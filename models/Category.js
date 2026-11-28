import db from '../config/database.js';

export default class Category {
    static async listWithSubcategories() {
        const [rows] = await db.execute(`
            SELECT c.id AS category_id, c.name AS category_name, c.is_active AS category_active,
                   s.id AS subcategory_id, s.name AS subcategory_name, s.is_active AS subcategory_active
            FROM categories c
            LEFT JOIN subcategories s ON s.category_id = c.id
            ORDER BY c.name, s.name
        `);
        const categories = new Map();
        for (const row of rows) {
            if (!categories.has(row.category_id)) {
                categories.set(row.category_id, {
                    id: row.category_id,
                    name: row.category_name,
                    isActive: Boolean(row.category_active),
                    subcategories: []
                });
            }
            if (row.subcategory_id) {
                categories.get(row.category_id).subcategories.push({
                    id: row.subcategory_id,
                    name: row.subcategory_name,
                    isActive: Boolean(row.subcategory_active)
                });
            }
        }
        return [...categories.values()];
    }

    static async listActive() {
        const [rows] = await db.execute('SELECT id, name FROM categories WHERE is_active = TRUE ORDER BY name');
        return rows;
    }

    static async exists(id) {
        const [rows] = await db.execute('SELECT id FROM categories WHERE id = ? LIMIT 1', [id]);
        return rows.length > 0;
    }

    static async create(name) {
        const [result] = await db.execute('INSERT INTO categories (name) VALUES (?)', [name]);
        return result.insertId;
    }

    static async createSubcategory(categoryId, name) {
        await db.execute('INSERT INTO subcategories (category_id, name) VALUES (?, ?)', [categoryId, name]);
    }
}
