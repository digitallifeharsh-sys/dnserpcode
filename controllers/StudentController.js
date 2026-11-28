import Category from '../models/Category.js';
import Student from '../models/Student.js';

const maxImageBytes = 2 * 1024 * 1024;
const genders = ['Male', 'Female', 'Other'];

function imageFromDataUrl(dataUrl) {
    if (!dataUrl) return { data: null, mime: null };
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw new Error('Choose a JPG, PNG, or WebP student image.');
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > maxImageBytes) throw new Error('Student image must be 2 MB or smaller.');
    const signatures = {
        'image/png': data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        'image/jpeg': data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
        'image/webp': data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    };
    if (!signatures[match[1]]) throw new Error('The selected file does not match its image format.');
    return { data, mime: match[1] };
}

function isValidDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function optionalId(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id > 0 ? id : NaN;
}

function formStudent(body, imageAction = 'keep') {
    const mobile = String(body.mobile || body.father_phone || '').trim();
    const feeText = String(body.total_fee || '0').trim();
    return {
        student_name: String(body.student_name || '').trim(),
        gender: genders.includes(String(body.gender || 'Other')) ? String(body.gender || 'Other') : 'Other',
        father_name: String(body.father_name || '').trim() || null,
        mother_name: String(body.mother_name || '').trim() || null,
        student_number: String(body.student_number || '').trim() || null,
        mobile: mobile || null,
        father_phone: String(body.father_phone || mobile).trim() || null,
        alternate_phone: String(body.alternate_phone || '').trim() || null,
        whatsapp_number: String(body.whatsapp_number || mobile).trim() || null,
        address: String(body.address || '').trim() || null,
        board: String(body.board || '').trim() || null,
        student_class: String(body.student_class || '').trim() || null,
        stream: String(body.stream || '').trim() || null,
        admission_date: String(body.admission_date || '').trim() || null,
        total_fee: feeText,
        category_id: optionalId(body.category_id),
        subcategory_id: optionalId(body.subcategory_id),
        remarks: String(body.remarks || '').trim() || null,
        image_data: null,
        image_mime: null,
        imageAction
    };
}

function validateStudent(student) {
    if (!student.student_name || student.student_name.length > 160) return 'Student name is required and must be 160 characters or fewer.';
    if (!['NIOS', 'BOSSE'].includes(student.board)) return 'Select NIOS or BOSSE as the board.';
    if (!student.student_class || !['10th', '12th'].includes(student.student_class)) return 'Select 10th or 12th class.';
    if (student.student_class === '12th' && !student.stream) return 'Select a stream for Class 12th.';
    if (!isValidDateOnly(student.admission_date)) return 'Select a valid admission date.';
    if (!Number.isFinite(Number(student.total_fee)) || Number(student.total_fee) < 0 || !/^\d{1,8}(?:\.\d{1,2})?$/.test(student.total_fee)) return 'Total fee must be a non-negative amount with up to two decimal places.';
    if (Number.isNaN(student.category_id)) return 'Select a valid category.';
    if (Number.isNaN(student.subcategory_id)) return 'Select a valid subcategory.';
    if (student.subcategory_id !== null && student.category_id === null) return 'Select a category before selecting a subcategory.';
    for (const key of ['father_name', 'mother_name']) if (student[key]?.length > 160) return 'Parent names must be 160 characters or fewer.';
    for (const key of ['mobile', 'alternate_phone', 'whatsapp_number']) if (student[key]?.length > 30) return 'Phone numbers must be 30 characters or fewer.';
    if (student.address?.length > 2000) return 'Address must be 2,000 characters or fewer.';
    if (student.remarks?.length > 5000) return 'Remarks must be 5,000 characters or fewer.';
    return null;
}

