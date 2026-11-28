import Student from '../models/Student.js';
import StudentPayment from '../models/StudentPayment.js';
import CashfreeGateway from '../services/CashfreeGateway.js';
import GeneralCollection from '../models/GeneralCollection.js';
import * as FeePayment from '../models/FeePayment.js';
import * as ScheduledPayment from '../models/ScheduledPayment.js';

function parseAmount(value) {
    const amount = String(value || '').trim();
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return null;
    return Number(amount).toFixed(2);
}

function redirectWithMessage(res, studentId, type, message) {
    return res.redirect(`/students/${studentId}?${type}=${encodeURIComponent(message)}`);
}

export default class StudentPaymentController {
    static detail = async (req, res) => {
        const id = Number(req.params.id);
        const student = Number.isSafeInteger(id) && id > 0 ? await Student.findById(id) : null;
        if (!student) return res.status(404).send('Student not found.');
        const [payments, installments, summary, pendingQrPayments] = await Promise.all([
            FeePayment.getPayments(id),
            ScheduledPayment.studentSchedules(id),
            FeePayment.paymentSummary(id),
            StudentPayment.pendingQrPaymentsForStudent(id)
        ]);
        return res.render('students/payments', {
            title: 'Student Fees', page: 'students', student, payments, installments, pendingQrPayments,
            paidTotal: summary.paid_total,
            pendingTotal: summary.qr_pending_total,
            plannedTotal: summary.reserved_total,
            remainingTotal: summary.available_to_collect,
            summary,
            error: req.query.error || null, success: req.query.success || null
        });
    };

    static scheduledPage = async (req, res) => {
        const students = await Student.paymentOptions();
        const selectedStudentId = String(req.query.student_id || '');
        const status = String(req.query.status || 'ACTIVE');
        const installments = await ScheduledPayment.listSchedules({
            status,
            search: String(req.query.search || '').trim()
        });
        const availableDue = selectedStudentId
            ? await ScheduledPayment.getAvailableScheduleAmount(selectedStudentId).catch(() => 0)
            : 0;
        return res.render('payments/scheduled', {
            title: 'Scheduled Payments', page: 'scheduled-payments',
            students, installments, selectedStudentId, status, availableDue,
            success: req.query.success || null, error: req.query.error || null
        });
    };

    static availableScheduleAmount = async (req, res) => {
        try {
            const available_due = await ScheduledPayment.getAvailableScheduleAmount(req.params.studentId);
            return res.json({ success: true, data: { available_due } });
        } catch (error) {
            return res.status(error.status || 400).json({ success: false, message: error.message });
        }
    };

    static createScheduledFromPage = async (req, res) => {
        const studentId = Number(req.body.student_id);
        try {
            const id = await ScheduledPayment.createSchedule({
                student_id: studentId,
                scheduled_amount: req.body.scheduled_amount || req.body.amount,
                scheduled_date: req.body.scheduled_date || req.body.due_date,
                payment_mode: req.body.payment_mode,
                reference_number: req.body.reference_number || req.body.title,
                transaction_reference: req.body.transaction_reference,
                remarks: req.body.remarks
            });
            return res.redirect(`/payments/scheduled?student_id=${studentId}&success=${encodeURIComponent('Scheduled payment saved.')}`);
        } catch (error) {
            return res.redirect(`/payments/scheduled?student_id=${Number.isSafeInteger(studentId) ? studentId : ''}&error=${encodeURIComponent(error.message)}`);
        }
    };

    static collectPayment = async (req, res) => {
        const studentId = Number(req.params.id);
        try {
            const result = await FeePayment.addPayment({
                student_id: studentId,
                amount: req.body.amount,
                payment_date: req.body.payment_date,
                payment_mode: req.body.payment_mode,
                transaction_reference: req.body.transaction_reference,
                remarks: req.body.remarks
            });
            return redirectWithMessage(res, studentId, 'success', `Fee payment collected successfully. Receipt ${result.receipt_no}.`);
        } catch (error) {
            return redirectWithMessage(res, studentId, 'error', error.message);
        }
    };

