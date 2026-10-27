document.addEventListener("DOMContentLoaded", () => {
    const logoutBtns = document.querySelectorAll("#logout-btn, .logout-link");

    if (logoutBtns.length > 0) {
        logoutBtns.forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();

                sessionStorage.clear();

                window.location.href = new URL('../../index.html', import.meta.url).href;
            });
        });
    }
});