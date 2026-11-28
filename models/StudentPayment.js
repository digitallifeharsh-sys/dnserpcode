import db from '../config/database.js';

function cents(value) { return Math.round(Number(value) * 100); }

export default class StudentPayment {
    static async studentForInstallment(installmentId) {
        const [rows] = await db.execute(`
            SELECT s.* FROM students s
            JOIN student_installments i ON i.student_id = s.id
            WHERE i.id = ? LIMIT 1
        `, [installmentId]);
        return rows[0] || null;
    }

    static async installmentsForStudent(studentId) {
        const [rows] = await db.execute(`
            SELECT i.id, i.student_id, i.installment_no, i.title, i.amount, i.due_date, i.preferred_payment_mode, i.reference_number, i.remarks,
                   COALESCE(SUM(CASE WHEN p.status = 'PAID' THEN p.amount ELSE 0 END), 0) AS paid_amount,
                   COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) AS pending_amount
            FROM student_installments i
            LEFT JOIN student_payments p ON p.installment_id = i.id
            WHERE i.student_id = ? AND i.is_cancelled = FALSE
            GROUP BY i.id
            ORDER BY i.installment_no
        `, [studentId]);
        return rows.map(row => ({
            ...row,
            amount: Number(row.amount),
            paid_amount: Number(row.paid_amount),
            pending_amount: Number(row.pending_amount),
            balance: Math.max(0, Number(row.amount) - Number(row.paid_amount)),
            available: Math.max(0, Number(row.amount) - Number(row.paid_amount) - Number(row.pending_amount))
        }));
    }

    static async allScheduledInstallments(status = 'ACTIVE') {
        const where = status === 'ALL' ? '1=1' : 'i.is_cancelled = FALSE';
        const [rows] = await db.execute(`
            SELECT i.id, i.student_id, i.installment_no, i.title, i.amount, i.due_date,
                   i.preferred_payment_mode, i.reference_number, i.remarks, i.is_cancelled,
                   s.student_name, s.student_number,
                   COALESCE(SUM(CASE WHEN p.status = 'PAID' THEN p.amount ELSE 0 END), 0) AS paid_amount,
                   COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) AS pending_amount
            FROM student_installments i
            JOIN students s ON s.id = i.student_id
            LEFT JOIN student_payments p ON p.installment_id = i.id
            WHERE ${where}
            GROUP BY i.id
            ORDER BY i.due_date ASC, i.id DESC
        `);
        const today = new Date().toISOString().slice(0, 10);
        return rows.map(row => {
            const amount = Number(row.amount), paid = Number(row.paid_amount), pending = Number(row.pending_amount);
            const remaining = Math.max(0, amount - paid - pending);
            const dueDate = row.due_date ? (row.due_date instanceof Date ? row.due_date.toISOString().slice(0,10) : String(row.due_date).slice(0,10)) : '';
            let status = row.is_cancelled ? 'CANCELLED' : remaining <= 0 ? 'RECEIVED' : dueDate && dueDate < today ? 'OVERDUE' : dueDate && dueDate === today ? 'DUE TODAY' : 'UPCOMING';
            return { ...row, amount, paid_amount: paid, pending_amount: pending, remaining, status,
                student_code: row.student_number || `DNS${String(row.student_id).padStart(6, '0')}` };
        });
    }

    static async pendingQrPaymentsForStudent(studentId) {
        const [rows] = await db.execute(`
            SELECT p.id, p.installment_id, p.amount, p.cashfree_link_id, p.cashfree_link_url
            FROM student_payments p
            JOIN student_installments i ON i.id = p.installment_id
            WHERE i.student_id = ? AND p.status = 'PENDING' AND p.cashfree_link_url IS NOT NULL
            ORDER BY p.id DESC
        `, [studentId]);
        return rows;
    }

