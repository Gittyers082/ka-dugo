/* DONOR API AND SHARED NAVIGATION */
(() => {
    const BASE = '../../api/donor_portal.php';
    let profileRequest;
    async function request(action, fields = null) {
        const url = `${BASE}?action=${encodeURIComponent(action)}`;
        let response;
        try {
            response = await fetch(url, fields === null ? {
                credentials: 'same-origin', cache: 'no-store'
            } : {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(fields)
            });
        }
        catch {
            throw new Error('Cannot reach the PHP server. Open Ka-dugo through WAMP (http://localhost/kadugo/) and check MySQL.');
        }
        let json;
        try {
            json = await response.json();
        }
        catch {
            throw new Error('The server did not return JSON. Check your PHP setup.');
        }
        if (response.status === 401 || response.status === 403) {
            window.location.replace('../../index.html');
            throw new Error('Please sign in with a donor account.');
        }
        if (!response.ok || !json.ok)
            throw new Error(json.error || 'The request could not be completed.');
        return json.data;
    }
    const first = (name) => String(name || 'Donor').trim().split(/\s+/)[0];
    const formatDate = (day) => {
        if (!day)
            return 'Not recorded';
        const date = new Date(`${String(day).slice(0, 10)}T12:00:00`);
        return Number.isNaN(date.getTime())
            ? String(day)
            : date.toLocaleDateString('en-PH', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
    };
    const formatTime = (time) => {
        if (!time)
            return '—';
        const [h, m] = String(time).split(':').map(Number);
        if (!Number.isFinite(h))
            return String(time);
        return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    };
    const safe = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
    const displayError = (message, parent) => {
        const target = parent || document.getElementById('donor-page-status');
        if (target) {
            target.hidden = false;
            target.textContent = message;
            target.classList.add('donor-data-error');
        }
    };
    /* DONOR NOTIFICATION FEED */
    // Dispatched alerts have database read receipts; live database items without
    // an alert use a browser-local per-donor read marker (no schema changes).
    const memoryReadMarkers = new Map();
    const readStorageKey = donorId => `kadugo:donor:${donorId}:live-notices-read`;

    function readMarkers(donorId) {
        const key = readStorageKey(donorId);
        try {
            const stored = JSON.parse(localStorage.getItem(key) || '{}');
            return stored && typeof stored === 'object' && !Array.isArray(stored)
                ? { ...stored, ...(memoryReadMarkers.get(key) || {}) }
                : (memoryReadMarkers.get(key) || {});
        }
        catch {
            return memoryReadMarkers.get(key) || {};
        }
    }

    function markLocalNoticesRead(donorId, keys) {
        const key = readStorageKey(donorId);
        const saved = readMarkers(donorId);
        const timestamp = Date.now();
        keys.filter(value => /^(?:(?:request|drive):\d+|expired_request:\d+:\d{14})$/.test(value)).forEach(value => {
            saved[value] = timestamp;
        });
        // Keep local storage bounded even when the donor sees many drives.
        const latest = Object.entries(saved).sort((a, b) => b[1] - a[1]).slice(0, 300);
        const bounded = Object.fromEntries(latest);
        memoryReadMarkers.set(key, bounded);
        try {
            localStorage.setItem(key, JSON.stringify(bounded));
        }
        catch {
            // Private browsing/storage restrictions: keep markers for this tab.
        }
    }

    function composeNotices(data) {
        const donorId = Number(data.donor_id) || 0;
        const seen = readMarkers(donorId);
        const alerts = Array.isArray(data.alerts) ? data.alerts : [];
        // An alert is not a bookable drive. Only allow Go when the drive is
        // currently listed by the donor's Drives & Booking endpoint.
        const browseableDrives = new Set((data.browseable_drive_ids || []).map(Number).filter(Number.isInteger));
        const linkedRequests = new Set(alerts.filter(a => a.request_id).map(a => Number(a.request_id)));
        const linkedDrives = new Set(alerts.filter(a => a.drive_id).map(a => Number(a.drive_id)));
        const items = [];

        // Show bank-created requests even if the bank has not sent an alert.
        for (const request of (data.matching_requests || [])) {
            const id = Number(request.request_id);
            if (!id || linkedRequests.has(id)) continue;
            const key = `request:${id}`;
            const level = String(request.urgency || 'normal').toUpperCase();
            items.push({
                key, kind: 'request', id, is_read: Boolean(seen[key]),
                type_label: `${level} MATCHING REQUEST`,
                title: `${request.blood_type_code || ''} blood requested`,
                sender: request.bank_name || 'Blood bank',
                detail: request.ward || '',
                date_label: 'Needed by', date_text: request.needed_by || '',
                message: `${request.bank_name || 'A blood bank'} needs ${Number(request.units_needed) || 0} unit(s) of ${request.component_name || 'blood'} for ${request.ward || 'a patient'}. Urgency: ${level}. Deadline: ${request.needed_by || 'not stated'}. Contact the bank to confirm if donations are still needed.`,
                link: null // Bank requests are not scheduled organizer drives.
            });
        }

        // Notify the donor once per request deadline when an open request expires.
        // Keep deadline in the key: a bank extension that later expires is new news.
        for (const request of (data.expired_requests || [])) {
            const id = Number(request.request_id);
            const deadline = String(request.needed_by || '');
            const deadlineKey = deadline.replace(/\D/g, '');
            if (!id || !/^\d{14}$/.test(deadlineKey)) continue;
            const key = `expired_request:${id}:${deadlineKey}`;
            items.push({
                key, kind: 'expiry', id, is_read: Boolean(seen[key]),
                type_label: 'REQUEST DEADLINE PASSED',
                title: `${request.blood_type_code || ''} request deadline passed`,
                sender: request.bank_name || 'Blood bank',
                detail: request.ward || '',
                date_label: 'Expired', date_text: deadline,
                message: `The deadline (${deadline}) for the ${request.blood_type_code || ''} blood request from ${request.bank_name || 'a blood bank'} has passed. It has been removed from your active matching requests. The bank has not yet marked it closed; contact the bank if you need confirmation.`,
                link: null
            });
        }

        // Only dispatched alerts matching this donor's registered blood type appear.
        for (const alert of alerts) {
            const id = Number(alert.alert_id);
            if (!id) continue;
            const expiredLink = Boolean(Number(alert.request_expired));
            items.push({
                key: `alert:${id}`, kind: 'alert', id,
                is_read: Boolean(Number(alert.is_read)),
                type_label: expiredLink ? 'PAST BLOOD REQUEST ALERT'
                    : alert.sender_type === 'bank' ? 'BLOOD BANK ALERT'
                    : alert.sender_type === 'organizer' ? 'ORGANIZER ALERT' : 'SYSTEM ALERT',
                title: expiredLink ? 'Blood request deadline passed'
                    : alert.drive_id ? 'Blood drive update'
                    : alert.request_id ? 'Blood request alert' : 'Blood donation alert',
                sender: [alert.sender_name || 'Ka-dugo', alert.blood_type_code].filter(Boolean).join(' · '),
                detail: '', date_label: 'Sent', date_text: alert.sent_at || '',
                message: expiredLink
                    ? `This request's deadline has passed. The bank should confirm whether it is still needed. Original alert: ${alert.message || ''}`
                    : (alert.message || ''),
                link: !expiredLink && browseableDrives.has(Number(alert.drive_id))
                    ? `drives-booking.html?view=upcoming&drive=${Number(alert.drive_id)}`
                    : null
            });
        }

        // Relevant organizer drives are visible without requiring a dispatch.
        for (const drive of (data.upcoming_drives || [])) {
            const id = Number(drive.drive_id);
            if (!id || linkedDrives.has(id)) continue;
            const key = `drive:${id}`;
            items.push({
                key, kind: 'drive', id, is_read: Boolean(seen[key]),
                type_label: 'UPCOMING BLOOD DRIVE',
                title: drive.title || 'Blood drive',
                sender: drive.organizer_name || 'Organizer',
                detail: drive.venue || '',
                date_label: 'Drive date', date_text: drive.drive_date || '',
                message: `${drive.title || 'A blood drive'} is scheduled for ${drive.drive_date || 'a future date'} at ${drive.venue || 'the announced venue'}. Organized by ${drive.organizer_name || 'the organizer'}. Visit Drives & Booking to see available time slots.`,
                link: browseableDrives.has(id)
                    ? `drives-booking.html?view=upcoming&drive=${id}`
                    : null
            });
        }

        return { donorId, items, unreadCount: items.filter(item => !item.is_read).length };
    }

    const loadNotices = async () => composeNotices(await request('notifications'));
    const profile = () => profileRequest ||= request('overview');
    window.KaDonor = {
        request, profile, first, formatDate, formatTime, safe, displayError,
        loadNotices, markLocalNoticesRead
    };
    document.querySelectorAll('.refresh-button').forEach(btn => btn.addEventListener('click', () => window.location.reload()));
    profile().then(data => {
        document.querySelectorAll('.donor-side-name').forEach(el => el.textContent = data.full_name);
        document.querySelectorAll('.nav-profile img').forEach(el => {
            el.alt = `${data.full_name} — account`;
            // The SQL's photo_path may point to a missing file; retain the existing placeholder.
        });
    }).catch(error => displayError(error.message));
})();
