// One toast for the whole app. Pages may include <div class="toast" role="status" aria-live="polite"></div>;
// if they don't, one is created on first use.
let hideTimer = null;

export function showToast(message, isError = false) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast.classList.remove('show'), isError ? 5000 : 3000);
}
