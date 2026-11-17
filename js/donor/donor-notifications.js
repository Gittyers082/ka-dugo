// Donor notifications: dispatched alerts (server read receipts) plus live matching requests and
// drives (read markers kept on this device). Opening a notice marks it read.
import { request, loadNotices, markLocalNoticesRead } from './donor-common.js';
import { el, $ } from '../ui/dom.js';

const list = $('#donor-notification-list');
const overlay = $('#notice-overlay');
const all = $('#show-all-alerts');
const unread = $('#show-unread-alerts');
let notices = [];
let donorId = 0;
let filter = 'all';
let previousFocus = null;
let activeNotice = null;
let loading = false;

function feedback(message) {
    const target = $('#notification-feedback');
    if (target) {
        target.hidden = !message;
        target.textContent = message || '';
    }
}

function render() {
    const unreadCount = notices.filter(notice => !notice.is_read).length;
    $('#unread-summary').textContent = `${unreadCount} unread`;
    $('#unread-tab-count').textContent = String(unreadCount);
    $('#mark-all-alerts-read').disabled = unreadCount === 0;
    all.setAttribute('aria-pressed', String(filter === 'all'));
    unread.setAttribute('aria-pressed', String(filter === 'unread'));
    const navUnread = $('#nav-unread');
    if (navUnread) navUnread.textContent = unreadCount || '';

    const visible = notices.filter(n => filter === 'all' || !n.is_read);
    list.replaceChildren(...visible.map((n) => el('li', { class: `row notice${n.is_read ? '' : ' is-unread'}` },
        el('span', { class: 'notice-dot', 'aria-hidden': 'true' }),
        el('div', { class: 'row-main' },
            el('span', { text: `${n.type_label} • ${n.date_label}: ${n.date_text || 'not provided'}` }),
            el('strong', { text: n.title }),
            el('span', { text: [n.sender, n.detail].filter(Boolean).join(' • ') })),
        el('button', { type: 'button', class: `btn btn-sm ${n.is_read ? 'btn-ghost' : 'btn-primary'}`, text: n.is_read ? 'View' : 'Read',
            onclick: () => openNotice(n.key) }))));

    const empty = $('#notifications-empty');
    empty.hidden = visible.length !== 0;
    empty.querySelector('p').textContent = filter === 'unread'
        ? 'No unread notifications.'
        : 'No notifications yet. New matching requests and blood drives will appear here.';
    $('#empty-show-all').hidden = filter === 'all';
}

async function openNotice(key) {
    const item = notices.find(n => n.key === key);
    if (!item) return;
    activeNotice = item;
    $('#notice-go').hidden = !item.link || !['drive', 'alert'].includes(item.kind);
    previousFocus = document.activeElement;
    $('#notice-detail-kind').textContent = item.type_label;
    $('#notice-detail-title').textContent = item.title;
    $('#notice-detail-sender').textContent = item.sender;
    $('#notice-detail-message').textContent = item.message;
    overlay.hidden = false;
    document.body.classList.add('qr-is-open');
    $('#notice-close').focus();

    if (!item.is_read) {
        try {
            if (item.kind === 'alert') {
                await request('read_alert', { alert_id: item.id });
            } else {
                markLocalNoticesRead(donorId, [item.key]);
            }
            item.is_read = true;
            render();
            feedback('');
        } catch (error) {
            feedback(`Could not mark notification as read: ${error.message}`);
        }
    }
}

function closeNotice() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('qr-is-open');
    (previousFocus?.isConnected ? previousFocus : all).focus();
}

async function refresh() {
    if (loading) return;
    loading = true;
    $('#refresh-notifications').disabled = true;
    try {
        const response = await loadNotices();
        notices = response.items;
        donorId = response.donorId;
        render();
        feedback('');
    } catch (error) {
        // Preserve already displayed notifications if a later refresh fails.
        if (!notices.length) {
            list.replaceChildren();
            $('#notifications-empty').hidden = true;
        }
        feedback(`Could not load notifications: ${error.message}`);
    } finally {
        loading = false;
        $('#refresh-notifications').disabled = false;
    }
}

all.addEventListener('click', () => { filter = 'all'; render(); });
unread.addEventListener('click', () => { filter = 'unread'; render(); });
$('#empty-show-all').addEventListener('click', () => { filter = 'all'; render(); });
$('#notice-close').addEventListener('click', closeNotice);
$('#notice-done').addEventListener('click', closeNotice);
// Go is only for a real upcoming drive listed in Drives & Booking.
$('#notice-go').addEventListener('click', () => {
    if (activeNotice?.link && ['drive', 'alert'].includes(activeNotice.kind)) {
        window.location.assign(activeNotice.link);
    }
});
$('#refresh-notifications').addEventListener('click', refresh);
overlay.addEventListener('click', event => {
    if (event.target === overlay) closeNotice();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeNotice();
});
$('#mark-all-alerts-read').addEventListener('click', async () => {
    try {
        await request('read_all', {});
        markLocalNoticesRead(donorId, notices.filter(n => n.kind !== 'alert').map(n => n.key));
        notices.forEach(item => { item.is_read = true; });
        render();
        feedback('');
    } catch (error) {
        feedback(`Could not mark notifications as read: ${error.message}`);
    }
});

window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
});
window.addEventListener('storage', event => {
    if (event.key?.includes(':live-notices-read')) refresh();
});
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
refresh();
