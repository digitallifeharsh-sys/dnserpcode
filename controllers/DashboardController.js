import db from '../config/database.js';

export default class DashboardController {
    static index = async (req, res) => {
        try {
            const [[studentStats]] = await db.execute(`
                SELECT COUNT(*) AS total_students,
                       SUM(CASE WHEN is_archived = FALSE THEN 1 ELSE 0 END) AS active_students,
                       COALESCE(SUM(CASE WHEN is_archived = FALSE THEN total_fee ELSE 0 END),0) AS total_fee
                FROM students
            `);
            const [[paymentStats]] = await db.execute(`
                SELECT COALESCE(SUM(amount),0) AS collected,
                       COALESCE(SUM(CASE WHEN payment_date=CURDATE() THEN amount ELSE 0 END),0) AS today
                FROM fee_payments
            `);
            const [[generalStats]] = await db.execute(`
                SELECT COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END),0) AS general_collected,
                       COALESCE(SUM(CASE WHEN status='PAID' AND linked_installment_id IS NULL THEN amount ELSE 0 END),0) AS unlinked_general_collected,
                       COALESCE(SUM(CASE WHEN status='PAID' AND linked_installment_id IS NULL AND DATE(paid_at)=CURDATE() THEN amount ELSE 0 END),0) AS today_unlinked_general
                FROM general_qr_collections
            `);
            const remainingDue = Math.max(0, Number(studentStats.total_fee || 0) - Number(paymentStats.collected || 0));
            const [[overdueCount]] = await db.execute(`
                SELECT COUNT(*) AS total FROM (
                    SELECT sp.id FROM scheduled_payments sp JOIN students s ON s.id=sp.student_id
                    WHERE s.is_archived=FALSE AND sp.status IN ('UPCOMING','PARTIAL')
                      AND sp.scheduled_date < CURDATE() AND sp.scheduled_amount > sp.received_amount
                    UNION ALL
                    SELECT i.id FROM student_installments i
                    JOIN students s ON s.id=i.student_id AND s.is_archived=FALSE
                    LEFT JOIN (SELECT installment_id, SUM(amount) AS paid FROM student_payments WHERE status='PAID' GROUP BY installment_id) p ON p.installment_id=i.id
                    WHERE i.is_cancelled=FALSE AND i.due_date < CURDATE() AND i.amount > COALESCE(p.paid,0)
                ) overdue_rows
            `);
            const [upcoming] = await db.execute(`
                SELECT * FROM (
                    SELECT s.id,
                           CONVERT(s.student_name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS student_name,
                           CONVERT(COALESCE(sp.reference_number,'Installment') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
                           sp.scheduled_date AS due_date, sp.scheduled_amount AS amount,
                           sp.received_amount AS paid
                    FROM scheduled_payments sp JOIN students s ON s.id=sp.student_id
                    WHERE s.is_archived=FALSE AND sp.status IN ('UPCOMING','PARTIAL')
                      AND sp.scheduled_date >= CURDATE() AND sp.scheduled_amount > sp.received_amount
                    UNION ALL
                    SELECT s.id,
                           CONVERT(s.student_name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS student_name,
                           CONVERT(i.title USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
                           i.due_date, i.amount,
                           COALESCE(p.paid,0) AS paid
                    FROM student_installments i JOIN students s ON s.id=i.student_id
                    LEFT JOIN (SELECT installment_id, SUM(amount) AS paid FROM student_payments WHERE status='PAID' GROUP BY installment_id) p ON p.installment_id=i.id
                    WHERE s.is_archived=FALSE AND i.is_cancelled=FALSE AND i.due_date >= CURDATE()
                      AND i.amount > COALESCE(p.paid,0)
                ) upcoming_rows
                ORDER BY due_date ASC LIMIT 8
            `);
            const [overdue] = await db.execute(`
                SELECT * FROM (
                    SELECT s.id,
                           CONVERT(s.student_name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS student_name,
                           CONVERT(COALESCE(sp.reference_number,'Installment') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
                           sp.scheduled_date AS due_date, sp.scheduled_amount AS amount,
                           sp.received_amount AS paid
                    FROM scheduled_payments sp JOIN students s ON s.id=sp.student_id
                    WHERE s.is_archived=FALSE AND sp.status IN ('UPCOMING','PARTIAL')
                      AND sp.scheduled_date < CURDATE() AND sp.scheduled_amount > sp.received_amount
                    UNION ALL
                    SELECT s.id,
                           CONVERT(s.student_name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS student_name,
                           CONVERT(i.title USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
                           i.due_date, i.amount,
                           COALESCE(p.paid,0) AS paid
                    FROM student_installments i JOIN students s ON s.id=i.student_id
                    LEFT JOIN (SELECT installment_id, SUM(amount) AS paid FROM student_payments WHERE status='PAID' GROUP BY installment_id) p ON p.installment_id=i.id
                    WHERE s.is_archived=FALSE AND i.is_cancelled=FALSE AND i.due_date < CURDATE()
                      AND i.amount > COALESCE(p.paid,0)
                ) overdue_rows
                ORDER BY due_date ASC LIMIT 8
            `);
            const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const stats = [
                { title: 'Total Students', value: Number(studentStats.total_students || 0).toLocaleString('en-IN'), icon: 'fa-user-graduate', color: 'primary' },
                { title: 'Active Students', value: Number(studentStats.active_students || 0).toLocaleString('en-IN'), icon: 'fa-user-check', color: 'success' },
                { title: 'Total Fee', value: money(studentStats.total_fee), icon: 'fa-indian-rupee-sign', color: 'info' },
                { title: 'Total Collected', value: money(Number(paymentStats.collected) + Number(generalStats.unlinked_general_collected)), icon: 'fa-wallet', color: 'success' },
                { title: 'Remaining Due', value: money(remainingDue), icon: 'fa-hourglass-half', color: 'warning' },
                { title: "Today's Collection", value: money(Number(paymentStats.today) + Number(generalStats.today_unlinked_general)), icon: 'fa-calendar-check', color: 'primary' },
                { title: 'General QR Collection', value: money(generalStats.general_collected), icon: 'fa-qrcode', color: 'info' },
                { title: 'Overdue Payments', value: Number(overdueCount.total || 0).toLocaleString('en-IN'), icon: 'fa-clock', color: 'warning' }
            ];
            return res.render('dashboard/index', { title: 'Dashboard', page: 'dashboard', stats, upcoming, overdue });
        } catch (error) {
            console.error('Dashboard Error:', error);
            return res.status(500).send('Dashboard could not be loaded. Check database migrations and server logs.');
        }
    };
}
