// Bump on any release that changes a cached asset. The fetch handler caches
// every same-origin GET, not just SHELL_ASSETS, so view modules under
// /views/ and /charts.js are cached too — without a bump, returning users
// keep running the previous release's modules against the new backend.
const CACHE_NAME = 'tripsplit-shell-v5';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/api.js',
  '/session.js',
  '/ui.js',
  '/errorMessages.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
    )),
  );
  self.clients.claim();
});

// Stale-while-revalidate for same-origin static assets only. Cloud Functions
// calls (trip/expense/member data, auth) are never intercepted — the app's
// actual data must always be live, only the static shell benefits from
// offline/caching. A stale shell self-heals on the next load since every
// hit also refreshes the cache in the background.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.hostname.endsWith('cloudfunctions.net')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
