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
        if (!response.ok || !json.success)
            throw new Error(json.message || 'The request could not be completed.');
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
    const profile = () => profileRequest ||= request('overview');
    window.KaDonor = { request, profile, first, formatDate, formatTime, safe, displayError };
    document.querySelectorAll('.refresh-button').forEach(btn => btn.addEventListener('click', () => window.location.reload()));
    profile().then(data => {
        document.querySelectorAll('.donor-side-name').forEach(el => el.textContent = data.full_name);
        document.querySelectorAll('.nav-profile img').forEach(el => {
            el.alt = `${data.full_name} — account`;
            // The SQL's photo_path may point to a missing file; retain the existing placeholder.
        });
    }).catch(error => displayError(error.message));
})();
