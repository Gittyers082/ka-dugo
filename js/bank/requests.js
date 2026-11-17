// Bank "Post blood request": creates a blood request (request.php), then sends an in-app alert about it
// to eligible donors near this bank (alerts.php requires the request_id; the server takes the blood type
// from the request).
import { api } from '../api.js';
import { $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDateTime, toLocalInput } from '../ui/format.js';
import { loadTodayQuota } from './quota.js';

const BLOOD_TYPE_IDS = { 'A+': 1, 'A-': 2, 'B+': 3, 'B-': 4, 'AB+': 5, 'AB-': 6, 'O+': 7, 'O-': 8 };
const COMPONENTS = { 1: 'Whole Blood', 2: 'Packed Red Blood Cells', 3: 'Platelets', 4: 'Fresh Frozen Plasma' };
const URGENCY = { normal: 1, high: 2, critical: 3 };

const form = $('#request-form');
const state = { bloodType: 'O-', componentId: 2, urgency: 'critical', units: 2, radius: 15 };
let reachRequest = 0;

// Buttons in one group behave like radio buttons: the clicked one becomes aria-pressed.
function pick(group, button) {
    group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
}

function updatePreview() {
    const ward = $('#ward-input').value.trim() || 'Ward not set';
    setText('#preview-blood', state.bloodType);
    setText('#preview-title', `${state.units} unit(s) ${COMPONENTS[state.componentId]}`);
    setText('#preview-ward', ward);
    setText('#preview-urgency', state.urgency);
    setText('#preview-deadline', $('#needed-by-input').value ? `Needed by ${formatDateTime($('#needed-by-input').value)}` : 'No deadline set');
    setText('#preview-message', alertMessage());
    setText('#units-display', `${state.units} unit${state.units === 1 ? '' : 's'}`);
}

function alertMessage() {
    const ward = $('#ward-input').value.trim() || 'our hospital';
    const note = $('#notes-input').value.split('\n')[0].trim();
    return `${state.urgency.toUpperCase()}: ${state.units} unit(s) of ${state.bloodType} ${COMPONENTS[state.componentId]} needed at ${ward}.${note ? ` ${note}` : ''}`;
}

async function updateReach() {
    const request = ++reachRequest;
    setText('#reach-count', '…');
    try {
        const reach = await api('alerts.php', { query: { action: 'reach', blood_type_id: BLOOD_TYPE_IDS[state.bloodType], radius_km: state.radius } });
        if (request !== reachRequest) return;
        setText('#reach-count', reach.count);
        setText('#reach-context', `eligible ${state.bloodType} donors within ${state.radius} km of ${reach.center_name}`);
    } catch (error) {
        if (request === reachRequest) {
            setText('#reach-count', '—');
            setText('#reach-context', error.offline ? 'Reach needs a connection.' : error.message);
        }
    }
}

async function loadQuota() {
    try {
        const quota = await loadTodayQuota();
        setText('#quota-text', `${quota.total}/${quota.goal}`);
        setText('#quota-meta', `${quota.percent}% of today's goal`);
    } catch {
        setText('#quota-text', '—');
    }
    try {
        const { requests } = await api('request.php', { query: { status: 'open' } });
        const top = requests.find((r) => r.units_remaining > 0); // sorted by urgency, then deadline
        setText('#deficit-text', top ? `${top.units_remaining} × ${top.blood_type_code}` : 'None');
        setText('#deficit-meta', top ? top.ward : 'Every open request is covered');
    } catch {
        setText('#deficit-text', '—');
    }
}

async function submit(event) {
    event.preventDefault();
    const ward = $('#ward-input').value.trim();
    const neededBy = $('#needed-by-input').value;
    if (!ward) return showToast('Enter the ward or unit that needs the blood.', true);
    if (!neededBy) return showToast('Choose when the blood is needed by.', true);

    const button = $('#dispatch-btn');
    button.disabled = true;
    try {
        const request = await api('request.php', { method: 'POST', body: {
            blood_type_id: BLOOD_TYPE_IDS[state.bloodType],
            component_id: state.componentId,
            ward,
            units_needed: state.units,
            urgency: state.urgency,
            needed_by: neededBy,
        } });
        window.dispatchEvent(new Event('kadugo:requests-changed'));
        loadQuota();
        try {
            const alert = await api('alerts.php', { method: 'POST', body: {
                request_id: request.request_id,
                level: URGENCY[state.urgency],
                radius_km: state.radius,
                message: alertMessage(),
                status: 'active',
            } });
            showToast(`Request posted and sent to ${alert.recipients_notified} eligible donor(s).`);
        } catch (alertError) {
            showToast(`Request posted, but no alert was sent: ${alertError.message}`, true);
        }
        form.reset();
        setDefaultDeadline();
        updatePreview();
    } catch (error) {
        showToast(error.message, true);
    } finally {
        button.disabled = false;
    }
}

function setDefaultDeadline() {
    const inSixHours = new Date(Date.now() + 6 * 3600 * 1000);
    $('#needed-by-input').value = toLocalInput(new Date(inSixHours - inSixHours.getTimezoneOffset() * 60000).toISOString());
}

/* ---------- wiring ---------- */

$('#blood-group').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    pick(event.currentTarget, button);
    state.bloodType = button.dataset.type;
    updatePreview();
    updateReach();
});
$('#component-group').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    pick(event.currentTarget, button);
    state.componentId = Number(button.dataset.component);
    updatePreview();
});
$('#urgency-group').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    pick(event.currentTarget, button);
    state.urgency = button.dataset.urgency;
    updatePreview();
});
$('#radius-group').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    pick(event.currentTarget, button);
    state.radius = Number(button.dataset.radius);
    updateReach();
});
$('#units-minus').addEventListener('click', () => { state.units = Math.max(1, state.units - 1); updatePreview(); });
$('#units-plus').addEventListener('click', () => { state.units = Math.min(100, state.units + 1); updatePreview(); });
form.addEventListener('input', updatePreview);
form.addEventListener('submit', submit);

setDefaultDeadline();
updatePreview();
updateReach();
loadQuota();
