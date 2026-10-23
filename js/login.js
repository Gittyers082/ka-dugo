const form = document.querySelector("#login-form");
const errorEl = document.querySelector("#login-error");
const toggle = document.querySelector(".toggle-password");
const pwd = document.querySelector("#password");

function showError(msg) {
    errorEl.textContent = msg;
}

// Show/hide password
toggle?.addEventListener("click", () => {
    const show = pwd.type === "password";
    pwd.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

// Login
form?.addEventListener("submit", async (e) => {
    e.preventDefault();          // keep this first so the page never navigates to raw JSON
    showError("");

    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) return showError("Enter your email and password.");

    if (!navigator.onLine) {
        return showError("Connect to the internet to log in.");
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        const res = await fetch(form.action, {
            method: "POST",
            body: new FormData(form),
            credentials: "same-origin",
        });
        const json = await res.json();
        if (json.ok) {
            window.location.href = json.data.redirect;
        } else {
            showError(json.error || "Couldn't sign you in. Try again.");
        }
    } catch {
        console.error("Login Error:", error);
        showError("Couldn't reach the server. Check your connection and try again.");
    } finally {
        btn.disabled = false;
    }
});