    static addInstallment = async (req, res) => {
        const studentId = Number(req.params.id);
        try {
            await ScheduledPayment.createSchedule({
                student_id: studentId,
                scheduled_amount: req.body.scheduled_amount || req.body.amount,
                scheduled_date: req.body.scheduled_date || req.body.due_date,
                payment_mode: req.body.payment_mode,
                reference_number: req.body.reference_number || req.body.title,
                transaction_reference: req.body.transaction_reference,
                remarks: req.body.remarks
            });
            return redirectWithMessage(res, studentId, 'success', 'Installment scheduled successfully.');
        } catch (error) {
            return redirectWithMessage(res, studentId, 'error', error.message);
        }
    };

    static updateInstallment = async (req, res) => {
        const studentId = Number(req.params.id);
        try {
            await ScheduledPayment.updateSchedule(req.params.installmentId, {
                scheduled_amount: req.body.scheduled_amount || req.body.amount,
                scheduled_date: req.body.scheduled_date || req.body.due_date,
                payment_mode: req.body.payment_mode,
                reference_number: req.body.reference_number || req.body.title,
                transaction_reference: req.body.transaction_reference,
                remarks: req.body.remarks
            });
            return redirectWithMessage(res, studentId, 'success', 'Scheduled payment updated.');
        } catch (error) {
            return redirectWithMessage(res, studentId, 'error', error.message);
        }
    };

    static cancelInstallment = async (req, res) => {
        const studentId = Number(req.params.id);
        try {
            const changed = await ScheduledPayment.cancelSchedule(req.params.installmentId);
            if (!changed) throw new Error('This scheduled payment can no longer be cancelled.');
            return redirectWithMessage(res, studentId, 'success', 'Scheduled payment cancelled.');
        } catch (error) {
            return redirectWithMessage(res, studentId, 'error', error.message);
        }
    };

    static recordCash = async (req, res) => {
        const scheduleId = Number(req.params.installmentId);
        const studentId = Number(req.body.student_id);
        try {
            await ScheduledPayment.recordSchedulePayment(scheduleId, {
                amount: req.body.amount,
                payment_date: req.body.payment_date || new Date().toISOString().slice(0, 10),
                transaction_reference: req.body.reference_number,
                remarks: req.body.remarks
            });
            return redirectWithMessage(res, studentId, 'success', 'Scheduled installment payment received.');
        } catch (error) {
            return redirectWithMessage(res, studentId, 'error', error.message);
        }
    };

    static receiveScheduledFromPage = async (req, res) => {
        try {
            await ScheduledPayment.recordSchedulePayment(req.params.id, {
                amount: req.body.amount,
                payment_date: req.body.payment_date || new Date().toISOString().slice(0, 10),
                transaction_reference: req.body.transaction_reference,
                remarks: req.body.remarks
            });
            return res.redirect(`/payments/scheduled?success=${encodeURIComponent('Payment received and added to Payment History.')}`);
        } catch (error) {
            return res.redirect(`/payments/scheduled?error=${encodeURIComponent(error.message)}`);
        }
    };

    static updateScheduledFromPage = async (req, res) => {
        try {
            await ScheduledPayment.updateSchedule(req.params.id, {
                scheduled_amount: req.body.scheduled_amount,
                scheduled_date: req.body.scheduled_date,
                payment_mode: req.body.payment_mode,
                reference_number: req.body.reference_number,
                transaction_reference: req.body.transaction_reference,
                remarks: req.body.remarks
            });
            return res.redirect(`/payments/scheduled?success=${encodeURIComponent('Installment updated.')}`);
        } catch (error) {
            return res.redirect(`/payments/scheduled?error=${encodeURIComponent(error.message)}`);
        }
    };

    static cancelScheduledFromPage = async (req, res) => {
        try {
            const changed = await ScheduledPayment.cancelSchedule(req.params.id);
            if (!changed) throw new Error('This scheduled payment can no longer be cancelled.');
            return res.redirect(`/payments/scheduled?success=${encodeURIComponent('Installment cancelled.')}`);
        } catch (error) {
            return res.redirect(`/payments/scheduled?error=${encodeURIComponent(error.message)}`);
        }
    };

