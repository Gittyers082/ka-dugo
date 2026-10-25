document.addEventListener('DOMContentLoaded', () => {
    const driveForm = document.getElementById('drive-form');
    const driveList = document.getElementById('drive-list');
    const slotsValue = document.getElementById('slots-value');
    const btnPlus = document.getElementById('plus');
    const btnMinus = document.getElementById('minus');
    const managedCount = document.getElementById('managed-count');
    const driveTotal = document.getElementById('drive-total');

    // Summary Stat Elements
    const activeCountElem = document.getElementById('active-count');
    const registrationCountElem = document.getElementById('registration-count');
    const ORGANIZER_ID = localStorage.getItem('kadugo_active_user');

    // --- Capacity Calculator ---
    let currentSlots = parseInt(slotsValue.textContent) || 60;

    btnPlus.addEventListener('click', () => {
        currentSlots += 4; // Add 1 interval capacity
        slotsValue.textContent = currentSlots;
    });

    btnMinus.addEventListener('click', () => {
        if (currentSlots > 4) {
            currentSlots -= 4;
            slotsValue.textContent = currentSlots;
        }
    });

    // --- Fetch & Render Existing Drives ---
    async function fetchDrives() {
        try {
            const response = await fetch(`../../api/drives.php?organizer_id=${ORGANIZER_ID}`);
            const result = await response.json();

            if (result.success && result.data.drives.length > 0) {
                renderDrives(result.data.drives);

                // Update basic counts
                if (managedCount) managedCount.textContent = result.data.count;
                if (driveTotal) driveTotal.textContent = result.data.count;

                // Calculate and inject summary stats
                let activeDrives = 0;
                let totalDonors = 0;

                result.data.drives.forEach(drive => {
                    if (drive.status === 'scheduled' || drive.status === 'ongoing') {
                        activeDrives++;
                    }
                    totalDonors += parseInt(drive.registered_count || 0);
                });

                if (activeCountElem) activeCountElem.textContent = activeDrives;
                if (registrationCountElem) registrationCountElem.textContent = totalDonors;

            } else {
                driveList.innerHTML = '<p class="empty">No scheduled drives found.</p>';
                if (activeCountElem) activeCountElem.textContent = "0";
                if (registrationCountElem) registrationCountElem.textContent = "0";
            }
        } catch (error) {
            console.error("Failed to load drives:", error);
            driveList.innerHTML = '<p class="empty">Error loading network data.</p>';
        }
    }

    function renderDrives(drives) {
        driveList.innerHTML = '';

        drives.forEach(drive => {
            const capacity = drive.slots_total || 1;
            const registered = drive.registered_count || 0;
            const progressPct = Math.min(100, Math.round((registered / capacity) * 100));

            const dateObj = new Date(drive.drive_date);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            const card = document.createElement('div');
            card.className = 'drive-item';
            card.innerHTML = `
                <div class="top">
                    <span class="status ${drive.status === 'cancelled' ? 'cancelled' : ''}">${drive.status.toUpperCase()}</span>
                    <small style="color: var(--muted); font-weight:700;">${drive.ref_code}</small>
                </div>
                <h3>${drive.title}</h3>
                <div class="meta">
                    <span>📅 ${dateStr}</span>
                    <span>📍 ${drive.venue}</span>
                    <span>⏱ ${drive.start_time.substring(0, 5)} - ${drive.end_time.substring(0, 5)}</span>
                </div>
                <div class="progress-label">
                    <span>${registered} Donors Reg.</span>
                    <span>${drive.slots_total} Slots Total</span>
                </div>
                <div class="progress">
                    <i style="width: ${progressPct}%;"></i>
                </div>
                <div class="drive-actions">
                    <button type="button">Manage Slots</button>
                    ${drive.status !== 'cancelled' ? `<button type="button" class="cancel" data-id="${drive.drive_id}">Cancel</button>` : ''}
                </div>
            `;
            driveList.appendChild(card);
        });

        document.querySelectorAll('.cancel').forEach(btn => {
            btn.addEventListener('click', (e) => cancelDrive(e.target.getAttribute('data-id')));
        });
    }

    // --- Create New Drive ---
    if (driveForm) {
        driveForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = driveForm.querySelector('.publish');
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Publishing...';

            const payload = {
                organizer_id: ORGANIZER_ID,
                title: document.getElementById('title').value,
                venue: document.getElementById('venue').value,
                drive_date: document.getElementById('drive-date').value,
                start_time: document.getElementById('start-time').value,
                end_time: document.getElementById('end-time').value,
                category: document.getElementById('category').value,
                slots_total: parseInt(slotsValue.textContent)
            };

            try {
                const response = await fetch('../../api/drives.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (result.success) {
                    alert(`Drive published successfully! Reference Code: ${result.data.ref_code}`);
                    driveForm.reset();
                    fetchDrives();
                } else {
                    alert('Error publishing drive: ' + result.message);
                }
            } catch (error) {
                console.error("Submission failed:", error);
                alert('Network error. Check console.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '&nbsp; Publish &amp; Open Donor Registration';
            }
        });
    }

    // --- Cancel Drive Function ---
    async function cancelDrive(driveId) {
        if (!confirm("Are you sure you want to cancel this drive? This will notify all registered donors.")) return;

        try {
            const response = await fetch('../../api/drives.php', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ drive_id: driveId })
            });
            const result = await response.json();

            if (result.success) {
                fetchDrives();
            } else {
                alert("Failed to cancel: " + result.message);
            }
        } catch (error) {
            console.error("Cancel failed:", error);
        }
    }

    // Initialize list on load
    fetchDrives();
});