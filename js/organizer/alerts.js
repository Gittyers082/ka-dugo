// Organizer drive invitations: an in-app alert to eligible donors of ONE blood type near one of the
// organizer's drives. The server checks the drive belongs to the organizer, is upcoming, has a GPS
// point and collects that blood type (api/alerts.php).
import { api } from '../api.js';
import { $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDate, formatTime } from '../ui/format.js';

const BLOOD_IDS = { 'A+': 1, 'A-': 2, 'B+': 3, 'B-': 4, 'AB+': 5, 'AB-': 6, 'O+': 7, 'O-': 8 };

const state = { drives: [], drive: null, bloodType: null, radius: 15, donors: 0, sending: false };
const message = $('#alert-message');
const dialog = $('.confirm-dialog');
const dispatchBtn = $('.dispatch');
const bloodButtons = [...document.querySelectorAll('.blood-grid .blood')];
let reachRequest = 0;

/* ---------- drive + blood type ---------- */

function selectDrive(driveId) {
    state.drive = state.drives.find((d) => String(d.drive_id) === String(driveId)) || null;
    const accepted = new Set((state.drive?.target_blood_types || []).map((t) => t.code));
    bloodButtons.forEach((button) => {
        button.disabled = accepted.size > 0 && !accepted.has(button.dataset.type);
    });
    setText('#drive-context', state.drive
        ? `${formatDate(state.drive.drive_date)}, ${formatTime(state.drive.start_time)} • ${state.drive.venue}`
        : 'Schedule a drive with a GPS location first.');
    const firstEnabled = bloodButtons.find((button) => !button.disabled);
    selectBloodType(state.bloodType && !bloodButtons.find((b) => b.dataset.type === state.bloodType)?.disabled
        ? state.bloodType : firstEnabled?.dataset.type);
}

function selectBloodType(code) {
    state.bloodType = code || null;
    bloodButtons.forEach((button) => {
        const on = button.dataset.type === code;
        button.classList.toggle('selected', on);
        button.setAttribute('aria-pressed', String(on));
    });
    setText('#selected-type', code || '—');
    resetMessage();
    updateReach();
}

function resetMessage() {
    if (!state.drive || !state.bloodType) return;
    message.value = `${state.drive.title} on ${formatDate(state.drive.drive_date)} needs ${state.bloodType} donors. `
        + 'Open Ka-dugo to book a time slot.';
    updateMessage();
}

function updateMessage() {
    setText('.counter', `${message.value.length} / 280`);
    setText('.alert-preview p', message.value || 'Your message will appear here.');
    setText('#message-status', message.value.trim() ? 'Message ready' : 'Enter a message');
}

/* ---------- reach ---------- */

async function updateReach() {
    const request = ++reachRequest;
    state.donors = 0;
    dispatchBtn.disabled = true;
    setText('#radius-label', `${state.radius} km`);
    if (!state.drive || !state.bloodType) {
        setText('#reach-count', '—');
        return;
    }

    setText('#reach-count', 'Checking…');
    try {
        const reach = await api('alerts.php', { query: {
            action: 'reach', drive_id: state.drive.drive_id, blood_type_id: BLOOD_IDS[state.bloodType], radius_km: state.radius,
        } });
        if (request !== reachRequest) return; // a newer selection is already loading
        state.donors = reach.count;
        setText('#reach-count', `${reach.count} eligible donor${reach.count === 1 ? '' : 's'}`);
        setText('#reach-context', `${state.bloodType} donors within ${state.radius} km of ${reach.center_name}.`);
        setText('#eligible-donor-count', reach.missing_location ? `${reach.missing_location} donor(s) have no saved location and are excluded.` : '');
        dispatchBtn.disabled = state.sending || reach.count === 0;
    } catch (error) {
        if (request !== reachRequest) return;
        setText('#reach-count', 'Unavailable');
        setText('#eligible-donor-count', error.message);
    }
}

/* ---------- send ---------- */

async function save(status) {
    if (state.sending || !state.drive || !state.bloodType) return;
    if (!message.value.trim()) return showToast('Enter a message.', true);
    state.sending = true;
    try {
        const result = await api('alerts.php', { method: 'POST', body: {
            drive_id: state.drive.drive_id,
            blood_type_id: BLOOD_IDS[state.bloodType],
            radius_km: state.radius,
            message: message.value.trim(),
            status,
        } });
        dialog.close();
        showToast(status === 'draft' ? 'Draft saved.' : `Invitation sent to ${result.recipients_notified} donor inbox(es).`);
    } catch (error) {
        showToast(error.message, true);
    } finally {
        state.sending = false;
        updateReach();
    }
}

/* ---------- wiring ---------- */

bloodButtons.forEach((button) => button.addEventListener('click', () => selectBloodType(button.dataset.type)));
$('#alert-drive').addEventListener('change', (event) => selectDrive(event.target.value));
$('.radius-input').addEventListener('input', (event) => { state.radius = Number(event.target.value); updateReach(); });
message.addEventListener('input', updateMessage);
$('#alert-form').addEventListener('submit', (event) => event.preventDefault());
$('#reset-protocol').addEventListener('click', resetMessage);
document.querySelectorAll('.close-dialog, .cancel-dialog').forEach((button) => button.addEventListener('click', () => dialog.close()));
dispatchBtn.addEventListener('click', () => { if (state.donors) dialog.showModal(); });
$('.approve-dialog').addEventListener('click', () => save('active'));
$('#save-draft').addEventListener('click', () => save('draft'));

api('profile.php').then((profile) => {
    setText('#preview-org', profile.org_name);
}).catch(() => {});

api('drives.php').then(({ drives }) => {
    state.drives = drives.filter((d) => ['scheduled', 'ongoing'].includes(d.status) && d.latitude !== null);
    $('#alert-drive').replaceChildren(...state.drives.map((d) => new Option(`${d.title} — ${formatDate(d.drive_date)}`, d.drive_id)));
    selectDrive(state.drives[0]?.drive_id);
}).catch((error) => showToast(error.message, true));
