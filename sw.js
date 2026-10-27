/* ==========================================================================
   KA-DUGO SERVICE WORKER
   Static files : cached on install, served cache-first, refreshed in background
   API (GET)    : network-first, last good response kept for offline display
   Old caches   : deleted on activate
   ========================================================================== */
const VERSION = "v10";
const CACHE_NAME = "kadugo-static-" + VERSION;
const DYNAMIC_CACHE = "kadugo-dynamic-" + VERSION;

const BASE = self.registration.scope;
const abs = (path) => new URL(path, BASE).href;
const OFFLINE_URL = abs("offline.html");

const STATIC_ASSETS = [
  "./",
  "index.html",
  "offline.html",
  "manifest.json",
  "css/styles.css",
  "css/base.css",
  "css/tokens.css",
  "css/organizer.css?v=10",
  "css/bank_css/bank-requests.css",
  "css/bank_css/bank-dashboard.css",
  "js/app.js",
  "js/db.js",
  "js/sync.js",
  "js/notify.js",
  "js/ui/dom.js",
  "js/login.js",
  "js/pages/account.js",
  "js/pages/organizer-account.js",
  "js/pages/organizer-alerts.js",
  "js/pages/organizer-scheduler.js",
  "js/pages/bank-dashboard.js",
  "js/pages/bank-log.js",
  "js/pages/bank-requests.js",
  "assets/icons/crimson/192-crimson_icon.png",
  "assets/icons/crimson/512-crimson_icon.png",
  "assets/icons/bone/192-bone_icon.png",
  "pages/bank/dashboard.html",
  "pages/bank/scan.html",
  "pages/bank/requests.html",
  "pages/bank/active_requests.html",
  "pages/donor/donor-dashboard.html",
  "pages/organizer/drives.html",
  "pages/organizer/organizer.dash.html",
  "pages/organizer/organizer.account.html",
  "pages/organizer/organizerholder.html",
].map(abs);

/* ---------- INSTALL: pre-cache the app shell ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          STATIC_ASSETS.map((url) =>
            cache
              .add(url)
              .catch(() =>
                console.warn("[SW] Could not cache (missing file?):", url),
              ),
          ),
        ),
      ),
  );
  self.skipWaiting();
});

/* ---------- ACTIVATE: remove old caches ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== DYNAMIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

/* ---------- FETCH ---------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/api/")) {
    event.respondWith(fetch(req).catch(() => new Response(JSON.stringify({success:false,message:'Connect to the local server to load current data.'}),{status:503,headers:{'Content-Type':'application/json'}})));
    return;
  }
  event.respondWith(staticStrategy(event));
});

async function networkFirstApi(event) {
  const req = event.request;
  const url = new URL(req.url);
  const cache = await caches.open(DYNAMIC_CACHE);
  const latestKey = new Request(url.origin + url.pathname);

  try {
    const res = await fetch(req);
    if (res.ok) {
      event.waitUntil(
        Promise.all([
          cache.put(req, res.clone()),
          cache.put(latestKey, res.clone()),
        ]),
      );
    }
    return res;
  } catch (err) {
    const cached = (await cache.match(req)) || (await cache.match(latestKey));
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-Served-From", "cache");
      return new Response(await cached.blob(), {
        status: 200,
        statusText: "OK",
        headers,
      });
    }
    return new Response(
      JSON.stringify({ success: false, offline: true, error: "Offline" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

async function staticStrategy(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });

  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === "basic" && !res.redirected)
        cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }

  const res = await refresh;
  if (res) return res;

  //offline.html reroute
  if (req.mode === "navigate") {
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }

  return Response.error();
}

/* ---------- NOTIFICATION CLICK: focus or open the app ---------- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || BASE;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (client.url.startsWith(BASE) && "focus" in client)
            return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
