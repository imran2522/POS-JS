// Runs the real sw.js in a sandbox with fake caches/fetch and simulates going offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const code = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/sw.js'), 'utf8').replaceAll('__BUILD__', 'testbuild');
const BASE = 'http://localhost';
const abs = (r) => { const u = new URL(typeof r === 'string' ? r : r.url, BASE); u.search = ''; return u.href; };

function makeWorker() {
  const stores = new Map();
  const handlers = {};
  const state = { offline: false, hang: false, claimed: false };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name);
      return {
        async addAll(reqs) { for (const r of reqs) s.set(abs(r), await sandbox.fetch(r)); },
        async put(r, res) { s.set(abs(r), res); },
      };
    },
    async match(r) { for (const s of stores.values()) if (s.has(abs(r))) return s.get(abs(r)).clone(); },
    async keys() { return [...stores.keys()]; },
    async delete(k) { return stores.delete(k); },
  };
  class ShimRequest extends Request { constructor(u, o) { super(new URL(u, BASE), o); } }
  const sandbox = {
    self: { addEventListener: (t, fn) => { handlers[t] = fn; }, location: { origin: BASE }, clients: { claim: async () => { state.claimed = true; } }, skipWaiting() { state.skipped = true; }, JS_POS_TIMEOUT: 40 },
    caches, Request: ShimRequest, Response, URL, setTimeout, Promise,
    fetch: async (r) => {
      if (state.hang) return new Promise(() => {});
      if (state.offline) throw new TypeError('Failed to fetch');
      return new Response('fresh:' + abs(r), { status: 200 });
    },
  };
  vm.runInContext(code, vm.createContext(sandbox));
  const fire = async (type, ev) => { ev.waitUntil ??= (p) => { ev.w = p; }; ev.respondWith ??= (p) => { ev.p = p; }; handlers[type](ev); await ev.w; return ev; };
  const get = async (pathname, mode = 'no-cors') => {
    const ev = await fire('fetch', { request: { url: BASE + pathname, method: 'GET', mode } });
    return ev.p ? (await ev.p) : null;
  };
  return { stores, state, fire, get };
}

test('installs the whole app shell into a versioned cache', async () => {
  const w = makeWorker();
  await w.fire('install', {});
  const cache = w.stores.get('js-pos-testbuild');
  assert.ok(cache.has(BASE + '/index.html') && cache.has(BASE + '/app.js') && cache.has(BASE + '/shared/cart.js'));
});

test('offline: scripts, styles and the home page load from cache', async () => {
  const w = makeWorker();
  await w.fire('install', {});
  w.state.offline = true;
  assert.match(await (await w.get('/app.js')).text(), /fresh:.*app\.js/);
  assert.equal((await w.get('/', 'navigate')).status, 200);
});

test('offline: reloading any page path still opens the app', async () => {
  const w = makeWorker();
  await w.fire('install', {});
  w.state.offline = true;
  assert.match(await (await w.get('/some/deep/link', 'navigate')).text(), /index\.html/);
});

test('slow network: falls back to cache instead of freezing', async () => {
  const w = makeWorker();
  await w.fire('install', {});
  w.state.hang = true;
  assert.equal((await w.get('/styles.css')).status, 200);
});

test('online: serves fresh files and refreshes the cache', async () => {
  const w = makeWorker();
  await w.fire('install', {});
  await (await w.get('/api.js')).text();
  assert.ok(w.stores.get('js-pos-testbuild').has(BASE + '/api.js'));
});

test('API calls are never intercepted or cached', async () => {
  const w = makeWorker();
  await w.fire('install', {});
  assert.equal(await w.get('/api/products'), null);
  const post = await w.fire('fetch', { request: { url: BASE + '/api/orders', method: 'POST', mode: 'cors' } });
  assert.equal(post.p, undefined);
});

test('activate removes old caches and takes control', async () => {
  const w = makeWorker();
  w.stores.set('till-oldbuild', new Map());
  w.stores.set('js-pos-oldbuild', new Map());
  await w.fire('install', {});
  await w.fire('activate', {});
  assert.deepEqual([...w.stores.keys()], ['js-pos-testbuild']);
  assert.ok(w.state.claimed);
});

test('SKIP_WAITING message activates the new version', async () => {
  const w = makeWorker();
  await w.fire('message', { data: 'SKIP_WAITING' });
  assert.ok(w.state.skipped);
});
