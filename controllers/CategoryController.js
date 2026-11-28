import Category from '../models/Category.js';

export default class CategoryController {
    static index = async (req, res) => {
        res.render('categories/index', {
            title: 'Categories',
            page: 'categories',
            categories: await Category.listWithSubcategories(),
            activeCategories: await Category.listActive(),
            error: null,
            success: null
        });
    };

    static createCategory = async (req, res) => {
        const name = String(req.body.name || '').trim();
        if (!name || name.length > 120) return res.status(400).send('Category name is required and must be 120 characters or fewer.');
        try {
            await Category.create(name);
            return res.redirect('/categories');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).send('That category already exists.');
            throw error;
        }
    };

    static createSubcategory = async (req, res) => {
        const categoryId = Number(req.body.category_id);
        const name = String(req.body.name || '').trim();
        if (!Number.isSafeInteger(categoryId) || categoryId < 1 || !name || name.length > 120) {
            return res.status(400).send('Choose a category and enter a subcategory name (up to 120 characters).');
        }
        try {
            await Category.createSubcategory(categoryId, name);
            return res.redirect('/categories');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).send('That subcategory already exists in the selected category.');
            if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).send('The selected category does not exist.');
            throw error;
        }
    };
}
