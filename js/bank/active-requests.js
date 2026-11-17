// Renders the bank's open blood requests into every [data-request-list] and wires Edit / Close.
// The server scopes request.php to the signed-in bank. Also updates the sidebar's open-request count.
import { el } from '../ui/dom.js';
import { api } from '../api.js';
import { showToast } from '../ui/toast.js';
import { formatDateTime as formatDate, toLocalInput } from '../ui/format.js';

const URGENCY_LABEL = { critical: 'Critical', high: 'Urgent', normal: 'Normal' };

const lists = document.querySelectorAll('[data-request-list]');
let requests = [];

const requestApi = (method, body) => api('request.php', method === 'GET'
    ? { query: { status: 'open' } }
    : { method, body });

const URGENCY_PILL = { critical: 'is-accent', high: 'is-warn', normal: 'is-muted' };

function card(r) {
    const percent = r.units_needed ? Math.min(100, Math.round((r.units_collected / r.units_needed) * 100)) : 0;
    return el('article', { class: 'item' },
        el('div', { class: 'item-top' },
            el('div', { class: 'item-head' },
                el('span', { class: 'badge-box', text: r.blood_type_code }),
                el('div', { class: 'row-main' },
                    el('strong', { text: r.ward }),
                    el('span', { text: `${r.units_needed} unit(s) ${r.component_name}` }))),
            el('span', { class: `pill ${URGENCY_PILL[r.urgency] || ''}`, text: URGENCY_LABEL[r.urgency] || r.urgency })),
        el('div', { class: 'bar' }, el('i', { style: `width: ${percent}%` })),
        el('div', { class: 'bar-labels' },
            el('span', { text: `${r.units_collected} fulfilled • ${r.units_remaining} remaining` }),
            el('span', { text: `Due ${formatDate(r.needed_by)}` })),
        el('div', { class: 'item-actions' },
            el('button', { type: 'button', class: 'btn btn-soft btn-sm', text: 'Edit', onclick: () => openEdit(r) }),
            el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Close request', onclick: () => closeRequest(r) })));
}

function render() {
    lists.forEach((list) => {
        const limit = Number(list.dataset.limit) || Infinity;
        list.replaceChildren(...(requests.length
            ? requests.slice(0, limit).map(card)
            : [el('p', { class: 'empty', text: 'No open blood requests.' })]));
    });
    const count = document.getElementById('view-all-count');
    if (count) count.textContent = `View all (${requests.length})`;
    const navCount = document.getElementById('nav-open-requests');
    if (navCount) navCount.textContent = requests.length || '';
}

async function load() {
    try {
        requests = (await requestApi('GET')).requests;
        render();
    } catch (err) {
        lists.forEach((list) => list.replaceChildren(el('p', { class: 'empty', text: err.message })));
    }
}

async function closeRequest(r) {
    if (!confirm(`Close the ${r.blood_type_code} request for ${r.ward}? Donors will stop receiving its alerts.`)) return;
    try {
        await requestApi('DELETE', { request_id: r.request_id });
        showToast('Request closed.');
        load();
    } catch (err) {
        showToast(err.message, true);
    }
}

// One shared edit dialog, built once.
const field = (label, input) => el('label', { class: 'field' }, el('span', { text: label }), input);
const wardInput = el('input', { type: 'text', name: 'ward', required: '', maxlength: '100' });
const unitsInput = el('input', { type: 'number', name: 'units_needed', required: '', min: '1', max: '500' });
const urgencyInput = el('select', { name: 'urgency' },
    ...Object.entries(URGENCY_LABEL).reverse().map(([value, text]) => el('option', { value, text })));
const neededInput = el('input', { type: 'datetime-local', name: 'needed_by', required: '' });
const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Save changes' });
let editing = null;

const form = el('form', { method: 'dialog' },
    el('h2', { text: 'Edit request' }),
    field('Ward / unit', wardInput),
    field('Units needed', unitsInput),
    field('Urgency', urgencyInput),
    field('Needed by', neededInput),
    el('div', { class: 'modal-actions' },
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel', onclick: () => dialog.close() }),
        saveBtn));
const dialog = el('dialog', { class: 'modal', 'aria-label': 'Edit blood request' }, form);
document.body.append(dialog);

function openEdit(r) {
    editing = r;
    wardInput.value = r.ward;
    unitsInput.value = r.units_needed;
    urgencyInput.value = r.urgency;
    neededInput.value = toLocalInput(r.needed_by);
    dialog.showModal();
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
        await requestApi('PUT', {
            request_id: editing.request_id,
            ward: wardInput.value.trim(),
            units_needed: Number(unitsInput.value),
            urgency: urgencyInput.value,
            needed_by: neededInput.value,
        });
        dialog.close();
        showToast('Request updated.');
        load();
    } catch (err) {
        showToast(err.message, true);
    } finally {
        saveBtn.disabled = false;
    }
});

window.addEventListener('kadugo:requests-changed', load); // a new request was dispatched on requests.html
load();
