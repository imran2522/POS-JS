import { addItem, setQty, calcTotals, fmt, lineTotal, setCurrency } from '/shared/cart.js';
import { MAX_DISCOUNT } from '/shared/roles.js';
import * as api from './api.js';
import { getQueue, getFailed, getSession, cachedShop, getPrinterPrefs, setPrinterPrefs } from './storage.js';
import { buildReceipt, toPlain, toEscPos } from './receipt.js';
import * as printer from './printer.js';
import { createAdmin } from './admin.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const friendly = (err) => (err.status ? err.message : 'Cannot reach the server. Check your connection.');

const state = { products: [], items: [], query: '', discountPct: 0, user: null };
let shop = cachedShop();
setCurrency(shop.currency);
let recentOrders = [];
let lastReceipt = null;
const maxDiscount = () => MAX_DISCOUNT[state.user.role];

// ---------- screens ----------
function showLogin(message = '') {
  state.user = null; state.items = []; state.discountPct = 0;
  $('app').hidden = true;
  $('login').hidden = false;
  $('loginError').textContent = message;
  $('loginPass').value = '';
  $('loginUser').focus();
}

function showApp(user) {
  state.user = user;
  $('login').hidden = true;
  $('app').hidden = false;
  $('who').textContent = `${user.username} · ${user.role}`;
  document.querySelectorAll('[data-role="manager"]').forEach((el) => { el.hidden = user.role !== 'manager'; });
  $('discount').max = maxDiscount();
  $('discount').value = state.discountPct = Math.min(state.discountPct, maxDiscount());
  renderStatus(); renderCart();
}

// ---------- rendering ----------
const stockBadge = (p) => (p.stock <= 0 ? '<em class="badge out">Out</em>' : p.stock <= 5 ? `<em class="badge low">${p.stock} left</em>` : '');
function renderGrid() {
  const q = state.query.toLowerCase();
  const list = state.products.filter((p) => (p.name + p.sku).toLowerCase().includes(q));
  $('grid').innerHTML = list.length
    ? list.map((p) => `<button class="tile" data-sku="${esc(p.sku)}"><b>${esc(p.name)}</b><span>${fmt(p.price)}</span>${stockBadge(p)}</button>`).join('')
    : '<p class="empty">No product matches that search.</p>';
}

function renderCart() {
  $('lines').innerHTML = state.items.length
    ? state.items.map((i) => `
        <div class="line">
          <div><b>${esc(i.name)}</b><small>${fmt(i.price)} each</small></div>
          <div class="qty">
            <button data-dec="${esc(i.sku)}" aria-label="Remove one">−</button>
            <span>${i.qty}</span>
            <button data-inc="${esc(i.sku)}" aria-label="Add one">+</button>
          </div>
          <span class="amt">${fmt(lineTotal(i))}</span>
        </div>`).join('')
    : '<p class="empty">Tap a product or scan an item to start.</p>';

  const t = calcTotals(state.items, state.discountPct);
  $('totals').innerHTML = `
    <dt>Subtotal</dt><dd>${fmt(t.subtotal)}</dd>
    ${t.discount ? `<dt>Discount</dt><dd>−${fmt(t.discount)}</dd>` : ''}
    <dt>Tax</dt><dd>${fmt(t.tax)}</dd>
    <dt class="big">Total</dt><dd class="big">${fmt(t.total)}</dd>`;
  $('payCash').disabled = $('payCard').disabled = !state.items.length;
}

function renderStatus(pending = getQueue().length) {
  const on = navigator.onLine;
  $('status').textContent = on ? 'Online' : 'Offline, sales are saved';
  $('status').className = 'pill ' + (on ? 'ok' : 'off');
  $('pending').hidden = pending === 0;
  $('pending').textContent = `${pending} to sync`;
  const failed = getFailed().length;
  $('failed').hidden = failed === 0;
  $('failed').textContent = `${failed} rejected, ask a manager`;
}

function showModal(html) {
  $('modal').innerHTML = `<div class="receipt">${html}</div>`;
  $('modal').hidden = false;
}
const closeModal = () => { $('modal').hidden = true; $('search').focus(); };
const closeBtn = '<button id="closeBtn" class="ghost">Close</button>';
const errorLine = (m) => (m ? `<p class="error" role="alert">${esc(m)}</p>` : '');

// ---------- sales ----------
function checkout(paymentMethod) {
  if (!state.items.length) return;
  const order = {
    id: crypto.randomUUID(), items: state.items, discountPct: state.discountPct,
    paymentMethod, cashier: state.user.username, createdAt: new Date().toISOString(),
  };
  const t = calcTotals(order.items, order.discountPct);

  lastReceipt = { order, copy: false };
  showReceipt(order);
  if (printer.isConnected() && getPrinterPrefs().auto) autoPrint(order);

  state.items = []; state.discountPct = 0; $('discount').value = 0;
  renderCart();
  api.submitOrder(order).then(renderStatus);
}

