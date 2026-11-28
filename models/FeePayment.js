import db from '../config/database.js';
import { InputError, positiveId, amountInCents, validDate, validMode, limitedText, cents, rupees } from "../utils/validation.js";

export async function addPayment(data = {}) {
  const studentId = positiveId(data.student_id, "student ID");
  const amountCents = amountInCents(data.amount, {name:"Payment"});
  const date = validDate(data.payment_date, "payment date");
  const mode = validMode(data.payment_mode);
  const reference = limitedText(data.transaction_reference, 120, "Transaction reference");
  const remarks = limitedText(data.remarks, 500, "Remarks");
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    // This same student-row mutex is shared with all schedule mutations/receipts.
    const [[student]] = await c.execute("SELECT total_fee,is_archived FROM students WHERE id=? FOR UPDATE", [studentId]);
    if (!student || student.is_archived) throw new InputError("Active student not found.", 404);
    const [[paid]] = await c.execute("SELECT COALESCE(SUM(amount),0) paid FROM fee_payments WHERE student_id=?", [studentId]);
    const [[scheduled]] = await c.execute("SELECT COALESCE(SUM(scheduled_amount-received_amount),0) reserved FROM scheduled_payments WHERE student_id=? AND status IN ('UPCOMING','PARTIAL')",[studentId]);
    const [[qrPending]] = await c.execute(`SELECT COALESCE(SUM(p.amount),0) pending
      FROM student_payments p JOIN student_installments i ON i.id=p.installment_id
      WHERE i.student_id=? AND p.status='PENDING'`, [studentId]);
    const [[qrReserved]] = await c.execute(`SELECT COALESCE(SUM(GREATEST(i.amount-
        COALESCE((SELECT SUM(paid.amount) FROM student_payments paid WHERE paid.installment_id=i.id AND paid.status='PAID'),0)-
        COALESCE((SELECT SUM(pending.amount) FROM student_payments pending WHERE pending.installment_id=i.id AND pending.status='PENDING'),0),0)),0) reserved
      FROM student_installments i WHERE i.student_id=? AND i.is_cancelled=FALSE`, [studentId]);
    const available = Math.max(cents(student.total_fee)-cents(paid.paid)-cents(scheduled.reserved)-cents(qrPending.pending)-cents(qrReserved.reserved),0);
    if (amountCents > available) throw new InputError(`Payment exceeds unreserved due fee ₹${rupees(available)}. Receive or cancel an existing scheduled installment first.`);
    const [r] = await c.execute("INSERT INTO fee_payments(student_id,amount,payment_date,payment_mode,transaction_reference,remarks) VALUES(?,?,?,?,?,?)",[studentId,rupees(amountCents),date,mode,reference,remarks]);
    const receipt = `DNS-RCP-${String(r.insertId).padStart(7,"0")}`;
    await c.execute("UPDATE fee_payments SET receipt_no=? WHERE id=?",[receipt,r.insertId]);
    await c.commit();
    return {id:r.insertId,receipt_no:receipt};
  } catch(e) {await c.rollback();throw e;} finally {c.release();}
}

export async function getPayments(id) {
  const studentId = positiveId(id, "student ID");
  const [rows] = await db.execute("SELECT * FROM fee_payments WHERE student_id=? ORDER BY payment_date DESC,id DESC",[studentId]);
  return rows;
}

export async function paymentSummary(studentId) {
  const id = positiveId(studentId, "student ID");
  const [[row]] = await db.execute(`SELECT s.total_fee,
    COALESCE((SELECT SUM(amount) FROM fee_payments WHERE student_id=s.id),0) paid,
    COALESCE((SELECT SUM(scheduled_amount-received_amount) FROM scheduled_payments WHERE student_id=s.id AND status IN ('UPCOMING','PARTIAL')),0) reserved,
    COALESCE((SELECT SUM(p.amount) FROM student_payments p JOIN student_installments i ON i.id=p.installment_id WHERE i.student_id=s.id AND p.status='PENDING'),0) qr_pending,
    COALESCE((SELECT SUM(GREATEST(i.amount-
      COALESCE((SELECT SUM(paid.amount) FROM student_payments paid WHERE paid.installment_id=i.id AND paid.status='PAID'),0)-
      COALESCE((SELECT SUM(pending.amount) FROM student_payments pending WHERE pending.installment_id=i.id AND pending.status='PENDING'),0),0))
      FROM student_installments i WHERE i.student_id=s.id AND i.is_cancelled=FALSE),0) qr_reserved
    FROM students s WHERE s.id=? AND s.is_archived=0`, [id]);
  if (!row) throw new InputError("Active student not found.", 404);
  const total = cents(row.total_fee), paid = cents(row.paid), reserved = cents(row.reserved), pending = cents(row.qr_pending), qrReserved = cents(row.qr_reserved);
  return {
    total_fee: Number(row.total_fee),
    paid_total: Number(rupees(paid)),
    reserved_total: Number(rupees(reserved)),
    qr_pending_total: Number(rupees(pending)),
    qr_reserved_total: Number(rupees(qrReserved)),
    available_to_collect: Number(rupees(Math.max(total-paid-reserved-pending-qrReserved,0))),
    due_total: Number(rupees(Math.max(total-paid,0)))
  };
}
