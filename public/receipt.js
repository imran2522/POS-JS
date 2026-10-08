// One receipt description, three outputs: on-screen preview, browser print, and ESC/POS bytes.
// Pure functions (no DOM), so everything here is unit-tested.
import { calcTotals, lineTotal } from '../shared/cart.js';

const SYMBOLS = { USD: '$', PKR: 'Rs ' };

// Always plain ASCII with two decimals: thermal printers use single-byte code pages.
export function money(cents, currency = 'USD') {
  const n = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : ''}${SYMBOLS[currency] ?? currency + ' '}${n}`;
}

export const ascii = (s) =>
  String(s)
    .replace(/×/g, 'x').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) { // a single very long word
      if (line) { out.push(line); line = ''; }
      out.push(w.slice(0, width)); w = w.slice(width);
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

export function rowText(left, right, width) {
  const maxLeft = Math.max(0, width - right.length - 1);
  const l = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  return l + ' '.repeat(Math.max(1, width - l.length - right.length)) + right;
}

const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// width = characters per line: 32 for 58 mm paper, 48 for 80 mm paper.
export function buildReceipt(order, shop, { width = 48, copy = false } = {}) {
  const t = calcTotals(order.items, order.discountPct || 0);
  const cur = shop.currency || 'USD';
  const m = (c) => money(c, cur);
  const lines = [];
  const center = (text, o = {}) => {
    for (const ln of wrap(ascii(text), Math.floor(width / (o.size || 1)))) lines.push({ type: 'text', text: ln, align: 'center', ...o });
  };
  const row = (left, right, o = {}) => lines.push({ type: 'row', left: ascii(left), right: ascii(right), ...o });
  const rule = () => lines.push({ type: 'rule' });

  center(shop.shopName || 'Receipt', { bold: true, size: 2 });
  for (const ln of String(shop.address || '').split('\n').filter(Boolean)) center(ln);
  if (shop.phone) center('Tel: ' + shop.phone);
  rule();
  if (copy) center('*** DUPLICATE COPY ***', { bold: true });
  row('Receipt', String(order.id).slice(0, 8).toUpperCase());
  row('Date', stamp(order.createdAt));
  if (order.cashier) row('Cashier', order.cashier);
  rule();
  for (const i of order.items) {
    row(`${i.qty} x ${i.name}`, m(lineTotal(i)));
    if (i.qty > 1) lines.push({ type: 'text', text: `  @ ${m(i.price)} each`, align: 'left' });
  }
  rule();
  row('Subtotal', m(t.subtotal));
  if (t.discount) row(`Discount (${order.discountPct}%)`, '-' + m(t.discount));
  row('Tax', m(t.tax));
  row('TOTAL', m(t.total), { bold: true, size: 2 });
  row('Paid by', order.paymentMethod || 'cash');
  rule();
  if (shop.footer) center(shop.footer);
  return lines;
}

// ---- plain text (preview + browser print) ----
export function toPlain(lines, width = 48) {
  return lines.map((l) => {
    if (l.type === 'rule') return '-'.repeat(width);
    if (l.type === 'row') return rowText(l.left, l.right, width);
    return l.align === 'center' ? ' '.repeat(Math.max(0, Math.floor((width - l.text.length) / 2))) + l.text : l.text;
  }).join('\n');
}

// ---- ESC/POS (Epson-compatible thermal printers) ----
export function toEscPos(lines, { width = 48, drawer = false, cut = true } = {}) {
  const b = [0x1b, 0x40, 0x1b, 0x74, 0x00]; // initialize, code page 437
  if (drawer) b.push(0x1b, 0x70, 0x00, 0x19, 0xfa); // pulse cash drawer pin 2
  for (const l of lines) {
    const size = l.size === 2 ? 2 : 1;
    b.push(0x1b, 0x61, l.align === 'center' ? 1 : 0); // alignment
    b.push(0x1b, 0x45, l.bold ? 1 : 0); // bold
    b.push(0x1d, 0x21, size === 2 ? 0x11 : 0x00); // double width + height
    const text = l.type === 'rule' ? '-'.repeat(width) : l.type === 'row' ? rowText(l.left, l.right, Math.floor(width / size)) : l.text;
    for (const ch of ascii(text)) b.push(ch.charCodeAt(0));
    b.push(0x0a);
  }
  b.push(0x1b, 0x61, 0x00, 0x1b, 0x45, 0x00, 0x1d, 0x21, 0x00); // reset styles
  b.push(0x1b, 0x64, 0x03); // feed 3 lines
  if (cut) b.push(0x1d, 0x56, 0x42, 0x03); // partial cut
  return Uint8Array.from(b);
}