// ---------- receipts + printing ----------
function showReceipt(order, { copy = false } = {}) {
  const width = getPrinterPrefs().width;
  const text = toPlain(buildReceipt(order, shop, { width, copy }), width);
  showModal(`
    <h3>Receipt</h3>
    <pre class="paper">${esc(text)}</pre>
    <p id="printMsg" class="error" role="status"></p>
    <div class="row">
      <button id="printBtn">Print</button>
      <button id="closeBtn" class="ghost">${copy ? 'Done' : 'New sale'}</button>
    </div>`);
}

// Thermal printer if connected, otherwise the browser's print dialog.
async function printReceipt(order, { copy = false, kick = false } = {}) {
  const width = getPrinterPrefs().width;
  const lines = buildReceipt(order, shop, { width, copy });
  if (printer.isConnected()) return printer.print(toEscPos(lines, { width, drawer: kick }));
  $('printArea').innerHTML = `<pre class="paper">${esc(toPlain(lines, width))}</pre>`;
  window.print();
}

const printFailed = (err) => {
  const msg = $('printMsg');
  if (msg) msg.textContent = `Printer problem: ${err.message}. Check the cable and paper, then tap Print again.`;
};

function autoPrint(order) {
  const kick = order.paymentMethod === 'cash' && getPrinterPrefs().drawer;
  printReceipt(order, { kick }).catch(printFailed);
}

async function reprint() {
  if (!lastReceipt) return;
  try { await printReceipt(lastReceipt.order, { copy: lastReceipt.copy }); $('printMsg').textContent = ''; } catch (err) { printFailed(err); }
}

const renderPrinterBtn = () => { $('printerBtn').textContent = printer.isConnected() ? 'Printer ●' : 'Printer'; };

function showPrinter(message = '', ok = false) {
  const sup = printer.supported();
  const p = getPrinterPrefs();
  showModal(`
    <h3>Receipt printer</h3>
    <p><span>Status</span><span>${printer.isConnected() ? `Connected (${printer.kind() === 'usb' ? 'USB' : 'serial'})` : 'Not connected'}</span></p>
    <div class="stack">
      ${sup.usb ? '<button data-pconnect="usb">Connect USB printer</button>' : ''}
      ${sup.serial ? '<button data-pconnect="serial" class="ghost">Connect serial or Bluetooth printer</button>' : ''}
      ${!sup.usb && !sup.serial ? '<p class="empty">Direct thermal printing needs Chrome or Edge. Browser printing still works.</p>' : ''}
      ${printer.isConnected() ? '<button data-ptest class="ghost">Print test receipt</button><button data-pdisconnect class="ghost">Disconnect</button>' : ''}
    </div>
    <form id="printerForm" class="stack">
      <label>Paper width
        <select name="width">
          <option value="32" ${p.width === 32 ? 'selected' : ''}>58 mm (32 columns)</option>
          <option value="48" ${p.width === 48 ? 'selected' : ''}>80 mm (48 columns)</option>
        </select>
      </label>
      <label class="check"><input type="checkbox" name="auto" ${p.auto ? 'checked' : ''} /> Print automatically after each sale</label>
      <label class="check"><input type="checkbox" name="drawer" ${p.drawer ? 'checked' : ''} /> Open cash drawer on cash sales</label>
    </form>
    <small>With no printer connected, Print opens the browser's print dialog.</small>
    ${message ? `<p class="${ok ? '' : 'error'}" role="status">${esc(message)}</p>` : ''}${closeBtn}`);
}

async function handlePrinterClick(e) {
  const d = e.target.dataset;
  if (d.pconnect) {
    try { await printer.connect(d.pconnect); renderPrinterBtn(); showPrinter('Printer connected.', true); } catch (err) {
      showPrinter(err.name === 'NotFoundError' ? 'No printer was selected.' : err.message);
    }
    return true;
  }
  if ('pdisconnect' in d) { await printer.disconnect(true); renderPrinterBtn(); showPrinter(); return true; }
  if ('ptest' in d) {
    const sample = { id: 'TEST0000', cashier: state.user.username, paymentMethod: 'cash', discountPct: 0, createdAt: new Date().toISOString(), items: [{ sku: 'T', name: 'Test item', qty: 2, price: 150, taxRate: 0 }] };
    try { await printReceipt(sample); showPrinter('Test receipt sent.', true); } catch (err) { showPrinter(err.message); }
    return true;
  }
  return false;
}

// ---------- manager menu + screens ----------
const admin = createAdmin({
  api, showModal, esc, friendly, fmt, closeBtn, errorLine,
  onProductsChange: async () => { state.products = await api.loadProducts(); renderGrid(); },
  onShopChange: (s) => { shop = s; setCurrency(s.currency); renderGrid(); renderCart(); },
});

