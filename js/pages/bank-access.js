// Extra UI guard; Apache's bank-page.php enforces bank URL authorization.
// The server uses the same logged-in PHP session as login.php.
(async () => {
    const root = document.documentElement;
    const base = new URL('../../', document.currentScript.src);
    const loginUrl = new URL('index.html', base).href;
    const scanUrl = new URL('pages/bank/scan.html', base).href;
    const isScan = location.pathname.endsWith('/pages/bank/scan.html');

    try {
        const response = await fetch(new URL('api/session.php', base), {
            credentials: 'same-origin',
            cache: 'no-store',
        });
        const result = await response.json();
        const role = result?.data?.role;
        // login-logout-sql branch uses {ok, data, error}, not {success, ...}.
        if (!response.ok || !result.ok || !['bank', 'admin', 'phlebotomist'].includes(role)) {
            location.replace(loginUrl);
            return;
        }
        if (role === 'phlebotomist' && !isScan) {
            location.replace(scanUrl);
            return;
        }

        window.kadugoBankRole = role;
        root.dataset.bankRole = role;
        if (role === 'phlebotomist') {
            // Only Scan and Logout remain visible.
            document.querySelectorAll('.bottom-nav a').forEach(link => {
                if (!link.classList.contains('logout-link') &&
                    !link.href.endsWith('/pages/bank/scan.html')) link.remove();
            });
            document.querySelector('.scan-header button[aria-label="Go Back"]')?.remove();
            document.querySelector('.form-actions .btn-secondary')?.remove();
            const subtitle = document.querySelector('.topbar .brand-copy p');
            if (subtitle) subtitle.textContent = 'Phlebotomist • Scanner Only';
        }
        root.dataset.bankAccess = 'ready';
    } catch (error) {
        location.replace(loginUrl);
    }
})();
