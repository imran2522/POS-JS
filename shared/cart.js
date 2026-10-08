// All money is INTEGER CENTS. Never store floats.
let currency = 'USD';
export const setCurrency = (code) => { currency = code; };
export const fmt = (cents) =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency });

export const lineTotal = (i) => i.price * i.qty;

export function addItem(items, product) {
  const found = items.find((i) => i.sku === product.sku);
  if (found) return items.map((i) => (i.sku === product.sku ? { ...i, qty: i.qty + 1 } : i));
  return [...items, { sku: product.sku, name: product.name, price: product.price, taxRate: product.taxRate, qty: 1 }];
}

export function setQty(items, sku, qty) {
  return qty <= 0 ? items.filter((i) => i.sku !== sku) : items.map((i) => (i.sku === sku ? { ...i, qty } : i));
}

// discountPct: 0-100, applied to subtotal; tax is computed on the discounted amount.
export function calcTotals(items, discountPct = 0) {
  const subtotal = items.reduce((s, i) => s + lineTotal(i), 0);
  const discount = Math.round((subtotal * discountPct) / 100);
  const rawTax = items.reduce((s, i) => s + lineTotal(i) * i.taxRate, 0);
  const tax = Math.round(rawTax * (1 - discountPct / 100));
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}
