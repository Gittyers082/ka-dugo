/* DONOR DASHBOARD - LIVE MYSQL DATA */
(() => {
    const $ = selector => document.querySelector(selector);
    const app = window.KaDonor;
    const qrDialog = $('#donor-qr-dialog');
    let previousFocus = null;
    function setText(selector, text) { const element = $(selector); if (element)
        element.textContent = text; }
    function renderProfile(data) {
        const name = String(data.full_name);
        setText(
            '.welcome-heading',
            `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${app.first(name)} ♥`
        );

        setText('.donor-id', `ID: ${data.donor_id}`);
        const eligible = Boolean(data.eligibility?.is_eligible);
        setText('.status-label', eligible ? 'CLINICAL STATUS: ELIGIBLE' : 'CLINICAL STATUS: DEFERRED');
        setText('.eligibility-card .status-badge', eligible ? 'Eligible' : 'Not eligible');
        setText('.eligibility-card h2', eligible ? 'Eligible to Donate Today' : 'Currently Not Eligible to Donate');
        setText(
            '.eligibility-explanation',
            eligible
                ? 'You meet the eligibility checks recorded in the system. Final screening is performed by the blood bank.'
                : (data.eligibility?.reasons?.join(' ') || 'Please contact the blood bank for guidance.')
        );

        const details = document.querySelectorAll('.eligibility-details .detail-item');

        if (details[0]) {
            details[0].querySelector('strong').textContent = app.formatDate(data.last_donation_date);
            details[0].querySelector('.detail-note').textContent = data.last_donation_date ? 'From donor record' : 'No past donation';
        }

        if (details[1]) {
            details[1].querySelector('strong').textContent = `${Number(data.weight_kg).toFixed(1)} kg`;
            details[1].querySelector('.detail-note').textContent = 'Recorded weight';
        }

        if (details[2]) {
            details[2].querySelector('strong').textContent = `${data.eligibility?.age ?? '—'} years`;
            details[2].querySelector('.detail-note').textContent = 'Age from birthdate';
        }

        setText('.blood-type-summary strong', data.blood_type_code);
        setText('.blood-type-summary span', `Type ${data.blood_type_code}`);
        setText('.donation-counts > div:first-child strong', String(data.total_units));
        setText('.donation-counts > div:last-child strong', String(data.history_count));
        setText('.admission-identification', `${name} · Donor #${data.donor_id}`);
        setText('.admission-summary', 'Present your digital QR at donor check-in');
        const qr = data.qr_code;
        if (qr && window.KaDonorQr) {
            const svg = window.KaDonorQr(qr);
            const small = $('#show-donor-qr');
            const large = $('.donor-qr-image');
            if (small) {
                small.innerHTML = svg;
                small.disabled = false;
                small.setAttribute('aria-label', 'Enlarge your donor QR code');
            }
            if (large)
                large.innerHTML = svg;
            setText('.donor-qr-note', `Donor #${data.donor_id} · ${name}`);
        }
        else {
            setText('.donor-qr-note', 'QR unavailable. Ask staff to look up your account.');
            $('#show-donor-qr').disabled = true;
        }
        const dot = $('.notification-dot');
        if (dot)
            dot.hidden = !Number(data.unread_count);
    }
    function renderRequest(data) {
        const card = $('.matching-request-card');
        if (!card)
            return;
        const request = (data.matching_requests || [])[0];
        if (!request) {
            card.innerHTML = '<p class="request-eyebrow">MATCHING BLOOD REQUESTS' +
                '</p><h2>No matching active requests' +
                '</h2><p class="request-location">Only open requests with future deadlines appear here. Expired requests are shown in Notifications.' +
                '</p>';
            return;
        }
        const urgency = String(request.urgency || 'normal').toUpperCase();
        card.innerHTML = `<div class="card-header request-heading">` +
            `<p class="request-eyebrow">MATCHING BLOOD REQUESTS` +
            `</p><span class="blood-match-badge">${app.safe(request.blood_type_code)} REQUIRED` +
            `</span></div><h2>${app.safe(request.ward)} ` +
            `<span class="priority-badge">${app.safe(urgency)}` +
            `</span></h2><p class="request-location">${app.safe(request.bank_name)}` +
            `</p><div class="request-details">` +
            `<div class="request-blood-type">${app.safe(request.blood_type_code)}` +
            `</div><div><strong>${Number(request.units_needed)} units requested` +
            `</strong><p>${app.safe(request.component_name)} · Needed by ${app.safe(app.formatDate(request.needed_by))}` +
            `</p></div></div><p class="request-notice">Please contact the blood bank to confirm availability and donation steps. Booking a drive is not a response to this request.` +
            `</p><div class="request-actions">` +
            `<button type="button" class="respond-button" id="respond-to-request">View Matching Requests →` +
            `</button></div>`;
        $('#respond-to-request')?.addEventListener('click', () => window.location.href = `drives-booking.html?view=requests&request=${encodeURIComponent(request.request_id)}`);
    }
    function renderBooking(data) {
        const section = $('.scheduled-drive-section');
        if (!section)
            return;
        const b = data.active_booking;
        if (!b) {
            section.innerHTML = '<h2>Your Scheduled Blood Drive' +
                '</h2><p class="empty-drive-results">You have no upcoming booked drive.' +
                '</p><a class="secondary-action" href="drives-booking.html">Browse Blood Drives →' +
                '</a>';
            return;
        }
        section.innerHTML = `<div class="card-header">` +
            `<h2>Your Scheduled Blood Drive` +
            `</h2><span class="status-badge slot-confirmed">Slot Confirmed` +
            `</span></div><article class="drive-card">` +
            `<div class="drive-date">` +
            `<span>${app.safe(app.formatDate(b.drive_date))}` +
            `</span></div><div class="drive-details">` +
            `<h3>${app.safe(b.title)}` +
            `</h3><p>${app.safe(b.org_name)} · ${app.safe(b.venue)}` +
            `</p><p><strong>${app.safe(app.formatTime(b.slot_time))}` +
            `</strong> · ${app.safe(b.component_name)}` +
            `</p><div class="drive-actions">` +
            `<button id="dashboard-reschedule" type="button">Reschedule` +
            `</button></div></div><aside class="arrival-reminder">` +
            `<h3>Before you arrive</h3>` +
            `<p>Bring a valid ID and your Digital Donor QR. Final screening takes place at the center.` +
            `</p></aside></article>`;
        $('#dashboard-reschedule')?.addEventListener('click', () => window.location.href = `drives-booking.html?view=bookings&action=reschedule&registration=${encodeURIComponent(b.registration_id)}`);
    }
    /* DONOR DASHBOARD NOTIFICATIONS */
    // Overview only counts dispatched alerts; include unread live database items.
    async function refreshNotificationBadge() {
        try {
            const feed = await app.loadNotices();
            const dot = $('.notification-dot');
            if (dot) dot.hidden = feed.unreadCount === 0;
        } catch (error) {
            // Keep the overview's DB alert count if the notification feed fails.
            console.warn('Could not refresh donor notifications:', error.message);
        }
    }

    // Refresh bank requests and organizer bookings from the server when dashboard is viewed.
    function refreshDashboard() {
        return app.request('overview').then(data => {
            renderProfile(data);
            renderRequest(data);
            renderBooking(data);
            return refreshNotificationBadge();
        }).catch(error => {
            setText('.welcome-heading', 'Donor Dashboard');
            app.displayError(error.message, $('.eligibility-explanation'));
            setText('.matching-request-card h2', 'Unable to load requests');
            setText('#dashboard-booking-placeholder', 'Unable to load your bookings');
        });
    }
    refreshDashboard();
    window.addEventListener('pageshow', event => {
        if (event.persisted) refreshDashboard();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshDashboard();
    });
    setInterval(() => { if (!document.hidden) refreshDashboard(); }, 60000);
    function openQr() {
        if (!qrDialog || qrDialog.open || !window.KaDonorQr)
            return;
        previousFocus = document.activeElement;
        qrDialog.showModal();
        $('#close-donor-qr')?.focus();
    }
    $('#show-donor-qr')?.addEventListener('click', openQr);
    $('#close-donor-qr')?.addEventListener('click', () => qrDialog?.close());
    qrDialog?.addEventListener('click', event => {
        const rect = qrDialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
            qrDialog.close();
    });
    qrDialog?.addEventListener('close', () => previousFocus?.focus?.());
    if (window.location.hash === '#donor-qr')
        app.profile().then(openQr).catch(() => { });
})();
