import db from '../config/database.js';
const createScheduledPaymentTables = async () => {
  const c = await db.getConnection();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS scheduled_payments (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        student_id BIGINT UNSIGNED NOT NULL,
        scheduled_amount DECIMAL(10,2) NOT NULL,
        scheduled_date DATE NOT NULL,
        payment_mode ENUM('Cash','UPI','Bank','Card','Other') NOT NULL DEFAULT 'Cash',
        reference_number VARCHAR(120) DEFAULT NULL,
        transaction_reference VARCHAR(120) DEFAULT NULL,
        remarks VARCHAR(500) DEFAULT NULL,
        status ENUM('UPCOMING','RECEIVED','PARTIAL','CANCELLED') NOT NULL DEFAULT 'UPCOMING',
        received_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        received_fee_payment_id BIGINT UNSIGNED DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at DATETIME DEFAULT NULL,
        INDEX idx_schedule_student(student_id),
        INDEX idx_schedule_date(scheduled_date),
        INDEX idx_schedule_status(status),
        CONSTRAINT fk_schedule_student FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_payment FOREIGN KEY(received_fee_payment_id) REFERENCES fee_payments(id) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log("Scheduled payment tables ready");
  } finally { c.release(); }
};
export default createScheduledPaymentTables;
