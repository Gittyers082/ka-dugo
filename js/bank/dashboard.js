// Bank dashboard: today's quota, open requests (with live donor reach for the most urgent one)
// and the organizer drives that partner with this bank.
import { api } from '../api.js';
import { el, $, setText } from '../ui/dom.js';
import { formatDateTime, formatTime } from '../ui/format.js';
import { loadTodayQuota } from './quota.js';

const URGENCY_PILL = { critical: 'is-accent', high: 'is-warn', normal: 'is-muted' };

function requestRow(r) {
    const needed = Number(r.units_needed) || 1;
    const collected = Number(r.units_collected) || 0;
    return el('li', { class: 'row' },
        el('span', { class: 'badge-box', text: r.blood_type_code }),
        el('div', { class: 'row-main' },
            el('strong', { text: r.ward }),
            el('span', { text: `${collected}/${needed} units ${r.component_name} • due ${formatDateTime(r.needed_by)}` })),
        el('span', { class: `pill ${URGENCY_PILL[r.urgency] || ''}`, text: r.urgency }));
}

function driveRow(d) {
    const day = new Date(`${d.drive_date}T12:00:00`);
    return el('li', { class: 'row' },
        el('span', { class: 'row-time' }, day.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
            el('small', { text: formatTime(d.start_time) })),
        el('div', { class: 'row-main' },
            el('strong', { text: d.title }),
            el('span', { text: `${d.org_name} • ${d.venue}` })),
        el('span', { class: 'pill is-muted no-dot', text: `${d.registered_count}/${d.slots_total}` }));
}

async function loadQuota() {
    const quota = await loadTodayQuota();
    setText('#quota-total', `${quota.total}/${quota.goal}`);
    setText('#quota-remaining', quota.remaining ? `${quota.remaining} units to reach today's goal` : "Today's goal is met");
    setText('#stat-today', quota.total);
    setText('#stat-quota', `${quota.percent}%`);
    $('#quota-bar').style.width = `${quota.percent}%`;
    $('#quota-components').replaceChildren(...(Object.keys(quota.byComponent).length
        ? Object.entries(quota.byComponent).map(([name, units]) => el('span', { class: 'pill is-soft no-dot', text: `${name}: ${units}` }))
        : [el('span', { class: 'muted', text: 'Nothing collected yet today.' })]));
}

async function loadRequests() {
    const { requests } = await api('request.php', { query: { status: 'open' } });
    const urgent = requests.filter((r) => r.urgency !== 'normal').length;
    setText('#stat-requests', requests.length);
    setText('#stat-urgent', urgent);
    const navCount = $('#nav-open-requests');
    if (navCount) navCount.textContent = requests.length || '';
    $('#requests-feed').replaceChildren(...(requests.length
        ? requests.slice(0, 4).map(requestRow)
        : [el('li', { class: 'empty', text: 'No open requests.' })]));

    const top = requests[0]; // the API sorts by urgency, then deadline
    if (!top) return;
    setText('#priority-title', `${top.blood_type_code} • ${top.ward}`);
    try {
        const reach = await api('alerts.php', { query: { action: 'reach', blood_type_id: top.blood_type_id, radius_km: 15 } });
            setText('#priority-reach', `${reach.count} eligible ${top.blood_type_code} donors within 15 km of ${reach.center_name}.`);
    } catch (error) {
        setText('#priority-reach', error.offline ? 'Donor reach needs a connection.' : error.message);
    }
}

async function loadDrives() {
    const { drives } = await api('drives.php');
    const upcoming = drives.filter((d) => d.status === 'scheduled' || d.status === 'ongoing');
    $('#drives-list').replaceChildren(...(upcoming.length
        ? upcoming.map(driveRow)
        : [el('li', { class: 'empty', text: 'No upcoming drives are partnered with your bank.' })]));
}

setText('#today-label', new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }));
api('profile.php').then((profile) => setText('#nav-org-title', profile.org_name)).catch(() => {});
for (const load of [loadQuota, loadRequests, loadDrives]) {
    load().catch((error) => console.warn('[bank dashboard]', error.message));
}
