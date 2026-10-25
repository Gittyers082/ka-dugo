document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Fetch data from your new PHP API
        const response = await fetch('../../api/organizer/profile.php');
        const result = await response.json();

        if (result.success) {
            const data = result.data;

            // Hydrate the DOM elements with real database values
            document.getElementById('display-org-name').textContent = data.org_name;
            document.getElementById('display-org-code').textContent = `Node #${data.org_code}`;
            document.getElementById('display-contact-person').textContent = data.contact_person;
            document.getElementById('display-email').textContent = data.email;
            document.getElementById('display-phone').textContent = data.contact_no;
            
            // If you added an ID for the impact stats:
            // document.getElementById('display-total-drives').textContent = data.total_drives;
        } else {
            console.error("Failed to load profile:", result.error);
        }
    } catch (error) {
        console.error("Network error fetching profile:", error);
    }
});