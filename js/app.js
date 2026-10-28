import { syncPendingDonations } from './sync.js';
import { getAllRecords } from './db.js';
import { showNotification } from './notify.js';
const APP_BASE = new URL('../', import.meta.url).pathname;
const ICON = APP_BASE + "assets/icons/crimson/192-crimson_icon.png";
const SYNC_RETRY_MS = 30000;

/* ==========================================================================
   1. SERVICE WORKER REGISTRATION
   ========================================================================== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(APP_BASE + "sw.js")
      .then((reg) => console.log("[PWA] SW registered, scope:", reg.scope))
      .catch((err) => console.error("[PWA] SW registration failed:", err));
  });
}

/* ==========================================================================
   2. PWA INSTALL PROMPT & CUSTOM BANNER
   ========================================================================== */
let deferredPrompt = null;
const DISMISS_KEY = "kadugo-install-dismissed";

const installCard = document.querySelector('.install-card');
const installBtn = document.getElementById('pwa-install-btn');
const notNowBtn = document.querySelector('.not-now-link');

if (installCard) installCard.style.display = 'none';

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;

  if (!sessionStorage.getItem(DISMISS_KEY)) {
    if (installCard) installCard.style.display = 'block';
  }
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    deferredPrompt = null;
    if (installCard) installCard.style.display = 'none';
  });
}

if (notNowBtn) {
  notNowBtn.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.setItem(DISMISS_KEY, "1");
    if (installCard) installCard.style.display = 'none';
  });
}

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  if (installCard) installCard.style.display = 'none';
  showNotification("Ka-dugo installed", "Open Ka-dugo from your home screen or desktop.", ICON);
});

/* ==========================================================================
   3. NETWORK STATUS BANNER & UI SYNC STATE
   ========================================================================== */
function createStatusBar() {
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

async function refreshStatus(isSyncing = false) {
  let pending = 0;
  let failed = 0;
  try {
    const all = await getAllRecords();
    pending = all.filter((r) => r.status === "Pending Sync").length;
    failed = all.filter((r) => r.status === "Failed").length;
  } catch (e) { }

  const bar = createStatusBar();
  const label = pending === 1 ? "1 record" : pending + " records";

  if (!navigator.onLine) {
    bar.className = "status-offline";
    bar.textContent = pending > 0
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
  if (dash) dash.textContent = pending + (pending === 1 ? " Record" : " Records");
}

/* ==========================================================================
   4. EVENT LISTENERS & BOOTSTRAP INIT
   ========================================================================== */
window.addEventListener("online", () => {
  refreshStatus();
  syncPendingDonations();
});
window.addEventListener("offline", () => refreshStatus(false));

// Custom sync events fired by sync.js
window.addEventListener("kadugo:sync-started", () => refreshStatus(true));
window.addEventListener("kadugo:sync-ended", () => refreshStatus(false));

// Main bootloader
function init() {
  createStatusBar();
  refreshStatus();
  if (navigator.onLine) syncPendingDonations();
  setInterval(() => {
    if (navigator.onLine) syncPendingDonations();
  }, SYNC_RETRY_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
function refreshTimeGreetings() {
 document.querySelectorAll('[data-time-greeting]').forEach(el=>{const h=new Date().getHours();el.textContent=h<12?'Good morning':h<18?'Good afternoon':'Good evening';});
}
function initializeGreeting() {
 if(!document.querySelector('.welcome-heading, .header-greeting')) {const heading=document.querySelector('.topbar .brand-copy, .topbar > div');if(heading&&!heading.querySelector('[data-time-greeting]')){const el=document.createElement('small');el.dataset.timeGreeting='';el.className='time-greeting';heading.append(el);}}
 refreshTimeGreetings();setInterval(refreshTimeGreetings,30000);document.addEventListener('visibilitychange',refreshTimeGreetings);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initializeGreeting);else initializeGreeting();

// Organizer headings use the signed-in profile instead of a sample organization.
if(location.pathname.includes('/pages/organizer/')) {
 fetch(new URL('api/profile.php',location.origin+APP_BASE),{credentials:'same-origin',cache:'no-store'})
 .then(r=>r.json()).then(result=>{if(result.ok){const heading=document.querySelector('.topbar p');if(heading)heading.textContent=result.data.org_name;}}).catch(()=>{});
}
