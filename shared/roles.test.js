import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, MAX_DISCOUNT } from './roles.js';

test('every role has a discount limit', () => {
  for (const r of ROLES) assert.equal(typeof MAX_DISCOUNT[r], 'number');
});
test('cashiers are capped below managers', () => {
  assert.ok(MAX_DISCOUNT.cashier < MAX_DISCOUNT.manager);
});
