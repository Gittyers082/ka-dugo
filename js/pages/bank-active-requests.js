import { el } from '../ui/dom.js';

// Renders the bank's open blood requests into every [data-request-list] and wires Edit / Close.
// The server scopes request.php to the signed-in bank.
const API = new URL('../../api/request.php', import.meta.url);
const URGENCY_LABEL = { critical: 'Critical', high: 'Urgent', normal: 'Normal' };
const URGENCY_CLASS = { critical: 'bg-urgent-light text-urgent', high: 'bg-warning-light text-warning', normal: 'bg-bone text-muted' };

const lists = document.querySelectorAll('[data-request-list]');
let requests = [];

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function api(method, body) {
    const res = await fetch(method === 'GET' ? `${API}?status=open` : API, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || `Request failed (${res.status}).`);
    return json.data;
}

const toLocalInput = (sqlDate) => String(sqlDate || '').replace(' ', 'T').slice(0, 16);
const formatDate = (sqlDate) => new Date(String(sqlDate).replace(' ', 'T'))
    .toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function card(r) {
    const pct = r.units_needed ? Math.min(100, Math.round((r.units_collected / r.units_needed) * 100)) : 0;
    return el('article', { class: 'card border-line bg-surface active-request-card' },
        el('div', { class: 'flex-between items-start mb-2' },
            el('div', { class: 'flex-row gap-3' },
                el('div', { class: 'mini-blood-box bg-maroon-light text-maroon font-bold t-title font-heading', text: r.blood_type_code }),
                el('div', {},
                    el('h4', { class: 't-heading text-oxblood font-heading m-0', text: `${r.blood_type_code} ${r.blood_type_code.endsWith('-') ? 'Negative' : 'Positive'}` }),
                    el('p', { class: 't-caption text-muted m-0 mt-1', text: `${r.units_needed} Units ${r.component_name} • ${r.ward}` }))),
            el('span', { class: `badge-pill font-bold ${URGENCY_CLASS[r.urgency] || URGENCY_CLASS.normal}`, text: URGENCY_LABEL[r.urgency] || r.urgency })),
        el('div', { class: 'progress-track mt-4 mb-3' },
            el('div', { class: 'progress-fill bg-maroon', style: `width: ${pct}%;` })),
        el('p', { class: 't-caption text-oxblood font-bold mb-6', text: `${r.units_collected} fulfilled, ${r.units_remaining} units remaining` }),
        el('div', { class: 'flex-between items-center border-top' },
            el('span', { class: 't-caption text-muted', text: `Needed by ${formatDate(r.needed_by)}` }),
            el('div', { class: 'flex-row gap-2' },
                el('button', { type: 'button', class: 'btn-outline-small', text: 'Edit', onclick: () => openEdit(r) }),
                el('button', { type: 'button', class: 'btn-outline-small text-urgent', style: 'border-color:var(--urgent);', text: 'Close', onclick: () => closeRequest(r) }))));
}

function render() {
    lists.forEach((list) => {
        const limit = Number(list.dataset.limit) || Infinity;
        list.replaceChildren(...(requests.length
            ? requests.slice(0, limit).map(card)
            : [el('p', { class: 't-caption text-muted', text: 'No open blood requests.' })]));
    });
    const count = document.getElementById('view-all-count');
    if (count) count.textContent = `View All (${requests.length})`;
}

async function load() {
    try {
        requests = (await api('GET')).requests;
        render();
    } catch (err) {
        lists.forEach((list) => list.replaceChildren(el('p', { class: 't-caption text-urgent', text: err.message })));
    }
}

async function closeRequest(r) {
    if (!confirm(`Close the ${r.blood_type_code} request for ${r.ward}? Donors will stop receiving its alerts.`)) return;
    try {
        await api('DELETE', { request_id: r.request_id });
        showToast('Request closed.');
        load();
    } catch (err) {
        showToast(err.message);
    }
}

// One shared edit dialog, built once.
const field = (label, input) => el('label', { class: 'edit-request-field' }, label, input);
const wardInput = el('input', { type: 'text', name: 'ward', required: '', maxlength: '100' });
const unitsInput = el('input', { type: 'number', name: 'units_needed', required: '', min: '1', max: '500' });
const urgencyInput = el('select', { name: 'urgency' },
    ...Object.entries(URGENCY_LABEL).reverse().map(([value, text]) => el('option', { value, text })));
const neededInput = el('input', { type: 'datetime-local', name: 'needed_by', required: '' });
const saveBtn = el('button', { type: 'submit', class: 'btn-primary bg-maroon text-bone font-bold p-3 px-6', text: 'Save changes' });
let editing = null;

const form = el('form', { method: 'dialog', class: 'edit-request-form' },
    el('h2', { class: 't-title font-heading text-oxblood m-0', text: 'Edit request' }),
    field('Ward / unit', wardInput),
    field('Units needed', unitsInput),
    field('Urgency', urgencyInput),
    field('Needed by', neededInput),
    el('div', { class: 'flex-row justify-end gap-2' },
        el('button', { type: 'button', class: 'btn-outline-small', text: 'Cancel', onclick: () => dialog.close() }),
        saveBtn));
const dialog = el('dialog', { class: 'edit-request-dialog', 'aria-label': 'Edit blood request' }, form);
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
        await api('PUT', {
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
        showToast(err.message);
    } finally {
        saveBtn.disabled = false;
    }
});

document.getElementById('refresh-btn')?.addEventListener('click', load);
load();
