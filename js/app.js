// Loaded on EVERY page (<script type="module" src=".../js/app.js">):
// service worker, online/offline bar with pending count, offline sync, install prompt, logout, nav identity.
import { syncPendingDonations } from './sync.js';
import { getAllRecords } from './db.js';
import { showNotification } from './notify.js';
import { APP_ROOT } from './api.js';

const ICON = new URL('assets/icons/crimson/192-crimson_icon.png', APP_ROOT).href;
const SYNC_RETRY_MS = 30000;

/* ==========================================================================
   1. SERVICE WORKER REGISTRATION
   ========================================================================== */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(new URL('sw.js', APP_ROOT))
            .catch((err) => console.error('[PWA] SW registration failed:', err));
    });
}

/* ==========================================================================
   2. PWA INSTALL PROMPT (install card on the sign-in page)
   ========================================================================== */
const DISMISS_KEY = 'kadugo-install-dismissed';
const installCard = document.querySelector('.install-card');
let deferredPrompt = null;

if (installCard) installCard.hidden = true;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installCard && !sessionStorage.getItem(DISMISS_KEY)) installCard.hidden = false;
});

document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (installCard) installCard.hidden = true;
});

document.querySelector('.not-now-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.setItem(DISMISS_KEY, '1');
    if (installCard) installCard.hidden = true;
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installCard) installCard.hidden = true;
    showNotification('Ka-dugo installed', 'Open Ka-dugo from your home screen or desktop.', ICON);
});

/* ==========================================================================
   3. ONLINE / OFFLINE STATUS BAR (shows records waiting to be sent)
   ========================================================================== */
function statusBar() {
    let bar = document.getElementById('network-status-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'network-status-bar';
        bar.setAttribute('role', 'status');
        bar.setAttribute('aria-live', 'polite');
        document.body.prepend(bar);
    }
    return bar;
}

async function refreshStatus(isSyncing = false) {
    let pending = 0;
    let failed = 0;
    try {
        const records = await getAllRecords();
        pending = records.filter((r) => r.status === 'Pending Sync').length;
        failed = records.filter((r) => r.status === 'Failed').length;
    } catch {
        // IndexedDB unavailable (private mode): show the network state only.
    }

    const bar = statusBar();
    const label = pending === 1 ? '1 record' : `${pending} records`;

    if (!navigator.onLine) {
        bar.className = 'status-offline';
        bar.textContent = pending > 0 ? `Offline — ${label} waiting to be sent` : 'Offline — showing saved data';
    } else if (isSyncing || pending > 0) {
        bar.className = 'status-syncing';
        bar.textContent = isSyncing ? `Online — syncing ${label}…` : `Online — ${label} waiting to sync`;
    } else {
        bar.className = 'status-online';
        bar.textContent = 'Online';
    }
    if (failed > 0) bar.textContent += ` • ${failed} need attention`;

    document.querySelectorAll('[data-pending-count]').forEach((node) => {
        node.textContent = pending;
    });
}

window.addEventListener('online', () => {
    refreshStatus();
    syncPendingDonations();
});
window.addEventListener('offline', () => refreshStatus());
window.addEventListener('kadugo:queued', () => refreshStatus());
window.addEventListener('kadugo:sync-started', () => refreshStatus(true));
window.addEventListener('kadugo:sync-ended', () => refreshStatus());

/* ==========================================================================
   4. LOGOUT (any element with .logout-link or #logout-btn)
   ========================================================================== */
document.querySelectorAll('#logout-btn, .logout-link').forEach((link) => {
    link.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await fetch(new URL('api/logout.php', APP_ROOT), { method: 'POST', credentials: 'same-origin' });
        } catch {
            // Offline: the server session expires on its own.
        }
        sessionStorage.clear();
        // Cached API answers belong to this account; drop them so the next user never sees them offline.
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => key.startsWith('kadugo-dynamic-')).map((key) => caches.delete(key)));
        }
        location.href = new URL('index.html', APP_ROOT).href;
    });
});

/* ==========================================================================
   5. NAV IDENTITY (sidebar brand + organization name from the signed-in account)
   ========================================================================== */
const ROLE_LABEL = { bank: 'BANK', phlebotomist: 'PHLEBOTOMIST', organizer: 'ORGANIZER', donor: 'DONOR', admin: 'ADMIN' };
const IDENTITY_KEY = 'kadugo-identity';

function applyIdentity({ role, org_name, full_name }) {
    const name = org_name || full_name || '';
    const navBrand = document.getElementById('nav-brand');
    if (navBrand) navBrand.textContent = `KA-DUGO\n${ROLE_LABEL[role] || ''}`;
    const navOrg = document.getElementById('nav-org');
    if (navOrg) navOrg.textContent = name;
    // Sidebar account card: initials of the first two words, e.g. "Trece Martires ..." -> "TM".
    const initials = document.getElementById('nav-initials');
    if (initials) initials.textContent = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function loadIdentity() {
    if (!document.getElementById('nav-brand') && !document.getElementById('nav-org')) return;

    const cached = sessionStorage.getItem(IDENTITY_KEY);
    if (cached) applyIdentity(JSON.parse(cached));
    if (!navigator.onLine) return;

    fetch(new URL('api/profile.php', APP_ROOT), { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => r.json())
        .then((result) => {
            if (!result.ok) return;
            applyIdentity(result.data);
            sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(result.data));
        })
        .catch(() => {});
}

/* ==========================================================================
   6. TIME-OF-DAY GREETING under the topbar title
   ========================================================================== */
function refreshGreetings() {
    const hour = new Date().getHours();
    const text = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    document.querySelectorAll('[data-time-greeting]').forEach((node) => { node.textContent = text; });
}

function initGreeting() {
    const copy = document.querySelector('.topbar .brand-copy');
    if (copy && !copy.querySelector('[data-time-greeting]')) {
        const small = document.createElement('small');
        small.className = 'time-greeting';
        small.dataset.timeGreeting = '';
        copy.append(small);
    }
    refreshGreetings();
    setInterval(refreshGreetings, 60000);
}

/* ==========================================================================
   7. BOOT
   ========================================================================== */
function init() {
    refreshStatus();
    loadIdentity();
    initGreeting();
    if (navigator.onLine) syncPendingDonations();
    setInterval(() => { if (navigator.onLine) syncPendingDonations(); }, SYNC_RETRY_MS);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
