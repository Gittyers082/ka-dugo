/* ==========================================================================
   KA-DUGO SERVICE WORKER
   Static files : cached on install, served cache-first, refreshed in background
   API (GET)    : network-first, last good response kept for offline display
   Old caches   : deleted on activate
   ========================================================================== */
const VERSION = 'v2';                       // bump this whenever STATIC_ASSETS changes
const CACHE_NAME = 'kadugo-static-' + VERSION;
const DYNAMIC_CACHE = 'kadugo-dynamic-' + VERSION;

const BASE = self.registration.scope;       // e.g. http://localhost/PWA/
const abs = (path) => new URL(path, BASE).href;
const OFFLINE_URL = abs('offline.html');

// ADD EVERY PAGE / CSS / JS / IMAGE / FONT the team creates to this list
const STATIC_ASSETS = [
  './',
  'index.html',
  'offline.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'assets/icon-192.png',
  'assets/icon-512.png'
  // 'login.html',
  // 'log.html',
  // 'scan.html',
  // 'requests.html',
  // 'assets/fonts/YourFont.woff2',
].map(abs);

/* ---------- INSTALL: pre-cache the app shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch(() => console.warn('[SW] Could not cache (missing file?):', url))
        )
      )
    )
  );
  self.skipWaiting();
});

/* ---------- ACTIVATE: remove old caches ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // POSTs (donations) go straight to the network

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // ignore other sites

  if (url.pathname.includes('/api/')) {
    event.respondWith(networkFirstApi(event));
    return;
  }
  event.respondWith(staticStrategy(event));
});

/* API: try network, remember it, fall back to the last copy when offline */
async function networkFirstApi(event) {
  const req = event.request;
  const url = new URL(req.url);
  const cache = await caches.open(DYNAMIC_CACHE);
  const latestKey = new Request(url.origin + url.pathname);   // "last loaded" copy of this endpoint

  try {
    const res = await fetch(req);
    if (res.ok) {
      event.waitUntil(Promise.all([cache.put(req, res.clone()), cache.put(latestKey, res.clone())]));
    }
    return res;
  } catch (err) {
    const cached = (await cache.match(req)) || (await cache.match(latestKey));
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Served-From', 'cache');                  // pages can show "showing last loaded data"
      return new Response(await cached.blob(), { status: 200, statusText: 'OK', headers });
    }
    return new Response(JSON.stringify({ success: false, offline: true, error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/* Static files: cache first, update in the background, offline page as last resort */
async function staticStrategy(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });

  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === 'basic' && !res.redirected) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }

  const res = await refresh;
  if (res) return res;

  if (req.mode === 'navigate') return (await cache.match(OFFLINE_URL)) || Response.error();
  return Response.error();
}

/* ---------- NOTIFICATION CLICK: focus or open the app ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || BASE;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(BASE) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});