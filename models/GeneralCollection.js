import db from '../config/database.js';

const cents = value => Math.round(Number(value) * 100);

export default class GeneralCollection {
    static async create({ payerName, payerPhone, amount }) {
        const [result] = await db.execute(
            `INSERT INTO general_qr_collections (payer_name, payer_phone, amount, status) VALUES (?, ?, ?, 'PENDING')`,
            [payerName || null, payerPhone || null, amount]
        );
        return result.insertId;
    }

    static async attachLink(id, linkId, url) {
        await db.execute('UPDATE general_qr_collections SET cashfree_link_id = ?, cashfree_link_url = ? WHERE id = ?', [linkId, url, id]);
    }

    static async fail(id) {
        await db.execute("UPDATE general_qr_collections SET status = 'FAILED' WHERE id = ? AND status = 'PENDING'", [id]);
    }

    static async findByLinkId(linkId) {
        const [rows] = await db.execute('SELECT * FROM general_qr_collections WHERE cashfree_link_id = ? LIMIT 1', [linkId]);
        return rows[0] || null;
    }

    static async markPaid(id, transactionId = null) {
        await db.execute("UPDATE general_qr_collections SET status = 'PAID', reference_number = COALESCE(?, reference_number), paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING'", [transactionId, id]);
    }

    static async list() {
        const [rows] = await db.execute(`
            SELECT g.*, s.student_name, i.title AS installment_title
            FROM general_qr_collections g
            LEFT JOIN students s ON s.id = g.linked_student_id
            LEFT JOIN student_installments i ON i.id = g.linked_installment_id
            ORDER BY g.id DESC LIMIT 300
        `);
        return rows;
    }

    static async linkToInstallment(collectionId, studentId, installmentId) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [collections] = await connection.execute(
                "SELECT * FROM general_qr_collections WHERE id = ? AND status = 'PAID' AND linked_installment_id IS NULL FOR UPDATE",
                [collectionId]
            );
            if (!collections.length) throw new Error('Paid general collection not found or already linked.');
            const [installments] = await connection.execute(
                `SELECT i.amount, i.student_id FROM student_installments i WHERE i.id = ? AND i.student_id = ? FOR UPDATE`,
                [installmentId, studentId]
            );
            if (!installments.length) throw new Error('Selected installment does not belong to this student.');
            const [paidRows] = await connection.execute(
                `SELECT COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END),0) AS paid,
                        COALESCE(SUM(CASE WHEN status='PENDING' THEN amount ELSE 0 END),0) AS pending
                 FROM student_payments WHERE installment_id = ?`,
                [installmentId]
            );
            const remaining = cents(installments[0].amount) - cents(paidRows[0].paid) - cents(paidRows[0].pending);
            if (cents(collections[0].amount) > remaining) throw new Error('Collection amount exceeds this installment balance.');
            await connection.execute(
                `INSERT INTO student_payments (installment_id, amount, payment_mode, status, reference_number, paid_at)
                 VALUES (?, ?, 'CASHFREE', 'PAID', ?, COALESCE(?, CURRENT_TIMESTAMP))`,
                [installmentId, collections[0].amount, `General QR #${collectionId}`, collections[0].paid_at]
            );
            await connection.execute(
                'UPDATE general_qr_collections SET linked_student_id = ?, linked_installment_id = ? WHERE id = ?',
                [studentId, installmentId, collectionId]
            );
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally { connection.release(); }
    }
}
