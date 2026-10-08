// JS Store service worker: the whole app (screens, scripts, styles) loads with no connection.
// The server swaps the build placeholder below for a hash of the app files, so any code
// change automatically produces a new cache and an "update ready" prompt. Nothing to bump by hand.
const VERSION = '__BUILD__';
const CACHE = `till-${VERSION}`;
const TIMEOUT = self.TILL_TIMEOUT ?? 3000; // a slow shop connection must not freeze the till

const SHELL = [
  '/', '/index.html', '/styles.css',
  '/app.js', '/api.js', '/storage.js', '/receipt.js', '/printer.js', '/admin.js',
  '/shared/cart.js', '/shared/roles.js',
  '/manifest.webmanifest', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (e) => {
  // 'reload' skips the browser HTTP cache, so we never precache stale files.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  // No skipWaiting here: a new version waits until the cashier taps "Reload" between sales.
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('till-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Network first (always fresh when online), cache when offline or slow.
function networkFirst(req, fallbackUrl) {
  const net = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
  net.catch(() => {}); // if the timeout wins, a later network failure is not an error
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT));
  return Promise.race([net, timeout]).catch(async () =>
    (await caches.match(req, { ignoreSearch: true })) ||
    (fallbackUrl && (await caches.match(fallbackUrl))) ||
    Response.error()
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // data is handled by the app's own offline queue
  // Any page navigation falls back to the cached app, so a reload while offline still opens the till.
  e.respondWith(networkFirst(req, req.mode === 'navigate' ? '/index.html' : null));
});
