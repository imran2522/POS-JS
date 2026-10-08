import { cacheShop, cachedShop, cacheProducts, cachedProducts, getQueue, dequeue, enqueue, failOrder, getSession, setSession, clearSession } from './storage.js';

let onAuthLost = () => {};
export const setAuthLostHandler = (fn) => { onAuthLost = fn; };

async function json(url, opts = {}) {
  const s = getSession();
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
  });
  if (res.status === 401 && s && url !== '/api/login') onAuthLost();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---- session ----
export async function login(username, password) {
  const r = await json('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  setSession({ token: r.token, user: r.user });
  return r.user;
}
export const logout = clearSession;
export async function refreshMe() {
  const user = await json('/api/me');
  setSession({ ...getSession(), user });
  return user;
}
export const changePassword = (current, next) => json('/api/me/password', { method: 'POST', body: JSON.stringify({ current, next }) });

// ---- catalog + sales ----
export async function loadProducts() {
  try {
    const p = await json('/api/products');
    cacheProducts(p);
    return p;
  } catch {
    return cachedProducts(); // offline: last known catalog
  }
}

// Save locally first so a sale is never lost, then try to sync.
export function submitOrder(order) {
  enqueue(order);
  return syncQueue();
}

const REJECTED = (err) => err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status);

export async function syncQueue() {
  const s = getSession();
  if (!s) return getQueue().length;
  for (const order of getQueue()) {
    // Cashiers only sync their own sales; a manager can sync anyone's.
    if (order.cashier !== s.user.username && s.user.role !== 'manager') continue;
    try {
      await json('/api/orders', { method: 'POST', body: JSON.stringify(order) }); // idempotent
      dequeue(order.id);
    } catch (err) {
      if (REJECTED(err)) { failOrder(order, err.message); continue; }
      break; // offline or signed out: keep the sale and retry later
    }
  }
  return getQueue().length;
}

// ---- manager ----
export const loadReport = () => json('/api/reports/today');
export const loadOrders = () => json('/api/orders');
export const refund = (id) => json(`/api/orders/${encodeURIComponent(id)}/refund`, { method: 'POST' });
export const loadUsers = () => json('/api/users');
export const createUser = (u) => json('/api/users', { method: 'POST', body: JSON.stringify(u) });
export const setUserDisabled = (name, disabled) => json(`/api/users/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ disabled }) });

// ---- shop settings + product management ----
export async function loadShop() {
  try {
    const s = await json('/api/settings');
    cacheShop(s);
    return s;
  } catch {
    return cachedShop(); // offline: last known shop details
  }
}
export const saveShop = async (s) => { const saved = await json('/api/settings', { method: 'PUT', body: JSON.stringify(s) }); cacheShop(saved); return saved; };
export const loadAllProducts = () => json('/api/products?all=1');
export const createProduct = (p) => json('/api/products', { method: 'POST', body: JSON.stringify(p) });
export const updateProduct = (sku, p) => json(`/api/products/${encodeURIComponent(sku)}`, { method: 'PATCH', body: JSON.stringify(p) });
