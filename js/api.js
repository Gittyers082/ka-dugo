// One fetch wrapper for every API call: same-origin cookie, JSON in/out, {ok, data, error} unwrapped.
// api('donations.php') -> GET; api('donations.php', { method: 'PUT', body: {...} }).
export const APP_ROOT = new URL('../', import.meta.url);

export class ApiError extends Error {
    constructor(message, status, offline = false) {
        super(message);
        this.status = status;
        this.offline = offline;
    }
}

// redirectOn401: false lets a caller keep unsaved work (e.g. queue a donation) instead of leaving the page.
export async function api(path, { method = 'GET', body = null, query = null, redirectOn401 = true } = {}) {
    const url = new URL(`api/${path}`, APP_ROOT);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
        }
    }

    let res;
    try {
        res = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new ApiError('You are offline. Connect to the server and try again.', 0, true);
    }

    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && redirectOn401) {
        location.replace(new URL('index.html', APP_ROOT).href);
        throw new ApiError('Your session has ended. Please sign in again.', 401);
    }
    if (res.status === 401) {
        throw new ApiError(json.error || 'Your session has ended. Please sign in again.', 401);
    }
    if (!res.ok || !json.ok) {
        throw new ApiError(json.error || `Request failed (${res.status}).`, res.status, Boolean(json.offline));
    }
    // The service worker marks answers it served from cache while offline.
    if (res.headers.get('X-Served-From') === 'cache' && json.data && typeof json.data === 'object') {
        json.data.fromCache = true;
    }
    return json.data;
}
