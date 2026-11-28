import db from '../config/database.js';

const createFeeTables = async () => {
    const connection = await db.getConnection();

    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS fee_payments (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                receipt_no VARCHAR(40) UNIQUE,
                student_id BIGINT UNSIGNED NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                payment_date DATE NOT NULL,
                payment_mode ENUM('Cash','UPI','Bank','Card','Other') NOT NULL DEFAULT 'Cash',
                transaction_reference VARCHAR(120) DEFAULT NULL,
                remarks VARCHAR(500) DEFAULT NULL,
                source_student_payment_id BIGINT UNSIGNED DEFAULT NULL UNIQUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_payment_date (payment_date),
                INDEX idx_payment_student (student_id),
                CONSTRAINT fk_payment_student FOREIGN KEY (student_id)
                    REFERENCES students(id) ON DELETE RESTRICT ON UPDATE CASCADE
            ) ENGINE=InnoDB
        `);

        console.log("Fee payment tables ready");
    } finally {
        connection.release();
    }
};

export default createFeeTables;
