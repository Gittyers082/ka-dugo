// Donor Drives & Booking: matching bank requests (read-only), upcoming organizer drives to book,
// and the donor's own bookings (reschedule / cancel). Data: api/donor_portal.php.
import { request, profile, formatTime } from './donor-common.js';
import { el, $ } from '../ui/dom.js';
import { todayLocal } from '../ui/format.js';

const params = new URLSearchParams(location.search);
const state = { me: null, drives: [], bookings: [], requests: [], openDrive: null, openBooking: null };
const statusBox = $('#donor-page-status');

function announce(message, isError = false) {
    statusBox.hidden = false;
    statusBox.textContent = message;
    statusBox.classList.toggle('donor-data-error', isError);
}

function dateTile(day) {
    const date = new Date(`${day}T12:00:00`);
    return el('span', { class: 'row-time' }, date.toLocaleDateString('en-PH', { month: 'short' }), el('small', { text: String(date.getDate()) }));
}

function setView(tab) {
    for (const name of ['requests', 'upcoming', 'bookings']) {
        $(`#tab-${name}`).setAttribute('aria-pressed', String(tab === name));
        $(`#${name}-view`).hidden = tab !== name;
    }
}

/* ---------- cards ---------- */

// Bank requests are not bookable drives; they only tell the donor where blood is needed.
function requestCard(r) {
    const urgency = String(r.urgency || 'normal');
    const focused = Number(r.request_id) === Number(params.get('request'));
    return el('article', { class: `item${focused ? ' is-focus' : ''}`, id: `bank-request-${r.request_id}` },
        el('div', { class: 'item-top' },
            el('div', { class: 'item-head' },
                el('span', { class: 'badge-box', text: r.blood_type_code }),
                el('div', { class: 'row-main' }, el('strong', { text: r.ward }), el('span', { text: `${r.bank_name} • ${r.component_name}` }))),
            el('span', { class: `pill ${urgency === 'critical' ? 'is-accent' : urgency === 'high' ? 'is-warn' : 'is-muted'}`, text: urgency })),
        el('p', { text: `${Number(r.units_needed) || 0} unit(s) needed • deadline ${r.needed_by || 'not specified'}` }),
        el('p', { class: 'note', text: 'A bank request is not a bookable drive. Contact the bank to ask about donating.' }));
}

function slotForm(drive) {
    const eligible = Boolean(state.me.eligibility?.is_eligible);
    const left = (slot) => Number(slot.capacity) - Number(slot.booked_count);
    const open = drive.slots.filter((slot) => left(slot) > 0);
    const form = el('form', { class: 'stack' },
        el('div', { class: 'choice-grid cols-3 slot-grid' }, ...drive.slots.map((slot) => el('label', {},
            el('input', { type: 'radio', name: 'slot_id', value: slot.slot_id, required: true, disabled: left(slot) <= 0 }),
            el('span', { text: `${formatTime(slot.slot_time)} • ${Math.max(0, left(slot))} left` })))),
        el('button', { class: 'btn btn-accent', type: 'submit', text: 'Book selected slot', disabled: !open.length || !eligible }),
        eligible ? null : el('p', { class: 'note is-bad', text: 'Your profile is currently deferred. You can book once you are eligible.' }));
    form.addEventListener('submit', (event) => book(event, drive));
    return form;
}

function driveCard(d) {
    const id = Number(d.drive_id);
    const booked = state.bookings.some((b) => Number(b.drive_id) === id && ['booked', 'checked_in', 'completed'].includes(b.status));
    const expanded = state.openDrive === id;
    const types = d.target_blood_types.map((t) => t.code).join(', ');
    return el('article', { class: `item${id === Number(params.get('drive')) ? ' is-focus' : ''}`, id: `donor-drive-${id}` },
        el('div', { class: 'item-top' },
            el('div', { class: 'item-head' },
                dateTile(d.drive_date),
                el('div', { class: 'row-main' }, el('strong', { text: d.title }), el('span', { text: `${d.org_name} • ${d.venue}` }))),
            el('span', { class: 'pill is-warn', text: d.status })),
        el('div', { class: 'meta' },
            el('span', { class: 'pill is-muted no-dot', text: `${formatTime(d.start_time)}–${formatTime(d.end_time)}` }),
            el('span', { class: 'pill is-muted no-dot', text: `${d.slots_available} slots left` }),
            types ? el('span', { class: 'pill is-soft no-dot', text: types }) : null),
        el('button', {
            type: 'button',
            class: `btn btn-sm ${booked ? 'btn-soft' : 'btn-primary'}`,
            'aria-expanded': String(expanded),
            disabled: booked,
            text: booked ? 'Already registered' : expanded ? 'Hide slots' : 'Choose a time slot',
            onclick: () => { state.openDrive = expanded ? null : id; render(); },
        }),
        expanded && !booked ? slotForm(d) : null);
}

