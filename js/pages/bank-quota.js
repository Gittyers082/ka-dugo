// Daily collection quota shared by the bank dashboard, donation log and requests page.

// shortcut: shift targets are fixed in code; move them to a bank settings table if banks need different targets.
export const GOALS = { Total: 50, PRBC: 28, Platelets: 12, 'Whole Blood': 10 };

const COMPONENT_KEY = { 'Packed Red Blood Cells': 'PRBC', 'Platelets': 'Platelets', 'Whole Blood': 'Whole Blood' };

// Units collected today (local calendar date; toISOString() would use UTC), per component, from donations.php rows.
export function todayCounts(donations) {
    const today = new Date().toLocaleDateString('en-CA');
    const counts = { Total: 0, PRBC: 0, Platelets: 0, 'Whole Blood': 0 };
    for (const d of donations) {
        if (!String(d.collected_at || '').startsWith(today) || d.status === 'discarded') continue;
        const units = Number(d.units) || 0;
        counts.Total += units;
        const key = COMPONENT_KEY[d.component_name];
        if (key) counts[key] += units;
    }
    return counts;
}

export async function loadTodayCounts() {
    const res = await fetch(new URL('../../api/donations.php', import.meta.url), { credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || `Could not load donations (${res.status}).`);
    return todayCounts(json.data.donations);
}
