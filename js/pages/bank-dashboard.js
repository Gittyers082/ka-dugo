import { el } from '../ui/dom.js';
import { getAllRecords } from '../db.js';
import { GOALS, loadTodayCounts } from './bank-quota.js';

document.addEventListener("DOMContentLoaded", () => {
    const dateHeader = document.querySelector(".date-header h2");
    if (dateHeader) {
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        dateHeader.textContent = new Date().toLocaleDateString('en-US', options);
    }

    // Ward, bank and component names come from staff input; escape before using innerHTML.
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const safeSet = (id, text) => {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    };

    async function loadBankDashboard() {
        try {
            // Quota: the server already limits donations to the signed-in bank.
            try {
                const counts = await loadTodayCounts();
                safeSet('quota-total-text', `${counts.Total}/${GOALS.Total}`);
                safeSet('quota-remaining-text', `${Math.max(0, GOALS.Total - counts.Total)} Units Remaining to Reach Shift Goal`);
                safeSet('quota-prbc', `PRBC: ${counts.PRBC}/${GOALS.PRBC}`);
                safeSet('quota-platelets', `Platelets: ${counts.Platelets}/${GOALS.Platelets}`);
                safeSet('quota-wb', `Whole Blood: ${counts['Whole Blood']}/${GOALS['Whole Blood']}`);
                const bar = document.getElementById('quota-progress-bar');
                if (bar) bar.style.width = `${Math.min(100, (counts.Total / GOALS.Total) * 100)}%`;
            } catch (quotaError) {
                safeSet('quota-remaining-text', quotaError.message);
            }

            // Fetch Open Requests
            // The server picks the bank from the session.
            const reqRes = await fetch('../../api/request.php?status=open');
            if (reqRes.ok) {
                const reqData = await reqRes.json();

                if (reqData.ok && reqData.data.requests) {
                    const requests = reqData.data.requests;

                    let urgentCount = 0;
                    requests.forEach(r => {
                        if (r.urgency === 'critical' || r.urgency === 'high') urgentCount++;
                    });

                    safeSet('active-requests-text', `${requests.length} Active`);
                    safeSet('urgent-requests-text', `${urgentCount} urgent protocol`);
                    safeSet('feed-count-badge', requests.length);

                    // Priority card: live reach for the most urgent open request (list is sorted by urgency).
                    const top = requests[0];
                    if (!top) {
                        safeSet('priority-reach-text', 'No open requests need donor outreach right now.');
                    } else {
                        try {
                            const reach = await fetch(`../../api/alerts.php?action=reach&blood_type_id=${top.blood_type_id}&radius_km=15`).then(r => r.json());
                            safeSet('priority-reach-text', reach.ok
                                ? `${reach.data.count} eligible ${top.blood_type_code} donors within 15 km of ${reach.data.center_name}`
                                : reach.error);
                        } catch (reachError) {
                            safeSet('priority-reach-text', 'Donor reach is unavailable offline.');
                        }
                    }

                    const container = document.getElementById('requests-feed-container');
                    if (container) {
                        container.innerHTML = '';

                        if (requests.length === 0) {
                            container.innerHTML = '<p class="t-caption text-muted text-center py-4">No open requests currently.</p>';
                        } else {
                            // Exact original HTML structure dynamically injected
                            requests.slice(0, 3).forEach(req => {
                                const needed = req.units_needed || 1;
                                const collected = req.units_collected || 0;
                                const remaining = req.units_remaining || 0;
                                const pct = Math.min(100, Math.round((collected / needed) * 100));

                                let deadlineStr = 'TBD';
                                if (req.needed_by) {
                                    const dateObj = new Date(req.needed_by);
                                    deadlineStr = dateObj.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                                }

                                const isCritical = req.urgency === 'critical';
                                const badgeHtml = isCritical ? `<span class="urgency-pill bg-maroon text-bone t-caption font-bold">CRITICAL</span>` : '';

                                container.innerHTML += `
                                    <article class="card request-card">
                                        <div class="request-top flex-between items-start">
                                            <div class="flex-row gap-4">
                                                <div class="blood-type-box bg-maroon text-bone t-title font-heading font-bold">
                                                    ${esc(req.blood_type_code)}
                                                </div>
                                                <div>
                                                    <h4 class="t-heading text-oxblood font-heading m-0">
                                                        ${esc(req.ward)}
                                                    </h4>
                                                    <p class="t-label text-urgent font-bold m-0 mt-1">
                                                        Status: ${esc(String(req.urgency).toUpperCase())} Need
                                                    </p>
                                                </div>
                                            </div>
                                            <div class="text-right">
                                                <p class="t-caption text-muted mb-2">
                                                    DEADLINE
                                                    <span class="text-maroon font-bold block">${deadlineStr}</span>
                                                </p>
                                                ${badgeHtml}
                                            </div>
                                        </div>
                                        <div class="progress-track mt-4">
                                            <div class="progress-fill bg-maroon" style="width: ${pct}%"></div>
                                        </div>
                                        <div class="flex-between mt-2">
                                            <p class="t-caption text-muted">${collected} of ${needed} units fulfilled</p>
                                            <p class="t-caption font-bold text-oxblood">${pct}%</p>
                                        </div>
                                        <div class="flex-between mt-1">
                                            <p class="t-caption text-muted">
                                                Required: ${esc(req.component_name)}
                                            </p>
                                            <p class="t-caption text-urgent font-bold">${remaining} units remaining</p>
                                        </div>
                                    </article>
                                `;
                            });
                        }
                    }
                }
            }

            // Sync Count
            try {
                const allRecords = await getAllRecords();
                const pendingCount = allRecords.filter(r => r.status === "Pending Sync").length;
                safeSet('dashboard-sync-count', `${pendingCount} Records`);
            } catch (e) {
                safeSet('dashboard-sync-count', `0 Records`);
            }

        } catch (error) {
            console.error("Dashboard failed to load:", error);
        }
    }

    loadBankDashboard();

    const refreshBtn = document.querySelector(".refresh");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            const icon = refreshBtn.querySelector("svg");
            if (icon) {
                icon.style.transition = "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)";
                icon.style.transform = "rotate(360deg)";
                setTimeout(() => {
                    icon.style.transition = "none";
                    icon.style.transform = "rotate(0deg)";
                }, 1000);
            }

            // Dynamic toast creation for the dashboard
            let toast = document.getElementById("toast");
            if (!toast) {
                toast = document.createElement("div");
                toast.id = "toast";
                Object.assign(toast.style, {
                    position: "fixed", bottom: "120px", left: "50%", transform: "translate(-50%, 20px)",
                    background: "var(--text)", color: "var(--surface)", padding: "13px 18px",
                    borderRadius: "5px", fontSize: "14px", fontWeight: "600", zIndex: "1000",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", opacity: "0", pointerEvents: "none", whiteSpace: "nowrap"
                });
                document.body.appendChild(toast);
            }

            toast.textContent = "Syncing dashboard metrics...";
            toast.style.opacity = "1";
            toast.style.transform = "translate(-50%, 0)";

            setTimeout(() => {
                toast.style.opacity = "0";
                toast.style.transform = "translate(-50%, 20px)";
            }, 3000);

            loadBankDashboard();
        });
    }

    const dispatchBtn = document.querySelector(".priority-card .btn-primary");
    if (dispatchBtn) {
        dispatchBtn.addEventListener("click", () => {
            dispatchBtn.disabled = true;
            dispatchBtn.textContent = "Dispatching...";
            dispatchBtn.style.opacity = "0.7";
            setTimeout(() => {
                dispatchBtn.textContent = "✓ Alerts Dispatched";
                dispatchBtn.style.backgroundColor = "#287a4b";
                dispatchBtn.style.opacity = "1";
            }, 1500);
        });
    }
});