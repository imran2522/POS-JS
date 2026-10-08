import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, setQty, calcTotals } from './cart.js';

const coffee = { sku: 'C1', name: 'Coffee', price: 350, taxRate: 0.1 };

test('adding same product increments qty', () => {
  const items = addItem(addItem([], coffee), coffee);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 2);
});

test('setQty 0 removes the line', () => {
  assert.deepEqual(setQty(addItem([], coffee), 'C1', 0), []);
});

test('totals use integer cents and avoid float drift', () => {
  const items = setQty(addItem([], coffee), 'C1', 3); // 1050 subtotal
  const t = calcTotals(items);
  assert.deepEqual(t, { subtotal: 1050, discount: 0, tax: 105, total: 1155 });
});

test('discount reduces tax proportionally', () => {
  const items = setQty(addItem([], coffee), 'C1', 3);
  const t = calcTotals(items, 10);
  assert.equal(t.discount, 105);
  assert.equal(t.total, 1050 - 105 + Math.round(105 * 0.9));
});
