// Organizer drive scheduler: create drives (venue GPS point, partner bank, accepted blood types,
// capacity), manage each drive's time slots, and cancel drives. The server scopes everything to
// the signed-in organizer.
import { api } from '../api.js';
import { el, $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDate, formatTime, todayLocal } from '../ui/format.js';

const ACTIVE = ['scheduled', 'ongoing'];
const form = $('#drive-form');
const slotsValue = $('#slots-value');
const bloodTypeOptions = $('#blood-type-options');
const bloodTypeStatus = $('#target-types-status');
const slotDialog = $('#slot-dialog');
const slotList = $('#slot-list');
let drives = [];
let selectedDrive = null;

/* ---------- form helpers ---------- */

const setSlotTotal = (value) => { slotsValue.textContent = Math.max(4, Math.min(2000, Number(value) || 4)); };
const selectedBloodTypes = () => [...bloodTypeOptions.querySelectorAll('input:checked')].map((input) => Number(input.value));

function updateBloodTypeStatus() {
    const selected = selectedBloodTypes().length;
    const total = bloodTypeOptions.querySelectorAll('input').length;
    bloodTypeOptions.querySelectorAll('.blood-type-choice').forEach((label) => {
        label.classList.toggle('is-selected', label.querySelector('input').checked);
    });
    bloodTypeStatus.classList.toggle('is-error', selected === 0);
    bloodTypeStatus.textContent = selected === 0 ? 'Select at least one blood type to publish.'
        : selected === total ? `All ${total} blood types selected.` : `${selected} of ${total} blood types selected.`;
}

async function loadLookups() {
    const [{ blood_types: types }, { banks }] = await Promise.all([
        api('drives.php', { query: { lookup: 'blood_types' } }),
        api('drives.php', { query: { lookup: 'banks' } }),
    ]);
    bloodTypeOptions.replaceChildren(...types.map((type) => el('label', { class: 'blood-type-choice' },
        el('input', { type: 'checkbox', name: 'blood_type_ids', value: type.blood_type_id }),
        el('span', { text: type.code }))));
    $('#partner-bank').append(...banks.map((bank) => new Option(`${bank.name} — ${bank.address}`, bank.bank_id)));
    updateBloodTypeStatus();
}

function captureLocation() {
    if (!navigator.geolocation) return setText('#gps-status', 'GPS unavailable on this device');
    setText('#gps-status', 'Locating…');
    navigator.geolocation.getCurrentPosition((position) => {
        $('#latitude').value = position.coords.latitude.toFixed(6);
        $('#longitude').value = position.coords.longitude.toFixed(6);
        setText('#gps-status', 'Location captured');
        $('#gps-status').className = 'pill is-ok no-dot';
    }, () => setText('#gps-status', 'Location permission needed'), { enableHighAccuracy: true, timeout: 10000 });
}

/* ---------- drive list ---------- */

const STATUS_PILL = { scheduled: 'is-warn', ongoing: 'is-ok', completed: 'is-muted', cancelled: 'is-soft' };

function driveItem(drive) {
    const registered = Number(drive.registered_count);
    const capacity = Number(drive.slots_total) || 1;
    const percent = Math.min(100, Math.round((registered / capacity) * 100));
    const isActive = ACTIVE.includes(drive.status);
    const types = drive.target_blood_types.map((type) => type.code).join(', ') || 'All blood types';

    return el('article', { class: 'item' },
        el('div', { class: 'item-top' },
            el('div', {},
                el('h3', { text: drive.title }),
                el('p', { text: `${formatDate(drive.drive_date)} • ${formatTime(drive.start_time)}–${formatTime(drive.end_time)}` })),
            el('span', { class: `pill ${STATUS_PILL[drive.status] || ''}`, text: drive.status })),
        el('p', { text: drive.venue }),
        el('div', { class: 'meta' },
            el('span', { class: 'pill is-muted no-dot', text: drive.ref_code }),
            el('span', { class: 'pill is-muted no-dot', text: drive.bank_name || 'No partner bank' }),
            el('span', { class: `pill no-dot ${drive.latitude ? 'is-ok' : 'is-soft'}`, text: drive.latitude ? 'GPS saved' : 'No GPS' }),
            el('span', { class: 'pill is-muted no-dot', text: types })),
        el('div', { class: 'bar' }, el('i', { style: `width: ${percent}%` })),
        el('div', { class: 'bar-labels' },
            el('span', { text: `${registered} registered` }),
            el('span', { text: `${capacity} capacity` })),
        isActive ? el('div', { class: 'item-actions' },
            el('button', { type: 'button', class: 'btn btn-soft btn-sm', text: 'Manage slots', onclick: () => openSlotManager(drive) }),
            el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Cancel drive', onclick: () => cancelDrive(drive) })) : null);
}

async function loadDrives() {
    try {
        ({ drives } = await api('drives.php'));
    } catch (error) {
        $('#drive-list').replaceChildren(el('p', { class: 'empty', text: error.message }));
        return;
    }
    setText('#managed-count', drives.length);
    setText('#drive-total', drives.length);
    setText('#active-count', drives.filter((d) => ACTIVE.includes(d.status)).length);
    setText('#registration-count', drives.reduce((sum, d) => sum + Number(d.registered_count), 0));
    setText('#located-count', drives.filter((d) => d.latitude !== null).length);
    $('#drive-list').replaceChildren(...(drives.length
        ? drives.map(driveItem)
        : [el('p', { class: 'empty', text: 'No drives yet. Create your first drive above.' })]));
}

async function cancelDrive(drive) {
    if (!confirm(`Cancel “${drive.title}”? It will stop accepting bookings.`)) return;
    try {
        await api('drives.php', { method: 'DELETE', body: { drive_id: drive.drive_id } });
        showToast('Drive cancelled.');
        loadDrives();
    } catch (error) {
        showToast(error.message, true);
    }
}

/* ---------- slot manager ---------- */

// First 30-minute start time inside the drive hours that no row uses yet.
function nextFreeTime() {
    const used = new Set([...slotList.querySelectorAll('.slot-time')].map((input) => input.value));
    const toMinutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    for (let t = toMinutes(selectedDrive.start_time); t < toMinutes(selectedDrive.end_time); t += 30) {
        const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
        if (!used.has(time)) return time;
    }
    return null;
}

function addSlotRow(slot) {
    if (!slot) {
        const time = nextFreeTime();
        if (!time) return showToast('Every 30-minute start time is already used. Edit an existing row.', true);
        slot = { slot_time: time, capacity: 4, booked_count: 0 };
    }
    const booked = Number(slot.booked_count) || 0;
    const row = el('div', { class: 'slot-row', 'data-slot-id': slot.slot_id || '' },
        el('label', { class: 'field' }, el('span', { text: `Time • ${booked} booked` }), el('input', { class: 'slot-time', type: 'time', required: true,
            value: String(slot.slot_time).slice(0, 5), disabled: booked > 0, title: booked ? 'Booked slot times are fixed' : false })),
        el('label', { class: 'field' }, el('span', { text: 'Capacity' }), el('input', { class: 'slot-capacity', type: 'number', min: Math.max(1, booked), max: 200,
            required: true, value: Number(slot.capacity) || 1 })),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Remove', disabled: booked > 0,
            title: booked ? 'Booked slots cannot be removed' : false, onclick: () => row.remove() }));
    slotList.append(row);
}

