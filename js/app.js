/* ==========================================================================
   KA-DUGO PWA ENGINE  (js/app.js)
   Include on EVERY page:  <script src="js/app.js"></script>
   (pages inside a subfolder use  ../js/app.js )
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 0. CONFIG ---------- */
  // This file lives in <app>/js/, so "../" is always the app root, whatever page loaded it.
  const APP_BASE = new URL('../', document.currentScript.src).href;
  const DONATIONS_API = APP_BASE + 'api/donations.php';   // change if Steven uses another path
  const ICON = APP_BASE + 'assets/icon-192.png';

  const DB_NAME = 'KadugoOfflineDB';
  const DB_VERSION = 2;
  const STORE = 'pending_donations';
  const SYNC_RETRY_MS = 30000;

  let isSyncing = false;

  /* ---------- 1. SERVICE WORKER (registered on every page) ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(APP_BASE + 'sw.js')
        .then((reg) => console.log('[PWA] SW registered, scope:', reg.scope))
        .catch((err) => console.error('[PWA] SW registration failed:', err));
    });
  }

  /* ---------- 2. INSTALL BUTTON ---------- */
  let deferredPrompt = null;
  const DISMISS_KEY = 'kadugo-install-dismissed';

  function installBanner() { return document.getElementById('install-banner-container'); }
  function showInstallBanner() { const el = installBanner(); if (el) el.style.display = 'block'; }
  function hideInstallBanner() { const el = installBanner(); if (el) el.style.display = 'none'; }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!sessionStorage.getItem(DISMISS_KEY)) showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBanner();
    notify('Ka-dugo installed', 'Open Ka-dugo from your home screen or desktop.');
  });

  window.triggerPWAInstall = async function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    hideInstallBanner();
  };

  window.dismissInstallBanner = function () {
    sessionStorage.setItem(DISMISS_KEY, '1');
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
        // v1 used an auto-increment id; v2 uses the client UUID as the key (prevents local duplicates)
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        const store = db.createObjectStore(STORE, { keyPath: 'client_uuid' });
        store.createIndex('status', 'status');
        store.createIndex('created_at', 'created_at');
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      let result;
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  const getAllRecords = () => withStore('readonly', (s) => s.getAll()).then((r) => r || []);
  const putRecord = (rec) => withStore('readwrite', (s) => s.put(rec));
  const deleteRecord = (id) => withStore('readwrite', (s) => s.delete(id));

  /* ---------- 4. SAVING A DONATION (online or offline) ---------- */
  function makeUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Every donation gets ONE permanent id the moment it is created.
  // The server stores it in a UNIQUE column, so re-sending the same record can never create a duplicate row.
  function buildRecord(formData) {
    const client_uuid = makeUuid();
    return {
      client_uuid: client_uuid,
      payload: Object.assign({}, formData, { client_uuid: client_uuid }),
      created_at: new Date().toISOString(),
      status: 'Pending Sync',
      last_error: null
    };
  }

  async function queueRecord(record) {
    await putRecord(record);
    await refreshStatus();
    notify('Record saved offline', 'Donation stored on this device. It will upload automatically when you are back online.');
    return record;
  }

  function postRecord(payload) {
    return fetch(DONATIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  const safeJson = (res) => res.json().catch(() => ({}));

  /**
   * Use this from ANY form that saves a donation.
   * Returns { status: 'saved' | 'queued' | 'error', message? }
   */
  async function submitDonation(formData) {
    const record = buildRecord(formData);

    if (!navigator.onLine) {
      await queueRecord(record);
      return { status: 'queued' };
    }

    try {
      const res = await postRecord(record.payload);
      if (res.ok) return { status: 'saved' };

      if (res.status >= 400 && res.status < 500) {            // validation error: do NOT queue bad data
        const err = await safeJson(res);
        return { status: 'error', message: err.message || err.error || 'The server rejected this donation.' };
      }
      throw new Error('Server error ' + res.status);          // 5xx: treat like no connection
    } catch (e) {
      await queueRecord(record);                              // network dropped / server down
      return { status: 'queued' };
    }
  }

  /* ---------- 5. SYNC ENGINE ---------- */
  async function syncPendingDonations() {
    if (isSyncing || !navigator.onLine) return;               // lock = no two syncs at once = no double sends

    const all = await getAllRecords().catch(() => []);
    const queue = all
      .filter((r) => r.status === 'Pending Sync')
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

          if (res.ok) {                                       // 200/201 (server also returns 200 for a duplicate uuid)
            await deleteRecord(record.client_uuid);
            synced++;
          } else if (res.status >= 400 && res.status < 500) { // server refused this record: park it, keep going
            const err = await safeJson(res);
            await putRecord(Object.assign({}, record, {
              status: 'Failed',
              last_error: err.message || 'HTTP ' + res.status
            }));
            failed++;
          } else {
            break;                                            // 5xx: stop, retry later
          }
        } catch (networkError) {
          break;                                              // connection dropped: stop, retry later
        }
      }
    } finally {
      isSyncing = false;
    }

    await refreshStatus();

    if (synced > 0) {
      notify('Sync complete', synced + ' offline record' + (synced === 1 ? '' : 's') + ' synced to Ka-dugo servers.');
      window.dispatchEvent(new CustomEvent('kadugo:synced', { detail: { count: synced } }));
    }
    if (failed > 0) {
      notify('Some records need attention', failed + ' record' + (failed === 1 ? ' was' : 's were') + ' rejected by the server.');
    }
  }

  /* ---------- 6. ONLINE / OFFLINE STATUS BANNER ---------- */
  function ensureStatusBar() {
    let bar = document.getElementById('network-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'network-status-bar';
      document.body.prepend(bar);
    }
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    return bar;
  }

  async function refreshStatus() {
    let pending = 0;
    let failed = 0;
    try {
      const all = await getAllRecords();
      pending = all.filter((r) => r.status === 'Pending Sync').length;
      failed = all.filter((r) => r.status === 'Failed').length;
    } catch (e) { /* IndexedDB unavailable */ }

    const bar = ensureStatusBar();
    const label = pending === 1 ? '1 record' : pending + ' records';

    if (!navigator.onLine) {
      bar.className = 'status-offline';
      bar.textContent = pending > 0
        ? 'Offline — ' + label + ' waiting to be sent'
        : 'Offline — you can still log donations';
    } else if (isSyncing) {
      bar.className = 'status-syncing';
      bar.textContent = 'Online — syncing ' + label + '…';
    } else if (pending > 0) {
      bar.className = 'status-syncing';
      bar.textContent = 'Online — ' + label + ' waiting to sync';
    } else {
      bar.className = 'status-online';
      bar.textContent = 'Online';
    }
    if (failed > 0) bar.textContent += ' · ' + failed + ' need attention';

    const dash = document.getElementById('dashboard-sync-count');
    if (dash) dash.textContent = pending + ' Records';
    document.querySelectorAll('[data-pending-count]').forEach((el) => { el.textContent = pending; });
  }

  window.addEventListener('online', () => { refreshStatus(); syncPendingDonations(); });
  window.addEventListener('offline', refreshStatus);

  /* ---------- 7. NOTIFICATIONS (shown through the service worker) ---------- */
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
  document.addEventListener('click', requestNotificationPermission, { once: true });

  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, {
        body: body,
        icon: ICON,
        badge: ICON,
        vibrate: [100, 50, 100],
        tag: 'kadugo-' + title,
        data: { url: APP_BASE + 'index.html' }
      });
    });
  }

  /* ---------- 8. START ---------- */
  function init() {
    ensureStatusBar();
    refreshStatus();
    if (navigator.onLine) syncPendingDonations();
    setInterval(() => { if (navigator.onLine) syncPendingDonations(); }, SYNC_RETRY_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ---------- 9. WHAT OTHER PAGES CAN USE ---------- */
  window.requestNotificationPermission = requestNotificationPermission;
  window.saveDonationLocally = (formData) => queueRecord(buildRecord(formData));   // kept for old code
  window.KadugoPWA = {
    submitDonation: submitDonation,          // save a donation (handles online/offline)
    syncNow: syncPendingDonations,
    getPendingDonations: getAllRecords,      // for showing "Pending Sync" rows in the log
    notify: notify,                          // Denver can reuse this for urgent alerts
    refreshStatus: refreshStatus
  };
})();