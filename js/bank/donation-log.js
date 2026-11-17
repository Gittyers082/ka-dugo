// Bank donation log: Read (server-side search / filter / sort), Update (units + status) and Delete
// of the donations collected by this bank's phlebotomists. Creating donations is the phlebotomist's job.
import { api } from '../api.js';
import { el, $ } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDateTime } from '../ui/format.js';
import { loadTodayQuota } from './quota.js';

const BLOOD_TYPES = { 'O-': 8, 'O+': 7, 'A-': 2, 'A+': 1, 'B-': 4, 'B+': 3, 'AB-': 6, 'AB+': 5 };

const state = { bloodType: '', donations: [], editing: null, deleting: null };
const filters = $('#filters');

/* ---------- filters ---------- */

function renderChips() {
    const chips = [['', 'All types'], ...Object.keys(BLOOD_TYPES).map((code) => [code, code])];
    $('#type-chips').replaceChildren(...chips.map(([code, label]) => el('button', {
        type: 'button',
        'aria-pressed': String(state.bloodType === code),
        text: label,
        onclick: () => { state.bloodType = code; renderChips(); load(); },
    })));
}

function currentQuery() {
    const form = new FormData(filters);
    const [sort, dir] = String(form.get('sort')).split(':');
    return {
        search: form.get('search').trim(),
        status: form.get('status'),
        blood_type_id: BLOOD_TYPES[state.bloodType] || '',
        sort,
        dir,
    };
}

/* ---------- list ---------- */

const STATUS_PILL = { collected: 'is-warn', tested: 'is-info', processed: 'is-soft', transfused: 'is-ok', discarded: 'is-muted' };

function card(d) {
    return el('article', { class: 'item' },
        el('div', { class: 'item-top' },
            el('div', { class: 'item-head' },
                el('span', { class: 'badge-box', text: d.blood_type_code }),
                el('div', { class: 'row-main' },
                    el('strong', { text: d.full_name }),
                    el('span', { text: `${Number(d.units)} unit(s) ${d.component_name} • ${Number(d.units) * 450} mL` }))),
            el('span', { class: `pill ${STATUS_PILL[d.status] || ''}`, text: d.status })),
        el('div', { class: 'meta' },
            el('span', { class: 'pill is-muted no-dot', text: formatDateTime(d.collected_at) }),
            el('span', { class: 'pill is-muted no-dot', text: d.phlebotomist_name || 'Bank staff' }),
            el('span', { class: 'pill is-muted no-dot', text: d.drive_title || 'Walk-in' })),
        el('p', { text: `Record ${d.client_uuid}` }),
        el('div', { class: 'item-actions' },
            el('button', { type: 'button', class: 'btn btn-soft btn-sm', text: 'Update', onclick: () => openEdit(d) }),
            el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Delete', onclick: () => openDelete(d) })));
}

async function load() {
    try {
        const data = await api('donations.php', { query: currentQuery() });
        state.donations = data.donations;
        $('#dl-count').textContent = data.count;
        $('#dl-cache').hidden = !data.fromCache;
        $('#dl-cards').replaceChildren(...data.donations.map(card));
        $('#dl-empty').hidden = data.count > 0;
    } catch (error) {
        showToast(error.message, true);
    }
}

async function loadQuota() {
    try {
        const quota = await loadTodayQuota();
        $('#quota-text').textContent = `${quota.total}/${quota.goal}`;
        $('#quota-remaining').textContent = quota.remaining ? `${quota.remaining} units to today's goal` : "Today's goal is met";
    } catch {
        // The quota card is informational; the log still works without it.
    }
}

/* ---------- update ---------- */

function openEdit(donation) {
    state.editing = donation;
    $('#edit-donor').textContent = `${donation.full_name} • ${donation.component_name}`;
    $('#edit-units').value = Number(donation.units);
    $('#edit-status').value = donation.status;
    $('#edit-dialog').showModal();
}

async function saveEdit(event) {
    event.preventDefault();
    try {
        await api('donations.php', {
            method: 'PUT',
            body: { donation_id: state.editing.donation_id, units: $('#edit-units').value, status: $('#edit-status').value },
        });
        $('#edit-dialog').close();
        showToast('Donation updated.');
        load();
        loadQuota();
    } catch (error) {
        showToast(error.message, true);
    }
}

/* ---------- delete ---------- */

function openDelete(donation) {
    state.deleting = donation;
    $('#delete-donor').textContent = `${donation.full_name} — ${Number(donation.units)} unit(s) ${donation.component_name}, ${formatDateTime(donation.collected_at)}`;
    $('#delete-dialog').showModal();
}

async function confirmDelete() {
    try {
        await api('donations.php', { method: 'DELETE', body: { donation_id: state.deleting.donation_id } });
        $('#delete-dialog').close();
        showToast('Donation deleted.');
        load();
        loadQuota();
    } catch (error) {
        showToast(error.message, true);
    }
}

/* ---------- wiring ---------- */

let searchTimer;
filters.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, event.target.name === 'search' ? 300 : 0);
});
filters.addEventListener('submit', (event) => { event.preventDefault(); load(); });
$('#edit-form').addEventListener('submit', saveEdit);
$('#confirm-delete').addEventListener('click', confirmDelete);
document.querySelectorAll('dialog [data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));
window.addEventListener('kadugo:sync-ended', load);

renderChips();
load();
loadQuota();
