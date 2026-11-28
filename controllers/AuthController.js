import crypto from 'node:crypto';
import { promisify } from 'node:util';
import User from '../models/User.js';
import Setting from '../models/Setting.js';

const scrypt = promisify(crypto.scrypt);
const resources = ['dashboard', 'users', 'students', 'categories', 'payments', 'settings'];
const actions = ['GET', 'POST', 'UPDATE', 'DELETE'];
const allPermissions = () => ({ admin: true, ui: Object.fromEntries(resources.map(r => [r, true])), crud: Object.fromEntries(resources.map(r => [r, Object.fromEntries(actions.map(a => [a, true]))])) });

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}

async function validPassword(password, stored) {
    const [salt, hash] = (stored || '').split(':');
    if (!salt || !hash) return false;
    const candidate = await scrypt(password, salt, 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function parsePermissions(input) {
    return {
        admin: false,
        ui: Object.fromEntries(resources.map(r => [r, input?.ui?.includes(r) || false])),
        crud: Object.fromEntries(resources.map(r => [r, Object.fromEntries(actions.map(a => [a, input?.crud?.[r]?.includes(a) || false]))]))
    };
}

export default class AuthController {
    static async loginPage(req, res) {
        if (req.user) return res.redirect('/dashboard');
        const [rows] = await (await import('../config/database.js')).default.execute('SELECT COUNT(*) AS count FROM users');
        res.render('auth/login', { layout: 'layouts/auth', title: 'Login', firstRun: Number(rows[0].count) === 0, error: null });
    }

    static async login(req, res) {
        const { username, password } = req.body;
        const user = await User.findByUsername(String(username || '').trim());
        if (!user || !user.is_active || !(await validPassword(String(password || ''), user.password_hash))) {
            return res.status(401).render('auth/login', { layout: 'layouts/auth', title: 'Login', firstRun: false, error: 'Invalid username or password.' });
        }
        req.session.pendingOtpUser = user.id;
        const apiKey = await Setting.get('twofactor_api_key');
        const phone = String(user.phone || '').replace(/\D/g, '');
        if (!apiKey || !phone) return res.status(503).render('auth/login', { layout: 'layouts/auth', title: 'Login', firstRun: false, error: 'OTP login is not configured. Ask an administrator to add the 2Factor API key and your phone number.' });
        try {
            const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(phone)}/AUTOGEN`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok || result.Status !== 'Success') throw new Error('OTP request rejected');
            req.session.otpSessionId = result.Details;
            return res.redirect('/verify-otp');
        } catch (error) {
            delete req.session.pendingOtpUser;
            return res.status(502).render('auth/login', { layout: 'layouts/auth', title: 'Login', firstRun: false, error: 'Could not send OTP. Check the 2Factor API key and user phone number.' });
        }
    }

    static otpPage(req, res) {
        if (!req.session.pendingOtpUser || !req.session.otpSessionId) return res.redirect('/login');
        res.render('auth/otp', { layout: 'layouts/auth', title: 'Verify OTP', error: null });
    }

    static async verifyOtp(req, res) {
        const { pendingOtpUser, otpSessionId } = req.session;
        if (!pendingOtpUser || !otpSessionId) return res.redirect('/login');
        try {
            const apiKey = await Setting.get('twofactor_api_key');
            const response = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(otpSessionId)}/${encodeURIComponent(String(req.body.otp || ''))}`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok || result.Status !== 'Success' || result.Details !== 'OTP Matched') throw new Error('Invalid OTP');
            delete req.session.pendingOtpUser;
            delete req.session.otpSessionId;
            req.login(pendingOtpUser);
            return res.redirect('/dashboard');
        } catch {
            return res.status(401).render('auth/otp', { layout: 'layouts/auth', title: 'Verify OTP', error: 'The OTP is invalid or expired. Please try logging in again.' });
        }
    }

    static async setup(req, res) {
        const [rows] = await (await import('../config/database.js')).default.execute('SELECT COUNT(*) AS count FROM users');
        if (Number(rows[0].count)) return res.redirect('/login');
        const { name, username, phone, password, twofactor_api_key } = req.body;
        if (!name || !username || !phone || !password || String(password).length < 10 || !twofactor_api_key?.trim()) return res.status(400).render('auth/login', { layout: 'layouts/auth', title: 'Create admin', firstRun: true, error: 'Enter all fields, a 2Factor API key, and a password of at least 10 characters.' });
        await User.create({ name, username, phone, passwordHash: await hashPassword(password), permissions: allPermissions() });
        await Setting.set('twofactor_api_key', twofactor_api_key.trim());
        return res.redirect('/login');
    }

    static logout(req, res) { req.logout(); res.redirect('/login'); }

    static async usersPage(req, res) {
        res.render('users/index', { title: 'Users', page: 'users', users: await User.list(), resources, actions, error: null, success: null });
    }

    static async createUser(req, res) {
        const { name, username, phone, password } = req.body;
        if (!name || !username || !phone || !password || String(password).length < 10) return res.status(400).send('Name, username, phone, and a password of at least 10 characters are required.');
        try {
            const permissions = parsePermissions(req.body.permissions || {});
            const [result] = await (await import('../config/database.js')).default.execute('INSERT INTO users (name, username, phone, password_hash, permissions) VALUES (?, ?, ?, ?, ?)', [name, username, phone, await hashPassword(password), JSON.stringify(permissions)]);
            return res.redirect('/users');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).send('That username is already in use.');
            throw error;
        }
    }

    static async settingsPage(req, res) {
        res.render('settings/index', { title: 'Settings', page: 'settings', apiKeySet: Boolean(await Setting.get('twofactor_api_key')), error: null, success: null });
    }

    static async saveSettings(req, res) {
        if (req.body.twofactor_api_key?.trim()) await Setting.set('twofactor_api_key', req.body.twofactor_api_key.trim());
        res.render('settings/index', { title: 'Settings', page: 'settings', apiKeySet: Boolean(await Setting.get('twofactor_api_key')), error: null, success: '2Factor API key saved.' });
    }
}
