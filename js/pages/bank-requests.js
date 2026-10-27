import { el } from '../ui/dom.js';

// ============================================================================
// BANK REQUESTS LOGIC (Secure DOM Refactor)
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {

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

    const radiusBtns = document.querySelectorAll(".radius-grid .radius-btn");
    radiusBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            radiusBtns.forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");

            const radius = parseInt(btn.getAttribute("data-radius"));
            state.radius = radius;
            const simulatedDonors = { 5: 48, 15: 142, 25: 298 };
            state.donors = simulatedDonors[radius];

            previewRadius.textContent = radius;
            previewDonors.textContent = state.donors;
            reachCountLabel.textContent = `${state.donors} Donors`;
            footerDonors.textContent = state.donors;
        });
    });

    const dispatchBtn = document.getElementById("dispatch-btn");
    if (dispatchBtn) {
        dispatchBtn.addEventListener("click", (e) => {
            e.preventDefault();

            const originalNodes = Array.from(dispatchBtn.childNodes);

            dispatchBtn.disabled = true;
            dispatchBtn.textContent = "Dispatching Alerts...";
            dispatchBtn.style.opacity = "0.7";
            setTimeout(() => {
                showToast(`SUCCESS: Request broadcasted to ${state.donors} eligible donors.`);

                dispatchBtn.disabled = false;
                dispatchBtn.textContent = "✓ Broadcast Active";
                dispatchBtn.style.backgroundColor = "#287a4b";
                dispatchBtn.style.opacity = "1";
                setTimeout(() => {
                    dispatchBtn.textContent = "";
                    originalNodes.forEach(node => dispatchBtn.append(node));
                    dispatchBtn.style.backgroundColor = "var(--urgent)";
                }, 4000);

            }, 1200);
        });
    }
});