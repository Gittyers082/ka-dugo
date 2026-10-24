/* DONOR DRIVE BOOKING - LIVE MYSQL REGISTRATIONS */
(async () => {
    const api = window.KaDonor, $ = selector => document.querySelector(selector);
    let me, drives = [], bookings = [], view = 'upcoming', openDrive = null, openBooking = null;
    const params = new URLSearchParams(location.search);
    const alertBox = $('#donor-page-status');
    function announce(message, bad = false) {
        alertBox.hidden = false;
        alertBox.textContent = message;
        alertBox.classList.toggle('donor-data-error', bad);
    }
    function dateTile(day) { const date = new Date(`${day}T12:00:00`); return `<div class="date-tile">` +
        `<span>${api.safe(date.toLocaleDateString('en-PH', { month: 'short' }).toUpperCase())}` +
        `</span><strong>${date.getDate()}` +
        `</strong></div>`; }
    function setView(tab) {
        view = tab;
        $('#tab-upcoming').classList.toggle('selected', tab === 'upcoming');
        $('#tab-bookings').classList.toggle('selected', tab === 'bookings');
        $('#tab-upcoming').setAttribute('aria-pressed', String(tab === 'upcoming'));
        $('#tab-bookings').setAttribute('aria-pressed', String(tab === 'bookings'));
        $('#upcoming-view').hidden = tab !== 'upcoming';
        $('#bookings-view').hidden = tab !== 'bookings';
    }
    async function load() {
        [me, ...[drives, bookings]] = await Promise.all([
            api.profile(),
            api.request('drives'),
            api.request('bookings')
        ]).then(([p, d, b]) => [p, d.drives || [], b.bookings || []]);
        render();
    }
    function render() {
        $('#drive-empty').hidden = drives.length > 0;
        $('#drive-list').innerHTML = drives.map(d => {
            const already = bookings.some(b => b.drive_id == d.drive_id && ['booked', 'checked_in', 'completed'].includes(b.status));
            const expanded = openDrive === Number(d.drive_id);
            const availableSlots = (d.slots || []).filter(slot => Number(slot.booked_count) < Number(slot.capacity));
            return `<article class="donor-drive-card">` +
                `<div class="donor-drive-heading">${dateTile(d.drive_date)}` +
                `<div><p class="panel-eyebrow">${api.safe(d.category)} · ${api.safe(d.ref_code)}` +
                `</p><h3>${api.safe(d.title)}` +
                `</h3><p>${api.safe(d.org_name)} · ${api.safe(d.venue)}` +
                `</p><p>${api.safe(api.formatTime(d.start_time))}–${api.safe(api.formatTime(d.end_time))} · ${api.safe(d.slots_available)} overall slots remaining` +
                `</p>${(d.target_blood_types || []).length ? `<p>Target blood types: ${(d.target_blood_types || []).map(bt => api.safe(bt.code)).join(', ')}</p>` : ''}` +
                `</div><span class="donor-badge">${api.safe(d.status)}` +
                `</span></div><button type="button" class="secondary-action toggle-drive" data-id="${Number(d.drive_id)}" aria-expanded="${expanded}" ${already ? 'disabled' : ''}>${already ? 'Already registered' : expanded ? 'Hide Slots' : 'View Details & Slots'}` +
                `</button>${expanded && !already ? `<form class="donor-slot-form" data-drive="${Number(d.drive_id)}">` +
                `<p>Choose an available time slot. All times come from the database.` +
                `</p><div class="donor-slot-grid">${(d.slots || []).map(slot => `<label class="donor-slot-choice">` +
                `<input type="radio" name="slot_id" value="${Number(slot.slot_id)}" ${Number(slot.booked_count) >= Number(slot.capacity) ? 'disabled' : ''} required>` +
                `<span>${api.safe(api.formatTime(slot.slot_time))} · ${Math.max(0, Number(slot.capacity) - Number(slot.booked_count))} left` +
                `</span></label>`).join('')}` +
                `</div><button class="book-button" type="submit" ${!availableSlots.length || !me.eligibility?.is_eligible ? 'disabled' : ''}>Book Selected Slot` +
                `</button>${!me.eligibility?.is_eligible ? '<p class="donor-warning">Your profile is currently deferred. You cannot book until eligible.</p>' : ''}` +
                `</form>` : ''}` +
                `</article>`;
        }).join('');
        $('#booking-empty').hidden = bookings.length > 0;
        $('#booking-list').innerHTML = bookings.map(b => {
            const editable = b.status === 'booked' && b.drive_date >= `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
            return `<article class="donor-drive-card">` +
                `<div class="donor-drive-heading">${dateTile(b.drive_date)}` +
                `<div><p class="panel-eyebrow">${api.safe(b.ref_code)} · ${api.safe(b.status)}` +
                `</p><h3>${api.safe(b.title)}` +
                `</h3><p>${api.safe(b.org_name)} · ${api.safe(b.venue)}` +
                `</p><p>${api.safe(api.formatTime(b.slot_time))} · ${api.safe(b.component_name)}` +
                `</p></div></div>${editable ? `<div class="donor-booking-actions">` +
                `<button class="secondary-action change-booking" data-id="${Number(b.registration_id)}" type="button">Reschedule` +
                `</button><button class="secondary-action cancel-booking" data-id="${Number(b.registration_id)}" type="button">Cancel booking` +
                `</button></div>${openBooking === Number(b.registration_id) ? `<div class="donor-reschedule-panel" data-id="${Number(b.registration_id)}">` +
                `<p>Select an available slot for this drive:` +
                `</p><div class="donor-slot-grid" id="reschedule-slots-${Number(b.registration_id)}">Loading time slots...` +
                `</div></div>` : ''}` : ''}` +
                `</article>`;
        }).join('');
        wire();
    }
    function wire() {
        document.querySelectorAll('.toggle-drive').forEach(btn => btn.addEventListener('click', () => {
            openDrive = openDrive === Number(btn.dataset.id) ? null : Number(btn.dataset.id);
            render();
        }));
        document.querySelectorAll('.donor-slot-form').forEach(form => form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const slot = form.querySelector('input[name="slot_id"]:checked');
            if (!slot) {
                announce('Choose a slot first.', true);
                return;
            }
            const button = form.querySelector('button[type=submit]');
            button.disabled = true;
            try {
                await api.request('book', { drive_id: Number(form.dataset.drive), slot_id: Number(slot.value) });
                openDrive = null;
                await load();
                setView('bookings');
                announce('Your drive registration was saved to MySQL.');
            }
            catch (e) {
                announce(e.message, true);
                button.disabled = false;
            }
        }));
        document.querySelectorAll('.cancel-booking').forEach(btn => btn.addEventListener('click', async () => {
            if (!confirm('Cancel your blood drive registration?'))
                return;
            try {
                await api.request('cancel_booking', { registration_id: Number(btn.dataset.id) });
                await load();
                announce('Your booking was cancelled in MySQL.');
            }
            catch (e) {
                announce(e.message, true);
            }
        }));
        document.querySelectorAll('.change-booking').forEach(btn => btn.addEventListener('click', async () => {
            openBooking = openBooking === Number(btn.dataset.id) ? null : Number(btn.dataset.id);
            render();
            if (openBooking)
                await loadRescheduleSlots(openBooking);
        }));
    }
    async function loadRescheduleSlots(regId) {
        const reg = bookings.find(b => Number(b.registration_id) === regId);
        const holder = document.getElementById(`reschedule-slots-${regId}`);
        if (!reg || !holder)
            return;
        try {
            const response = await api.request('drives');
            const drive = (response.drives || []).find(d => Number(d.drive_id) === Number(reg.drive_id));
            if (!drive) {
                holder.textContent = 'This drive is no longer open.';
                return;
            }
            holder.innerHTML = (drive.slots || []).map(slot => `<button type="button" class="donor-time-button" data-slot="${Number(slot.slot_id)}" ${Number(slot.booked_count) >= Number(slot.capacity) && Number(slot.slot_id) !== Number(reg.slot_id) ? 'disabled' : ''}>${api.safe(api.formatTime(slot.slot_time))}${Number(slot.slot_id) === Number(reg.slot_id) ? ' (current)' : ''}` +
                `</button>`).join('');
            holder.querySelectorAll('button').forEach(button => button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await api.request('reschedule', { registration_id: regId, slot_id: Number(button.dataset.slot) });
                    openBooking = null;
                    await load();
                    setView('bookings');
                    announce('Your booking was rescheduled in MySQL.');
                }
                catch (e) {
                    announce(e.message, true);
                    button.disabled = false;
                }
            }));
        }
        catch (e) {
            holder.textContent = e.message;
        }
    }
    $('#tab-upcoming').addEventListener('click', () => setView('upcoming'));
    $('#tab-bookings').addEventListener('click', () => setView('bookings'));
    try {
        await load();
        alertBox.hidden = true;
        setView(params.get('view') === 'bookings' ? 'bookings' : 'upcoming');
        if (params.get('action') === 'reschedule' && params.has('registration')) {
            const id = Number(params.get('registration'));
            if (bookings.some(b => Number(b.registration_id) === id && b.status === 'booked')) {
                openBooking = id;
                render();
                await loadRescheduleSlots(id);
            }
        }
    }
    catch (e) {
        announce(e.message, true);
    }
})();