    static exportHistory = async (req, res) => {
        const studentId = Number(req.params.id);
        const student = Number.isSafeInteger(studentId) && studentId > 0 ? await Student.findById(studentId) : null;
        if (!student) return res.status(404).send('Student not found.');
        const type = req.query.type || 'payments';
        if (!['payments', 'scheduled'].includes(type)) return res.status(400).send('Invalid export type.');
        const { workbook, amountNumber } = await import('../services/xlsx.js');
        let headings, rows, widths;
        if (type === 'payments') {
            const payments = await FeePayment.getPayments(studentId);
            headings = ['Receipt Number', 'Payment Date', 'Amount (INR)', 'Payment Mode', 'Transaction Reference', 'Remarks'];
            rows = payments.map(p => [p.receipt_no || '', String(p.payment_date), amountNumber(p.amount), p.payment_mode, p.transaction_reference || '', p.remarks || '']);
            widths = [24, 18, 20, 19, 30, 48];
        } else {
            const schedules = await ScheduledPayment.studentSchedules(studentId);
            headings = ['Installment', 'Scheduled Date', 'Scheduled Amount (INR)', 'Received Amount (INR)', 'Remaining Amount (INR)', 'Payment Mode', 'Status'];
            rows = schedules.map((p, i) => [p.reference_number || `Installment ${i + 1}`, String(p.scheduled_date), amountNumber(p.scheduled_amount), amountNumber(p.received_amount), amountNumber(p.remaining_amount), p.payment_mode, p.display_status || p.status]);
            widths = [28, 20, 25, 25, 25, 20, 19];
        }
        if (!rows.length) rows = [['No records available']];
        const bytes = workbook({
            title: type === 'payments' ? 'Payment History' : 'Scheduled Payment History',
            studentName: student.student_name,
            studentCode: student.student_number || `DNS${String(student.id).padStart(6, '0')}`,
            headings, rows, widths
        });
        const code = String(student.student_number || `DNS${student.id}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="DNS-${code}-${type}.xlsx"`,
            'Cache-Control': 'private, no-store'
        });
        return res.send(bytes);
    };

    static createCashfreeLink = async (req, res) => {
        const installmentId = Number(req.params.installmentId);
        const studentId = Number(req.body.student_id);
        const amount = parseAmount(req.body.amount);
        const installment = Number.isSafeInteger(studentId) && studentId > 0
            ? (await StudentPayment.installmentsForStudent(studentId)).find(item => Number(item.id) === installmentId)
            : null;
        if (!installment || !amount) return res.status(400).send('Invalid installment or amount.');
        const student = await Student.findById(studentId);
        let paymentId;
        try {
            paymentId = await StudentPayment.reserveCashfree(installmentId, amount);
            const linkId = `fee_${paymentId}_${Date.now()}`;
            const link = await CashfreeGateway.createPaymentLink({
                linkId,
                amount,
                purpose: `${student.student_name} - ${installment.title}`,
                student,
                installmentId,
                paymentId
            });
            await StudentPayment.attachCashfreeLink(paymentId, linkId, link.link_url);
            return redirectWithMessage(res, studentId, 'success', 'Cashfree payment link and QR are ready.');
        } catch (error) {
            if (paymentId) await StudentPayment.failCashfreePayment(paymentId);
            return redirectWithMessage(res, studentId, 'error', error.message);
        }
    };

    static cashfreeWebhook = async (req, res) => {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
        const signature = req.get('x-webhook-signature');
        const timestamp = req.get('x-webhook-timestamp');
        if (!(await CashfreeGateway.verifyWebhook(rawBody, signature, timestamp))) return res.sendStatus(401);

        let event;
        try { event = JSON.parse(rawBody.toString('utf8')); }
        catch { return res.sendStatus(400); }
        const linkId = event?.data?.link_id || event?.data?.link_details?.link_id || event?.link_id;
        if (!linkId) return res.sendStatus(200);

        const payment = await StudentPayment.findByCashfreeLinkId(String(linkId));
        const link = await CashfreeGateway.fetchPaymentLink(String(linkId));
        if (payment && payment.status === 'PENDING') {
            if (Math.round(Number(link.link_amount_paid || 0) * 100) >= Math.round(Number(payment.amount) * 100)) {
                await StudentPayment.markCashfreePaid(payment.id, String(event?.data?.payment?.cf_payment_id || event?.data?.cf_payment_id || event?.data?.payment_id || '').trim() || null);
            }
            return res.sendStatus(200);
        }
        const general = await GeneralCollection.findByLinkId(String(linkId));
        if (general && general.status === 'PENDING' &&
            Math.round(Number(link.link_amount_paid || 0) * 100) >= Math.round(Number(general.amount) * 100)) {
            await GeneralCollection.markPaid(general.id, String(event?.data?.payment?.cf_payment_id || event?.data?.cf_payment_id || event?.data?.payment_id || '').trim() || null);
        }
        return res.sendStatus(200);
    };
}
