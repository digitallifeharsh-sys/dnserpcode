import Cashfree from '../models/Cashfree.js';
import CashfreeGateway from '../services/CashfreeGateway.js';

function renderSettings(res, configuration, { error = null, success = null, status = 200 } = {}) {
    return res.status(status).render('cashfree/settings', {
        title: 'Cashfree',
        page: 'cashfree',
        configuration,
        error,
        success,
        encryptionKeyConfigured: Buffer.byteLength(process.env.PAYMENT_CONFIG_ENCRYPTION_KEY || '') >= 32,
        environmentOverrides: ['CASHFREE_ENABLED', 'CASHFREE_ENVIRONMENT', 'CASHFREE_API_VERSION', 'CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET', 'CASHFREE_RETURN_URL', 'CASHFREE_WEBHOOK_URL'].some(key => process.env[key] !== undefined)
    });
}

export default class CashfreeController {
    static settingsPage = async (req, res) => renderSettings(res, await Cashfree.getConfiguration());

    static saveCredentials = async (req, res) => {
        const configuration = {
            enabled: req.body.enabled === 'on',
            environment: String(req.body.environment || '').trim(),
            apiVersion: '2026-01-01',
            clientId: String(req.body.client_id || '').trim(),
            clientSecret: String(req.body.client_secret || '').trim(),
            returnUrl: String(req.body.return_url || '').trim(),
            webhookUrl: String(req.body.webhook_url || '').trim()
        };

        const urlIsValid = value => {
            if (!value) return true;
            try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
        };
        const current = await Cashfree.getConfiguration();
        if (!['sandbox', 'production'].includes(configuration.environment) || !configuration.clientId ||
            (!configuration.clientSecret && !current.hasClientSecret) || !urlIsValid(configuration.returnUrl) || !urlIsValid(configuration.webhookUrl)) {
            return renderSettings(res, { ...current, ...configuration, hasClientSecret: current.hasClientSecret }, {
                error: 'Select an environment, enter a Client ID, and add a Client Secret if none is saved. Optional URLs must use HTTP or HTTPS.',
                status: 400
            });
        }

        try {
            await Cashfree.saveConfiguration(configuration);
            return renderSettings(res, await Cashfree.getConfiguration(), { success: 'Cashfree configuration saved to the database.' });
        } catch (error) {
            return renderSettings(res, { ...current, ...configuration, hasClientSecret: current.hasClientSecret }, {
                error: error.message,
                status: 400
            });
        }
    };

    static testConnection = async (req, res) => {
        try {
            const result = await CashfreeGateway.testConnection();
            return renderSettings(res, await Cashfree.getConfiguration(), {
                success: `Cashfree ${result.environment} credentials are working. Unpaid test order ${result.orderId} was created for ₹1.00.`
            });
        } catch (error) {
            return renderSettings(res, await Cashfree.getConfiguration(), {
                error: `Cashfree connection test failed: ${error.message}`,
                status: 400
            });
        }
    };
}
