export const DB_NAME = "KadugoOfflineDB";
export const DB_VERSION = 2;
export const STORE = "pending_donations";

let dbPromise = null;
export function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (db.objectStoreNames.contains(STORE)) {
                db.deleteObjectStore(STORE);
            }
            const store = db.createObjectStore(STORE, { keyPath: "client_uuid" });
            store.createIndex("status", "status");
            store.createIndex("created_at", "created_at");
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    return dbPromise;
}

export function withStore(mode, fn) {
    return openDB().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, mode);
                const request = fn(tx.objectStore(STORE));
                let result;

                if (request) {
                    request.onsuccess = () => {
                        result = request.result;
                    };
                }

                tx.oncomplete = () => resolve(result);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            }),
    );
}

// Exported CRUD operations for the offline queue
export const getAllRecords = () => withStore("readonly", (s) => s.getAll()).then((r) => r || []);
export const putRecord = (rec) => withStore("readwrite", (s) => s.put(rec));
export const deleteRecord = (id) => withStore("readwrite", (s) => s.delete(id));