// Today's collected units for the signed-in bank, against its daily quota (blood_bank.daily_quota_units).
// Shared by the bank dashboard, donation log and requests page.
import { api } from '../api.js';
import { todayLocal } from '../ui/format.js';

export async function loadTodayQuota() {
    const today = todayLocal();
    const [profile, data] = await Promise.all([
        api('profile.php'),
        api('donations.php', { query: { from: today, to: today } }),
    ]);

    const byComponent = {};
    let total = 0;
    for (const donation of data.donations) {
        if (donation.status === 'discarded') continue;
        const units = Number(donation.units) || 0;
        total += units;
        byComponent[donation.component_name] = (byComponent[donation.component_name] || 0) + units;
    }

    const goal = Number(profile.daily_quota_units) || 0;
    return {
        goal,
        total,
        byComponent,
        percent: goal ? Math.min(100, Math.round((total / goal) * 100)) : 0,
        remaining: Math.max(0, goal - total),
    };
}
