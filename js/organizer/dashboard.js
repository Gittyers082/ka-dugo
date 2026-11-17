// Organizer dashboard: drive numbers, the status pipeline, turnout (check-in / no-show) for one
// drive, drives that need attention (no GPS / no partner bank) and the managed drive list.
import { api } from '../api.js';
import { el, $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDate, formatTime } from '../ui/format.js';

const ACTIVE = ['scheduled', 'ongoing'];
const STAGES = ['scheduled', 'ongoing', 'completed', 'cancelled'];
const STATUS_PILL = {
    scheduled: 'is-warn', ongoing: 'is-ok', completed: 'is-muted', cancelled: 'is-soft',
    booked: 'is-info', checked_in: 'is-ok', no_show: 'is-soft',
};

const pill = (status) => el('span', { class: `pill ${STATUS_PILL[status] || ''}`, text: status.replace('_', ' ') });
const empty = (text) => el('li', { class: 'empty', text });

function renderStats(drives) {
    const active = drives.filter((d) => ACTIVE.includes(d.status));
    const booked = active.reduce((sum, d) => sum + d.registered_count, 0);
    const capacity = active.reduce((sum, d) => sum + Number(d.slots_total), 0);
    setText('#stat-active', active.length);
    setText('#stat-booked', booked);
    setText('#stat-open', Math.max(0, capacity - booked));
    setText('#stat-fill', capacity ? `${Math.round((booked / capacity) * 100)}%` : '—');
}

function renderPipeline(drives) {
    const most = Math.max(1, ...STAGES.map((key) => drives.filter((d) => d.status === key).length));
    $('#pipeline').replaceChildren(...STAGES.map((key) => {
        const count = drives.filter((d) => d.status === key).length;
        const share = drives.length ? Math.round((count / drives.length) * 100) : 0;
        return el('div', { class: 'stage' },
            el('div', { class: 'stage-head' }, pill(key), el('small', { text: `${share}%` })),
            el('div', { class: `hatch${key === 'completed' ? ' is-solid' : ''}`, style: `height: ${Math.max(12, (count / most) * 72)}px` }),
            el('div', { class: 'stage-value' }, el('strong', { text: count }), el('span', { text: count === 1 ? 'drive' : 'drives' })),
        );
    }));
}

function driveRow(d) {
    const day = new Date(`${d.drive_date}T12:00:00`);
    return el('li', { class: 'row' },
        el('span', { class: 'row-time' }, day.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
            el('small', { text: formatTime(d.start_time) })),
        el('div', { class: 'row-main' },
            el('strong', { text: d.title }),
            el('span', { text: `${d.registered_count}/${d.slots_total} booked • ${d.bank_name || 'No partner bank'}` })),
        pill(d.status));
}

function renderAttention(drives) {
    const issues = drives.filter((d) => ACTIVE.includes(d.status)).flatMap((d) => [
        d.latitude === null ? [d, 'No GPS location — invitations are disabled'] : null,
        !d.bank_id ? [d, 'No partner bank to collect the blood'] : null,
    ].filter(Boolean));
    $('#attention-list').replaceChildren(...(issues.length
        ? issues.map(([d, problem]) => el('li', { class: 'row' },
            el('div', { class: 'row-main' }, el('strong', { text: d.title }), el('span', { text: problem })),
            el('a', { class: 'link', href: 'drives.html', text: 'Fix' })))
        : [empty('All upcoming drives have a GPS location and a partner bank.')]));
}

function turnoutRow(r) {
    const actions = r.status === 'booked'
        ? el('div', { class: 'row-actions' },
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Check in', onclick: () => setStatus(r, 'checked_in') }),
            el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'No-show', onclick: () => setStatus(r, 'no_show') }))
        : pill(r.status);
    return el('li', { class: 'row' },
        el('span', { class: 'row-time', text: formatTime(r.slot_time) }),
        el('div', { class: 'row-main' },
            el('strong', { text: r.full_name }),
            el('span', { text: `${r.blood_type_code} • ${r.component_name}` })),
        actions);
}

async function loadTurnout() {
    const driveId = $('#turnout-drive').value;
    if (!driveId) {
        $('#turnout-list').replaceChildren(empty('No upcoming drives.'));
        setText('#stat-checked', 0);
        return;
    }
    try {
        const { registrations } = await api('registrations.php', { query: { drive_id: driveId } });
        setText('#stat-checked', registrations.filter((r) => ['checked_in', 'completed'].includes(r.status)).length);
        $('#turnout-list').replaceChildren(...(registrations.length
            ? registrations.map(turnoutRow)
            : [empty('No donors have booked this drive yet.')]));
    } catch (error) {
        $('#turnout-list').replaceChildren(empty(error.message));
    }
}

async function setStatus(registration, status) {
    try {
        await api('registrations.php', { method: 'PUT', body: { registration_id: registration.registration_id, status } });
        showToast(status === 'checked_in' ? `${registration.full_name} checked in.` : `${registration.full_name} marked as no-show.`);
        loadTurnout();
    } catch (error) {
        showToast(error.message, true);
    }
}

async function load() {
    const [{ drives }, profile] = await Promise.all([api('drives.php'), api('profile.php')]);
    setText('#org-name', profile.org_name);
    renderStats(drives);
    renderPipeline(drives);
    renderAttention(drives);
    $('#drives-list').replaceChildren(...(drives.length
        ? drives.slice(0, 5).map(driveRow)
        : [empty('No drives yet. Schedule your first drive.')]));
    const active = drives.filter((d) => ACTIVE.includes(d.status));
    $('#turnout-drive').replaceChildren(...active.map((d) => new Option(`${d.title} • ${formatDate(d.drive_date)}`, d.drive_id)));
    loadTurnout();
}

$('#turnout-drive').addEventListener('change', loadTurnout);
load().catch((error) => showToast(error.message, true));
