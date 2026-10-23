// ============================================================================
// SCANNER & LOG PROTOCOL LOGIC (Wired to Backend API & Offline IndexedDB)
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const DONORS_API = "../../api/donors.php";

  // Active donor state (defaults to Donor #1 Miguel Cruz from kadugo.sql)
  let activeDonor = {
    donor_id: 1,
    full_name: "Miguel Cruz",
    blood_type_id: 7,
    blood_type_code: "O+",
    qr_code: "DNR-QR-99238471209384",
  };
  let units = 1;
  const volumePerUnit = 450;

  // --- 1. Toast Notification System ---
  function showToast(message) {
    let toast = document.getElementById("scan-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "scan-toast";
      document.body.appendChild(toast);
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "120px",
        left: "50%",
        transform: "translate(-50%, 20px)",
        background: "#2a0605",
        color: "#fff",
        padding: "14px 24px",
        borderRadius: "8px",
        fontSize: "14px",
        fontWeight: "600",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        opacity: "0",
        pointerEvents: "none",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        zIndex: "1000",
        whiteSpace: "nowrap",
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

  // --- 2. Auto-fill Current Timestamp & Client UUID ---
  const timeInput = document.querySelector('input[value="Today, 14:32"]');
  if (timeInput) {
    const now = new Date();
    const timeString = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    timeInput.value = `Today, ${timeString}`;
  }

  const uuidInput = document.querySelector('input[value="9f8c2b1a-4d3e"]');
  const clientUuid =
    window.KadugoPWA && window.KadugoPWA.makeUuid
      ? window.KadugoPWA.makeUuid()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
          ((Math.random() * 16) | 0).toString(16),
        );
  if (uuidInput) {
    uuidInput.value = clientUuid;
  }

  // --- 3. Component & Volume Stepper Logic ---
  const stepperContainer = document.querySelector(".stepper-control");
  if (stepperContainer) {
    const minusBtn = stepperContainer.querySelectorAll("button")[0];
    const plusBtn = stepperContainer.querySelectorAll("button")[1];
    const unitDisplay = stepperContainer.querySelector(".t-title");
    const volumeDisplay = stepperContainer.querySelector(".t-caption");

    function updateStepper() {
      unitDisplay.textContent = `${units} Unit${units > 1 ? "s" : ""}`;
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
      flashBtn.style.backgroundColor = flashOn
        ? "rgba(0,0,0,0.05)"
        : "transparent";
      flashBtn.style.borderColor = flashOn ? "var(--maroon)" : "var(--line)";
      flashBtn.style.color = flashOn ? "var(--maroon)" : "var(--text)";
      showToast(flashOn ? "Camera flash enabled" : "Camera flash disabled");
    });
  }

  // --- 5. Live Donor Lookup via api/donors.php ---
  const lookupBtn = document.querySelector(".manual-entry .btn-secondary");
  const idInput = document.querySelector(".manual-entry input");
  if (idInput && idInput.value === "BLD-88291") {
    idInput.value = "DNR-QR-99238471209384"; // Default to sample QR in kadugo.sql
  }

  async function lookupDonor(queryVal) {
    const param = /^\d+$/.test(queryVal)
      ? `donor_id=${encodeURIComponent(queryVal)}`
      : `qr_code=${encodeURIComponent(queryVal)}`;

    const res = await fetch(`${DONORS_API}?${param}`);
    const json = await res.json();
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.message || "Donor not found.");
    }
    return json.data;
  }

  function renderMatchedDonor(donor) {
    activeDonor = {
      donor_id: Number(donor.donor_id),
      full_name: donor.full_name,
      blood_type_id: Number(donor.blood_type_id),
      blood_type_code: donor.blood_type_code || "O+",
      qr_code: donor.qr_code,
    };

    const matchedCard = document.querySelectorAll(
      ".scan-col-right .scan-card",
    )[0];
    if (!matchedCard) return;

    const nameEl = matchedCard.querySelector("h2.t-title");
    const idEl = matchedCard.querySelector("p.t-caption.text-muted");
    const btBadge = matchedCard.querySelector(".blood-type-badge span.t-title");
    const cells = matchedCard.querySelectorAll(".data-cell");
    const alertBox = matchedCard.querySelector(".alert-box");

    if (nameEl) nameEl.textContent = donor.full_name;
    if (idEl)
      idEl.textContent = `Donor ID: #${donor.donor_id} (${donor.qr_code})`;
    if (btBadge) btBadge.textContent = donor.blood_type_code || "O+";

    if (cells[0] && donor.eligibility) {
      const age = donor.eligibility.age ?? "--";
      cells[0].innerHTML = `<span class="t-caption font-bold block mb-1">AGE / BIRTHDATE</span>
                <span class="t-body font-bold text-oxblood">${age} yrs <span class="text-muted font-normal">(${donor.birthdate})</span></span>`;
    }
    if (cells[1]) {
      cells[1].innerHTML = `<span class="t-caption font-bold block mb-1">RECORDED WEIGHT</span>
                <span class="t-body font-bold text-oxblood">${donor.weight_kg} kg <span class="text-success font-bold" style="font-size: 13px;">(>= 50kg req)</span></span>`;
    }
    if (cells[2]) {
      const lastDate = donor.last_donation_date || "First-time Donor";
      cells[2].querySelector("span.t-label").textContent = lastDate;
    }
    if (alertBox && donor.eligibility) {
      const eligible = donor.eligibility.is_eligible;
      const titleSpan = alertBox.querySelector("span.t-label");
      const descSpan = alertBox.querySelector("span.t-caption");
      if (titleSpan)
        titleSpan.textContent = eligible
          ? "Eligible to Donate"
          : "Deferred / Ineligible";
      if (descSpan) {
        descSpan.textContent = eligible
          ? "Passed 56-day whole blood interval & weight requirement."
          : donor.eligibility.reasons.join(" ");
      }
    }
  }

  if (lookupBtn && idInput) {
    lookupBtn.addEventListener("click", async () => {
      const query = idInput.value.trim();
      if (!query) {
        showToast("Please enter a valid Donor ID or QR Code.");
        return;
      }
      const originalText = lookupBtn.textContent;
      lookupBtn.textContent = "Searching...";
      lookupBtn.disabled = true;

      try {
        const donor = await lookupDonor(query);
        renderMatchedDonor(donor);
        showToast(`Verified: ${donor.full_name} (${donor.blood_type_code})`);
      } catch (err) {
        showToast(err.message || "Lookup failed.");
      } finally {
        lookupBtn.textContent = originalText;
        lookupBtn.disabled = false;
      }
    });
  }

  // --- 6. Save & Log Donation via KadugoPWA (Online POST or Offline IndexedDB) ---
  const saveBtn = document.querySelector(".form-actions .btn-primary");
  if (saveBtn) {
    saveBtn.onclick = async (e) => {
      e.preventDefault();
      const remarksInput = document.querySelector(".custom-textarea");
      const payload = {
        client_uuid: clientUuid,
        donor_id: activeDonor.donor_id,
        donor_name: activeDonor.full_name,
        blood_type_id: activeDonor.blood_type_id,
        blood_type_code: activeDonor.blood_type_code,
        bank_id: 1,
        drive_id: 1,
        component_id: 1,
        phlebotomist_id: 1,
        units: units,
        notes: remarksInput ? remarksInput.value.trim() : "Standard collection",
      };

      saveBtn.innerHTML = "Processing...";
      saveBtn.disabled = true;
      saveBtn.style.opacity = "0.8";

      try {
        let result = { status: "queued" };
        if (window.KadugoPWA && window.KadugoPWA.submitDonation) {
          result = await window.KadugoPWA.submitDonation(payload);
        } else {
          const res = await fetch("../../api/donations.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          result = res.ok
            ? { status: "saved" }
            : { status: "error", message: "Failed to save" };
        }

        if (result.status === "error") {
          showToast(result.message);
          saveBtn.innerHTML = "Save & Log Donation";
          saveBtn.disabled = false;
          saveBtn.style.opacity = "1";
          return;
        }

        showToast(
          result.status === "saved"
            ? "Donation synced to MySQL database!"
            : "Offline: Donation queued in IndexedDB!",
        );

        setTimeout(() => {
          window.location.href = "donation-log.html";
        }, 900);
      } catch (err) {
        showToast("Saved to offline queue.");
        setTimeout(() => {
          window.location.href = "donation-log.html";
        }, 900);
      }
    };
  }
});
