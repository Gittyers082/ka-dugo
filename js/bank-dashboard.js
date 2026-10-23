// ============================================================================
// BANK DASHBOARD LOGIC
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {

    // --- 1. Dynamic Toast Notification System ---
    function showToast(message) {
        let toast = document.getElementById("dynamic-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "dynamic-toast";
            document.body.appendChild(toast);

            // Apply inline styles to match the donation log toast
            Object.assign(toast.style, {
                position: "fixed", bottom: "120px", left: "50%", transform: "translate(-50%, 20px)",
                background: "#2a0605", color: "#fff", padding: "14px 24px", borderRadius: "8px",
                fontSize: "14px", fontWeight: "600", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                opacity: "0", pointerEvents: "none", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                zIndex: "1000", whiteSpace: "nowrap"
            });

            // Adjust for desktop sidebar if screen is wide
            if (window.innerWidth >= 900) {
                toast.style.left = "calc(50% + 130px)";
                toast.style.bottom = "40px";
            }
        }

        toast.textContent = message;
        toast.style.opacity = "1";
        toast.style.transform = window.innerWidth >= 900 ? "translate(-50%, 0)" : "translate(-50%, 0)";

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = window.innerWidth >= 900 ? "translate(-50%, 20px)" : "translate(-50%, 20px)";
        }, 3000);
    }

    // --- 2. Dynamic Date Header ---
    const dateHeader = document.querySelector(".date-header h2");
    if (dateHeader) {
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        dateHeader.textContent = new Date().toLocaleDateString('en-US', options);
    }

    // --- 3. Refresh Button Animation ---
    const refreshBtn = document.querySelector(".refresh");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            const icon = refreshBtn.querySelector("svg");
            // Spin animation
            icon.style.transition = "transform 0.5s ease";
            icon.style.transform = "rotate(360deg)";

            showToast("Syncing latest dashboard metrics...");

            setTimeout(() => {
                icon.style.transition = "none";
                icon.style.transform = "rotate(0deg)";
            }, 500);
        });
    }

    // --- 4. Priority Alert Dispatch Button ---
    const dispatchBtn = document.querySelector(".priority-card .btn-primary");
    if (dispatchBtn) {
        dispatchBtn.addEventListener("click", () => {
            const originalText = dispatchBtn.textContent;
            dispatchBtn.disabled = true;
            dispatchBtn.textContent = "Dispatching...";
            dispatchBtn.style.opacity = "0.7";

            // Simulate API Call
            setTimeout(() => {
                showToast("Push & SMS Alerts successfully dispatched to 142 donors.");
                dispatchBtn.textContent = "✓ Alerts Dispatched";
                dispatchBtn.style.backgroundColor = "#287a4b"; // Turn green
                dispatchBtn.style.opacity = "1";
            }, 1500);
        });
    }
});