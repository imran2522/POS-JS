import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { calcTotals } from '../shared/cart.js';
import { ROLES, MAX_DISCOUNT } from '../shared/roles.js';
import {
  getProducts, getProduct, addProduct, updateProduct, priceAt, getSettings, setSettings,
  getOrder, getOrders, insertOrder, refundOrder, getUsers, getUser, addUser, updateUser,
} from './db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, requireRole } from './auth.js';

const app = express();
app.use(express.json());

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// The service worker carries a build hash of the app files, so every code change
// triggers an update. Must be registered before the static middleware.
function buildId() {
  const h = crypto.createHash('sha1');
  for (const dir of ['public', 'shared']) {
    for (const f of fs.readdirSync(path.join(root, dir)).sort()) {
      const file = path.join(root, dir, f);
      if (fs.statSync(file).isFile()) h.update(f).update(fs.readFileSync(file));
    }
  }
  return h.digest('hex').slice(0, 10);
}
app.get('/sw.js', (_req, res) => {
  const src = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8').replaceAll('__BUILD__', buildId());
  res.set({ 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }).send(src);
});
app.use('/shared', express.static(path.join(root, 'shared')));
app.use(express.static(path.join(root, 'public')));

// Client clocks drift: accept the client's sale time only if it is a real date that is not in the future.
const saleTime = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= Date.now() + 5 * 60_000 ? new Date(t).toISOString() : new Date().toISOString();
};

function parseProduct(b, partial) {
  const out = {};
  const bad = (error) => ({ error });
  if (!partial || 'name' in b) {
    const n = String(b.name ?? '').trim();
    if (!n || n.length > 60) return bad('Name is required (60 characters max)');
    out.name = n;
  }
  if (!partial || 'price' in b) {
    if (!Number.isInteger(b.price) || b.price < 0 || b.price > 100_000_000) return bad('Price must be a whole number of cents');
    out.price = b.price;
  }
  if (!partial || 'taxRate' in b) {
    const t = Number(b.taxRate);
    if (!Number.isFinite(t) || t < 0 || t > 1) return bad('Tax rate must be between 0 and 1');
    out.taxRate = t;
  }
  if (!partial || 'stock' in b) {
    if (!Number.isInteger(b.stock) || b.stock < 0 || b.stock > 1_000_000) return bad('Stock must be a whole number, 0 or more');
    out.stock = b.stock;
  }
  if ('active' in b) {
    if (typeof b.active !== 'boolean') return bad('active must be true or false');
    out.active = b.active;
  }
  return { fields: out };
}

const pub = (u) => ({ username: u.username, role: u.role, disabled: !!u.disabled });
const manager = requireRole('manager');

// ---------- first run: create the manager account ----------
if (getUsers().length === 0) {
  const pw = process.env.POS_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  addUser({ username: 'manager', role: 'manager', passHash: hashPassword(pw), createdAt: new Date().toISOString() });
  console.log(`\nFirst run: manager account created.\n  username: manager\n  password: ${pw}\nSign in, then use the Password button to change it.\n`);
}

// ---------- login (with simple brute-force lockout) ----------
const attempts = new Map();
const MAX_TRIES = 5, LOCK_MS = 60_000;
const DUMMY_HASH = hashPassword('dummy'); // equalizes timing for unknown users

function isLocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (a.until <= Date.now()) { if (a.count >= MAX_TRIES) attempts.delete(key); return false; }
  return a.count >= MAX_TRIES;
}
function recordFailure(key) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count++; a.until = Date.now() + LOCK_MS;
  attempts.set(key, a);
}

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').toLowerCase();
  const password = String(req.body?.password || '');
  const key = `${req.ip}|${username}`;
  if (isLocked(key)) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });

  const user = getUser(username);
  const ok = verifyPassword(password, user ? user.passHash : DUMMY_HASH) && user && !user.disabled;
  if (!ok) { recordFailure(key); return res.status(401).json({ error: 'Wrong username or password' }); }

  attempts.delete(key);
  res.json({ token: signToken({ sub: user.username }), user: pub(user) });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Everything below needs a signed-in user.
app.use('/api', requireAuth);

app.get('/api/me', (req, res) => res.json(pub(req.user)));

