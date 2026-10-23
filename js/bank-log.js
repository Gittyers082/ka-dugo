const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];

const MOCK_DONATIONS = [
    {
        id: "d-1042",
        donor_name: "Elena<br>Rostova",
        blood_type: "O-",
        component: "Whole Blood<br>(450 mL)",
        units: 1,
        station: "Bay 2",
        collected_at: "Today, 11:20 AM",
        collected_by: "Phlebotomist D. Clark (Cert #608)",
        link_type: "Allocated Dept",
        link_value: "Trauma ICU - Bay 4 (Stat Reserve)",
        link_icon: "building",
        drive: "Downtown Blood Drive #D-401",
        notes: "Clean right antecubital puncture; donor well-tolerated 450 mL draw without vasovagal reaction or hematoma.",
        status: "pending",
        status_sub: "uuid: c7a2-41e9",
        can_delete: true
    },
    {
        id: "d-1041",
        donor_name: "Marcus<br>Vance",
        blood_type: "O-",
        component: "Packed Red Blood<br>Cells (PRBC)",
        units: 1,
        station: "Bay 1",
        collected_at: "Today, 09:45 AM",
        collected_by: "Nurse Sarah Jenkins (RN #4402)",
        link_type: "Linked Request",
        link_value: "REQ-104 (Emergency Dept Resus - Trauma Bay)",
        link_icon: "asterisk",
        notes: "Smooth draw via left median cubital vein; donor vitals stable post-donation (BP 118/74). Rapid dispatch requested.",
        status: "synced",
        status_sub: "10:02 AM",
        can_delete: false
    },
    {
        id: "d-1040",
        donor_name: "Sarah<br>Jenkins",
        blood_type: "A+",
        component: "Platelets<br>Apheresis (Trima Accel)",
        units: 1,
        station: "Apheresis Suite 1",
        collected_at: "Yesterday, 16:15 PM",
        collected_by: "Specialist M. Davies (CLS #119)",
        link_type: "Target Ward",
        link_value: "Hematology/Oncology Unit (Infusion 3)",
        link_icon: "building",
        notes: "Apheresis cycle runtime 68 min. Anticoagulant infusion tolerated; mild perioral paresthesia resolved with oral calcium tablet.",
        status: "synced",
        status_sub: "Oct 23, 16:30 PM",
        can_delete: false
    },
    {
        id: "d-1039",
        donor_name: "David<br>Kim",
        blood_type: "B+",
        component: "2x PRBC (Double<br>Red Alyx)",
        units: 2,
        station: "Apheresis Suite 2",
        collected_at: "Oct 23, 14:10 PM",
        collected_by: "Nurse Sarah Jenkins (RN #4402)",
        link_type: "Target Ward",
        link_value: "Surgical Ward 3B (Pre-op Crossmatch)",
        link_icon: "building",
        notes: "Saline compensation 500 mL infused. Pre-procedure Hgb 15.2 g/dL. No complaints, full recovery in observation lounge.",
        status: "synced",
        status_sub: "Verified",
        can_delete: false
    }
];

const state = {
    donations: MOCK_DONATIONS,
    query: "",
    activeType: "All Types",
    sort: "newest",
    pendingDeleteId: null,
    editingId: null
};

// ============================================================================
// DOM HELPER
// ============================================================================
function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(props)) {
        if (key === "class") node.className = val;
        else if (key === "innerHTML") node.innerHTML = val;
        else if (key === "onclick") node.onclick = val;
        else if (val !== null && val !== undefined) node.setAttribute(key, val);
    }
    kids.flat().forEach((kid) => {
        if (kid === null || kid === undefined || kid === false) return;
        node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
    return node;
}

const ICONS = {
    clock: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    building: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)" stroke-width="2"><path d="M3 21h18"></path><path d="M9 8h6"></path><path d="M12 5v6"></path><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path></svg>`,
    asterisk: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--urgent)" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="19.07" y2="4.93"></line></svg>`,
    pin: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
    edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
    eye: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    sync: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
};

// ============================================================================
// UI FEEDBACK & ACTIONS
// ============================================================================

let toastTimer;
function showToast(message) {
    const toastEl = document.getElementById("toast");
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3000);
}

