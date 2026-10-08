// Tiny JSON-file store so the project runs with zero setup.
// Swap this file for Postgres (pg / Prisma) later; keep the same function names.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data.json');

const seed = {
  products: [
    { sku: 'COF-01', name: 'Espresso', price: 300, taxRate: 0.08, stock: 100 },
    { sku: 'COF-02', name: 'Latte', price: 450, taxRate: 0.08, stock: 100 },
    { sku: 'COF-03', name: 'Cappuccino', price: 425, taxRate: 0.08, stock: 100 },
    { sku: 'BAK-01', name: 'Croissant', price: 375, taxRate: 0.08, stock: 40 },
    { sku: 'BAK-02', name: 'Blueberry muffin', price: 350, taxRate: 0.08, stock: 40 },
    { sku: 'SND-01', name: 'Turkey sandwich', price: 895, taxRate: 0.08, stock: 25 },
    { sku: 'BEV-01', name: 'Orange juice', price: 400, taxRate: 0.08, stock: 30 },
    { sku: 'BEV-02', name: 'Sparkling water', price: 250, taxRate: 0.08, stock: 60 },
  ],
  orders: [],
};

let data;
function load() {
  if (data) return data;
  data = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : seed;
  data.users ||= [];
  data.settings ||= {};
  return data;
}
const save = () => fs.writeFileSync(FILE, JSON.stringify(data, null, 2));

export const getProducts = () => load().products;
export const getOrder = (id) => load().orders.find((o) => o.id === id);
export const getOrders = () => load().orders;

export function insertOrder(order) {
  const d = load();
  for (const line of order.items) {
    const p = d.products.find((x) => x.sku === line.sku);
    if (p) p.stock = Math.max(0, p.stock - line.qty);
  }
  d.orders.push(order);
  save();
  return order;
}

export function refundOrder(id, by) {
  const o = getOrder(id);
  if (!o || o.status === 'refunded') return o;
  o.status = 'refunded';
  o.refundedBy = by;
  o.refundedAt = new Date().toISOString();
  for (const line of o.items) {
    const p = load().products.find((x) => x.sku === line.sku);
    if (p) p.stock += line.qty;
  }
  save();
  return o;
}

// ---- users ----
export const getUsers = () => load().users;
export const getUser = (name) => load().users.find((u) => u.username === String(name).toLowerCase());
export function addUser(user) {
  load().users.push(user);
  save();
  return user;
}
export function updateUser(name, patch) {
  const u = getUser(name);
  if (u) { Object.assign(u, patch); save(); }
  return u;
}

// ---- products ----
const EPOCH = '1970-01-01T00:00:00.000Z';
export const getProduct = (sku) => load().products.find((p) => p.sku.toLowerCase() === String(sku).toLowerCase());

export function addProduct(p) {
  load().products.push(p);
  save();
  return p;
}

// Price and tax changes are recorded in history so a sale made offline at the old
// price is still priced correctly when it syncs later.
export function updateProduct(sku, patch) {
  const p = getProduct(sku);
  if (!p) return undefined;
  const priceChanged = ('price' in patch && patch.price !== p.price) || ('taxRate' in patch && patch.taxRate !== p.taxRate);
  if (priceChanged) {
    p.history ||= [];
    if (!p.history.length) p.history.push({ from: EPOCH, price: p.price, taxRate: p.taxRate });
  }
  Object.assign(p, patch);
  if (priceChanged) p.history.push({ from: new Date().toISOString(), price: p.price, taxRate: p.taxRate });
  save();
  return p;
}

// The price that applied when the sale was rung up (clamped so a wrong tablet clock cannot reach into the future).
export function priceAt(p, iso) {
  if (!p.history?.length) return { price: p.price, taxRate: p.taxRate };
  const t = Date.parse(iso);
  const when = Number.isFinite(t) ? Math.min(t, Date.now()) : Date.now();
  let hit = p.history[0];
  for (const e of p.history) if (Date.parse(e.from) <= when) hit = e;
  return { price: hit.price, taxRate: hit.taxRate };
}

// ---- shop settings (used on receipts) ----
const DEFAULT_SETTINGS = { shopName: 'JS Store Coffee', address: '', phone: '', footer: 'Thank you!', currency: 'USD' };
export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...load().settings });
export function setSettings(patch) {
  load().settings = { ...getSettings(), ...patch };
  save();
  return getSettings();
}
