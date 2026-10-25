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
});