// ---- Edit Flow ----
function openEdit(id) {
    const record = state.donations.find(d => d.id === id);
    if (!record) return;
    state.editingId = id;

    const cleanName = record.donor_name.replace("<br>", " ");
    document.getElementById("edit-donor-name").textContent = cleanName;
    document.getElementById("edit-id").value = record.id;
    document.getElementById("edit-component").value = record.component.replace("<br>", " ");
    document.getElementById("edit-units").value = record.units;
    document.getElementById("edit-station").value = record.station;
    document.getElementById("edit-notes").value = record.notes;

    const dialog = document.getElementById("edit-dialog");
    if (dialog) dialog.showModal();
}

function closeEdit() {
    state.editingId = null;
    const dialog = document.getElementById("edit-dialog");
    if (dialog) dialog.close();
}

function handleEditSubmit(e) {
    e.preventDefault();
    if (!state.editingId) return;

    const recordIndex = state.donations.findIndex(d => d.id === state.editingId);
    if (recordIndex > -1) {
        state.donations[recordIndex].component = document.getElementById("edit-component").value;
        state.donations[recordIndex].units = parseInt(document.getElementById("edit-units").value, 10);
        state.donations[recordIndex].station = document.getElementById("edit-station").value;
        state.donations[recordIndex].notes = document.getElementById("edit-notes").value;

        renderList();
        showToast("Record updated successfully");
    }

    closeEdit();
}

// ---- Details Flow ----
function openDetails(id) {
    const record = state.donations.find(d => d.id === id);
    if (!record) return;

    const content = document.getElementById("details-content");
    content.innerHTML = `
        <div class="details-grid">
            <div><strong>Donor Name</strong><span>${record.donor_name.replace("<br>", " ")} (Type: ${record.blood_type})</span></div>
            <div><strong>Component</strong><span>${record.component.replace("<br>", " ")}</span></div>
            <div><strong>Collection</strong><span>${record.units} Unit(s) at ${record.station}</span></div>
            <div><strong>Time & Staff</strong><span>${record.collected_at} by ${record.collected_by}</span></div>
            ${record.link_type ? `<div><strong>${record.link_type}</strong><span>${record.link_value}</span></div>` : ''}
            ${record.drive ? `<div><strong>Drive</strong><span>${record.drive}</span></div>` : ''}
            <div><strong>Clinical Observations</strong><span>${record.notes || "None"}</span></div>
            <div><strong>Sync Status</strong><span>${record.status === 'pending' ? 'Pending Sync' : 'Synced'}</span></div>
        </div>
    `;

    const dialog = document.getElementById("details-dialog");
    if (dialog) dialog.showModal();
}

function closeDetails() {
    const dialog = document.getElementById("details-dialog");
    if (dialog) dialog.close();
}

// ---- Delete Flow ----
function openDeleteConfirm(id) {
    state.pendingDeleteId = id;
    const dialog = document.getElementById("delete-dialog");
    if (dialog) dialog.showModal();
}

function closeDeleteConfirm() {
    state.pendingDeleteId = null;
    const dialog = document.getElementById("delete-dialog");
    if (dialog) dialog.close();
}

function confirmDelete() {
    if (!state.pendingDeleteId) return;
    state.donations = state.donations.filter((d) => d.id !== state.pendingDeleteId);
    closeDeleteConfirm();
    renderList();
    showToast("Donation record deleted successfully");
}

// ============================================================================
// RENDERING
// ============================================================================

function renderChips() {
    const chipsContainer = document.getElementById("type-chips");
    if (!chipsContainer) return;

    chipsContainer.textContent = "";
    ["All Types", ...BLOOD_TYPES].forEach((type) => {
        const chip = el(
            "button",
            {
                type: "button",
                class: type === state.activeType ? "dl-chip active" : "dl-chip",
                onclick: () => {
                    state.activeType = type;
                    renderChips();
                    renderList();
                }
            },
            type === "All Types" ? type : `Type ${type}`
        );
        chipsContainer.append(chip);
    });
}

