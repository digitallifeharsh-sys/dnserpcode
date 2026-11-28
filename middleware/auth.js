import crypto from 'node:crypto';
import User from '../models/User.js';

const sessions = new Map();
const cookieName = 'erp_session';
const cookieSecret = process.env.SESSION_SECRET || 'replace-this-session-secret';

export function sessionMiddleware(req, res, next) {
    let token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.split('=')[1];
    if (!token || !sessions.has(token)) {
        token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, {});
        res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    }
    const session = sessions.get(token);
    req.session = session;
    req.login = (userId) => {
        session.userId = userId;
    };
    req.logout = () => {
        if (token) sessions.delete(token);
        res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
        sessions.delete(token);
        req.session = {};
    };
    next();
}

export async function loadUser(req, res, next) {
    try {
        req.user = req.session.userId ? await User.findById(req.session.userId) : null;
        res.locals.currentUser = req.user;
        res.locals.permissions = req.user?.permissions || {};
        next();
    } catch (error) { next(error); }
}

export function requireAuth(req, res, next) {
    if (!req.user) return res.redirect('/login');
    next();
}

export function requirePermission(resource, action) {
    return (req, res, next) => {
        const perms = req.user?.permissions || {};
        if (perms.admin || perms.crud?.[resource]?.[action] || perms[resource]?.[action]) return next();
        return res.status(403).send('403 - You do not have permission to perform this action');
    };
}

export function canSee(user, resource) {
    return Boolean(user?.permissions?.admin || user?.permissions?.ui?.[resource]);
}
