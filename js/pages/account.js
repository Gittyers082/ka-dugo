document.addEventListener("DOMContentLoaded", () => {
    const logoutBtns = document.querySelectorAll("#logout-btn, .logout-link");

    if (logoutBtns.length > 0) {
        logoutBtns.forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();

                sessionStorage.clear();

                const currentPath = window.location.pathname;
                const basePath = currentPath.includes('/kadugo/') ? '/kadugo/' : '/';

                window.location.href = basePath + "index.html";
            });
        });
    }
});