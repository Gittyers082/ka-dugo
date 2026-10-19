let deferredPrompt;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW Registered:', reg.scope))
      .catch(err => console.error('SW Registration Failed:', err));
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const installContainer = document.getElementById('install-banner-container');
  if (installContainer) {
    installContainer.style.display = 'block';
  }
});

window.triggerPWAInstall = function() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then((choiceResult) => {
    deferredPrompt = null;
    dismissInstallBanner();
  });
}

window.dismissInstallBanner = function() {
  const installContainer = document.getElementById('install-banner-container');
  if (installContainer) installContainer.style.display = 'none';
}

let db;
const dbRequest = indexedDB.open('KadugoOfflineDB', 1);

dbRequest.onupgradeneeded = (event) => {
  db = event.target.result;
  if (!db.objectStoreNames.contains('pending_donations')) {
    db.createObjectStore('pending_donations', { keyPath: 'id', autoIncrement: true });
  }
};

dbRequest.onsuccess = (event) => {
  db = event.target.result;
  refreshUI();
  if (navigator.onLine) syncPendingDonations();
};

window.saveDonationLocally = function(formData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending_donations'], 'readwrite');
    const store = tx.objectStore('pending_donations');

    const record = {
      payload: formData,
      timestamp: new Date().toISOString(),
      status: 'Pending Sync'
    };

    const addReq = store.add(record);
    addReq.onsuccess = () => {
      refreshUI();
      triggerPushNotification('Record Saved Offline', 'Donation logged locally. Will sync when back online.');
      resolve(true);
    };
    addReq.onerror = () => reject(addReq.error);
  });
}

async function syncPendingDonations() {
  if (!navigator.onLine || !db) return;

  const tx = db.transaction(['pending_donations'], 'readonly');
  const store = tx.objectStore('pending_donations');
  const getAllReq = store.getAll();

  getAllReq.onsuccess = async () => {
    const records = getAllReq.result;
    if (records.length === 0) return;

    let syncedCount = 0;

    for (const record of records) {
      try {
        const response = await fetch('/api/donations.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record.payload)
        });

        if (response.ok) {
          const delTx = db.transaction(['pending_donations'], 'readwrite');
          delTx.objectStore('pending_donations').delete(record.id);
          syncedCount++;
        }
      } catch (err) {
        console.error('Failed to sync record ID:', record.id, err);
      }
    }

    if (syncedCount > 0) {
      refreshUI();
      triggerPushNotification('Sync Complete', `${syncedCount} offline records synced to Ka-dugo servers.`);
    }
  };
}

function refreshUI() {
  if (!db) return;

  const tx = db.transaction(['pending_donations'], 'readonly');
  const store = tx.objectStore('pending_donations');
  const countReq = store.count();

  countReq.onsuccess = () => {
    const count = countReq.result;

    const syncCountEl = document.getElementById('dashboard-sync-count');
    if (syncCountEl) {
      syncCountEl.textContent = `${count} Records`;
    }
  };
}

window.addEventListener('online', () => {
  refreshUI();
  syncPendingDonations();
});

window.addEventListener('offline', () => {
  refreshUI();
});

window.requestNotificationPermission = function() {
  if ('Notification' in window) {
    Notification.requestPermission();
  }
}

function triggerPushNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, {
        body: body,
        icon: '/assets/icon-192.png',
        vibrate: [100, 50, 100]
      });
    });
  }
}

document.addEventListener('click', () => {
  requestNotificationPermission();
}, { once: true });