    static async createInstallment(studentId, { title, amount, dueDate, paymentMode = 'ANY', referenceNumber = null, remarks = null }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [students] = await connection.execute('SELECT total_fee FROM students WHERE id = ? FOR UPDATE', [studentId]);
            if (!students.length) throw new Error('Student not found.');
            const [totals] = await connection.execute('SELECT COALESCE(SUM(amount), 0) AS planned FROM student_installments WHERE student_id = ? AND is_cancelled = FALSE', [studentId]);
            if (cents(totals[0].planned) + cents(amount) > cents(students[0].total_fee)) throw new Error('Installment amounts cannot exceed the student total fee.');
            const [numbers] = await connection.execute('SELECT COALESCE(MAX(installment_no), 0) + 1 AS next_no FROM student_installments WHERE student_id = ?', [studentId]);
            await connection.execute(
                'INSERT INTO student_installments (student_id, installment_no, title, amount, due_date, preferred_payment_mode, reference_number, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [studentId, numbers[0].next_no, title, amount, dueDate || null, paymentMode, referenceNumber || null, remarks || null]
            );
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally { connection.release(); }
    }


    static async updateInstallment(installmentId, studentId, { title, amount, dueDate, paymentMode = 'ANY', referenceNumber = null, remarks = null }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute(
                `SELECT i.amount, s.total_fee FROM student_installments i
                 JOIN students s ON s.id = i.student_id
                 WHERE i.id = ? AND i.student_id = ? AND i.is_cancelled = FALSE FOR UPDATE`,
                [installmentId, studentId]
            );
            if (!rows.length) throw new Error('Scheduled payment not found.');
            const [payments] = await connection.execute(
                "SELECT COALESCE(SUM(amount),0) AS paid, COALESCE(SUM(CASE WHEN status='PENDING' THEN amount ELSE 0 END),0) AS pending FROM student_payments WHERE installment_id = ?",
                [installmentId]
            );
            if (cents(amount) < cents(payments[0].paid) + cents(payments[0].pending)) throw new Error('Schedule amount cannot be lower than already paid and pending payments.');
            const [otherTotals] = await connection.execute(
                'SELECT COALESCE(SUM(amount),0) AS planned FROM student_installments WHERE student_id = ? AND id <> ? AND is_cancelled = FALSE',
                [studentId, installmentId]
            );
            if (cents(otherTotals[0].planned) + cents(amount) > cents(rows[0].total_fee)) throw new Error('Total scheduled installments cannot exceed the student course fee.');
            await connection.execute(
                'UPDATE student_installments SET title = ?, amount = ?, due_date = ?, preferred_payment_mode = ?, reference_number = ?, remarks = ? WHERE id = ?',
                [title, amount, dueDate || null, paymentMode, referenceNumber || null, remarks || null, installmentId]
            );
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
    }

    static async cancelInstallment(installmentId, studentId) {
        const [rows] = await db.execute(
            "SELECT COUNT(*) AS total FROM student_payments WHERE installment_id = ? AND status IN ('PAID','PENDING')",
            [installmentId]
        );
        if (Number(rows[0].total)) throw new Error('This schedule has paid or pending transactions and cannot be cancelled.');
        await db.execute('UPDATE student_installments SET is_cancelled = TRUE WHERE id = ? AND student_id = ?', [installmentId, studentId]);
    }