function buildCard(d) {
    const isPending = d.status === "pending";
    const statusIcon = isPending ? ICONS.sync : ICONS.check;
    const statusClass = isPending ? "status-pill pending" : "status-pill synced";
    const cardClass = isPending ? "card dl-card pending-sync" : "card dl-card";
    const statusLabel = isPending ? "Pending<br>Sync" : "Synced";

    const topRow = el("div", { class: "card-top" },
        el("div", { class: "donor-identity" },
            el("h3", { innerHTML: d.donor_name }),
            el("span", { class: "blood-badge" }, d.blood_type),
            el("span", { class: "component-pill", innerHTML: d.component })
        ),
        el("div", { class: "status-col" },
            el("span", { class: statusClass, innerHTML: `${statusIcon} <span style="text-align: left;">${statusLabel}</span>` }),
            el("span", { class: "status-sub" }, d.status_sub)
        )
    );

    const meta = el("p", { class: "unit-meta" }, `${d.units} Unit${d.units > 1 ? 's' : ''} • Station: ${d.station}`);

    const details = el("div", { class: "details-list" },
        el("div", { class: "details-item" },
            el("span", { class: "icon", innerHTML: ICONS.clock }),
            el("span", { innerHTML: `<span class="label">Collected:</span> ${d.collected_at} by ${d.collected_by}` })
        )
    );

    if (d.link_type && d.link_value) {
        details.append(
            el("div", { class: "details-item" },
                el("span", { class: "icon", innerHTML: ICONS[d.link_icon] || ICONS.building }),
                el("span", { innerHTML: `<span class="label">${d.link_type}:</span> <span class="highlight">${d.link_value}</span>` })
            )
        );
    }

    if (d.drive) {
        details.append(
            el("div", { class: "details-item" },
                el("span", { class: "icon", innerHTML: ICONS.pin }),
                el("span", { innerHTML: `<span class="label">Drive:</span> <span class="highlight" style="color: #3d3a3a;">${d.drive}</span>` })
            )
        );
    }

    const clinical = el("div", { class: "clinical-notes" },
        el("strong", {}, "Clinical Observations:"),
        el("p", {}, d.notes)
    );

    const actions = el("div", { class: "card-actions" },
        el("button", { type: "button", class: "btn-action", innerHTML: `${ICONS.edit} Edit`, onclick: () => openEdit(d.id) }),
        el("button", { type: "button", class: "btn-action", innerHTML: `${ICONS.eye} Details`, onclick: () => openDetails(d.id) }),
        d.can_delete ? el("button", { type: "button", class: "btn-action delete", innerHTML: `${ICONS.trash} Delete`, onclick: () => openDeleteConfirm(d.id) }) : null
    );

    return el("div", { class: cardClass }, topRow, meta, details, clinical, actions);
}

function renderList() {
    let list = state.donations.filter((d) => {
        const matchesType = state.activeType === "All Types" || d.blood_type === state.activeType;
        const q = state.query.trim().toLowerCase();
        const cleanName = d.donor_name.replace("<br>", " ").toLowerCase();
        const matchesQuery = !q || cleanName.includes(q);
        return matchesType && matchesQuery;
    });

    if (state.sort === "oldest") {
        list.reverse();
    }

    const cardsContainer = document.getElementById("dl-cards");
    const emptyState = document.getElementById("dl-empty");

    if (!cardsContainer) return;
    cardsContainer.textContent = "";

    if (list.length === 0) {
        if (emptyState) emptyState.hidden = false;
    } else {
        if (emptyState) emptyState.hidden = true;
        list.forEach((d) => cardsContainer.append(buildCard(d)));
    }
}

