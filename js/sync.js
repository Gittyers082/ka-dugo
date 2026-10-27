import { getAllRecords, putRecord, deleteRecord } from './db.js';
import { showNotification } from './notify.js';

// App root from this file's location (js/..), so it works whatever the project folder is called.
const getBaseUrl = () => new URL('../', import.meta.url).pathname;

const DONATIONS_API = getBaseUrl() + "api/donations.php";
export let isSyncing = false;

const safeJson = (res) => res.json().catch(() => ({}));

function postRecord(payload) {
    return fetch(DONATIONS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function syncPendingDonations() {
    if (isSyncing || !navigator.onLine) return;

    try {
        const all = await getAllRecords();
        const queue = all
            .filter((r) => r.status === "Pending Sync")
            .sort((a, b) => a.created_at.localeCompare(b.created_at));

        if (queue.length === 0) return;

        isSyncing = true;
        window.dispatchEvent(new Event("kadugo:sync-started"));

        let synced = 0;
        let failed = 0;

        for (const record of queue) {
            try {
                const res = await postRecord(record.payload);

                if (res.ok) {
                    await deleteRecord(record.client_uuid);
                    synced++;
                } else if (res.status === 401) {
                    // Signed out: keep the record pending and retry after the next login.
                    break;
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

        const iconPath = getBaseUrl() + "assets/icons/crimson/192-crimson_icon.png";

        if (synced > 0) {
            showNotification(
                "Sync complete",
                synced + " offline record" + (synced === 1 ? "" : "s") + " synced to Ka-dugo servers.",
                iconPath
            );
            window.dispatchEvent(new CustomEvent("kadugo:synced", { detail: { count: synced } }));
        }

        if (failed > 0) {
            showNotification(
                "Some records need attention",
                failed + " record" + (failed === 1 ? " was" : "s were") + " rejected by the server.",
                iconPath
            );
        }

    } catch (error) {
        console.error("[Sync Engine] Error accessing IndexedDB", error);
    } finally {
        isSyncing = false;
        window.dispatchEvent(new Event("kadugo:sync-ended"));
    }
}