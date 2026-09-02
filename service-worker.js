/* ============================================================
   service-worker.js — FinResolver PWA
   Uses relative paths so it works on GitHub Pages subdirectories.
   ============================================================ */

const CACHE_NAME   = 'finresolver-v3';
const CACHE_ASSETS = [
  './',
  './index.html',
  './finresolver.png',
  './manifest.json',
  './css/variables.css',
  './css/app.css',
  './css/login.css',
  './css/home.css',
  './css/loans.css',
  './css/investments.css',
  './css/import.css',
  './css/insights.css',
  './css/mobile.css',
  './css/theme-light.css',
  './js/theme.js',
  './js/data.js',
  './js/render.js',
  './js/tracker.js',
  './js/import.js',
  './js/insights.js',
  './js/home.js',
  './js/sync.js',
  './js/auth.js',
  './js/notes.js',
  './js/loans.js',
  './js/investments.js',
];

/* ── Install: cache all core assets ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: clear old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: network-first for external APIs, cache-first for local assets ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Always go network for external APIs (Firebase, Yahoo, proxies) */
  if (url.origin !== location.origin) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  /* Cache-first for local assets, fallback to index.html for offline */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
