import db from '../config/database.js';
import { InputError, positiveId, amountInCents, validDate, validMode, limitedText, cents, rupees } from "../utils/validation.js";

async function lockActiveStudent(connection, studentId) {
  const [[student]] = await connection.execute("SELECT id,total_fee,is_archived FROM students WHERE id=? FOR UPDATE",[studentId]);
  if (!student || student.is_archived) throw new InputError("Active student not found.", 404);
  return student;
}
async function availableCents(connection, student, excludeScheduleId = 0) {
  const [[paid]] = await connection.execute("SELECT COALESCE(SUM(amount),0) total FROM fee_payments WHERE student_id=?", [student.id]);
  const [[reserved]] = await connection.execute("SELECT COALESCE(SUM(scheduled_amount-received_amount),0) total FROM scheduled_payments WHERE student_id=? AND status IN ('UPCOMING','PARTIAL') AND id<>?", [student.id,excludeScheduleId]);
  const [[qrPending]] = await connection.execute(`SELECT COALESCE(SUM(p.amount),0) total
    FROM student_payments p JOIN student_installments i ON i.id=p.installment_id
    WHERE i.student_id=? AND p.status='PENDING'`, [student.id]);
  const [[qrReserved]] = await connection.execute(`SELECT COALESCE(SUM(GREATEST(i.amount-
      COALESCE((SELECT SUM(paid.amount) FROM student_payments paid WHERE paid.installment_id=i.id AND paid.status='PAID'),0)-
      COALESCE((SELECT SUM(pending.amount) FROM student_payments pending WHERE pending.installment_id=i.id AND pending.status='PENDING'),0),0)),0) total
    FROM student_installments i WHERE i.student_id=? AND i.is_cancelled=FALSE`, [student.id]);
  return Math.max(0,cents(student.total_fee)-cents(paid.total)-cents(reserved.total)-cents(qrPending.total)-cents(qrReserved.total));
}
export async function createSchedule(data = {}) {
  const studentId=positiveId(data.student_id,"student ID");
  const amount=amountInCents(data.scheduled_amount,{name:"Scheduled amount"});
  const date=validDate(data.scheduled_date,"scheduled date");
  const mode=validMode(data.payment_mode);
  const installment=limitedText(data.reference_number,120,"Installment");
  const transactionReference=limitedText(data.transaction_reference,120,"Transaction reference");
  const remarks=limitedText(data.remarks,500,"Remarks");
  const connection=await db.getConnection();
  try {
    await connection.beginTransaction();
    const student=await lockActiveStudent(connection,studentId);
    const available=await availableCents(connection,student);
    if(amount>available)throw new InputError(`Scheduled amount exceeds available due ₹${rupees(available)}. Other unpaid installments are included.`);
    const [result]=await connection.execute("INSERT INTO scheduled_payments(student_id,scheduled_amount,scheduled_date,payment_mode,reference_number,transaction_reference,remarks) VALUES(?,?,?,?,?,?,?)",[studentId,rupees(amount),date,mode,installment,transactionReference,remarks]);
    await connection.commit();
    return result.insertId;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
export async function listSchedules(filters = {}) {
  let sql = `SELECT sp.*,s.student_number AS student_code,s.student_name,s.mobile,s.alternate_phone AS alternate_mobile,
    CASE WHEN sp.status IN ('RECEIVED','CANCELLED') THEN sp.status
      WHEN sp.scheduled_date < CURDATE() THEN 'OVERDUE'
      WHEN sp.scheduled_date = CURDATE() THEN 'DUE_TODAY'
      ELSE 'UPCOMING' END display_status,
    GREATEST(sp.scheduled_amount-sp.received_amount,0) remaining_amount
    FROM scheduled_payments sp JOIN students s ON s.id=sp.student_id WHERE s.is_archived=0`;
  const values = [];
  if (!filters.status || filters.status === "ACTIVE") sql += " AND sp.status IN ('UPCOMING','PARTIAL')";
  if (filters.search) { sql += " AND (s.student_name LIKE ? OR s.student_number LIKE ? OR s.mobile LIKE ? OR s.alternate_phone LIKE ?)"; const q=`%${filters.search}%`; values.push(q,q,q,q); }
  if (filters.status && !["ALL", "ACTIVE"].includes(filters.status)) {
    if (filters.status === "OVERDUE") sql += " AND sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date<CURDATE()";
    else if (filters.status === "DUE_TODAY") sql += " AND sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date=CURDATE()";
    else if (filters.status === "UPCOMING") sql += " AND sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date>CURDATE()";
    else if (["PARTIAL","RECEIVED","CANCELLED"].includes(filters.status)) {sql += " AND sp.status=?";values.push(filters.status);}
    else throw new InputError("Invalid schedule status filter.");
  }
  if (filters.from) { sql += " AND sp.scheduled_date>=?"; values.push(validDate(filters.from)); }
  if (filters.to) { sql += " AND sp.scheduled_date<=?"; values.push(validDate(filters.to)); }
  sql += " ORDER BY sp.scheduled_date ASC,sp.id DESC";
  const [rows] = await db.execute(sql, values);
  return rows;
}
export async function scheduleSummary() {
  const [rows] = await db.execute(`SELECT
    COALESCE(SUM(CASE WHEN sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date>CURDATE() THEN sp.scheduled_amount-sp.received_amount ELSE 0 END),0) upcoming_amount,
    COALESCE(SUM(CASE WHEN sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date=CURDATE() THEN sp.scheduled_amount-sp.received_amount ELSE 0 END),0) due_today_amount,
    COALESCE(SUM(CASE WHEN sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date<CURDATE() THEN sp.scheduled_amount-sp.received_amount ELSE 0 END),0) overdue_amount,
    COALESCE(SUM(CASE WHEN sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date<CURDATE() THEN 1 ELSE 0 END),0) overdue_count,
    COALESCE(SUM(CASE WHEN sp.status IN ('UPCOMING','PARTIAL') AND sp.scheduled_date<=CURDATE() THEN 1 ELSE 0 END),0) reminder_count
    FROM scheduled_payments sp JOIN students s ON s.id=sp.student_id WHERE s.is_archived=0`);
  return rows[0];
}
export async function recordSchedulePayment(id,data = {}) {
  const scheduleId=positiveId(id,"schedule ID");
  const amount=amountInCents(data.amount,{name:"Received amount"});
  const paymentDate=validDate(data.payment_date,"payment date");
  const reference=limitedText(data.transaction_reference,120,"Transaction reference");
  const remarks=limitedText(data.remarks,500,"Remarks");
  const connection=await db.getConnection();
  try {
    await connection.beginTransaction();
    // Fetch student id without a lock, then acquire locks consistently: student, schedule.
    const [[owner]]=await connection.execute("SELECT student_id FROM scheduled_payments WHERE id=?",[scheduleId]);
    if(!owner)throw new InputError("Scheduled payment not found.",404);
    const student=await lockActiveStudent(connection,owner.student_id);
    const [[schedule]]=await connection.execute("SELECT * FROM scheduled_payments WHERE id=? AND student_id=? FOR UPDATE",[scheduleId,student.id]);
    if(!schedule || !["UPCOMING","PARTIAL"].includes(schedule.status))throw new InputError("Schedule is already completed or cancelled.");
    const remaining=cents(schedule.scheduled_amount)-cents(schedule.received_amount);
    const available=await availableCents(connection,student,scheduleId);
    if(amount>remaining)throw new InputError(`Received amount exceeds this installment's remaining ₹${rupees(remaining)}.`);
    if(amount>available)throw new InputError(`Received amount exceeds available due ₹${rupees(available)}.`);
    const [insert]=await connection.execute("INSERT INTO fee_payments(student_id,amount,payment_date,payment_mode,transaction_reference,remarks) VALUES(?,?,?,?,?,?)",[student.id,rupees(amount),paymentDate,schedule.payment_mode,reference||schedule.transaction_reference||schedule.reference_number||null,remarks||schedule.remarks||null]);
    const receipt=`DNS-RCP-${String(insert.insertId).padStart(7,"0")}`;
    await connection.execute("UPDATE fee_payments SET receipt_no=? WHERE id=?",[receipt,insert.insertId]);
    const newReceived=cents(schedule.received_amount)+amount;
    const complete=newReceived===cents(schedule.scheduled_amount);
    await connection.execute("UPDATE scheduled_payments SET received_amount=?,received_fee_payment_id=?,status=?,completed_at=? WHERE id=?",[rupees(newReceived),insert.insertId,complete?"RECEIVED":"PARTIAL",complete?new Date():null,scheduleId]);
    await connection.commit();
    return {id:insert.insertId,receipt_no:receipt,received_amount:Number(rupees(newReceived)),remaining_amount:Number(rupees(remaining-amount)),status:complete?"RECEIVED":"PARTIAL"};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
export async function updateSchedule(id,data = {}) {
  const scheduleId=positiveId(id,"schedule ID");
  const amount=amountInCents(data.scheduled_amount,{name:"Scheduled amount"});
  const date=validDate(data.scheduled_date,"scheduled date");
  const mode=validMode(data.payment_mode);
  const installment=limitedText(data.reference_number,120,"Installment");
  const transactionReference=limitedText(data.transaction_reference,120,"Transaction reference");
  const remarks=limitedText(data.remarks,500,"Remarks");
  const connection=await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[owner]]=await connection.execute("SELECT student_id FROM scheduled_payments WHERE id=?",[scheduleId]);
    if(!owner)throw new InputError("Scheduled payment not found.",404);
    const student=await lockActiveStudent(connection,owner.student_id);
    const [[schedule]]=await connection.execute("SELECT * FROM scheduled_payments WHERE id=? AND student_id=? FOR UPDATE",[scheduleId,student.id]);
    if(!schedule || !["UPCOMING","PARTIAL"].includes(schedule.status))throw new InputError("Only pending schedules can be edited.");
    const received=cents(schedule.received_amount);
    if(amount<received)throw new InputError(`Scheduled amount cannot be less than ₹${rupees(received)} already received.`);
    if(amount-received>await availableCents(connection,student,scheduleId))throw new InputError("Remaining installment exceeds unreserved due fee.");
    if(received>0 && mode!==schedule.payment_mode)throw new InputError("Payment mode cannot change after a partial receipt.");
    const status=amount===received?"RECEIVED":received?"PARTIAL":"UPCOMING";
    await connection.execute("UPDATE scheduled_payments SET scheduled_amount=?,scheduled_date=?,payment_mode=?,reference_number=?,transaction_reference=?,remarks=?,status=?,completed_at=? WHERE id=?",[rupees(amount),date,mode,installment,transactionReference,remarks,status,status==="RECEIVED"?new Date():null,scheduleId]);
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
export async function cancelSchedule(id) {
  const scheduleId=positiveId(id,"schedule ID");
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [[owner]]=await connection.execute("SELECT student_id FROM scheduled_payments WHERE id=?",[scheduleId]);
    if(!owner)throw new InputError("Schedule not found.",404);
    await lockActiveStudent(connection,owner.student_id);
    const [result]=await connection.execute("UPDATE scheduled_payments SET status='CANCELLED' WHERE id=? AND status IN ('UPCOMING','PARTIAL')",[scheduleId]);
    await connection.commit();return result.affectedRows;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
export async function studentSchedules(studentId) {
  const id=positiveId(studentId,"student ID");
  const [rows]=await db.execute(`SELECT *, CASE WHEN status IN ('RECEIVED','CANCELLED') THEN status WHEN scheduled_date<CURDATE() THEN 'OVERDUE' WHEN scheduled_date=CURDATE() THEN 'DUE_TODAY' ELSE 'UPCOMING' END display_status, GREATEST(scheduled_amount-received_amount,0) remaining_amount FROM scheduled_payments WHERE student_id=? ORDER BY scheduled_date DESC,id DESC`,[id]);
  return rows;
}

export async function getAvailableScheduleAmount(studentId) {
  const id=positiveId(studentId,"student ID");
  const [[row]]=await db.execute(`SELECT s.total_fee,
    COALESCE((SELECT SUM(amount) FROM fee_payments WHERE student_id=s.id),0) paid,
    COALESCE((SELECT SUM(scheduled_amount-received_amount) FROM scheduled_payments WHERE student_id=s.id AND status IN ('UPCOMING','PARTIAL')),0) reserved,
    COALESCE((SELECT SUM(p.amount) FROM student_payments p JOIN student_installments i ON i.id=p.installment_id WHERE i.student_id=s.id AND p.status='PENDING'),0) qr_pending,
    COALESCE((SELECT SUM(GREATEST(i.amount-
      COALESCE((SELECT SUM(paid.amount) FROM student_payments paid WHERE paid.installment_id=i.id AND paid.status='PAID'),0)-
      COALESCE((SELECT SUM(pending.amount) FROM student_payments pending WHERE pending.installment_id=i.id AND pending.status='PENDING'),0),0))
      FROM student_installments i WHERE i.student_id=s.id AND i.is_cancelled=FALSE),0) qr_reserved
    FROM students s WHERE s.id=? AND s.is_archived=0`,[id]);
  if(!row)throw new InputError("Active student not found.",404);
  return Number(rupees(Math.max(cents(row.total_fee)-cents(row.paid)-cents(row.reserved)-cents(row.qr_pending)-cents(row.qr_reserved),0)));
}
