import db from '../config/database.js';

function isValidDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const fields = `student_name, gender, father_name, mother_name, student_number, father_phone,
    alternate_phone, whatsapp_number, mobile, address, board, student_class, stream, admission_date,
    total_fee, category_id, subcategory_id, remarks, image_data, image_mime`;

export default class Student {
    static async list(filters = {}) {
        const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
        const limitValue = Number.parseInt(filters.limit, 10);
        const limit = [25, 50, 100].includes(limitValue) ? limitValue : 25;
        const search = String(filters.search || '').trim();
        const board = String(filters.board || '').trim();
        const studentClass = String(filters.student_class || '').trim();
        const fromDate = String(filters.from_date || '').trim();
        const toDate = String(filters.to_date || '').trim();
        const where = ['s.is_archived = FALSE'];
        const values = [];
        if (search) {
            where.push('(s.student_name LIKE ? OR s.father_name LIKE ? OR s.mother_name LIKE ? OR s.mobile LIKE ? OR s.alternate_phone LIKE ?)');
            values.push(...Array(5).fill(`%${search}%`));
        }
        if (board) { where.push('s.board = ?'); values.push(board); }
        if (studentClass) { where.push('s.student_class = ?'); values.push(studentClass); }
        if (isValidDateOnly(fromDate)) { where.push('s.admission_date >= ?'); values.push(fromDate); }
        if (isValidDateOnly(toDate)) { where.push('s.admission_date <= ?'); values.push(toDate); }
        const clause = where.join(' AND ');
        const [[count]] = await db.execute(`SELECT COUNT(*) AS total FROM students s WHERE ${clause}`, values);
        const offset = (page - 1) * limit;
        const [rows] = await db.execute(`
            SELECT s.id, s.student_name, s.student_number, s.total_fee, s.father_name, s.mother_name, s.mobile,
                   s.alternate_phone, s.board, s.student_class, s.admission_date, s.image_mime
            FROM students s WHERE ${clause}
            ORDER BY s.admission_date DESC, s.id DESC LIMIT ? OFFSET ?
        `, [...values, limit, offset]);
        const [filterRows] = await db.execute('SELECT DISTINCT board FROM students WHERE board IS NOT NULL AND board <> \'\' ORDER BY board');
        return { rows, total: Number(count.total), page, limit, pages: Math.max(1, Math.ceil(Number(count.total) / limit)), filters: filterRows.map(row => row.board) };
    }


    static async paymentOptions() {
        const [rows] = await db.execute(`
            SELECT id, student_name, student_number, total_fee, mobile, alternate_phone
            FROM students WHERE is_archived = FALSE
            ORDER BY student_name, id
        `);
        return rows;
    }

    static async archived() {
        const [rows] = await db.execute(`SELECT id, student_name, father_name, mobile, board, student_class, admission_date
            FROM students WHERE is_archived = TRUE ORDER BY updated_at DESC`);
        return rows;
    }

    static async findById(id) {
        const [rows] = await db.execute(`
            SELECT s.*, c.name AS category_name, sc.name AS subcategory_name
            FROM students s
            LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
            LEFT JOIN categories c ON c.id = s.category_id
            WHERE s.id = ? LIMIT 1
        `, [id]);
        return rows[0] || null;
    }

    static async imageById(id) {
        const [rows] = await db.execute('SELECT image_data, image_mime FROM students WHERE id = ? LIMIT 1', [id]);
        return rows[0] || null;
    }

    static async create(student) {
        const values = fields.split(',').map(field => student[field.trim()]);
        const placeholders = values.map(() => '?').join(', ');
        const [result] = await db.execute(`INSERT INTO students (${fields}) VALUES (${placeholders})`, values);
        return result.insertId;
    }

    static async update(id, student) {
        const updateFields = fields.split(',').map(field => field.trim()).filter(field => !['image_data', 'image_mime'].includes(field));
        const assignments = updateFields.map(field => `${field} = ?`);
        const values = updateFields.map(field => student[field]);
        if (student.imageAction === 'replace') {
            assignments.push('image_data = ?', 'image_mime = ?');
            values.push(student.image_data, student.image_mime);
        } else if (student.imageAction === 'remove') {
            assignments.push('image_data = NULL', 'image_mime = NULL');
        }
        values.push(id);
        await db.execute(`UPDATE students SET ${assignments.join(', ')} WHERE id = ?`, values);
    }

    static async archive(id) {
        await db.execute('UPDATE students SET is_archived = TRUE WHERE id = ?', [id]);
    }

    static async restore(id) {
        await db.execute('UPDATE students SET is_archived = FALSE WHERE id = ?', [id]);
    }

    static async delete(id) {
        await db.execute('DELETE FROM students WHERE id = ?', [id]);
    }

    static async subcategoriesForCategory(categoryId) {
        const [rows] = await db.execute(
            'SELECT id, name FROM subcategories WHERE category_id = ? AND is_active = TRUE ORDER BY name',
            [categoryId]
        );
        return rows;
    }

    static async subcategoryBelongsToCategory(subcategoryId, categoryId) {
        const [rows] = await db.execute(
            'SELECT id FROM subcategories WHERE id = ? AND category_id = ? LIMIT 1',
            [subcategoryId, categoryId]
        );
        return rows.length > 0;
    }
}
