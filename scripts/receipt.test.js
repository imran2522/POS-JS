import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, toPlain, toEscPos, money, ascii, rowText } from '../public/receipt.js';

const shop = { shopName: 'Café Ünïcode Roasters of the Very Long Name', address: '12 Main Bazaar\nFaisalabad', phone: '041-555-0100', footer: 'Thank you!', currency: 'USD' };
const order = {
  id: 'a1b2c3d4-0000-4000-8000-000000000000', cashier: 'ana', paymentMethod: 'card', discountPct: 10,
  createdAt: '2026-10-08T09:30:00.000Z',
  items: [
    { sku: 'A', name: 'Latte', qty: 3, price: 450, taxRate: 0.08 },
    { sku: 'B', name: 'Extra long sandwich name with many words to force truncation', qty: 1, price: 895, taxRate: 0.08 },
  ],
};

test('money is plain ASCII with two decimals', () => {
  assert.equal(money(123456), '$1,234.56');
  assert.equal(money(-500), '-$5.00');
  assert.equal(money(250, 'PKR'), 'Rs 2.50');
  assert.equal(money(250, 'EUR'), 'EUR 2.50');
});

test('ascii() strips accents and replaces symbols', () => {
  assert.equal(ascii('Café × 2 – “ok”'), 'Cafe x 2 - "ok"');
  assert.equal(ascii('日本'), '??');
});

test('rowText right-aligns and truncates the left side, never overflowing', () => {
  assert.equal(rowText('Tax', '$1.00', 20).length, 20);
  assert.equal(rowText('A very long item name here', '$12.00', 20).length, 20);
  assert.ok(rowText('Tax', '$1.00', 20).endsWith('$1.00'));
});

for (const width of [32, 48]) {
  test(`no printed line is wider than ${width} columns`, () => {
    const text = toPlain(buildReceipt(order, shop, { width }), width);
    for (const ln of text.split('\n')) assert.ok(ln.length <= width, `too wide (${ln.length}): ${ln}`);
  });
}

test('receipt shows totals that match the cart logic, discount included', () => {
  const text = toPlain(buildReceipt(order, shop, { width: 48 }), 48);
  // 3*450 + 895 = 2245 subtotal, 10% off = 224.5 -> 225 (rounded), tax = round(0.08*2245*0.9)
  assert.match(text, /Subtotal\s+\$22\.45/);
  assert.match(text, /Discount \(10%\)\s+-\$2\.25/);
  assert.match(text, /TOTAL\s+\$/);
  assert.match(text, /3 x Latte/);
  assert.match(text, /@ \$4\.50 each/);
  assert.match(text, /A1B2C3D4/);
});

test('reprints are clearly marked as duplicates', () => {
  assert.match(toPlain(buildReceipt(order, shop, { copy: true })), /DUPLICATE COPY/);
  assert.doesNotMatch(toPlain(buildReceipt(order, shop)), /DUPLICATE/);
});

test('ESC/POS: init, cut, ASCII-only text', () => {
  const bytes = toEscPos(buildReceipt(order, shop, { width: 48 }), { width: 48 });
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40]); // ESC @
  assert.deepEqual([...bytes.slice(-4)], [0x1d, 0x56, 0x42, 0x03]); // GS V cut
  const printable = [...bytes].filter((b) => b >= 0x80);
  assert.equal(printable.length, 0, 'no high bytes: accents must have been stripped');
});

test('ESC/POS: cash drawer pulse only when asked', () => {
  const lines = buildReceipt(order, shop);
  const has = (b, seq) => b.join(',').includes(seq.join(','));
  const pulse = [0x1b, 0x70, 0x00, 0x19, 0xfa];
  assert.ok(has(toEscPos(lines, { drawer: true }), pulse));
  assert.ok(!has(toEscPos(lines, { drawer: false }), pulse));
});

test('ESC/POS: shop name prints double size and bold', () => {
  const bytes = toEscPos(buildReceipt(order, shop), {});
  assert.ok(bytes.join(',').includes([0x1d, 0x21, 0x11].join(',')));
  assert.ok(bytes.join(',').includes([0x1b, 0x45, 0x01].join(',')));
});