function openSlotManager(drive) {
    selectedDrive = drive;
    setText('#slot-dialog-title', `Manage slots: ${drive.title}`);
    setText('#slot-dialog-subtitle', `${formatDate(drive.drive_date)} • ${drive.ref_code}`);
    slotList.replaceChildren();
    drive.slots.forEach(addSlotRow);
    if (!drive.slots.length) addSlotRow();
    slotDialog.showModal();
}

async function saveSlots(event) {
    if (!slotDialog.querySelector('form').reportValidity()) return;
    const slots = [...slotList.querySelectorAll('.slot-row')].map((row) => ({
        slot_id: Number(row.dataset.slotId) || 0,
        slot_time: row.querySelector('.slot-time').value,
        capacity: Number(row.querySelector('.slot-capacity').value),
    }));
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await api('drives.php', { method: 'PUT', body: { drive_id: selectedDrive.drive_id, slots } });
        slotDialog.close();
        showToast('Slots saved.');
        loadDrives();
    } catch (error) {
        showToast(error.message, true);
    } finally {
        button.disabled = false;
    }
}

/* ---------- create ---------- */

async function publish(event) {
    event.preventDefault();
    const bloodTypeIds = selectedBloodTypes();
    if (!bloodTypeIds.length) {
        updateBloodTypeStatus();
        bloodTypeOptions.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    if ($('#end-time').value <= $('#start-time').value) return showToast('End time must be after the start time.', true);

    const button = form.querySelector('.publish');
    button.disabled = true;
    try {
        await api('drives.php', { method: 'POST', body: {
            title: $('#title').value.trim(),
            venue: $('#venue').value.trim(),
            latitude: $('#latitude').value,
            longitude: $('#longitude').value,
            bank_id: $('#partner-bank').value,
            drive_date: $('#drive-date').value,
            start_time: $('#start-time').value,
            end_time: $('#end-time').value,
            category: $('#category').value,
            slots_total: Number(slotsValue.textContent),
            blood_type_ids: bloodTypeIds,
        } });
        form.reset();
        setSlotTotal(60);
        updateBloodTypeStatus();
        setText('#gps-status', 'Needed for invitations');
        $('#gps-status').className = 'pill is-muted no-dot';
        showToast('Drive published. Donors can now book it.');
        await loadDrives();
        $('#scheduled').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        showToast(error.message, true);
    } finally {
        button.disabled = false;
    }
}

/* ---------- wiring ---------- */

$('#drive-date').min = todayLocal();
$('#plus').addEventListener('click', () => setSlotTotal(Number(slotsValue.textContent) + 4));
$('#minus').addEventListener('click', () => setSlotTotal(Number(slotsValue.textContent) - 4));
$('#location').addEventListener('click', captureLocation);
$('#select-all-types').addEventListener('click', () => {
    bloodTypeOptions.querySelectorAll('input').forEach((input) => { input.checked = true; });
    updateBloodTypeStatus();
});
$('#clear-types').addEventListener('click', () => {
    bloodTypeOptions.querySelectorAll('input').forEach((input) => { input.checked = false; });
    updateBloodTypeStatus();
});
bloodTypeOptions.addEventListener('change', updateBloodTypeStatus);
$('#add-slot').addEventListener('click', () => addSlotRow());
$('#save-slots').addEventListener('click', saveSlots);
form.addEventListener('submit', publish);

loadLookups().catch((error) => {
    bloodTypeStatus.textContent = error.message;
    form.querySelector('.publish').disabled = true;
});
loadDrives();
