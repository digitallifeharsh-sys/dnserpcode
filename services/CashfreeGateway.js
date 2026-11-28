import crypto from 'node:crypto';
import Cashfree from '../models/Cashfree.js';

function baseUrl(environment) {
    return environment === 'sandbox' ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';
}

async function request(path, options = {}, { requireEnabled = true } = {}) {
    const config = await Cashfree.getGatewayCredentials();
    if (requireEnabled && !config.enabled) throw new Error('Cashfree payments are disabled in settings.');
    if (!config.clientId || !config.clientSecret) throw new Error('Cashfree Client ID and Client Secret are not configured.');
    const response = await fetch(`${baseUrl(config.environment)}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'x-client-id': config.clientId,
            'x-client-secret': config.clientSecret,
            'x-api-version': config.apiVersion || '2026-01-01',
            ...options.headers
        },
        signal: AbortSignal.timeout(20000)
    });
    const responseText = await response.text();
    let result = {};
    try { result = responseText ? JSON.parse(responseText) : {}; } catch { /* handled below */ }
    if (!response.ok) throw new Error(result.message || result.type || `Cashfree returned HTTP ${response.status}.`);
    return { result, config };
}

export default class CashfreeGateway {
    static async testConnection() {
        const orderId = `erp_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const { result, config } = await request('/orders', {
            method: 'POST',
            headers: { 'x-idempotency-key': crypto.randomUUID() },
            body: JSON.stringify({
                order_id: orderId,
                order_amount: 1,
                order_currency: 'INR',
                customer_details: {
                    customer_id: 'erp_connection_test',
                    customer_name: 'ERP Connection Test',
                    customer_phone: '9999999999'
                },
                order_note: 'Unpaid Cashfree credential connection test'
            })
        }, { requireEnabled: false });
        if (!result.order_id) throw new Error('Cashfree accepted the request but did not return an order ID.');
        return { environment: config.environment, orderId: result.order_id };
    }

    static async createPaymentLink({ linkId, amount, purpose, student = null, installmentId = null, paymentId = null, customerName = null, customerPhone = null, notes = {} }) {
        const config = await Cashfree.getGatewayCredentials();
        const rawPhone = customerPhone || student?.mobile || student?.father_phone || student?.whatsapp_number || student?.alternate_phone || '';
        const phone = String(rawPhone).replace(/\D/g, '');
        if (phone.length < 10) throw new Error('Add a valid 10-digit mobile number before creating a Cashfree payment.');
        const body = {
            link_id: linkId,
            link_amount: Number(amount),
            link_currency: 'INR',
            link_purpose: String(purpose || 'DNS Academy Fee Payment').slice(0, 240),
            link_partial_payments: false,
            customer_details: {
                customer_name: String(customerName || student?.student_name || 'DNS Academy Customer').slice(0, 100),
                customer_phone: phone.slice(-10)
            },
            link_meta: {
                ...(config.webhookUrl ? { notify_url: config.webhookUrl } : {}),
                ...(config.returnUrl ? { return_url: config.returnUrl } : {})
            },
            link_notes: {
                ...(student?.id ? { student_id: String(student.id) } : {}),
                ...(installmentId ? { installment_id: String(installmentId) } : {}),
                ...(paymentId ? { payment_id: String(paymentId) } : {}),
                ...notes
            },
            link_notify: { send_sms: false, send_email: false }
        };
        const { result } = await request('/links', {
            method: 'POST',
            headers: { 'x-idempotency-key': crypto.randomUUID() },
            body: JSON.stringify(body)
        });
        if (!result.link_url) throw new Error('Cashfree did not return a payment link.');
        return result;
    }

    static async fetchPaymentLink(linkId) {
        const { result } = await request(`/links/${encodeURIComponent(linkId)}`, { method: 'GET' }, { requireEnabled: false });
        return result;
    }

    static async verifyWebhook(rawBody, signature, timestamp) {
        const config = await Cashfree.getGatewayCredentials();
        if (!signature || !timestamp || !config.clientSecret) return false;
        const expected = crypto
            .createHmac('sha256', config.clientSecret)
            .update(timestamp)
            .update(rawBody)
            .digest('base64');
        const expectedBuffer = Buffer.from(expected);
        const signatureBuffer = Buffer.from(signature);
        return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    }
}
