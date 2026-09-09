/* Service worker — NETWORK-FIRST for the app shell.
 *
 *   - navigations / index.html  -> network first, cache only as offline fallback
 *   - hashed assets (immutable) -> cache first (safe: filename changes per build)
 *   - everything cross-origin   -> never touched (API calls and streams go direct)
 *
 * The hash Vite appends is base64url, so it can contain '-' as well as
 * letters, digits and '_'. The asset regex accepts all three so no chunk
 * is ever missed from the cache.
 */
const V = 'surbox-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // API calls untouched

  const isShell = req.mode === 'navigate' || url.pathname.endsWith('/') ||
                  url.pathname.endsWith('index.html');
  const isHashed = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(url.pathname);

  if (isShell) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((h) => h || caches.match('./index.html')))
    );
    return;
  }

  if (isHashed) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
