import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUser } from './db.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Signing secret: env var wins, otherwise generated once and kept in server/.secret
function loadSecret() {
  if (process.env.POS_SECRET) return process.env.POS_SECRET;
  const file = path.join(dir, '.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

// ---- passwords: scrypt + per-user salt (built in, no extra dependency) ----
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- tokens: body.signature, HMAC-SHA256, with expiry ----
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

export function signToken(payload, ttlMs = 12 * 60 * 60 * 1000) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function verifyToken(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

// ---- middleware ----
// Role is read from the database on every request, so disabling a user or
// changing a role takes effect immediately, even for tokens already issued.
export function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const payload = m && verifyToken(m[1]);
  const user = payload && getUser(payload.sub);
  if (!user || user.disabled) return res.status(401).json({ error: 'Sign in required' });
  req.user = user;
  next();
}
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Managers only' });