app.post('/api/me/password', (req, res) => {
  const { current = '', next = '' } = req.body || {};
  if (!verifyPassword(String(current), req.user.passHash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (String(next).length < 8) return res.status(400).json({ error: 'New password needs at least 8 characters' });
  updateUser(req.user.username, { passHash: hashPassword(String(next)) });
  res.json({ ok: true });
});

// ---------- cashier + manager ----------
// Cashiers see active products only. A manager can ask for everything with ?all=1.
app.get('/api/products', (req, res) => {
  const all = req.query.all === '1' && req.user.role === 'manager';
  res.json(getProducts()
    .filter((p) => all || p.active !== false)
    .map(({ history, ...p }) => ({ ...p, active: p.active !== false })));
});

app.get('/api/settings', (_req, res) => res.json(getSettings()));

// IDEMPOTENT: the client generates the order id. Retrying the same id never double-charges.
app.post('/api/orders', (req, res) => {
  const { id, items, discountPct = 0, paymentMethod = 'cash', createdAt, cashier } = req.body || {};
  if (!id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'id and non-empty items are required' });
  }
  const existing = getOrder(id);
  if (existing) return res.status(200).json(existing);

  const d = Number(discountPct);
  if (!Number.isFinite(d) || d < 0 || d > MAX_DISCOUNT[req.user.role]) {
    return res.status(403).json({ error: `Your role allows discounts up to ${MAX_DISCOUNT[req.user.role]}%` });
  }

  const catalog = new Map(getProducts().map((p) => [p.sku, p]));
  const lines = [];
  for (const i of items) {
    const p = catalog.get(i.sku);
    if (!p || !Number.isInteger(i.qty) || i.qty < 1) return res.status(400).json({ error: `Invalid line: ${i.sku}` });
    const eff = priceAt(p, createdAt); // price at the time of sale, not at sync time
    lines.push({ sku: p.sku, name: p.name, price: eff.price, taxRate: eff.taxRate, qty: i.qty });
  }
  // Who rang it up comes from the token. Only a manager may sync a sale on someone else's behalf.
  const rungBy = req.user.role === 'manager' && typeof cashier === 'string' && getUser(cashier) ? cashier.toLowerCase() : req.user.username;
  const order = {
    id, items: lines, discountPct: d, paymentMethod, ...calcTotals(lines, d),
    cashier: rungBy, status: 'paid',
    createdAt: saleTime(createdAt), syncedAt: new Date().toISOString(),
  };
  res.status(201).json(insertOrder(order));
});

// ---------- manager only ----------
app.post('/api/products', manager, (req, res) => {
  const sku = String(req.body?.sku || '').trim();
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(sku)) return res.status(400).json({ error: 'SKU: 1-30 letters, numbers, . _ -' });
  if (getProduct(sku)) return res.status(409).json({ error: 'That SKU already exists' });
  const { fields, error } = parseProduct(req.body, false);
  if (error) return res.status(400).json({ error });
  const now = new Date().toISOString();
  res.status(201).json(addProduct({ sku, ...fields, active: true, history: [{ from: now, price: fields.price, taxRate: fields.taxRate }] }));
});

app.patch('/api/products/:sku', manager, (req, res) => {
  if (!getProduct(req.params.sku)) return res.status(404).json({ error: 'Product not found' });
  const { fields, error } = parseProduct(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const { history, ...p } = updateProduct(req.params.sku, fields);
  res.json(p);
});

app.put('/api/settings', manager, (req, res) => {
  const b = req.body || {};
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const currency = String(b.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: 'Currency must be a 3-letter code, like USD or PKR' });
  const shopName = str(b.shopName, 40);
  if (!shopName) return res.status(400).json({ error: 'Shop name is required' });
  res.json(setSettings({ shopName, address: str(b.address, 120), phone: str(b.phone, 30), footer: str(b.footer, 80), currency }));
});

app.get('/api/orders', manager, (_req, res) => res.json(getOrders().slice(-50).reverse()));

app.post('/api/orders/:id/refund', manager, (req, res) => {
  const o = refundOrder(req.params.id, req.user.username);
  return o ? res.json(o) : res.status(404).json({ error: 'Order not found' });
});

app.get('/api/reports/today', manager, (_req, res) => {
  const today = new Date().toDateString();
  const paid = getOrders().filter((o) => o.status === 'paid' && new Date(o.createdAt).toDateString() === today);
  const byMethod = {}, byCashier = {};
  for (const o of paid) {
    byMethod[o.paymentMethod] = (byMethod[o.paymentMethod] || 0) + o.total;
    byCashier[o.cashier] = (byCashier[o.cashier] || 0) + o.total;
  }
  res.json({
    orders: paid.length,
    revenue: paid.reduce((s, o) => s + o.total, 0),
    tax: paid.reduce((s, o) => s + o.tax, 0),
    byMethod, byCashier,
  });
});

app.get('/api/users', manager, (_req, res) => res.json(getUsers().map(pub)));

app.post('/api/users', manager, (req, res) => {
  const username = String(req.body?.username || '').toLowerCase();
  const { password = '', role = 'cashier' } = req.body || {};
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username: 3-30 letters, numbers, . _ -' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (getUser(username)) return res.status(409).json({ error: 'That username is taken' });
  const u = addUser({ username, role, passHash: hashPassword(String(password)), createdAt: new Date().toISOString() });
  res.status(201).json(pub(u));
});

app.patch('/api/users/:username', manager, (req, res) => {
  if (req.params.username.toLowerCase() === req.user.username) return res.status(400).json({ error: 'You cannot change your own account here' });
  if (!getUser(req.params.username)) return res.status(404).json({ error: 'User not found' });
  const patch = {};
  if (typeof req.body?.disabled === 'boolean') patch.disabled = req.body.disabled;
  if (ROLES.includes(req.body?.role)) patch.role = req.body.role;
  res.json(pub(updateUser(req.params.username, patch)));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`POS running on http://localhost:${PORT}`));
