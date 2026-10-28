import { el } from '../ui/dom.js';
import { GOALS, loadTodayCounts } from './bank-quota.js';

// ============================================================================
// BANK REQUESTS LOGIC (Secure DOM Refactor)
// ============================================================================

const BLOOD_TYPE_IDS = { "A+": 1, "A-": 2, "B+": 3, "B-": 4, "AB+": 5, "AB-": 6, "O+": 7, "O-": 8 };
// Matches blood_component rows; Cryoprecipitate has no row yet, so it can't be requested.
const COMPONENT_IDS = { "Whole Blood": 1, "Packed RBC (PRBC)": 2, "Platelets Apheresis": 3, "Fresh Frozen Plasma": 4 };
const URGENCY = { Normal: { urgency: "normal", level: 1 }, Urgent: { urgency: "high", level: 2 }, Critical: { urgency: "critical", level: 3 } };

document.addEventListener("DOMContentLoaded", () => {

    // Start from whatever the markup pre-selects.
    const state = {
        bloodType: document.querySelector(".blood-grid .blood.selected")?.dataset.type || "O-",
        component: document.querySelector(".component-grid .component-btn.selected")?.dataset.comp || "Whole Blood",
        urgency: document.querySelector(".urgency-grid .urgency-btn.selected")?.dataset.level || "Normal",
        units: parseInt(document.getElementById("units-display")?.textContent) || 1,
        radius: parseInt(document.querySelector(".radius-grid .radius-btn.selected")?.dataset.radius) || 15,
        donors: parseInt(document.getElementById("preview-donors")?.textContent) || 0,
    };

    const neededByInput = document.getElementById("needed-by-input");
    if (neededByInput && !neededByInput.value) {
        const d = new Date(Date.now() + 6 * 3600 * 1000);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        neededByInput.value = d.toISOString().slice(0, 16);
    }

    async function postJson(url, body) {
        const res = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || `Request failed (${res.status}).`);
        return json.data;
    }

    function showToast(message) {
        const toast = document.getElementById("toast");
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
    }

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
            showToast("Resetting requests...");
            setTimeout(() => window.location.reload(), 600);
        });
    }

    const previewBlood = document.getElementById("preview-blood");
    const previewUnits = document.getElementById("preview-units");
    const previewComp = document.getElementById("preview-comp");
    const previewRadius = document.getElementById("preview-radius");
    const previewDonors = document.getElementById("preview-donors");

    const footerDonors = document.getElementById("footer-donors");
    const footerType = document.getElementById("footer-type");
    const reachCountLabel = document.getElementById("donor-reach-count");

    const typeLabel = document.getElementById("type-label");
    const compLabel = document.getElementById("component-label");
    const bloodBtns = document.querySelectorAll(".blood-grid .blood");
    bloodBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            bloodBtns.forEach(b => b.classList.remove("selected", "critical"));
            btn.classList.add("selected");

            const type = btn.getAttribute("data-type");
            const role = btn.getAttribute("data-role");

            if (role === "Critical Need") btn.classList.add("critical");

            state.bloodType = type;
            typeLabel.textContent = role;
            previewBlood.textContent = type;
            footerType.textContent = type;

            showToast(`${type} set as target blood type`);
            updateReach();
        });
    });

    const compBtns = document.querySelectorAll(".component-grid .component-btn");
    compBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            compBtns.forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");

            const comp = btn.getAttribute("data-comp");
            state.component = comp;
            compLabel.textContent = `${comp.split('(')[0]} Selected`;
            previewComp.textContent = "";
            const parts = comp.split("(");

            previewComp.append(
                document.createTextNode(parts[0]),
                parts[1] ? el("br") : "",
                parts[1] ? document.createTextNode(`(${parts[1]}`) : ""
            );
        });
    });

    const btnMinus = document.getElementById("units-minus");
    const btnPlus = document.getElementById("units-plus");
    const unitsDisplay = document.getElementById("units-display");

    function updateUnits() {
        unitsDisplay.textContent = `${state.units} Units`;
        previewUnits.textContent = state.units;
    }

    if (btnMinus) {
        btnMinus.addEventListener("click", () => {
            if (state.units > 1) {
                state.units--;
                updateUnits();
            }
        });
    }

    if (btnPlus) {
        btnPlus.addEventListener("click", () => {
            if (state.units < 100) {
                state.units++;
                updateUnits();
            }
        });
    }

    const urgencyBtns = document.querySelectorAll(".urgency-grid .urgency-btn");
    urgencyBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            urgencyBtns.forEach(b => b.classList.remove("selected", "critical"));
            btn.classList.add("selected");
            state.urgency = btn.getAttribute("data-level");
            if (btn.getAttribute("data-level") === "Critical") {
                btn.classList.add("critical");
            }
        });
    });

    const notesInput = document.getElementById("notes-input");
    const doctorInput = document.getElementById("doctor-input");
    const previewNotes = document.getElementById("preview-notes");

    function updateNotesPreview() {
        const doc = doctorInput.value || "Unknown Attending";
        const note = notesInput.value.split('\n')[0] || "No clinical rationale provided.";
        previewNotes.textContent = `${note} • Attending: ${doc}`;
    }

    if (notesInput) notesInput.addEventListener("input", updateNotesPreview);
    if (doctorInput) doctorInput.addEventListener("input", updateNotesPreview);

    // Preview follows the form: ward, urgency and deadline.
    const wardInput = document.getElementById("ward-input");
    const setText = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };

    function updateWardPreview() {
        setText("preview-ward", wardInput?.value.trim() || "Ward not set");
    }
    function updateUrgencyPreview() {
        const label = state.urgency === "Urgent" ? "High" : state.urgency;
        const badge = document.getElementById("preview-urgency");
        if (badge) badge.replaceChildren(document.createTextNode(state.urgency), el("br"), document.createTextNode("Urgency"));
        setText("broadcast-status", `Open - ${label} Priority`);
    }
    function updateDeadlinePreview() {
        const due = neededByInput?.value ? new Date(neededByInput.value) : null;
        if (!due || isNaN(due)) return setText("preview-deadline", "Deadline not set");
        const mins = Math.round((due - Date.now()) / 60000);
        if (mins <= 0) return setText("preview-deadline", "Deadline has passed");
        const h = Math.floor(mins / 60), m = mins % 60;
        setText("preview-deadline", `Deadline in ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`);
    }
    wardInput?.addEventListener("input", updateWardPreview);
    neededByInput?.addEventListener("input", updateDeadlinePreview);
    urgencyBtns.forEach(btn => btn.addEventListener("click", updateUrgencyPreview));
    setInterval(updateDeadlinePreview, 60000);
    updateWardPreview();
    updateUrgencyPreview();
    updateDeadlinePreview();
    updateNotesPreview();

    // Quota card: today's collected units vs the shift goal, and the biggest open-request deficit.
    async function loadQuota() {
        try {
            const counts = await loadTodayCounts();
            const pct = Math.min(100, Math.round((counts.Total / GOALS.Total) * 100));
            setText("req-quota-text", `${counts.Total} / ${GOALS.Total} Units`);
            setText("req-quota-pct", `${pct}%`);
        } catch (err) {
            setText("req-quota-text", "Unavailable");
        }
        try {
            const res = await fetch("../../api/request.php?status=open", { credentials: "same-origin" });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);
            // The API sorts open requests by urgency, then deadline; take the first one still short of units.
            const top = json.data.requests.find(r => r.units_remaining > 0);
            setText("req-quota-deficit", top
                ? `${top.urgency === "critical" ? "Critical" : "Open"} Deficit: ${top.blood_type_code} (${top.units_remaining} Units Required)`
                : "No open deficits");
        } catch (err) {
            setText("req-quota-deficit", "Open requests unavailable");
        }
    }
    loadQuota();

    const radiusBtns = document.querySelectorAll(".radius-grid .radius-btn");
    radiusBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            radiusBtns.forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");

            const radius = parseInt(btn.getAttribute("data-radius"));
            state.radius = radius;
            previewRadius.textContent = radius;
            updateReach();
        });
    });

    // Live count of eligible donors of the chosen type within the radius of this bank.
    async function updateReach() {
        const setCount = (text) => {
            previewDonors.textContent = text;
            reachCountLabel.textContent = `${text} Donors`;
            footerDonors.textContent = text;
        };
        try {
            const res = await fetch(`../../api/alerts.php?action=reach&blood_type_id=${BLOOD_TYPE_IDS[state.bloodType]}&radius_km=${state.radius}`, { credentials: "same-origin", cache: "no-store" });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);
            state.donors = json.data.count;
            setCount(state.donors);
        } catch (err) {
            setCount("—");
        }
    }
    updateReach();

    const dispatchBtn = document.getElementById("dispatch-btn");
    if (dispatchBtn) {
        dispatchBtn.addEventListener("click", async (e) => {
            e.preventDefault();

            const ward = document.getElementById("ward-input")?.value.trim();
            const neededBy = neededByInput?.value;
            const componentId = COMPONENT_IDS[state.component];
            const { urgency, level } = URGENCY[state.urgency] || URGENCY.Normal;
            if (!ward) return showToast("Enter the ward or unit that needs the blood.");
            if (!neededBy) return showToast("Choose when the blood is needed by.");
            if (!componentId) return showToast(`${state.component} can't be requested yet.`);

            const originalNodes = Array.from(dispatchBtn.childNodes);
            dispatchBtn.disabled = true;
            dispatchBtn.textContent = "Dispatching Alerts...";
            dispatchBtn.style.opacity = "0.7";

            try {
                const request = await postJson("../../api/request.php", {
                    blood_type_id: BLOOD_TYPE_IDS[state.bloodType],
                    component_id: componentId,
                    ward,
                    units_needed: state.units,
                    urgency,
                    needed_by: neededBy,
                });
                const note = notesInput?.value.split("\n")[0].trim();
                const alert = await postJson("../../api/alerts.php", {
                    sender_type: "bank",
                    bank_id: request.bank_id,
                    request_id: request.request_id,
                    blood_type_id: request.blood_type_id,
                    level,
                    radius_km: state.radius,
                    message: `${urgency.toUpperCase()}: ${state.units} unit(s) of ${state.bloodType} ${state.component} needed at ${ward}.${note ? " " + note : ""}`,
                    status: "active",
                });

                showToast(`SUCCESS: Request broadcasted to ${alert.recipients_notified} eligible donors.`);
                window.dispatchEvent(new Event("kadugo:requests-changed"));
                loadQuota();
                dispatchBtn.textContent = "✓ Broadcast Active";
                dispatchBtn.style.backgroundColor = "#287a4b";
                setTimeout(() => {
                    dispatchBtn.textContent = "";
                    originalNodes.forEach(node => dispatchBtn.append(node));
                    dispatchBtn.style.backgroundColor = "var(--urgent)";
                }, 4000);
            } catch (err) {
                showToast(err.message);
                dispatchBtn.textContent = "";
                originalNodes.forEach(node => dispatchBtn.append(node));
            } finally {
                dispatchBtn.disabled = false;
                dispatchBtn.style.opacity = "1";
            }
        });
    }
});