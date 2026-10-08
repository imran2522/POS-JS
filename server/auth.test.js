import test from 'node:test';
import assert from 'node:assert/strict';

process.env.POS_SECRET = 'test-secret';
const { hashPassword, verifyPassword, signToken, verifyToken } = await import('./auth.js');

test('password hash verifies and rejects wrong password', () => {
  const h = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('token round trip', () => {
  assert.equal(verifyToken(signToken({ sub: 'ana' })).sub, 'ana');
});

test('tampered token is rejected', () => {
  const [body, sig] = signToken({ sub: 'ana' }).split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'manager', exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal(verifyToken(`${forged}.${sig}`), null);
  assert.equal(verifyToken(`${body}.x${sig}`), null);
});

test('expired token is rejected', () => {
  assert.equal(verifyToken(signToken({ sub: 'ana' }, -1)), null);
});
