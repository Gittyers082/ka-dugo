document.addEventListener('DOMContentLoaded', () => {
    const organizerId = Number(localStorage.getItem('kadugo_active_user')) || 1;
    const form = document.getElementById('drive-form');
    const list = document.getElementById('drive-list');
    const slotsValue = document.getElementById('slots-value');
    const dialog = document.getElementById('slot-dialog');
    const slotList = document.getElementById('slot-list');
    let selectedDrive = null;

    const setSlotTotal = (value) => { slotsValue.textContent = Math.max(4, Math.min(2000, Number(value) || 4)); };
    const formatDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

    const today=new Date();
    document.getElementById('drive-date').min = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    document.getElementById('plus').addEventListener('click', () => setSlotTotal(Number(slotsValue.textContent) + 4));
    document.getElementById('minus').addEventListener('click', () => setSlotTotal(Number(slotsValue.textContent) - 4));
    document.getElementById('view-drives').addEventListener('click', () => document.getElementById('scheduled').scrollIntoView({ behavior: 'smooth' }));
    document.getElementById('schedule-tab').addEventListener('click', () => document.getElementById('scheduler').scrollIntoView({ behavior: 'smooth' }));
    document.getElementById('reload').addEventListener('click', loadDrives);

    document.getElementById('location').addEventListener('click', () => {
        const status = document.getElementById('gps-status');
        if (!navigator.geolocation) { status.textContent = 'GPS unavailable'; return; }
        status.textContent = 'Locating...';
        navigator.geolocation.getCurrentPosition((position) => {
            document.getElementById('latitude').value = position.coords.latitude.toFixed(6);
            document.getElementById('longitude').value = position.coords.longitude.toFixed(6);
            status.textContent = 'Location captured';
        }, () => { status.textContent = 'Location permission needed'; }, { enableHighAccuracy: true, timeout: 10000 });
    });

    async function loadDrives() {
        list.innerHTML = '<p class="empty">Loading scheduled drives...</p>';
        try {
            const response = await fetch(`../../api/drives.php?organizer_id=${organizerId}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Unable to load drives.');
            const drives = result.data.drives || [];
            document.getElementById('managed-count').textContent = drives.length;
            document.getElementById('drive-total').textContent = drives.length;
            document.getElementById('active-count').textContent = drives.filter((drive) => ['scheduled', 'ongoing'].includes(drive.status)).length;
            document.getElementById('registration-count').textContent = drives.reduce((sum, drive) => sum + Number(drive.registered_count || 0), 0);
            renderDrives(drives);
        } catch (error) {
            console.error('Drive fetch failed:', error);
            list.innerHTML = `<p class="empty">${escapeHtml(error.message)} Refresh and try again.</p>`;
        }
    }
    function renderDrives(drives) {
        if (!drives.length) { list.innerHTML = '<p class="empty">No scheduled drives yet. Create your first drive above.</p>'; return; }
        list.innerHTML = drives.map((drive) => {
            const capacity = Number(drive.slots_total) || 1;
            const registered = Number(drive.registered_count) || 0;
            const progress = Math.min(100, Math.round((registered / capacity) * 100));
            return `<article class="drive-item"><div class="top"><span class="status ${drive.status === 'cancelled' ? 'cancelled' : ''}">${escapeHtml(drive.status).toUpperCase()}</span><small>${escapeHtml(drive.ref_code)}</small></div><h3>${escapeHtml(drive.title)}</h3><div class="meta"><span>📅 ${formatDate(drive.drive_date)}</span><span>📍 ${escapeHtml(drive.venue)}</span><span>⏱ ${String(drive.start_time).slice(0, 5)} - ${String(drive.end_time).slice(0, 5)}</span></div><div class="progress-label"><span>${registered} donor${registered === 1 ? '' : 's'} registered</span><span>${capacity} total capacity</span></div><div class="progress"><i style="width:${progress}%"></i></div><div class="drive-actions"><button type="button" class="manage-slots" ${['scheduled','ongoing'].includes(drive.status) ? '' : 'disabled'} data-id="${drive.drive_id}">Manage slots</button>${['scheduled','ongoing'].includes(drive.status) ? `<button type="button" class="cancel" data-id="${drive.drive_id}">Cancel drive</button>` : ''}</div></article>`;
        }).join('');
        list.querySelectorAll('.manage-slots').forEach((button) => button.addEventListener('click', () => openSlotManager(drives.find((drive) => Number(drive.drive_id) === Number(button.dataset.id)))));
        list.querySelectorAll('.cancel').forEach((button) => button.addEventListener('click', () => cancelDrive(button.dataset.id)));
    }
    function addSlotRow(slot) {
        if(!slot){const used=new Set([...slotList.querySelectorAll('.slot-time')].map(el=>el.value));let [h,m]=selectedDrive.start_time.split(':').map(Number);const [eh,em]=selectedDrive.end_time.split(':').map(Number);let time='';for(let n=h*60+m;n<eh*60+em;n+=30){const candidate=`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;if(!used.has(candidate)){time=candidate;break;}}if(!time){alert('No unused 30-minute start time remains. Edit an existing row.');return;}slot={slot_time:time,capacity:4,booked_count:0};}
        const row = document.createElement('div');
        row.className = 'slot-row';
        row.dataset.slotId = slot.slot_id || '';
        row.innerHTML = `<label>Time<input class="slot-time" type="time" ${Number(slot.booked_count) ? 'disabled title="Booked slot times are fixed"' : ''} value="${String(slot.slot_time).slice(0, 5)}" required></label><label>Capacity<input class="slot-capacity" type="number" min="1" max="200" value="${Number(slot.capacity) || 1}" required></label><span class="slot-booking">${Number(slot.booked_count) || 0} booked</span><button type="button" class="slot-remove" ${Number(slot.booked_count) ? 'disabled title="Booked slots cannot be removed"' : ''}>Remove</button>`;
        row.querySelector('.slot-remove').addEventListener('click', () => row.remove());
        slotList.appendChild(row);
    }
    function openSlotManager(drive) {
        selectedDrive = drive;
        document.getElementById('slot-dialog-title').textContent = `Manage slots: ${drive.title}`;
        document.getElementById('slot-dialog-subtitle').textContent = `${formatDate(drive.drive_date)} · ${drive.ref_code}`;
        slotList.innerHTML = '';
        (drive.slots || []).forEach(addSlotRow);
        if (!drive.slots?.length) addSlotRow();
        dialog.showModal();
    }
    document.getElementById('add-slot').addEventListener('click', () => addSlotRow());
    document.getElementById('save-slots').addEventListener('click', async (event) => {
        if (!selectedDrive || !dialog.querySelector('form').reportValidity()) return;
        const slots = [...slotList.querySelectorAll('.slot-row')].map((row) => ({
            slot_id: row.dataset.slotId || undefined,
            slot_time: `${row.querySelector('.slot-time').value}:00`,
            capacity: Number(row.querySelector('.slot-capacity').value)
        }));
        if (!slots.length || slots.some((slot) => !slot.slot_time || slot.capacity < 1)) return;
        const button = event.currentTarget;
        button.disabled = true; button.textContent = 'Saving...';
        try {
            const response = await fetch('../../api/drives.php', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drive_id: selectedDrive.drive_id, slots }) });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Unable to save slots.');
            dialog.close();
            await loadDrives();
        } catch (error) { alert(error.message); } finally { button.disabled = false; button.textContent = 'Save slot changes'; }
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if(!form.reportValidity())return;
        if(document.getElementById('end-time').value<=document.getElementById('start-time').value){alert('End time must be after start time.');return;}
        const submit = form.querySelector('.publish');
        const payload = { organizer_id: organizerId, title: document.getElementById('title').value.trim(), venue: document.getElementById('venue').value.trim(), drive_date: document.getElementById('drive-date').value, start_time: document.getElementById('start-time').value, end_time: document.getElementById('end-time').value, category: document.getElementById('category').value, slots_total: Number(slotsValue.textContent) };
        submit.disabled = true; submit.textContent = 'Publishing...';
        try {
            const response = await fetch('../../api/drives.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Unable to publish drive.');
            form.reset(); setSlotTotal(60); await loadDrives(); document.getElementById('scheduled').scrollIntoView({ behavior: 'smooth' });
        } catch (error) { alert(error.message); } finally { submit.disabled = false; submit.innerHTML = 'Publish &amp; Open Donor Registration'; }
    });
    async function cancelDrive(driveId) {
        if (!confirm('Cancel this drive? It will no longer accept new registrations.')) return;
        const response = await fetch('../../api/drives.php', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drive_id: driveId }) });
        const result = await response.json();
        if (!response.ok || !result.success) return alert(result.message || 'Unable to cancel drive.');
        loadDrives();
    }
    loadDrives();
});
