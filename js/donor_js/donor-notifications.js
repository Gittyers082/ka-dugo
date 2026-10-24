/* DONOR NOTIFICATIONS - LIVE MYSQL ALERT RECIPIENTS */
(async () => {
    const api = window.KaDonor, $ = selector => document.querySelector(selector);
    const list = $('#donor-notification-list');
    const overlay = $('#notice-overlay');
    const all = $('#show-all-alerts'), unread = $('#show-unread-alerts');
    let alerts = [], filter = 'all', previousFocus = null;
    function render() {
        const unreadCount = alerts.filter(a => !Number(a.is_read)).length;
        $('#unread-summary').textContent = `${unreadCount} unread`;
        $('#unread-tab-count').textContent = String(unreadCount);
        $('#mark-all-alerts-read').disabled = unreadCount === 0;
        all.classList.toggle('active', filter === 'all');
        unread.classList.toggle('active', filter === 'unread');
        all.setAttribute('aria-selected', String(filter === 'all'));
        unread.setAttribute('aria-selected', String(filter === 'unread'));
        const visible = alerts.filter(a => filter === 'all' || !Number(a.is_read));
        list.innerHTML = visible.map(a => {
            const sender = a.sender_name || 'Ka-dugo';
            const title = a.drive_id ? 'Blood drive update' : a.request_id ? 'Blood request' : 'Blood donation alert';
            const type = a.sender_type === 'organizer' ? 'ORGANIZER ALERT' : a.sender_type === 'bank' ? 'BLOOD BANK ALERT' : 'SYSTEM ALERT';
            return `<article class="notification-card ${Number(a.is_read) ? '' : 'unread'}" data-alert-id="${Number(a.alert_id)}">` +
                `<div class="notice-indicator" aria-hidden="true">` +
                `</div><div class="notice-content">` +
                `<div class="notice-meta">` +
                `<span class="notice-kind">${type}` +
                `</span><time>${api.safe(a.sent_at || 'Date unavailable')}` +
                `</time></div><h2>${api.safe(title)}` +
                `</h2><p class="notice-sender">${api.safe(sender)} · ${api.safe(a.blood_type_code)}` +
                `</p><p class="notice-excerpt">${api.safe(a.message)}` +
                `</p><button type="button" class="notice-open" data-id="${Number(a.alert_id)}">${Number(a.is_read) ? 'View' : 'Read'} notification →` +
                `</button></div></article>`;
        }).join('');
        $('#notifications-empty').hidden = visible.length !== 0;
        $('#notification-load-status')?.remove();
        list.querySelectorAll('.notice-open').forEach(button => button.addEventListener('click', () => openNotice(Number(button.dataset.id))));
    }
    async function openNotice(id) {
        const item = alerts.find(a => Number(a.alert_id) === id);
        if (!item)
            return;
        previousFocus = document.activeElement;
        $('#notice-detail-kind').textContent = item.sender_type === 'bank'
            ? 'BLOOD BANK ALERT'
            : item.sender_type === 'organizer' ? 'ORGANIZER ALERT' : 'SYSTEM ALERT';
        $('#notice-detail-title').textContent = item.drive_id
            ? 'Blood drive update'
            : item.request_id ? 'Blood request' : 'Blood donation alert';
        $('#notice-detail-sender').textContent = `${item.sender_name} · ${item.blood_type_code}`;
        $('#notice-detail-message').textContent = item.message;
        overlay.hidden = false;
        document.body.classList.add('qr-is-open');
        $('#notice-close').focus();
        if (!Number(item.is_read)) {
            try {
                await api.request('read_alert', { alert_id: id });
                item.is_read = 1;
                render();
            }
            catch (error) {
                console.error('Could not mark notification read:', error.message);
            }
        }
    }
    function closeNotice() {
        if (overlay.hidden)
            return;
        overlay.hidden = true;
        document.body.classList.remove('qr-is-open');
        (previousFocus?.isConnected ? previousFocus : all).focus();
    }
    all.addEventListener('click', () => { filter = 'all'; render(); });
    unread.addEventListener('click', () => { filter = 'unread'; render(); });
    $('#empty-show-all')?.addEventListener('click', () => { filter = 'all'; render(); });
    $('#notice-close').addEventListener('click', closeNotice);
    $('#notice-done').addEventListener('click', closeNotice);
    overlay.addEventListener('click', event => { if (event.target === overlay)
        closeNotice(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape')
        closeNotice(); });
    $('#mark-all-alerts-read').addEventListener('click', async () => {
        try {
            await api.request('read_all', {});
            alerts.forEach(a => a.is_read = 1);
            render();
        }
        catch (error) {
            api.displayError(error.message, list);
        }
    });
    try {
        const response = await api.request('notifications');
        alerts = response.alerts || [];
        render();
    }
    catch (error) {
        api.displayError(error.message, list);
    }
})();
