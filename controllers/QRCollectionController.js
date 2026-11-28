import db from '../config/database.js';
import Student from '../models/Student.js';
import StudentPayment from '../models/StudentPayment.js';
import GeneralCollection from '../models/GeneralCollection.js';
import CashfreeGateway from '../services/CashfreeGateway.js';

function parseAmount(value) {
    const amount = String(value || '').trim();
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return null;
    return Number(amount).toFixed(2);
}

export default class QRCollectionController {
    static index = async (req, res) => {
        const [students] = await db.execute('SELECT id, student_name, mobile FROM students WHERE is_archived = FALSE ORDER BY student_name');
        return res.render('collections/index', {
            title: 'QR Payment Collection', page: 'collections',
            students, collections: await GeneralCollection.list(),
            success: req.query.success || null, error: req.query.error || null
        });
    };

    static createGeneral = async (req, res) => {
        const amount = parseAmount(req.body.amount);
        const payerName = String(req.body.payer_name || '').trim();
        const payerPhone = String(req.body.payer_phone || '').replace(/\D/g, '').slice(-10);
        if (!amount) return res.redirect('/qr-collection?error=Enter+a+valid+amount');
        if (payerPhone.length !== 10) return res.redirect('/qr-collection?error=Enter+a+valid+10-digit+phone');
        let id;
        try {
            id = await GeneralCollection.create({ payerName, payerPhone, amount });
            const linkId = `general_${id}_${Date.now()}`;
            const link = await CashfreeGateway.createPaymentLink({
                linkId, amount, purpose: `DNS Academy General Collection #${id}`,
                customerName: payerName || 'DNS Academy Customer',
                customerPhone: payerPhone,
                notes: { general_collection_id: String(id) }
            });
            await GeneralCollection.attachLink(id, linkId, link.link_url);
            return res.redirect('/qr-collection?success=General+QR+generated');
        } catch (error) {
            if (id) await GeneralCollection.fail(id);
            return res.redirect(`/qr-collection?error=${encodeURIComponent(error.message)}`);
        }
    };

    static createStudent = async (req, res) => {
        const studentId = Number(req.body.student_id);
        const installmentId = Number(req.body.installment_id);
        const amount = parseAmount(req.body.amount);
        const student = await Student.findById(studentId);
        const installment = (await StudentPayment.installmentsForStudent(studentId)).find(item => Number(item.id) === installmentId);
        if (!student || !installment || !amount || Number(amount) > installment.available) {
            return res.redirect('/qr-collection?error=Invalid+student,+installment+or+amount');
        }
        let paymentId;
        try {
            paymentId = await StudentPayment.reserveCashfree(installmentId, amount);
            const linkId = `fee_${paymentId}_${Date.now()}`;
            const link = await CashfreeGateway.createPaymentLink({
                linkId, amount, purpose: `${student.student_name} - ${installment.title}`,
                customerName: student.student_name,
                customerPhone: student.mobile || student.father_phone || student.whatsapp_number || student.alternate_phone,
                notes: { student_id: String(studentId), installment_id: String(installmentId), payment_id: String(paymentId) }
            });
            await StudentPayment.attachCashfreeLink(paymentId, linkId, link.link_url);
            return res.redirect(`/students/${studentId}?success=Student+QR+generated`);
        } catch (error) {
            if (paymentId) await StudentPayment.failCashfreePayment(paymentId);
            return res.redirect(`/qr-collection?error=${encodeURIComponent(error.message)}`);
        }
    };

    static linkCollection = async (req, res) => {
        const collectionId = Number(req.params.id);
        const studentId = Number(req.body.student_id);
        const installmentId = Number(req.body.installment_id);
        try {
            await GeneralCollection.linkToInstallment(collectionId, studentId, installmentId);
            return res.redirect('/qr-collection?success=Collection+linked+to+student+installment');
        } catch (error) {
            return res.redirect(`/qr-collection?error=${encodeURIComponent(error.message)}`);
        }
    };

    static studentInstallments = async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid student.' });
        return res.json(await StudentPayment.installmentsForStudent(id));
    };
}
