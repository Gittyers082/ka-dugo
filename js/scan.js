// ============================================================================
// SCANNER & LOG PROTOCOL LOGIC
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {

    // --- 1. Dynamic Toast Notification System ---
    function showToast(message) {
        let toast = document.getElementById("scan-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "scan-toast";
            document.body.appendChild(toast);

            Object.assign(toast.style, {
                position: "fixed", bottom: "120px", left: "50%", transform: "translate(-50%, 20px)",
                background: "#2a0605", color: "#fff", padding: "14px 24px", borderRadius: "8px",
                fontSize: "14px", fontWeight: "600", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                opacity: "0", pointerEvents: "none", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                zIndex: "1000", whiteSpace: "nowrap"
            });

            if (window.innerWidth >= 900) {
                toast.style.left = "calc(50% + 130px)";
                toast.style.bottom = "40px";
            }
        }
        toast.textContent = message;
        toast.style.opacity = "1";
        toast.style.transform = "translate(-50%, 0)";
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translate(-50%, 20px)";
        }, 3000);
    }

    // --- 2. Auto-fill Current Timestamp ---
    const timeInput = document.querySelector('input[value="Today, 14:32"]');
    if (timeInput) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        timeInput.value = `Today, ${timeString}`;
    }

    // --- 3. Component & Volume Stepper Logic ---
    const stepperContainer = document.querySelector(".stepper-control");
    if (stepperContainer) {
        const minusBtn = stepperContainer.querySelectorAll("button")[0];
        const plusBtn = stepperContainer.querySelectorAll("button")[1];
        const unitDisplay = stepperContainer.querySelector(".t-title");
        const volumeDisplay = stepperContainer.querySelector(".t-caption");

        let units = 1;
        const volumePerUnit = 450; // mL

        function updateStepper() {
            unitDisplay.textContent = `${units} Unit${units > 1 ? 's' : ''}`;
            volumeDisplay.textContent = `Whole Blood / ${units * volumePerUnit} mL`;
        }

        minusBtn.addEventListener("click", () => {
            if (units > 1) {
                units--;
                updateStepper();
            } else {
                showToast("Minimum collection is 1 Unit.");
            }
        });

        plusBtn.addEventListener("click", () => {
            if (units < 4) {
                units++;
                updateStepper();
            } else {
                showToast("Maximum collection is 4 Units.");
            }
        });
    }

    // --- 4. Camera Flash Toggle ---
    const flashBtn = document.querySelector(".scan-card .btn-outline-small");
    if (flashBtn) {
        let flashOn = false;
        flashBtn.addEventListener("click", () => {
            flashOn = !flashOn;
            if (flashOn) {
                flashBtn.style.backgroundColor = "rgba(0,0,0,0.05)";
                flashBtn.style.borderColor = "var(--maroon)";
                flashBtn.style.color = "var(--maroon)";
                showToast("Camera flash enabled");
            } else {
                flashBtn.style.backgroundColor = "transparent";
                flashBtn.style.borderColor = "var(--line)";
                flashBtn.style.color = "var(--text)";
                showToast("Camera flash disabled");
            }
        });
    }

    // --- 5. Manual ID Lookup Simulation ---
    const lookupBtn = document.querySelector(".manual-entry .btn-secondary");
    const idInput = document.querySelector(".manual-entry input");

    if (lookupBtn && idInput) {
        lookupBtn.addEventListener("click", () => {
            if (idInput.value.trim() === "") {
                showToast("Please enter a valid Donor ID.");
                return;
            }

            const originalText = lookupBtn.textContent;
            lookupBtn.textContent = "Searching...";
            lookupBtn.disabled = true;

            setTimeout(() => {
                showToast(`Donor record verified for ${idInput.value}`);
                lookupBtn.textContent = originalText;
                lookupBtn.disabled = false;
            }, 800);
        });
    }

    // --- 6. Save & Log Donation Button ---
    const saveBtn = document.querySelector(".form-actions .btn-primary");
    if (saveBtn) {
        // Prevent the default window.location.href trigger from HTML for a moment to show the simulation
        saveBtn.onclick = (e) => {
            e.preventDefault();
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = "Processing...";
            saveBtn.disabled = true;
            saveBtn.style.opacity = "0.8";

            setTimeout(() => {
                showToast("Donation successfully logged to local queue.");
                // Route to the log page after a brief delay
                setTimeout(() => {
                    window.location.href = 'donation-log.html';
                }, 1000);
            }, 1000);
        };
    }
});