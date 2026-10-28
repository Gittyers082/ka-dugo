document.addEventListener("DOMContentLoaded", () => {
    const logoutBtns = document.querySelectorAll("#logout-btn, .logout-link");

    if (logoutBtns.length > 0) {
        logoutBtns.forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.preventDefault();

                // End the PHP session too; clearing browser storage alone leaves the account signed in.
                try {
                    await fetch(new URL('../../api/logout.php', import.meta.url), { method: "POST", credentials: "same-origin" });
                } catch (err) {
                    console.warn("Offline: server session will expire on its own.");
                }
                sessionStorage.clear();
                localStorage.removeItem('kadugo_active_user');

                window.location.href = new URL('../../index.html', import.meta.url).href;
            });
        });
    }
});