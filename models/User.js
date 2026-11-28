import db from '../config/database.js';

export default class User {
    static async findByUsername(username) {
        const [rows] = await db.execute('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
        return rows[0] ? { ...rows[0], permissions: typeof rows[0].permissions === 'string' ? JSON.parse(rows[0].permissions) : rows[0].permissions } : null;
    }

    static async findById(id) {
        const [rows] = await db.execute('SELECT id, name, username, phone, permissions, is_active FROM users WHERE id = ? LIMIT 1', [id]);
        return rows[0] ? { ...rows[0], permissions: typeof rows[0].permissions === 'string' ? JSON.parse(rows[0].permissions) : rows[0].permissions } : null;
    }

    static async list() {
        const [rows] = await db.execute('SELECT id, name, username, phone, permissions, is_active, created_at FROM users ORDER BY id DESC');
        return rows.map(row => ({ ...row, permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions }));
    }

    static async create({ name, username, phone, passwordHash, permissions }) {
        const [result] = await db.execute(
            'INSERT INTO users (name, username, phone, password_hash, permissions) VALUES (?, ?, ?, ?, ?)',
            [name, username, phone, passwordHash, JSON.stringify(permissions)]
        );
        return result.insertId;
    }

    static async updatePassword(id, passwordHash) {
        await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
    }
}