function showManagerMenu() {
  showModal(`
    <h3>Manager</h3>
    <div class="stack">
      <button data-menu="products">Products and stock</button>
      <button data-menu="orders" class="ghost">Sales and refunds</button>
      <button data-menu="report" class="ghost">Today's report</button>
      <button data-menu="staff" class="ghost">Staff</button>
      <button data-menu="shop" class="ghost">Shop and receipt details</button>
    </div>
    ${closeBtn}`);
}
const openMenu = (name) => ({ menu: showManagerMenu, products: () => admin.showProducts(), orders: () => showOrders(), report: showReport, staff: () => showStaff(), shop: () => admin.showShop() })[name]?.();

// ---------- manager screens ----------
async function showReport() {
  try {
    const r = await api.loadReport();
    const rows = (o) => Object.entries(o).map(([k, v]) => `<p><span>${esc(k)}</span><span>${fmt(v)}</span></p>`).join('');
    showModal(`
      <h3>Today</h3>
      <p><span>Sales</span><span>${r.orders}</span></p>
      <p><span>Revenue</span><span>${fmt(r.revenue)}</span></p>
      <p><span>Tax collected</span><span>${fmt(r.tax)}</span></p>
      <h4>By payment</h4>${rows(r.byMethod)}
      <h4>By cashier</h4>${rows(r.byCashier)}
      ${closeBtn}`);
  } catch (err) {
    showModal(`<h3>Today</h3>${errorLine(friendly(err))}${closeBtn}`);
  }
}

async function showOrders(message = '') {
  try {
    const orders = (recentOrders = await api.loadOrders());
    showModal(`
      <h3>Recent sales</h3>
      ${orders.length ? orders.map((o) => `
        <p><span>${new Date(o.createdAt).toLocaleTimeString()} · ${esc(o.cashier)} · ${fmt(o.total)}${o.status === 'refunded' ? ' · refunded' : ''}</span>
        <span class="actions"><button class="small ghost" data-print="${esc(o.id)}">Receipt</button>${o.status === 'paid' ? `<button class="small" data-refund="${esc(o.id)}">Refund</button>` : ''}</span></p>`).join('') : '<p class="empty">No sales yet.</p>'}
      ${errorLine(message)}${closeBtn}`);
  } catch (err) {
    showModal(`<h3>Recent sales</h3>${errorLine(friendly(err))}${closeBtn}`);
  }
}

async function showStaff(message = '') {
  try {
    const users = await api.loadUsers();
    showModal(`
      <h3>Staff</h3>
      ${users.map((u) => `
        <p><span>${esc(u.username)} · ${u.role}${u.disabled ? ' · disabled' : ''}</span>
        ${u.username !== state.user.username ? `<button class="small ghost" data-toggle="${esc(u.username)}" data-disable="${u.disabled ? 'false' : 'true'}">${u.disabled ? 'Enable' : 'Disable'}</button>` : ''}</p>`).join('')}
      <form id="addUserForm" class="stack">
        <h4>Add staff</h4>
        <input name="username" placeholder="Username" autocomplete="off" required />
        <input name="password" type="password" placeholder="Password, 8+ characters" minlength="8" autocomplete="new-password" required />
        <select name="role"><option value="cashier">Cashier</option><option value="manager">Manager</option></select>
        <button type="submit">Add</button>
      </form>
      ${errorLine(message)}${closeBtn}`);
  } catch (err) {
    showModal(`<h3>Staff</h3>${errorLine(friendly(err))}${closeBtn}`);
  }
}

function showPassword(message = '', ok = false) {
  showModal(`
    <h3>Change password</h3>
    <form id="pwForm" class="stack">
      <input name="current" type="password" placeholder="Current password" autocomplete="current-password" required />
      <input name="next" type="password" placeholder="New password, 8+ characters" minlength="8" autocomplete="new-password" required />
      <button type="submit">Save password</button>
    </form>
    ${ok ? '<p>Password changed.</p>' : errorLine(message)}${closeBtn}`);
}

// ---------- events (delegated, so re-rendering never loses handlers) ----------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const user = await api.login($('loginUser').value.trim(), $('loginPass').value);
    $('loginUser').value = '';
    await enter(user);
  } catch (err) {
    $('loginError').textContent = friendly(err);
  }
});

$('logoutBtn').addEventListener('click', async () => {
  const pending = await api.syncQueue();
  if (pending > 0 && !confirm(`${pending} sale(s) have not synced yet. They stay saved on this device until the next sign-in. Sign out anyway?`)) return;
  api.logout();
  showLogin();
});

$('grid').addEventListener('click', (e) => {
  const sku = e.target.closest('[data-sku]')?.dataset.sku;
  const p = state.products.find((x) => x.sku === sku);
  if (p) { state.items = addItem(state.items, p); renderCart(); }
});