function bookingCard(b) {
    const id = Number(b.registration_id);
    const editable = b.status === 'booked' && b.drive_date >= todayLocal();
    return el('article', { class: 'item' },
        el('div', { class: 'item-top' },
            el('div', { class: 'item-head' },
                dateTile(b.drive_date),
                el('div', { class: 'row-main' }, el('strong', { text: b.title }), el('span', { text: `${b.org_name} • ${b.venue}` }))),
            el('span', { class: `pill ${b.status === 'booked' ? 'is-ok' : 'is-muted'}`, text: b.status.replace('_', ' ') })),
        el('p', { text: `${formatTime(b.slot_time)} • ${b.component_name} • ${b.ref_code}` }),
        editable ? el('div', { class: 'item-actions' },
            el('button', { type: 'button', class: 'btn btn-soft btn-sm', text: 'Reschedule', onclick: () => toggleReschedule(b) }),
            el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Cancel booking', onclick: () => cancel(b) })) : null,
        editable && state.openBooking === id ? reschedulePanel(b) : null);
}

function reschedulePanel(booking) {
    const drive = state.drives.find((d) => Number(d.drive_id) === Number(booking.drive_id));
    const grid = el('div', { class: 'choice-grid cols-3' });
    if (!drive) {
        grid.textContent = 'This drive is no longer open.';
    } else {
        grid.append(...drive.slots.map((slot) => {
            const current = Number(slot.slot_id) === Number(booking.slot_id);
            return el('button', {
                type: 'button',
                disabled: Number(slot.booked_count) >= Number(slot.capacity) && !current,
                text: `${formatTime(slot.slot_time)}${current ? ' (current)' : ''}`,
                onclick: (event) => reschedule(event, booking, slot),
            });
        }));
    }
    return el('div', { class: 'stack' }, el('p', { text: 'Pick a new time slot:' }), grid);
}

function render() {
    $('#request-empty').hidden = state.requests.length > 0;
    $('#request-list').replaceChildren(...state.requests.map(requestCard));
    $('#drive-empty').hidden = state.drives.length > 0;
    $('#drive-list').replaceChildren(...state.drives.map(driveCard));
    $('#booking-empty').hidden = state.bookings.length > 0;
    $('#booking-list').replaceChildren(...state.bookings.map(bookingCard));
}

/* ---------- actions ---------- */

async function load() {
    const [me, driveData, bookingData, noticeData] = await Promise.all([
        profile(), request('drives'), request('bookings'), request('notifications'),
    ]);
    state.me = me;
    state.drives = driveData.drives || [];
    state.bookings = bookingData.bookings || [];
    state.requests = noticeData.matching_requests || [];
    render();
}

async function book(event, drive) {
    event.preventDefault();
    const slot = event.currentTarget.querySelector('input[name="slot_id"]:checked');
    if (!slot) return announce('Choose a slot first.', true);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        await request('book', { drive_id: Number(drive.drive_id), slot_id: Number(slot.value) });
        state.openDrive = null;
        await load();
        setView('bookings');
        announce('Your drive booking is confirmed.');
    } catch (error) {
        announce(error.message, true);
        button.disabled = false;
    }
}

async function cancel(booking) {
    if (!confirm('Cancel your blood drive registration?')) return;
    try {
        await request('cancel_booking', { registration_id: Number(booking.registration_id) });
        await load();
        announce('Your booking was cancelled.');
    } catch (error) {
        announce(error.message, true);
    }
}

function toggleReschedule(booking) {
    const id = Number(booking.registration_id);
    state.openBooking = state.openBooking === id ? null : id;
    render();
}

async function reschedule(event, booking, slot) {
    event.currentTarget.disabled = true;
    try {
        await request('reschedule', { registration_id: Number(booking.registration_id), slot_id: Number(slot.slot_id) });
        state.openBooking = null;
        await load();
        setView('bookings');
        announce('Your booking was rescheduled.');
    } catch (error) {
        announce(error.message, true);
    }
}

/* ---------- start ---------- */

for (const name of ['requests', 'upcoming', 'bookings']) {
    $(`#tab-${name}`).addEventListener('click', () => setView(name));
}

try {
    await load();
    statusBox.hidden = true;
    const view = params.get('view');
    setView(['requests', 'upcoming', 'bookings'].includes(view) ? view : 'upcoming');

    const driveId = Number(params.get('drive'));
    if (driveId && state.drives.some((d) => Number(d.drive_id) === driveId)) {
        state.openDrive = driveId;
        render();
        $(`#donor-drive-${driveId}`)?.scrollIntoView({ block: 'nearest' });
    }
    if (view === 'requests' && params.has('request')) {
        $(`#bank-request-${Number(params.get('request'))}`)?.scrollIntoView({ block: 'nearest' });
    }
    const registrationId = Number(params.get('registration'));
    if (params.get('action') === 'reschedule' && state.bookings.some((b) => Number(b.registration_id) === registrationId && b.status === 'booked')) {
        state.openBooking = registrationId;
        render();
    }
} catch (error) {
    announce(error.message, true);
}
