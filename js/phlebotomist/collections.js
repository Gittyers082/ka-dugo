// Phlebotomist "Today": what this phlebotomist saved on the server for a day, plus records still
// waiting in this device's offline queue (IndexedDB). Failed records can be retried or discarded.
import { getAllRecords, putRecord, deleteRecord } from '../db.js';
import { syncPendingDonations } from '../sync.js';
import { api } from '../api.js';
import { el, $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDateTime, todayLocal } from '../ui/format.js';

const COMPONENTS = { 1: 'Whole Blood', 2: 'Packed Red Blood Cells', 3: 'Platelets', 4: 'Fresh Frozen Plasma' };
const dayInput = $('#day');

function emptyNote(text) {
    return el('li', { class: 'empty', text });
}

function queueItem(record) {
    const failed = record.status === 'Failed';
    const { payload } = record;
    return el('li', { class: 'row' },
        el('div', { class: 'row-main' },
            el('strong', { text: record.label || payload.qr_code || `Donor #${payload.donor_id}` }),
            el('span', { text: `${payload.units} unit(s) ${COMPONENTS[payload.component_id] || ''} • ${formatDateTime(payload.collected_at)}` }),
            failed ? el('span', { class: 'note is-bad', text: record.last_error }) : null),
        el('div', { class: 'row-actions' },
            el('span', { class: `pill ${failed ? 'is-soft' : 'is-warn'}`, text: failed ? 'Needs attention' : 'Waiting' }),
            failed ? el('button', { type: 'button', class: 'btn btn-soft btn-sm', text: 'Retry', onclick: () => retry(record) }) : null,
            failed ? el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Discard', onclick: () => discard(record) }) : null));
}

function savedItem(donation) {
    return el('li', { class: 'row' },
        el('span', { class: 'badge-box is-soft', text: donation.blood_type_code }),
        el('div', { class: 'row-main' },
            el('strong', { text: donation.full_name }),
            el('span', { text: `${Number(donation.units)} unit(s) ${donation.component_name} • ${formatDateTime(donation.collected_at)}` }),
            el('span', { text: donation.drive_title || 'Walk-in' })),
        el('span', { class: 'pill is-ok', text: 'Saved' }));
}

async function renderQueue() {
    const records = (await getAllRecords()).sort((a, b) => b.created_at.localeCompare(a.created_at));
    $('#queue-list').replaceChildren(...(records.length
        ? records.map(queueItem)
        : [emptyNote('Nothing waiting. Every record on this device has been sent.')]));
}

async function renderSaved() {
    try {
        const data = await api('donations.php', { query: { date: dayInput.value } });
        $('#cache-note').hidden = !data.fromCache;
        setText('#sum-saved', data.count);
        setText('#sum-units', data.donations.reduce((sum, d) => sum + Number(d.units), 0));
        $('#saved-list').replaceChildren(...(data.count
            ? data.donations.map(savedItem)
            : [emptyNote('No donations saved for this day yet.')]));
    } catch (error) {
        $('#saved-list').replaceChildren(emptyNote(error.message));
    }
}

async function retry(record) {
    await putRecord({ ...record, status: 'Pending Sync', last_error: undefined });
    await syncPendingDonations();
}

async function discard(record) {
    if (!confirm('Discard this record from the device? It was rejected by the server and will not be sent.')) return;
    await deleteRecord(record.client_uuid);
    window.dispatchEvent(new Event('kadugo:queued'));
    renderQueue();
}

$('#sync-now').addEventListener('click', async () => {
    if (!navigator.onLine) return showToast('You are offline. Records sync when the connection returns.', true);
    await syncPendingDonations();
});
dayInput.addEventListener('change', renderSaved);
window.addEventListener('kadugo:sync-ended', () => { renderQueue(); renderSaved(); });
window.addEventListener('kadugo:queued', renderQueue);

dayInput.value = todayLocal();
renderQueue();
renderSaved();