    static async recordCash(installmentId, amount, referenceNumber) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [installments] = await connection.execute('SELECT amount FROM student_installments WHERE id = ? AND is_cancelled = FALSE FOR UPDATE', [installmentId]);
            if (!installments.length) throw new Error('Installment not found.');
            const [summaryRows] = await connection.execute(`
                SELECT COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) AS paid,
                       COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END), 0) AS pending
                FROM student_payments WHERE installment_id = ?
            `, [installmentId]);
            const remaining = cents(installments[0].amount) - cents(summaryRows[0].paid) - cents(summaryRows[0].pending);
            if (cents(amount) > remaining) throw new Error('Payment amount exceeds the remaining amount available for this installment.');
            const [insert] = await connection.execute(
                `INSERT INTO student_payments (installment_id, amount, payment_mode, status, reference_number, payment_date, paid_at)
                 VALUES (?, ?, 'CASH', 'PAID', ?, CURDATE(), CURRENT_TIMESTAMP)`,
                [installmentId, amount, referenceNumber || null]
            );
            await connection.execute(`
                INSERT IGNORE INTO fee_payments
                    (student_id, amount, payment_date, payment_mode, transaction_reference, source_student_payment_id)
                SELECT i.student_id, p.amount, COALESCE(p.payment_date, CURDATE()), 'Cash', p.reference_number, p.id
                FROM student_payments p JOIN student_installments i ON i.id=p.installment_id
                WHERE p.id=? AND p.status='PAID'
            `, [insert.insertId]);
            await connection.execute(`
                UPDATE fee_payments SET receipt_no=CONCAT('DNS-RCP-',LPAD(id,7,'0'))
                WHERE source_student_payment_id=? AND (receipt_no IS NULL OR receipt_no='')
            `, [insert.insertId]);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally { connection.release(); }
    }

    static async recordManualPayment(studentId, { amount, paymentDate, paymentMode, referenceNumber, remarks }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [students] = await connection.execute('SELECT total_fee FROM students WHERE id = ? AND is_archived = FALSE FOR UPDATE', [studentId]);
            if (!students.length) throw new Error('Student not found.');
            const [totals] = await connection.execute(`
                SELECT
                    COALESCE(SUM(CASE WHEN p.status = 'PAID' THEN p.amount ELSE 0 END), 0) paid,
                    COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) pending
                FROM student_installments i LEFT JOIN student_payments p ON p.installment_id = i.id
                WHERE i.student_id = ? AND i.is_cancelled = FALSE
            `, [studentId]);
            const dueCents = cents(students[0].total_fee) - cents(totals[0].paid) - cents(totals[0].pending);
            if (cents(amount) > dueCents) throw new Error('Payment amount exceeds the available due amount.');

            let [installments] = await connection.execute(`
                SELECT i.id, i.amount,
                    COALESCE(SUM(CASE WHEN p.status = 'PAID' THEN p.amount ELSE 0 END), 0) paid,
                    COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) pending
                FROM student_installments i LEFT JOIN student_payments p ON p.installment_id = i.id
                WHERE i.student_id = ? AND i.is_cancelled = FALSE
                GROUP BY i.id ORDER BY i.installment_no FOR UPDATE
            `, [studentId]);

            // If no schedule exists yet, create a backing installment for this collected amount.
            if (!installments.length) {
                const [next] = await connection.execute('SELECT COALESCE(MAX(installment_no),0)+1 next_no FROM student_installments WHERE student_id=?', [studentId]);
                const [created] = await connection.execute(
                    "INSERT INTO student_installments (student_id, installment_no, title, amount, due_date, preferred_payment_mode) VALUES (?, ?, 'Direct Collection', ?, ?, ?)",
                    [studentId, next[0].next_no, amount, paymentDate || null, paymentMode]
                );
                installments = [{ id: created.insertId, amount: Number(amount), paid: 0, pending: 0 }];
            }

            let remaining = cents(amount);
            for (const item of installments) {
                if (remaining <= 0) break;
                const available = cents(item.amount) - cents(item.paid) - cents(item.pending);
                if (available <= 0) continue;
                const part = Math.min(available, remaining);
                await connection.execute(`
                    INSERT INTO student_payments (installment_id, amount, payment_mode, status, reference_number, remarks, payment_date, paid_at)
                    VALUES (?, ?, ?, 'PAID', ?, ?, ?, ?)
                `, [item.id, (part / 100).toFixed(2), paymentMode, referenceNumber || null, remarks || null, paymentDate, `${paymentDate} 12:00:00`]);
                remaining -= part;
            }
            if (remaining > 0) {
                const [next] = await connection.execute('SELECT COALESCE(MAX(installment_no),0)+1 next_no FROM student_installments WHERE student_id=?', [studentId]);
                const [created] = await connection.execute(
                    "INSERT INTO student_installments (student_id, installment_no, title, amount, due_date, preferred_payment_mode) VALUES (?, ?, 'Direct Collection', ?, ?, ?)",
                    [studentId, next[0].next_no, (remaining / 100).toFixed(2), paymentDate || null, paymentMode]
                );
                await connection.execute(`INSERT INTO student_payments (installment_id, amount, payment_mode, status, reference_number, remarks, payment_date, paid_at) VALUES (?, ?, ?, 'PAID', ?, ?, ?, ?)`,
                    [created.insertId, (remaining / 100).toFixed(2), paymentMode, referenceNumber || null, remarks || null, paymentDate, `${paymentDate} 12:00:00`]);
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally { connection.release(); }
    }

    static async reserveCashfree(installmentId, amount) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [installments] = await connection.execute('SELECT amount FROM student_installments WHERE id = ? AND is_cancelled = FALSE FOR UPDATE', [installmentId]);
            if (!installments.length) throw new Error('Installment not found.');
            const [summaryRows] = await connection.execute(`
                SELECT COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) AS paid,
                       COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END), 0) AS pending
                FROM student_payments WHERE installment_id = ?
            `, [installmentId]);
            const remaining = cents(installments[0].amount) - cents(summaryRows[0].paid) - cents(summaryRows[0].pending);
            if (cents(amount) > remaining) throw new Error('Payment amount exceeds the remaining amount available for this installment.');
            const [result] = await connection.execute(
                `INSERT INTO student_payments (installment_id, amount, payment_mode, status)
                 VALUES (?, ?, 'CASHFREE', 'PENDING')`, [installmentId, amount]
            );
            await connection.commit();
            return result.insertId;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally { connection.release(); }
    }

    static async attachCashfreeLink(paymentId, linkId, linkUrl) {
        await db.execute('UPDATE student_payments SET cashfree_link_id = ?, cashfree_link_url = ? WHERE id = ?', [linkId, linkUrl, paymentId]);
    }

    static async failCashfreePayment(paymentId) {
        await db.execute("UPDATE student_payments SET status = 'FAILED' WHERE id = ? AND status = 'PENDING'", [paymentId]);
    }

    static async findByCashfreeLinkId(linkId) {
        const [rows] = await db.execute(`
            SELECT p.id, p.amount, p.status, p.installment_id
            FROM student_payments p WHERE p.cashfree_link_id = ? LIMIT 1
        `, [linkId]);
        return rows[0] || null;
    }

    static async markCashfreePaid(paymentId, transactionId = null) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [updated] = await connection.execute(
                "UPDATE student_payments SET status = 'PAID', reference_number = COALESCE(?, reference_number), payment_date = COALESCE(payment_date, CURDATE()), paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING'",
                [transactionId, paymentId]
            );
            if (updated.affectedRows) {
                await connection.execute(`
                    INSERT IGNORE INTO fee_payments
                        (student_id, amount, payment_date, payment_mode, transaction_reference, remarks, source_student_payment_id)
                    SELECT i.student_id, p.amount, COALESCE(p.payment_date, DATE(p.paid_at), CURDATE()),
                           'UPI', p.reference_number, p.remarks, p.id
                    FROM student_payments p
                    JOIN student_installments i ON i.id = p.installment_id
                    WHERE p.id = ? AND p.status = 'PAID'
                `, [paymentId]);
                await connection.execute(`
                    UPDATE fee_payments
                    SET receipt_no = CONCAT('DNS-RCP-', LPAD(id, 7, '0'))
                    WHERE source_student_payment_id = ? AND (receipt_no IS NULL OR receipt_no='')
                `, [paymentId]);
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}
