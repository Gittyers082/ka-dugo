// Admin accounts: list every account (filter by role, search, sort) and activate / deactivate it.
// A deactivated account is signed out by the server on its next request.
import { api } from '../api.js';
import { el, $ } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDateTime } from '../ui/format.js';

const ROLE_LABEL = { donor: 'Donor', bank: 'Blood bank', phlebotomist: 'Phlebotomist', organizer: 'Organizer', admin: 'Admin' };
const filters = $('#filters');
let myAccountId = 0;

function row(account) {
    const active = Number(account.is_active) === 1;
    const isMe = Number(account.account_id) === myAccountId;
    return el('tr', {},
        el('td', {}, el('strong', { text: account.display_name }),
            account.bank_name ? el('span', { class: 'muted', text: ` • ${account.bank_name}` }) : null),
        el('td', { text: account.email }),
        el('td', { text: ROLE_LABEL[account.role] }),
        el('td', { text: account.last_login ? formatDateTime(account.last_login) : 'Never' }),
        el('td', {}, el('span', { class: `pill ${active ? 'is-ok' : 'is-soft'}`, text: active ? 'Active' : 'Inactive' })),
        el('td', {}, el('button', {
            type: 'button',
            class: `btn btn-sm ${active ? 'btn-danger' : 'btn-primary'}`,
            text: active ? 'Deactivate' : 'Activate',
            disabled: isMe,
            title: isMe ? 'You cannot deactivate your own account' : false,
            onclick: () => toggle(account, active ? 0 : 1),
        })));
}

async function loadAccounts() {
    const form = new FormData(filters);
    const [sort, dir] = String(form.get('sort')).split(':');
    try {
        const { accounts } = await api('admin.php', { query: { view: 'accounts', search: form.get('search'), role: form.get('role'), sort, dir } });
        $('#account-rows').replaceChildren(...(accounts.length
            ? accounts.map(row)
            : [el('tr', {}, el('td', { colspan: 6, class: 'muted', text: 'No accounts match.' }))]));
    } catch (error) {
        showToast(error.message, true);
    }
}

async function loadRoleTiles() {
    const { accounts } = await api('admin.php', { query: { view: 'summary' } });
    $('#role-tiles').replaceChildren(...accounts.map((a) => el('div', { class: 'stat' },
        el('span', { class: 'stat-label', text: ROLE_LABEL[a.role] }),
        el('span', { class: 'stat-value', text: a.active }),
        el('span', { class: 'stat-meta', text: `active of ${a.total}` }))));
}

async function toggle(account, isActive) {
    const verb = isActive ? 'Activate' : 'Deactivate';
    if (!confirm(`${verb} ${account.display_name} (${account.email})?`)) return;
    try {
        await api('admin.php', { method: 'PUT', body: { account_id: account.account_id, is_active: isActive } });
        showToast(`${account.display_name} ${isActive ? 'activated' : 'deactivated'}.`);
        loadAccounts();
        loadRoleTiles();
    } catch (error) {
        showToast(error.message, true);
    }
}

let searchTimer;
filters.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadAccounts, 300);
});
filters.addEventListener('submit', (event) => event.preventDefault());

api('profile.php').then((me) => { myAccountId = Number(me.account_id); }).finally(loadAccounts);
loadRoleTiles().catch((error) => showToast(error.message, true));
