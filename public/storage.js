// Offline layer: session, catalog cache, pending-order queue.
// localStorage keeps it simple; move to IndexedDB when queues get large.
const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export const getSession = () => read('pos.session', null);
export const setSession = (s) => write('pos.session', s);
export const clearSession = () => localStorage.removeItem('pos.session');

export const cacheProducts = (p) => write('pos.products', p);
export const cachedProducts = () => read('pos.products', []);
export const getQueue = () => read('pos.queue', []);
export const enqueue = (o) => write('pos.queue', [...getQueue(), o]);
export const dequeue = (id) => write('pos.queue', getQueue().filter((o) => o.id !== id));

// Sales the server rejected (not a connection problem). Kept for a manager to review, never silently dropped.
export const getFailed = () => read('pos.failed', []);
export const failOrder = (o, reason) => { dequeue(o.id); write('pos.failed', [...getFailed(), { ...o, reason }]); };

// Shop details for receipts (cached so receipts still print offline).
export const cacheShop = (s) => write('pos.shop', s);
export const cachedShop = () => read('pos.shop', { shopName: 'JS Store', address: '', phone: '', footer: 'Thank you!', currency: 'USD' });

// Printer preferences. width = characters per line (32 = 58 mm paper, 48 = 80 mm paper).
export const getPrinterPrefs = () => ({ width: 48, auto: true, drawer: false, kind: null, ...read('pos.printer', {}) });
export const setPrinterPrefs = (p) => write('pos.printer', p);
