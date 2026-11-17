// Admin oversight: totals and per-bank / per-organizer summaries (api/admin.php), plus every
// donation across all banks with server-side search, filter and sort (api/donations.php).
import { api } from '../api.js';
import { el, $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDateTime } from '../ui/format.js';

const filters = $('#filters');
const STATUS_PILL = { collected: 'is-warn', tested: 'is-info', processed: 'is-soft', transfused: 'is-ok', discarded: 'is-muted' };
const sort = { column: 'collected_at', dir: 'desc' };

const td = (text, num = false) => el('td', { class: num ? 'num' : false, text });

async function loadSummary() {
    const summary = await api('admin.php', { query: { view: 'summary' } });
    const donations = summary.by_status.reduce((sum, row) => sum + Number(row.donations), 0);
    const units = summary.by_status.filter((row) => row.status !== 'discarded').reduce((sum, row) => sum + Number(row.units), 0);
    setText('#tile-donations', donations);
    setText('#tile-units', units);
    setText('#tile-today', summary.banks.reduce((sum, b) => sum + Number(b.today), 0));
    setText('#tile-requests', summary.banks.reduce((sum, b) => sum + Number(b.open_requests), 0));

    $('#bank-rows').replaceChildren(...summary.banks.map((b) => el('tr', {},
        td(b.name), td(b.today, true), td(b.daily_quota_units, true), td(b.donations, true),
        td(Number(b.units), true), td(b.open_requests, true), td(b.phlebotomists, true))));
    $('#organizer-rows').replaceChildren(...summary.organizers.map((o) => el('tr', {},
        td(o.org_name), td(o.drives, true), td(o.upcoming, true), td(o.registrations, true), td(o.alerts, true))));

    filters.elements.bank_id.append(...summary.banks.map((b) => new Option(b.name, b.bank_id)));
}

async function loadDonations() {
    const form = new FormData(filters);
    try {
        const data = await api('donations.php', { query: { ...Object.fromEntries(form), sort: sort.column, dir: sort.dir } });
        setText('#donation-count', `${data.count} donation(s)${data.fromCache ? ' • offline copy' : ''}`);
        $('#donation-rows').replaceChildren(...(data.count
            ? data.donations.map((d) => el('tr', {},
                td(formatDateTime(d.collected_at)), td(d.full_name), td(d.blood_type_code), td(d.component_name),
                td(Number(d.units), true), td(d.bank_name), td(d.phlebotomist_name || '—'),
                el('td', {}, el('span', { class: `pill ${STATUS_PILL[d.status] || ''}`, text: d.status }))))
            : [el('tr', {}, el('td', { colspan: 8, class: 'muted', text: 'No donations match these filters.' }))]));
    } catch (error) {
        showToast(error.message, true);
    }
}

// Clicking a sortable header sorts by it; clicking again flips the direction.
document.querySelectorAll('#donation-table th[data-sort] button').forEach((button) => {
    button.addEventListener('click', () => {
        const th = button.closest('th');
        sort.dir = sort.column === th.dataset.sort && sort.dir === 'desc' ? 'asc' : 'desc';
        sort.column = th.dataset.sort;
        document.querySelectorAll('#donation-table th[data-sort]').forEach((header) => header.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
        loadDonations();
    });
});

let searchTimer;
filters.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadDonations, 300);
});
filters.addEventListener('submit', (event) => event.preventDefault());

loadSummary().catch((error) => showToast(error.message, true));
loadDonations();
