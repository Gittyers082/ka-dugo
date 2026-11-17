/* ==========================================================================
   KA-DUGO SERVICE WORKER
   Install  : pre-cache the app shell (HTML, CSS, JS, fonts, icons)
   Activate : delete caches from older versions
   Fetch    : pages/files -> network first, cached copy when offline (offline.html for unknown pages)
              API GET     -> network first, last good answer kept for offline display
   Sync     : POSTs are never cached; offline donations wait in IndexedDB (js/sync.js)
   ========================================================================== */
const VERSION = "v20";
const CACHE_NAME = "kadugo-static-" + VERSION;
const DYNAMIC_CACHE = "kadugo-dynamic-" + VERSION;

const BASE = self.registration.scope;
const abs = (path) => new URL(path, BASE).href;
const OFFLINE_URL = abs("offline.html");

// Answers that must never be replayed from cache (who is signed in right now).
const NEVER_CACHE = ["api/session.php"];

const STATIC_ASSETS = [
  "./",
  "index.html",
  "offline.html",
  "manifest.json",

  // Shared
  "css/tokens.css",
  "css/base.css",
  "css/styles.css",
  "css/ui.css",
  "js/app.js",
  "js/api.js",
  "js/db.js",
  "js/guard.js",
  "js/login.js",
  "js/notify.js",
  "js/sync.js",
  "js/ui/dom.js",
  "js/ui/format.js",
  "js/ui/toast.js",

  // Fonts and icons
  "assets/fonts/Unbounded/Unbounded-Regular.ttf",
  "assets/fonts/Unbounded/Unbounded-Medium.ttf",
  "assets/fonts/Unbounded/Unbounded-SemiBold.ttf",
  "assets/fonts/Unbounded/Unbounded-Bold.ttf",
  "assets/fonts/Hanken Grotesk/HankenGrotesk-Regular.ttf",
  "assets/fonts/Hanken Grotesk/HankenGrotesk-Medium.ttf",
  "assets/fonts/Hanken Grotesk/HankenGrotesk-SemiBold.ttf",
  "assets/fonts/Hanken Grotesk/HankenGrotesk-Bold.ttf",
  "assets/icons/kadugo-ico.ico",
  "assets/icons/crimson/crimson-logo.svg",
  "assets/icons/crimson/192-crimson_icon.png",
  "assets/icons/crimson/512-crimson_icon.png",
  "assets/icons/bone/bone-logo.svg",
  "assets/icons/bone/192-bone_icon.png",
  "assets/icons/bone/512-bone_icon.png",
  "assets/img/avatar-placeholder.svg",

  // Phlebotomist
  "pages/phlebotomist/scan.html",
  "pages/phlebotomist/collections.html",
  "js/phlebotomist/scan.js",
  "js/phlebotomist/collections.js",
  "css/phlebotomist/scan.css",
  "js/vendor/jsQR.js",

  // Bank
  "pages/bank/dashboard.html",
  "pages/bank/donation-log.html",
  "pages/bank/requests.html",
  "pages/bank/active_requests.html",
  "js/bank/dashboard.js",
  "js/bank/donation-log.js",
  "js/bank/requests.js",
  "js/bank/active-requests.js",
  "js/bank/quota.js",

  // Organizer
  "pages/organizer/dashboard.html",
  "pages/organizer/drives.html",
  "pages/organizer/alerts.html",
  "pages/organizer/account.html",
  "js/organizer/dashboard.js",
  "js/organizer/drives.js",
  "js/organizer/alerts.js",
  "js/organizer/account.js",

  // Admin
  "pages/admin/dashboard.html",
  "pages/admin/accounts.html",
  "js/admin/dashboard.js",
  "js/admin/accounts.js",

  // Donor
  "pages/donor/donor-dashboard.html",
  "pages/donor/drives-booking.html",
  "pages/donor/my-donations.html",
  "pages/donor/notifications.html",
  "pages/donor/profile.html",
  "js/donor/donor-common.js",
  "js/donor/donor-dashboard.js",
  "js/donor/donor-notifications.js",
  "js/donor/donor-profile.js",
  "js/donor/donor-qr.js",
  "js/donor/drives-booking.js",
  "js/donor/my-donations.js",
].map(abs);

/* ---------- INSTALL: pre-cache the app shell ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch(() => console.warn("[SW] Could not cache:", url)),
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
    const neverCache = NEVER_CACHE.some((path) => url.pathname.endsWith(path));
    event.respondWith(neverCache ? networkOnlyApi(req) : networkFirstApi(event));
    return;
  }
  event.respondWith(networkFirstStatic(event));
});

const offlineJson = () =>
  new Response(JSON.stringify({ ok: false, data: null, error: "You are offline.", offline: true }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });

async function networkOnlyApi(req) {
  try {
    return await fetch(req);
  } catch {
    return offlineJson();
  }
}

// Last good answer per full URL, so a page shows the data it last loaded while offline.
async function networkFirstApi(event) {
  const req = event.request;
  const cache = await caches.open(DYNAMIC_CACHE);

  try {
    const res = await fetch(req);
    if (res.ok) event.waitUntil(cache.put(req, res.clone()));
    return res;
  } catch {
    const cached = await cache.match(req);
    if (!cached) return offlineJson();
    const headers = new Headers(cached.headers);
    headers.set("X-Served-From", "cache");
    return new Response(await cached.blob(), { status: 200, headers });
  }
}

// Network first so edits show up immediately; the cache is the offline fallback.
async function networkFirstStatic(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_NAME);

  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic" && !res.redirected) {
      event.waitUntil(cache.put(req, res.clone()));
    }
    return res;
  } catch {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Redirect (not serve in place) so offline.html's relative paths resolve from the app root.
    if (req.mode === "navigate" && (await cache.match(OFFLINE_URL))) {
      return Response.redirect(OFFLINE_URL, 302);
    }
    return Response.error();
  }
}

/* ---------- NOTIFICATION CLICK: focus or open the app ---------- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || BASE;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(BASE) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
