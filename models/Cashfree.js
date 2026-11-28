import crypto from 'node:crypto';
import Setting from './Setting.js';

const settingKeys = {
    enabled: 'cashfree_enabled',
    environment: 'cashfree_environment',
    apiVersion: 'cashfree_api_version',
    clientId: 'cashfree_client_id',
    clientSecret: 'cashfree_client_secret',
    returnUrl: 'cashfree_return_url',
    webhookUrl: 'cashfree_webhook_url'
};

function encryptionKey() {
    const value = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY || '';
    if (Buffer.byteLength(value) < 32) {
        throw new Error('PAYMENT_CONFIG_ENCRYPTION_KEY must be at least 32 bytes to save Cashfree credentials.');
    }
    return crypto.createHash('sha256').update(value).digest();
}

function encryptSecret(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
    if (!value.startsWith('enc:v1:')) return value;
    const [, , ivText, tagText, encryptedText] = value.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64')), decipher.final()]).toString('utf8');
}

async function readSetting(key, envName, fallback = '') {
    const environmentValue = process.env[envName];
    if (environmentValue !== undefined) return environmentValue;
    return (await Setting.get(key)) || fallback;
}

export default class Cashfree {
    static async getConfiguration() {
        const [enabled, environment, clientId, storedSecret, returnUrl, webhookUrl] = await Promise.all([
            readSetting(settingKeys.enabled, 'CASHFREE_ENABLED', 'false'),
            readSetting(settingKeys.environment, 'CASHFREE_ENVIRONMENT', 'sandbox'),
            readSetting(settingKeys.clientId, 'CASHFREE_CLIENT_ID'),
            readSetting(settingKeys.clientSecret, 'CASHFREE_CLIENT_SECRET'),
            readSetting(settingKeys.returnUrl, 'CASHFREE_RETURN_URL'),
            readSetting(settingKeys.webhookUrl, 'CASHFREE_WEBHOOK_URL')
        ]);
        return {
            enabled: enabled === true || enabled === 'true' || enabled === '1',
            environment,
            apiVersion: process.env.CASHFREE_API_VERSION || '2026-01-01',
            clientId,
            hasClientSecret: Boolean(storedSecret),
            returnUrl,
            webhookUrl
        };
    }

    static async getGatewayCredentials() {
        const configuration = await this.getConfiguration();
        const [clientId, storedSecret] = await Promise.all([
            readSetting(settingKeys.clientId, 'CASHFREE_CLIENT_ID'),
            readSetting(settingKeys.clientSecret, 'CASHFREE_CLIENT_SECRET')
        ]);
        return {
            ...configuration,
            clientId,
            clientSecret: storedSecret ? decryptSecret(storedSecret) : ''
        };
    }

    static async saveConfiguration(configuration) {
        // Resolve the key before writing any values so a missing key cannot leave a partial update.
        const encryptedSecret = configuration.clientSecret ? encryptSecret(configuration.clientSecret) : null;
        const values = {
            [settingKeys.enabled]: configuration.enabled ? 'true' : 'false',
            [settingKeys.environment]: configuration.environment,
            [settingKeys.apiVersion]: configuration.apiVersion,
            [settingKeys.clientId]: configuration.clientId,
            [settingKeys.returnUrl]: configuration.returnUrl,
            [settingKeys.webhookUrl]: configuration.webhookUrl
        };
        for (const [key, value] of Object.entries(values)) await Setting.set(key, value);
        if (encryptedSecret) await Setting.set(settingKeys.clientSecret, encryptedSecret);
    }
}