$('lines').addEventListener('click', (e) => {
  const inc = e.target.closest('[data-inc]')?.dataset.inc;
  const dec = e.target.closest('[data-dec]')?.dataset.dec;
  const sku = inc || dec;
  if (!sku) return;
  const cur = state.items.find((i) => i.sku === sku).qty;
  state.items = setQty(state.items, sku, cur + (inc ? 1 : -1));
  renderCart();
});

$('search').addEventListener('input', (e) => { state.query = e.target.value; renderGrid(); });

// Barcode scanners type the SKU then press Enter.
$('search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = state.query.trim().toLowerCase();
  const exact = state.products.find((p) => p.sku.toLowerCase() === q);
  const only = state.products.filter((p) => (p.name + p.sku).toLowerCase().includes(q));
  const hit = exact || (only.length === 1 && only[0]);
  if (hit) {
    state.items = addItem(state.items, hit);
    state.query = ''; e.target.value = '';
    renderGrid(); renderCart();
  }
});

$('discount').addEventListener('input', (e) => {
  state.discountPct = Math.min(maxDiscount(), Math.max(0, Number(e.target.value) || 0));
  renderCart();
});

document.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => checkout(b.dataset.pay)));
$('managerBtn').addEventListener('click', showManagerMenu);
$('printerBtn').addEventListener('click', () => showPrinter());
$('pwBtn').addEventListener('click', () => showPassword());

$('modal').addEventListener('click', async (e) => {
  if (e.target === $('modal') || e.target.id === 'closeBtn') return closeModal();
  if (e.target.id === 'printBtn') return reprint();
  if (await admin.handleClick(e)) return;
  if (await handlePrinterClick(e)) return;
  if (e.target.dataset.menu) return openMenu(e.target.dataset.menu);
  const printId = e.target.dataset.print;
  if (printId) {
    const order = recentOrders.find((o) => o.id === printId);
    if (order) { lastReceipt = { order, copy: true }; showReceipt(order, { copy: true }); }
    return;
  }

  const refundId = e.target.dataset.refund;
  if (refundId && confirm('Refund this sale? Stock is returned.')) {
    try { await api.refund(refundId); showOrders(); } catch (err) { showOrders(friendly(err)); }
  }
  const toggle = e.target.dataset.toggle;
  if (toggle) {
    try { await api.setUserDisabled(toggle, e.target.dataset.disable === 'true'); showStaff(); } catch (err) { showStaff(friendly(err)); }
  }
});

$('modal').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await admin.handleSubmit(e)) return;
  const f = Object.fromEntries(new FormData(e.target));
  if (e.target.id === 'addUserForm') {
    try { await api.createUser(f); showStaff(); } catch (err) { showStaff(friendly(err)); }
  }
  if (e.target.id === 'pwForm') {
    try { await api.changePassword(f.current, f.next); showPassword('', true); } catch (err) { showPassword(friendly(err)); }
  }
});

$('modal').addEventListener('change', (e) => {
  if (e.target.form?.id !== 'printerForm') return;
  const f = new FormData(e.target.form);
  setPrinterPrefs({ ...getPrinterPrefs(), width: Number(f.get('width')), auto: f.has('auto'), drawer: f.has('drawer') });
});

const sync = async () => { if (state.user) renderStatus(await api.syncQueue()); };
window.addEventListener('online', sync);
window.addEventListener('offline', () => state.user && renderStatus());
setInterval(sync, 15000);

// ---------- start ----------
async function enter(user) {
  showApp(user);
  [state.products, shop] = await Promise.all([api.loadProducts(), api.loadShop()]);
  setCurrency(shop.currency);
  renderGrid(); renderCart();
  printer.reconnect().then(renderPrinterBtn);
  sync();
  api.refreshMe().then((fresh) => { if (fresh.role !== state.user?.role) showApp(fresh); }).catch(() => {}); // offline: keep stored role
  $('search').focus();
}

// A 401 means the session expired or the account was disabled. Unsent sales stay queued.
api.setAuthLostHandler(() => { api.logout(); showLogin('Your session ended. Sign in again; unsent sales are kept.'); });

const saved = getSession();
if (saved) enter(saved.user); else showLogin();

// ---------- offline app shell ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // false on the very first visit

  const offerUpdate = (worker) => {
    $('update').hidden = false;
    $('updateBtn').onclick = () => {
      if (state.items.length && !confirm('Reloading clears the current sale. Continue?')) return;
      worker.postMessage('SKIP_WAITING');
    };
  };

  navigator.serviceWorker.register('/sw.js').then((reg) => {
    if (reg.waiting && hadController) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000); // check hourly
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing to reload
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.ready.then(() => { $('cached').hidden = false; });
}
registerServiceWorker();
