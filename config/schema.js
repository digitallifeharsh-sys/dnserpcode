import db from './database.js';
import mysql from 'mysql2/promise';
import createFeePaymentTables from '../models/feePaymentTables.js';
import createScheduledPaymentTables from '../models/scheduledPaymentTables.js';

export async function initializeSchema() {
    const databaseName = process.env.DB_NAME || 'erpfee';
    if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) throw new Error('Invalid DB_NAME');
    const server = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'harsh',
        password: process.env.DB_PASSWORD || 'Harsh0003'
    });
    await server.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await server.end();
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        username VARCHAR(190) NOT NULL UNIQUE,
        phone VARCHAR(30) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        permissions JSON NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.execute(`CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await db.execute(`CREATE TABLE IF NOT EXISTS categories (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL UNIQUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await db.execute(`CREATE TABLE IF NOT EXISTS subcategories (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        category_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(120) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_subcategory_category_name (category_id, name),
        CONSTRAINT fk_subcategory_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.execute(`CREATE TABLE IF NOT EXISTS students (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_name VARCHAR(160) NOT NULL,
        gender ENUM('Male', 'Female', 'Other') NOT NULL,
        father_name VARCHAR(160) NULL,
        mother_name VARCHAR(160) NULL,
        student_number VARCHAR(60) NULL UNIQUE,
        father_phone VARCHAR(30) NULL,
        alternate_phone VARCHAR(30) NULL,
        whatsapp_number VARCHAR(30) NULL,
        total_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        category_id BIGINT UNSIGNED NULL,
        subcategory_id BIGINT UNSIGNED NULL,
        remarks TEXT NULL,
        image_data MEDIUMBLOB NULL,
        image_mime VARCHAR(40) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_students_category_subcategory (category_id, subcategory_id),
        CONSTRAINT fk_student_category FOREIGN KEY (category_id) REFERENCES categories(id),
        CONSTRAINT fk_student_subcategory FOREIGN KEY (subcategory_id) REFERENCES subcategories(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Additive student profile fields. Existing columns and records are never dropped.
    const addColumnIfMissing = async (table, column, definition) => {
        const [found] = await db.execute(
            `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [table, column]
        );
        if (!Number(found[0].total)) {
            await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            return true;
        }
        return false;
    };

    const mobileColumnAdded = await addColumnIfMissing('students', 'mobile', 'VARCHAR(30) NULL');
    await addColumnIfMissing('students', 'address', 'TEXT NULL');
    await addColumnIfMissing('students', 'board', 'VARCHAR(40) NULL');
    await addColumnIfMissing('students', 'student_class', 'VARCHAR(20) NULL');
    await addColumnIfMissing('students', 'stream', 'VARCHAR(60) NULL');
    const admissionDateColumnAdded = await addColumnIfMissing('students', 'admission_date', 'DATE NULL');
    await addColumnIfMissing('students', 'is_archived', 'BOOLEAN NOT NULL DEFAULT FALSE');

    // Category and subcategory are optional on student admission. Existing values are preserved.
    await db.execute('ALTER TABLE students MODIFY COLUMN category_id BIGINT UNSIGNED NULL');
    await db.execute('ALTER TABLE students MODIFY COLUMN subcategory_id BIGINT UNSIGNED NULL');

    // Backfill only when the new columns are first introduced.
    if (mobileColumnAdded) {
        await db.execute(`UPDATE students SET mobile = father_phone WHERE father_phone IS NOT NULL`);
    }
    if (admissionDateColumnAdded) {
        await db.execute(`UPDATE students SET admission_date = DATE(created_at)`);
    }


    await db.execute(`CREATE TABLE IF NOT EXISTS student_installments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id BIGINT UNSIGNED NOT NULL,
        installment_no INT UNSIGNED NOT NULL,
        title VARCHAR(120) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        due_date DATE NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_student_installment_no (student_id, installment_no),
        CONSTRAINT fk_installment_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.execute(`CREATE TABLE IF NOT EXISTS student_payments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        installment_id BIGINT UNSIGNED NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_mode ENUM('CASH', 'UPI', 'BANK', 'CARD', 'OTHER', 'CASHFREE') NOT NULL,
        status ENUM('PENDING', 'PAID', 'FAILED') NOT NULL,
        reference_number VARCHAR(120) NULL,
        cashfree_link_id VARCHAR(100) NULL UNIQUE,
        cashfree_link_url TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL,
        KEY idx_student_payment_installment_status (installment_id, status),
        CONSTRAINT fk_payment_installment FOREIGN KEY (installment_id) REFERENCES student_installments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await addColumnIfMissing('student_installments', 'is_cancelled', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await addColumnIfMissing('student_installments', 'reference_number', 'VARCHAR(120) NULL');
    await addColumnIfMissing('student_installments', 'remarks', 'VARCHAR(500) NULL');
    await addColumnIfMissing('student_installments', 'preferred_payment_mode', "ENUM('ANY','CASH','UPI','BANK','CARD','OTHER','CASHFREE') NOT NULL DEFAULT 'ANY'");
    await addColumnIfMissing('student_payments', 'remarks', 'VARCHAR(500) NULL');
    await addColumnIfMissing('student_payments', 'payment_date', 'DATE NULL');
    // Upgrade older installations without dropping payment records.
    await db.execute("ALTER TABLE student_payments MODIFY payment_mode ENUM('CASH','UPI','BANK','CARD','OTHER','CASHFREE') NOT NULL");
    await db.execute("ALTER TABLE student_installments MODIFY preferred_payment_mode ENUM('ANY','CASH','UPI','BANK','CARD','OTHER','CASHFREE') NOT NULL DEFAULT 'ANY'");

    await db.execute(`CREATE TABLE IF NOT EXISTS general_qr_collections (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        payer_name VARCHAR(160) NULL,
        payer_phone VARCHAR(30) NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('PENDING', 'PAID', 'FAILED') NOT NULL DEFAULT 'PENDING',
        cashfree_link_id VARCHAR(100) NULL UNIQUE,
        cashfree_link_url TEXT NULL,
        reference_number VARCHAR(120) NULL,
        linked_student_id BIGINT UNSIGNED NULL,
        linked_installment_id BIGINT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL,
        KEY idx_general_collection_status (status, created_at),
        CONSTRAINT fk_general_collection_student FOREIGN KEY (linked_student_id) REFERENCES students(id) ON DELETE SET NULL,
        CONSTRAINT fk_general_collection_installment FOREIGN KEY (linked_installment_id) REFERENCES student_installments(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);


    // Fee collection and scheduled-payment modules copied from DNS Updated.
    // These are additive tables; existing QR collection tables remain untouched.
    await createFeePaymentTables();
    await addColumnIfMissing('fee_payments', 'source_student_payment_id', 'BIGINT UNSIGNED NULL UNIQUE');
    await createScheduledPaymentTables();
    await addColumnIfMissing('scheduled_payments', 'transaction_reference', 'VARCHAR(120) NULL');

    // Keep previously recorded successful Cashfree/manual student payments visible
    // in the unified fee-payment history. source_student_payment_id prevents duplicates.
    await db.execute(`
        INSERT IGNORE INTO fee_payments
            (student_id, amount, payment_date, payment_mode, transaction_reference, remarks, source_student_payment_id)
        SELECT i.student_id, p.amount,
               COALESCE(p.payment_date, DATE(p.paid_at), DATE(p.created_at)),
               CASE WHEN p.payment_mode='CASHFREE' THEN 'UPI'
                    WHEN p.payment_mode='CASH' THEN 'Cash'
                    WHEN p.payment_mode='UPI' THEN 'UPI'
                    WHEN p.payment_mode='BANK' THEN 'Bank'
                    WHEN p.payment_mode='CARD' THEN 'Card'
                    ELSE 'Other' END,
               p.reference_number, p.remarks, p.id
        FROM student_payments p
        JOIN student_installments i ON i.id=p.installment_id
        WHERE p.status='PAID'
    `);
    await db.execute(`
        UPDATE fee_payments
        SET receipt_no = CONCAT('DNS-RCP-', LPAD(id, 7, '0'))
        WHERE receipt_no IS NULL OR receipt_no=''
    `);

}
