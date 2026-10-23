/* ==========================================================================
   KA-DUGO PWA ENGINE (js/app.js)
   ========================================================================== */
(function () {
  "use strict";

  const APP_BASE = new URL("../", document.currentScript.src).href;
  const DONATIONS_API = APP_BASE + "api/donations.php";
  const ICON = APP_BASE + "assets/icons/icon-192.png";

  const DB_NAME = "KadugoOfflineDB";
  const DB_VERSION = 2;
  const STORE = "pending_donations";
  const SYNC_RETRY_MS = 30000;

  let isSyncing = false;

  /* ---------- 1. SERVICE WORKER ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(APP_BASE + "sw.js")
        .then((reg) => console.log("[PWA] SW registered, scope:", reg.scope))
        .catch((err) => console.error("[PWA] SW registration failed:", err));
    });
  }

  /* ---------- 2. INSTALL BUTTON ---------- */
  let deferredPrompt = null;
  const DISMISS_KEY = "kadugo-install-dismissed";

  function installBanner() {
    return (
      document.getElementById("install-banner-container") ||
      document.querySelector(".install-card")
    );
  }
  function showInstallBanner() {
    const el = installBanner();
    if (el) el.style.display = "";
  }
  function hideInstallBanner() {
    const el = installBanner();
    if (el) el.style.display = "none";
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!sessionStorage.getItem(DISMISS_KEY)) showInstallBanner();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideInstallBanner();
    notify(
      "Ka-dugo installed",
      "Open Ka-dugo from your home screen or desktop.",
    );
  });

  window.triggerPWAInstall = async function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    hideInstallBanner();
  };

  window.dismissInstallBanner = function (e) {
    if (e) e.preventDefault();
    sessionStorage.setItem(DISMISS_KEY, "1");
    hideInstallBanner();
  };

  /* ---------- 3. INDEXEDDB ---------- */
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        const store = db.createObjectStore(STORE, { keyPath: "client_uuid" });
        store.createIndex("status", "status");
        store.createIndex("created_at", "created_at");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const request = fn(tx.objectStore(STORE));
          let result;
          if (request)
            request.onsuccess = () => {
              result = request.result;
            };
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );
  }

  const getAllRecords = () =>
    withStore("readonly", (s) => s.getAll()).then((r) => r || []);
  const putRecord = (rec) => withStore("readwrite", (s) => s.put(rec));
  const deleteRecord = (id) => withStore("readwrite", (s) => s.delete(id));

  /* ---------- 4. SAVING A DONATION (ONLINE OR OFFLINE) ---------- */
  function makeUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function buildRecord(formData) {
    const client_uuid = formData.client_uuid || makeUuid();
    return {
      client_uuid: client_uuid,
      payload: Object.assign({}, formData, { client_uuid: client_uuid }),
      created_at: new Date().toISOString(),
      status: "Pending Sync",
      last_error: null,
    };
  }

  async function queueRecord(record) {
    await putRecord(record);
    await refreshStatus();
    notify(
      "Record saved offline",
      "Donation stored on this device. It will upload automatically when you are back online.",
    );
    return record;
  }

  function postRecord(payload) {
    return fetch(DONATIONS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  const safeJson = (res) => res.json().catch(() => ({}));

  async function submitDonation(formData) {
    const record = buildRecord(formData);

    if (!navigator.onLine) {
      await queueRecord(record);
      return { status: "queued", client_uuid: record.client_uuid };
    }

    try {
      const res = await postRecord(record.payload);
      if (res.ok) return { status: "saved", client_uuid: record.client_uuid };
      if (res.status >= 400 && res.status < 500) {
        const err = await safeJson(res);
        return {
          status: "error",
          message:
            err.message || err.error || "The server rejected this donation.",
        };
      }
      throw new Error("Server error " + res.status);
    } catch (e) {
      await queueRecord(record);
      return { status: "queued", client_uuid: record.client_uuid };
    }
  }

  /* ---------- 5. SYNC ENGINE ---------- */
  async function syncPendingDonations() {
    if (isSyncing || !navigator.onLine) return;

    const all = await getAllRecords().catch(() => []);
    const queue = all
      .filter((r) => r.status === "Pending Sync")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (queue.length === 0) return;

    isSyncing = true;
    await refreshStatus();

    let synced = 0;
    let failed = 0;

    try {
      for (const record of queue) {
        try {
          const res = await postRecord(record.payload);
          if (res.ok) {
            await deleteRecord(record.client_uuid);
            synced++;
          } else if (res.status >= 400 && res.status < 500) {
            const err = await safeJson(res);
            await putRecord(
              Object.assign({}, record, {
                status: "Failed",
                last_error: err.message || "HTTP " + res.status,
              }),
            );
            failed++;
          } else {
            break;
          }
        } catch (networkError) {
          break;
        }
      }
    } finally {
      isSyncing = false;
    }

    await refreshStatus();

    if (synced > 0) {
      notify(
        "Sync complete",
        synced +
          " offline record" +
          (synced === 1 ? "" : "s") +
          " synced to Ka-dugo servers.",
      );
      window.dispatchEvent(
        new CustomEvent("kadugo:synced", { detail: { count: synced } }),
      );
    }
    if (failed > 0) {
      notify(
        "Some records need attention",
        failed +
          " record" +
          (failed === 1 ? " was" : "s were") +
          " rejected by the server.",
      );
    }
  }

  /* ---------- 6. ONLINE / OFFLINE STATUS BANNER ---------- */
  function ensureStatusBar() {
    let bar = document.getElementById("network-status-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "network-status-bar";
      document.body.prepend(bar);
    }
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    return bar;
  }

  async function refreshStatus() {
    let pending = 0;
    let failed = 0;
    try {
      const all = await getAllRecords();
      pending = all.filter((r) => r.status === "Pending Sync").length;
      failed = all.filter((r) => r.status === "Failed").length;
    } catch (e) {
      /* IndexedDB unavailable */
    }

    const bar = ensureStatusBar();
    const label = pending === 1 ? "1 record" : pending + " records";

    if (!navigator.onLine) {
      bar.className = "status-offline";
      bar.textContent =
        pending > 0
          ? "Offline — " + label + " waiting to be sent"
          : "Offline — you can still log donations";
    } else if (isSyncing) {
      bar.className = "status-syncing";
      bar.textContent = "Online — syncing " + label + "...";
    } else if (pending > 0) {
      bar.className = "status-syncing";
      bar.textContent = "Online — " + label + " waiting to sync";
    } else {
      bar.className = "status-online";
      bar.textContent = "Online";
    }
    if (failed > 0) bar.textContent += " • " + failed + " need attention";

    const dash = document.getElementById("dashboard-sync-count");
    if (dash) dash.textContent = pending + " Records";
    document.querySelectorAll("[data-pending-count]").forEach((el) => {
      el.textContent = pending;
    });
  }

  window.addEventListener("online", () => {
    refreshStatus();
    syncPendingDonations();
  });
  window.addEventListener("offline", refreshStatus);

  /* ---------- 7. NOTIFICATIONS ---------- */
  function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }
  document.addEventListener("click", requestNotificationPermission, {
    once: true,
  });

  function notify(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted")
      return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, {
        body: body,
        icon: ICON,
        badge: ICON,
        vibrate: [100, 50, 100],
        tag: "kadugo-" + title,
        data: { url: APP_BASE + "index.html" },
      });
    });
  }

  /* ---------- 8. INIT ---------- */
  function init() {
    ensureStatusBar();
    refreshStatus();

    const installBtn = document.getElementById("pwa-install-btn");
    if (installBtn)
      installBtn.addEventListener("click", window.triggerPWAInstall);

    const dismissLink = document.querySelector(".not-now-link");
    if (dismissLink)
      dismissLink.addEventListener("click", window.dismissInstallBanner);

    if (navigator.onLine) syncPendingDonations();
    setInterval(() => {
      if (navigator.onLine) syncPendingDonations();
    }, SYNC_RETRY_MS);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();

  window.requestNotificationPermission = requestNotificationPermission;
  window.saveDonationLocally = (formData) => queueRecord(buildRecord(formData));
  window.KadugoPWA = {
    submitDonation: submitDonation,
    syncNow: syncPendingDonations,
    getPendingDonations: getAllRecords,
    notify: notify,
    refreshStatus: refreshStatus,
    makeUuid: makeUuid,
  };
})();