// ============================================================================
// EVENT LISTENERS & INIT
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
    // Topbar & Search
    const searchInput = document.getElementById("dl-search");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            state.query = e.target.value;
            renderList();
        });
    }

    const sortSelect = document.getElementById("dl-sort");
    if (sortSelect) {
        sortSelect.addEventListener("change", (e) => {
            state.sort = e.target.value;
            renderList();
        });
    }

    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => showToast("Refreshing logs from server..."));

    const broadcastBtn = document.querySelector(".btn-broadcast");
    if (broadcastBtn) broadcastBtn.addEventListener("click", () => showToast("Opening emergency broadcast menu..."));

    // Edit Modal Events
    const editForm = document.getElementById("edit-form");
    if (editForm) editForm.addEventListener("submit", handleEditSubmit);

    const cancelEditX = document.getElementById("cancel-edit-x");
    if (cancelEditX) cancelEditX.addEventListener("click", closeEdit);

    const cancelEditBtn = document.getElementById("cancel-edit-btn");
    if (cancelEditBtn) cancelEditBtn.addEventListener("click", closeEdit);

    const editDialog = document.getElementById("edit-dialog");
    if (editDialog) {
        editDialog.addEventListener("click", (event) => {
            if (event.target === editDialog) closeEdit();
        });
    }

    // Details Modal Events
    const closeDetailsX = document.getElementById("close-details-x");
    if (closeDetailsX) closeDetailsX.addEventListener("click", closeDetails);

    const closeDetailsBtn = document.getElementById("close-details-btn");
    if (closeDetailsBtn) closeDetailsBtn.addEventListener("click", closeDetails);

    const detailsDialog = document.getElementById("details-dialog");
    if (detailsDialog) {
        detailsDialog.addEventListener("click", (event) => {
            if (event.target === detailsDialog) closeDetails();
        });
    }

    // Delete Modal Events
    const cancelDelX = document.getElementById("cancel-delete-x");
    const cancelDelBtn = document.getElementById("cancel-delete-btn");
    const confirmDelBtn = document.getElementById("confirm-delete-btn");
    const deleteDialog = document.getElementById("delete-dialog");

    if (cancelDelX) cancelDelX.addEventListener("click", closeDeleteConfirm);
    if (cancelDelBtn) cancelDelBtn.addEventListener("click", closeDeleteConfirm);
    if (confirmDelBtn) confirmDelBtn.addEventListener("click", confirmDelete);

    if (deleteDialog) {
        deleteDialog.addEventListener("click", (event) => {
            if (event.target === deleteDialog) closeDeleteConfirm();
        });
    }

    // Initial Render
    renderChips();
    renderList();
});

// ============================================================================
// BROADCAST ALERT MODAL LOGIC
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
    const broadcastBtn = document.getElementById("broadcast-alert-btn");
    const broadcastDialog = document.getElementById("broadcast-dialog");
    const closeBroadcastX = document.getElementById("close-broadcast-x");
    const dispatchBtn = document.getElementById("dispatch-alert-btn");

    // Editor Elements
    const bloodButtons = document.querySelectorAll("#broadcast-blood-grid .blood");
    const radiusSlider = document.getElementById("broadcast-radius");
    const radiusDisplay = document.getElementById("radius-display");
    const reachDisplay = document.getElementById("reach-display");
    const msgInput = document.getElementById("broadcast-msg");
    const charCount = document.getElementById("char-count");
    const previewBody = document.getElementById("preview-body");

    // 1. Open/Close Modal
    if (broadcastBtn && broadcastDialog) {
        broadcastBtn.addEventListener("click", () => {
            broadcastDialog.showModal();
        });
    }

    if (closeBroadcastX && broadcastDialog) {
        closeBroadcastX.addEventListener("click", () => {
            broadcastDialog.close();
        });
    }

    // 2. Blood Type Selector
    bloodButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            bloodButtons.forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");

            // Auto-update message template with new blood type
            const type = btn.dataset.type;
            const currentMsg = msgInput.value;
            msgInput.value = currentMsg.replace(/\b(?:O|A|B|AB)[+-]\b/g, type);
            updatePreview();
        });
    });

    // 3. Radius Slider Logic
    if (radiusSlider) {
        radiusSlider.addEventListener("input", (e) => {
            const val = e.target.value;
            radiusDisplay.textContent = `${val} km`;

            // Simulate changing reach numbers based on radius
            const estimatedDonors = {
                5: 48, 10: 91, 15: 142, 20: 198, 25: 251, 30: 317
            };
            reachDisplay.textContent = `${estimatedDonors[val]} Donors`;

            // Update lock screen preview footer
            const footerSpan = document.querySelector(".notif-footer span");
            if (footerSpan) footerSpan.textContent = `⌾ Within ${val}km Geofence`;
        });
    }

    // 4. Live Message Editor Preview
    function updatePreview() {
        const text = msgInput.value;
        charCount.textContent = `${text.length} / 280`;
        previewBody.textContent = text || "Your alert message will appear here.";
    }

    if (msgInput) {
        msgInput.addEventListener("input", updatePreview);
    }

    // 5. Dispatch Action
    if (dispatchBtn) {
        dispatchBtn.addEventListener("click", () => {
            const originalText = dispatchBtn.innerHTML;
            dispatchBtn.disabled = true;
            dispatchBtn.innerHTML = "Dispatching...";

            // Simulate API request delay
            setTimeout(() => {
                broadcastDialog.close();
                showToast(`Emergency alert dispatched to ${reachDisplay.textContent}`);

                // Reset button
                dispatchBtn.disabled = false;
                dispatchBtn.innerHTML = originalText;
            }, 1200);
        });
    }
});