async function renderForm(res, { student = null, error = null, status = 200 } = {}) {
    return res.status(status).render('students/form', {
        title: student?.id ? 'Edit Student' : 'Add Student',
        page: 'students',
        student: student || {
            student_name: '', gender: 'Other', father_name: '', mother_name: '', student_number: '',
            mobile: '', father_phone: '', alternate_phone: '', whatsapp_number: '', address: '',
            board: 'NIOS', student_class: '', stream: '', admission_date: new Date().toISOString().slice(0, 10),
            total_fee: '0.00', category_id: '', subcategory_id: '', remarks: '', hasImage: false
        },
        categories: await Category.listActive(),
        subcategories: student?.category_id ? await Student.subcategoriesForCategory(student.category_id) : [],
        error
    });
}

async function save(req, res, id = null) {
    const imageAction = req.body.remove_image === 'on' ? 'remove' : (req.body.image_data ? 'replace' : 'keep');
    const student = formStudent(req.body, imageAction);
    const validationError = validateStudent(student);
    if (validationError) return renderForm(res, { student: { ...student, id, hasImage: imageAction === 'keep' && Boolean(req.body.has_image) }, error: validationError, status: 400 });

    if (student.category_id !== null && !(await Category.exists(student.category_id))) {
        return renderForm(res, { student: { ...student, id, hasImage: imageAction === 'keep' && Boolean(req.body.has_image) }, error: 'The selected category does not exist.', status: 400 });
    }
    if (student.subcategory_id !== null) {
        if (!(await Student.subcategoryBelongsToCategory(student.subcategory_id, student.category_id))) {
            return renderForm(res, { student: { ...student, id, hasImage: imageAction === 'keep' && Boolean(req.body.has_image) }, error: 'The selected subcategory does not belong to the selected category.', status: 400 });
        }
    }
    if (imageAction === 'replace') {
        try {
            const image = imageFromDataUrl(String(req.body.image_data));
            student.image_data = image.data;
            student.image_mime = image.mime;
        } catch (error) {
            return renderForm(res, { student: { ...student, id, hasImage: false }, error: error.message, status: 400 });
        }
    }
    try {
        const studentId = id || await Student.create(student);
        if (id) await Student.update(id, student);
        return res.redirect(`/students/${studentId}`);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return renderForm(res, { student: { ...student, id }, error: 'That student number is already in use.', status: 409 });
        if (error.code === 'ER_NO_REFERENCED_ROW_2') return renderForm(res, { student: { ...student, id }, error: 'Choose an existing category or subcategory.', status: 400 });
        throw error;
    }
}

export default class StudentController {
    static index = async (req, res) => {
        const result = await Student.list(req.query);
        return res.render('students/index', {
            title: 'Students', page: 'students', ...result,
            query: {
                search: req.query.search || '', board: req.query.board || '',
                student_class: req.query.student_class || '', from_date: req.query.from_date || '',
                to_date: req.query.to_date || ''
            }
        });
    };

    static archived = async (req, res) => res.render('students/archived', {
        title: 'Archived Students', page: 'students', students: await Student.archived()
    });

    static restore = async (req, res) => {
        await Student.restore(Number(req.params.id));
        return res.redirect('/students/archived');
    };

    static createPage = async (req, res) => renderForm(res);
    static create = async (req, res) => save(req, res);

    static editPage = async (req, res) => {
        const id = Number(req.params.id);
        const student = Number.isSafeInteger(id) && id > 0 ? await Student.findById(id) : null;
        if (!student) return res.status(404).send('Student not found.');
        student.hasImage = Boolean(student.image_data);
        delete student.image_data;
        return renderForm(res, { student });
    };

    static update = async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1 || !(await Student.findById(id))) return res.status(404).send('Student not found.');
        return save(req, res, id);
    };

    static delete = async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send('Student not found.');
        await Student.archive(id);
        return res.redirect('/students');
    };

    static image = async (req, res) => {
        const id = Number(req.params.id);
        const image = Number.isSafeInteger(id) && id > 0 ? await Student.imageById(id) : null;
        if (!image?.image_data || !image.image_mime) return res.sendStatus(404);
        res.set('Content-Type', image.image_mime);
        res.set('Cache-Control', 'private, max-age=3600');
        return res.send(image.image_data);
    };
}
