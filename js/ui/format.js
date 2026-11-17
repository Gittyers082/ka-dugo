// Date/time formatting shared by every module. Inputs are MySQL strings ("2026-11-05", "2026-11-05 08:30:00", "08:30:00").

const toDate = (value) => new Date(String(value).replace(' ', 'T'));

// "Nov 5, 2026"; date-only values are read at noon so the time zone never shifts the day.
export function formatDate(value) {
    if (!value) return 'Not recorded';
    const text = String(value);
    const date = text.length === 10 ? new Date(`${text}T12:00:00`) : toDate(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Nov 5, 08:30 AM"
export function formatDateTime(value) {
    if (!value) return '—';
    const date = toDate(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// "8:30 AM"
export function formatTime(value) {
    if (!value) return '—';
    const [h, m] = String(value).split(':').map(Number);
    if (!Number.isFinite(h)) return String(value);
    return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Value for <input type="datetime-local"> from a MySQL datetime.
export const toLocalInput = (value) => String(value || '').replace(' ', 'T').slice(0, 16);

// Today's date in local time as YYYY-MM-DD (toISOString() would use UTC).
export const todayLocal = () => new Date().toLocaleDateString('en-CA');
