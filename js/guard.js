// Page guard: <script src="../../js/guard.js" data-roles="bank,admin"></script> in <head>.
// The page stays hidden (base.css) until api/session.php confirms the signed-in role.
// Offline, the cached page shell is shown; every API still checks the session itself.
(() => {
    const script = document.currentScript;
    const allowed = (script.dataset.roles || '').split(',').map((role) => role.trim());
    const appRoot = new URL('../', script.src);
    const root = document.documentElement;

    const show = () => { root.dataset.access = 'ready'; };
    const go = (path) => location.replace(new URL(path, appRoot).href);

    root.dataset.access = 'pending';
    if (!navigator.onLine) { show(); return; }

    fetch(new URL('api/session.php', appRoot), { credentials: 'same-origin', cache: 'no-store' })
        .then(async (res) => {
            const json = await res.json().catch(() => ({}));
            if (res.status === 401) return go('index.html');
            if (!res.ok || !json.ok) return show(); // server trouble: let the page show its own errors
            if (!allowed.includes(json.data.role)) return go(json.data.home);
            root.dataset.role = json.data.role;
            show();
        })
        .catch(show); // network dropped mid-check: treat as offline
})();
