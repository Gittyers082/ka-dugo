document.addEventListener('DOMContentLoaded', async () => {
    // Fallback to 1 if testing locally without logging in
    const ORGANIZER_ID = localStorage.getItem('kadugo_active_user') || 1;

    // Helper function to safely set text ONLY if the element exists on the current page
    const safeSet = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    // --- 1. Fetch Profile Data ---
    try {
        const profileRes = await fetch(`../../api/profile.php?organizer_id=${ORGANIZER_ID}`);
        if (profileRes.ok) {
            const profileResult = await profileRes.json();

            if (profileResult.success) {
                const data = profileResult.data;

                safeSet('display-org-name', data.org_name || 'Organization Name');
                safeSet('display-org-code', data.org_code ? `Node #${data.org_code}` : 'No Code');
                safeSet('display-contact-person', data.contact_person || 'N/A');
                safeSet('display-email', data.email || 'N/A');
                safeSet('display-phone', data.contact_no || 'N/A');
                safeSet('display-blood-bank', data.bank_name || 'Unassigned');
            } else {
                console.warn("Profile API returned false success:", profileResult.message);
            }
        }
    } catch (error) {
        console.error("Network error fetching profile data.", error);
    }

    // --- 2. Fetch Impact Stats (Runs independently) ---
    try {
        const statsRes = await fetch(`../../api/drives.php?organizer_id=${ORGANIZER_ID}`);
        if (statsRes.ok) {
            const statsResult = await statsRes.json();

            if (statsResult.success && statsResult.data.drives) {
                const drives = statsResult.data.drives;
                let totalHosted = drives.length;
                let totalEngaged = 0;

                drives.forEach(drive => {
                    totalEngaged += parseInt(drive.registered_count || 0);
                });

                safeSet('impact-drives', totalHosted);
                safeSet('impact-donors', totalEngaged);
            } else {
                safeSet('impact-drives', "0");
                safeSet('impact-donors', "0");
            }
        }
    } catch (error) {
        console.error("Network error fetching impact stats:", error);
        safeSet('impact-drives', "0");
        safeSet('impact-donors', "0");
    }
});document.addEventListener('DOMContentLoaded', () => {
    const organizerId = Number(localStorage.getItem('kadugo_active_user')) || 1;
    const profileDialog = document.getElementById('update-profile-dialog');
    const passwordDialog = document.getElementById('password-dialog');
    const profileForm = document.getElementById('update-profile-form');
    const profileButton = document.getElementById('updateProfileBtn');
    const toast = document.getElementById('toastNotif');

    const safeSet = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };
    const showToast = (message, isError = false) => {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.toggle('error', isError);
        toast.classList.add('show');
        window.setTimeout(() => toast.classList.remove('show'), 3500);
    };

    async function loadProfile() {
        try {
            const response = await fetch(`../../api/profile.php?organizer_id=${organizerId}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Unable to load profile.');
            const data = result.data;
            profileButton.disabled=false;
            safeSet('display-org-name', data.org_name || 'Organization Name');
            safeSet('display-org-code', data.org_code ? `Node #${data.org_code}` : 'No Code');
            safeSet('display-contact-person', data.contact_person || 'Not provided');
            safeSet('display-email', data.email || 'Not provided');
            safeSet('display-phone', data.contact_no || 'Not provided');
            safeSet('display-blood-bank', data.bank_name || 'Network-managed');
            document.getElementById('profile-contact-person').value = data.contact_person || '';
            document.getElementById('profile-contact-no').value = data.contact_no || '';
        } catch (error) {
            console.error('Profile load failed:', error);
            showToast(error.message, true);
            profileButton.disabled=true;
        }
    }

    async function loadStats() {
        try {
            const response = await fetch(`../../api/drives.php?organizer_id=${organizerId}`);
            const result = await response.json();
            const drives = result.success ? (result.data.drives || []) : [];
            safeSet('impact-drives', drives.length);
            safeSet('impact-donors', drives.reduce((sum, drive) => sum + Number(drive.registered_count || 0), 0));
        } catch (error) {
            console.error('Impact stats load failed:', error);
            safeSet('impact-drives', '0');
            safeSet('impact-donors', '0');
        }
    }

    profileButton?.addEventListener('click', () => profileDialog?.showModal());
    document.getElementById('close-profile-x')?.addEventListener('click', () => profileDialog?.close());
    document.getElementById('cancel-profile-btn')?.addEventListener('click', () => profileDialog?.close());
    document.getElementById('changePasswordBtn')?.addEventListener('click', () => passwordDialog?.showModal());
    document.getElementById('close-password-x')?.addEventListener('click', () => passwordDialog?.close());
    document.getElementById('cancel-password-btn')?.addEventListener('click', () => passwordDialog?.close());

    profileForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = profileForm.querySelector('[type="submit"]');
        const payload = {
            organizer_id: organizerId,
            contact_person: document.getElementById('profile-contact-person').value.trim(),
            contact_no: document.getElementById('profile-contact-no').value.trim()
        };
        submit.disabled = true;
        submit.textContent = 'Saving...';
        try {
            const response = await fetch('../../api/profile.php', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Profile update failed.');
            safeSet('display-contact-person', result.data.contact_person);
            safeSet('display-phone', result.data.contact_no);
            profileDialog.close();
            showToast('Profile details saved.');
        } catch (error) {
            console.error('Profile update failed:', error);
            showToast(error.message, true);
        } finally {
            submit.disabled = false;
            submit.textContent = 'Save Changes';
        }
    });

    document.getElementById('change-password-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        passwordDialog?.close();
        event.currentTarget.reset();
        showToast('Password updates require the account service.');
    });
    document.getElementById('refreshBtn')?.addEventListener('click', async () => {
        await Promise.all([loadProfile(), loadStats()]);
    });

    Promise.all([loadProfile(), loadStats()]);
});
