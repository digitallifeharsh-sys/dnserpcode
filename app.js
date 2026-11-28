import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import expressLayouts from 'express-ejs-layouts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// EJS Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Layout Setup
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Middleware
app.use(['/cashfree/webhook', '/api/v1/course-payments/webhook'], express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));
app.use(express.json({ limit: '4mb' }));

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

const [{ default: webRoutes }, { sessionMiddleware, loadUser, canSee }, { initializeSchema }] = await Promise.all([
    import('./routes/web.js'), import('./middleware/auth.js'), import('./config/schema.js')
]);

// Routes
app.use(sessionMiddleware);
app.use(loadUser);
app.use((req, res, next) => { res.locals.canSee = resource => canSee(req.user, resource); next(); });
app.use('/', webRoutes);

// 404
app.use((req, res) => {
    res.status(404).send('404 - Page Not Found');
});

const PORT = process.env.PORT || 8000;
try {
    await initializeSchema();
    app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
} catch (error) {
    console.error('Database connection/schema initialization failed:', error.message);
    process.exit(1);
}
