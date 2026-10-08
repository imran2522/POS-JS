import test from 'node:test';
import assert from 'node:assert/strict';
import { getCart, saveCart, clearCart } from '../public/storage.js';

const makeStorage = () => {
  const store = Object.create(null);
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  };
};

test('cart state persists until an explicit new-sale reset', () => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: makeStorage(),
    configurable: true,
    writable: true,
  });

  try {
    assert.deepEqual(getCart(), { items: [], discountPct: 0 });
    saveCart([{ sku: 'P1', name: 'Widget', qty: 2, price: 100, taxRate: 0 }], 10);
    assert.deepEqual(getCart(), {
      items: [{ sku: 'P1', name: 'Widget', qty: 2, price: 100, taxRate: 0 }],
      discountPct: 10,
    });
    clearCart();
    assert.deepEqual(getCart(), { items: [], discountPct: 0 });
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
  }
});
