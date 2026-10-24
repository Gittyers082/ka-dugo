import { el } from '../ui/dom.js';
import { showNotification } from '../notify.js';

document.addEventListener("DOMContentLoaded", () => {
    // --- State & DOM Mapping ---
    const state = {
        bloodType: "O-",
        radius: "15",
        donors: 142
    };

    const bloodBtns = document.querySelectorAll(".blood-grid .blood");
    const radiusSlider = document.querySelector(".radius-input");
    const radiusTag = document.querySelector(".radius-card .tag");
    const reachDisplay = document.querySelector(".reach strong");
    const msgInput = document.querySelector("textarea");
    const charCount = document.querySelector(".counter");
    const previewBody = document.querySelector(".alert-preview p");
    const dispatchBtn = document.querySelector(".dispatch");
    const dialog = document.querySelector(".confirm-dialog");
    const confirmBtn = document.querySelector(".approve-dialog");
    const cancelBtns = document.querySelectorAll(".close-dialog, .cancel-dialog");
    const toast = document.querySelector(".toast");

    // --- Dynamic Donor Estimation ---
    function updateReach() {
        const baseDonors = { "5": 48, "10": 91, "15": 142, "20": 198, "25": 251, "30": 317 };
        const multiplier = (state.bloodType === "O-") ? 1.5 : 1.0;

        state.donors = Math.floor(baseDonors[state.radius] * multiplier);
        if (reachDisplay) reachDisplay.textContent = `${state.donors} Donors`;
    }

    // --- Event Listeners ---

    // 1. Blood Type Selection
    bloodBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            bloodBtns.forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            state.bloodType = btn.getAttribute("data-type");

            const notice = document.querySelector(".notice strong");
            if (notice) notice.textContent = `${state.bloodType}-Negative`;

            updateReach();
        });
    });

    // 2. Radius Slider
    if (radiusSlider) {
        radiusSlider.addEventListener("input", (e) => {
            state.radius = e.target.value;
            if (radiusTag) radiusTag.textContent = `${state.radius} km Radius`;

            const labels = document.querySelectorAll(".range-labels span");
            labels.forEach(label => label.classList.remove("active"));

            if (state.radius === "5" && labels[0]) labels[0].classList.add("active");
            if (state.radius === "15" && labels[1]) labels[1].classList.add("active");
            if (state.radius === "30" && labels[2]) labels[2].classList.add("active");

            updateReach();
        });
    }

    // 3. Message Editor Sync (No innerHTML)
    if (msgInput) {
        msgInput.addEventListener("input", () => {
            const text = msgInput.value;
            if (charCount) charCount.textContent = `${text.length} / 280`;
            if (previewBody) previewBody.textContent = text || "Your alert message will appear here.";
        });
    }

    // 4. Dispatch Flow
    if (dispatchBtn && dialog) {
        dispatchBtn.addEventListener("click", () => dialog.showModal());
    }

    cancelBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            if (dialog) dialog.close();
        });
    });

    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "Dispatching...";

            // Simulate dispatch
            setTimeout(() => {
                if (dialog) dialog.close();
                showNotification("Alert Broadcasted", `Emergency notice dispatched to ${state.donors} donors.`, "/kadugo/assets/icons/crimson/192-crimson_icon.png");

                if (toast) {
                    toast.textContent = "Broadcast successful.";
                    toast.classList.add("show");
                    setTimeout(() => toast.classList.remove("show"), 3000);
                }

                confirmBtn.disabled = false;
                confirmBtn.textContent = "Dispatch now";
            }, 1200);
        });
    }

    // Initialize
    updateReach();
});