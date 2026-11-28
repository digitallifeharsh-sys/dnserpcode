import db from '../config/database.js';

export default class Setting {
    static async get(key) {
        const [rows] = await db.execute('SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1', [key]);
        return rows[0]?.setting_value || '';
    }

    static async set(key, value) {
        await db.execute(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            [key, value]
        );
    }
}
