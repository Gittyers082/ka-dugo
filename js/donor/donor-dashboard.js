// Donor dashboard: eligibility, donation numbers, digital donor QR (Fast Admission Pass),
// the top matching bank request and the donor's next booked drive.
import { request, profile, displayError, firstName, formatDate, formatTime } from './donor-common.js';
import { generateQrSvg } from './donor-qr.js';
import { el, $, setText } from '../ui/dom.js';

const qrDialog = $('#donor-qr-dialog');

function renderProfile(data) {
    const eligible = Boolean(data.eligibility?.is_eligible);
    setText('#donor-first-name', firstName(data.full_name));
    setText('#donor-id', `Donor #${data.donor_id}`);
    setText('#stat-type', data.blood_type_code);
    setText('#stat-units', data.total_units);
    setText('#stat-records', data.history_count);
    setText('#stat-last', data.last_donation_date ? formatDate(data.last_donation_date) : 'None yet');

    const status = $('#eligibility-pill');
    status.className = `pill ${eligible ? 'is-ok' : 'is-soft'}`;
    status.textContent = eligible ? 'Eligible' : 'Not eligible';
    setText('#eligibility-title', eligible ? 'You can donate today' : 'Not eligible to donate yet');
    setText('#eligibility-detail', eligible
        ? 'You pass the recorded checks. Final screening happens at the blood bank.'
        : (data.eligibility?.reasons?.join(' ') || 'Contact the blood bank for guidance.'));
    $('#eligibility-facts').replaceChildren(
        el('div', {}, el('dt', { text: 'Age' }), el('dd', { text: `${data.eligibility?.age ?? '—'} years` })),
        el('div', {}, el('dt', { text: 'Weight' }), el('dd', { text: `${Number(data.weight_kg).toFixed(1)} kg` })),
        el('div', {}, el('dt', { text: 'Last donation' }), el('dd', { text: formatDate(data.last_donation_date) })),
    );

    const qrButton = $('#show-donor-qr');
    if (data.qr_code) {
        qrButton.replaceChildren(generateQrSvg(data.qr_code));
        qrButton.disabled = false;
        $('.donor-qr-image').replaceChildren(generateQrSvg(data.qr_code));
        setText('.donor-qr-note', `${data.full_name} • Donor #${data.donor_id}`);
    } else {
        qrButton.disabled = true;
        qrButton.textContent = 'QR unavailable';
    }
}

function renderRequest(data) {
    const top = (data.matching_requests || [])[0];
    if (!top) {
        $('#request-slot').replaceChildren(el('p', { class: 'empty', text: 'No open requests match your blood type right now.' }));
        return;
    }
    const urgency = String(top.urgency || 'normal');
    $('#request-slot').replaceChildren(el('div', { class: 'item' },
        el('div', { class: 'item-top' },
            el('div', { class: 'item-head' },
                el('span', { class: 'badge-box', text: top.blood_type_code }),
                el('div', { class: 'row-main' },
                    el('strong', { text: top.ward }),
                    el('span', { text: top.bank_name }))),
            el('span', { class: `pill ${urgency === 'critical' ? 'is-accent' : urgency === 'high' ? 'is-warn' : 'is-muted'}`, text: urgency })),
        el('p', { text: `${Number(top.units_needed)} unit(s) ${top.component_name} • needed by ${formatDate(top.needed_by)}` }),
        el('p', { class: 'note', text: 'Contact the blood bank to arrange your donation. Booking a drive is separate from this request.' }),
        el('a', { class: 'link', href: `drives-booking.html?view=requests&request=${encodeURIComponent(top.request_id)}`, text: 'See all matching requests →' })));
}

function renderBooking(data) {
    const b = data.active_booking;
    if (!b) {
        $('#booking-slot').replaceChildren(
            el('p', { class: 'empty', text: 'You have no upcoming booked drive.' }),
            el('a', { class: 'btn btn-primary btn-block section-gap', href: 'drives-booking.html', text: 'Browse blood drives' }));
        return;
    }
    const day = new Date(`${b.drive_date}T12:00:00`);
    $('#booking-slot').replaceChildren(
        el('div', { class: 'row' },
            el('span', { class: 'row-time' }, day.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), el('small', { text: formatTime(b.slot_time) })),
            el('div', { class: 'row-main' },
                el('strong', { text: b.title }),
                el('span', { text: `${b.org_name} • ${b.venue}` })),
            el('span', { class: 'pill is-ok', text: 'Confirmed' })),
        el('p', { class: 'note', text: 'Bring a valid ID and your digital donor QR. Final screening happens at the drive.' }),
        el('a', { class: 'btn btn-ghost btn-block section-gap', text: 'Reschedule',
            href: `drives-booking.html?view=bookings&action=reschedule&registration=${encodeURIComponent(b.registration_id)}` }));
}

async function refreshDashboard() {
    try {
        const data = await request('overview');
        renderProfile(data);
        renderRequest(data);
        renderBooking(data);
    } catch (error) {
        displayError(error.message);
    }
}

function openQr() {
    if (!qrDialog.open && !$('#show-donor-qr').disabled) qrDialog.showModal();
}

$('#show-donor-qr').addEventListener('click', openQr);
$('#close-donor-qr').addEventListener('click', () => qrDialog.close());
qrDialog.addEventListener('click', (event) => { if (event.target === qrDialog) qrDialog.close(); }); // backdrop click
window.addEventListener('pageshow', (event) => { if (event.persisted) refreshDashboard(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDashboard(); });
setInterval(() => { if (!document.hidden) refreshDashboard(); }, 60000);

await refreshDashboard();
if (location.hash === '#donor-qr') profile().then(openQr).catch(() => {});
