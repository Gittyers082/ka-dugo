import { getAllRecords, putRecord, deleteRecord } from '../db.js';

const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];

const state = {
  donations: [],
  query: "",
  activeType: "All Types",
  sort: "newest",
  pendingDeleteId: null,
  editingId: null,
};

// ============================================================================
// SAFE DOM HELPERS (Zero innerHTML for strict security)
// ============================================================================

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (key === "className" || key === "class") node.className = val;
    else if (key === "text") node.textContent = val;
    else if (key.startsWith("data-")) node.setAttribute(key, val);
    else if (key.startsWith("on") && typeof val === "function") node.addEventListener(key.substring(2).toLowerCase(), val);
    else if (val !== null && val !== undefined) node.setAttribute(key, val);
  }
  children.flat().forEach(child => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function createIcon(svgString) {
  return new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
}

function formatBr(text) {
  const frag = document.createDocumentFragment();
  const parts = (text || "").split("<br>");
  parts.forEach((part, idx) => {
    frag.appendChild(document.createTextNode(part));
    if (idx < parts.length - 1) frag.appendChild(document.createElement("br"));
  });
  return frag;
}

const ICONS = {
  clock: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  building: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)" stroke-width="2"><path d="M3 21h18"></path><path d="M9 8h6"></path><path d="M12 5v6"></path><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path></svg>`,
  pin: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
  edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  eye: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
  trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  sync: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
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
  const record = state.donations.find((d) => d.id === id);
  if (!record) return;
  state.editingId = id;

  document.getElementById("edit-donor-name").textContent = record.donor_name.replace(/<br>/g, " ");
  document.getElementById("edit-id").value = record.id;
  document.getElementById("edit-component").value = record.component.replace(/<br>/g, " ");
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

// Sends a change to the API; returns null on success or a message to show.
async function sendDonationChange(method, body) {
  try {
    const res = await fetch("../../api/donations.php", {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok && json.ok ? null : (json.error || `The server rejected the change (${res.status}).`);
  } catch (err) {
    return "You're offline. Saved records can only be changed while connected.";
  }
}

async function handleEditSubmit(e) {
  e.preventDefault();
  if (!state.editingId) return;

  const id = String(state.editingId);
  const newUnits = parseInt(document.getElementById("edit-units").value, 10);
  const recordIndex = state.donations.findIndex((d) => d.id === state.editingId);
  if (!(newUnits >= 1 && newUnits <= 10)) return showToast("Units must be between 1 and 10.");

  if (id.startsWith("db-")) {
    const error = await sendDonationChange("PUT", { donation_id: Number(id.slice(3)), units: newUnits });
    if (error) return showToast(error);
  } else {
    // Still in the offline queue: change the record that will be synced, not just the screen.
    const queued = (await getAllRecords()).find((r) => r.client_uuid === id);
    if (queued) await putRecord({ ...queued, payload: { ...queued.payload, units: newUnits } });
  }

  if (recordIndex > -1) {
    state.donations[recordIndex].component = document.getElementById("edit-component").value;
    state.donations[recordIndex].units = newUnits;
    state.donations[recordIndex].station = document.getElementById("edit-station").value;
    state.donations[recordIndex].notes = document.getElementById("edit-notes").value;
    renderList();
    showToast("Record updated");
  }
  closeEdit();
}

// ---- Details Flow ----
function openDetails(id) {
  const record = state.donations.find((d) => d.id === id);
  if (!record) return;

  const content = document.getElementById("details-content");
  content.textContent = "";

  const grid = el("div", { class: "details-grid" },
    el("div", {}, el("strong", { text: "Donor Name" }), el("span", { text: `${record.donor_name.replace(/<br>/g, " ")} (Type: ${record.blood_type})` })),
    el("div", {}, el("strong", { text: "Component" }), el("span", { text: record.component.replace(/<br>/g, " ") })),
    el("div", {}, el("strong", { text: "Collection" }), el("span", { text: `${record.units} Unit(s) at ${record.station}` })),
    el("div", {}, el("strong", { text: "Time & Staff" }), el("span", { text: `${record.collected_at} by ${record.collected_by}` }))
  );

  if (record.link_type && record.link_value) {
    grid.append(el("div", {}, el("strong", { text: record.link_type }), el("span", { text: record.link_value })));
  }

  grid.append(
    el("div", {}, el("strong", { text: "Clinical Observations" }), el("span", { text: record.notes || "None" })),
    el("div", {}, el("strong", { text: "Sync Status" }), el("span", { text: record.status === "pending" ? "Pending Sync" : "Synced" }))
  );

  content.append(grid);
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

async function confirmDelete() {
  if (!state.pendingDeleteId) return;
  const id = String(state.pendingDeleteId);

  if (id.startsWith("db-")) {
    const error = await sendDonationChange("DELETE", { donation_id: Number(id.slice(3)) });
    if (error) {
      closeDeleteConfirm();
      return showToast(error);
    }
  } else {
    // Remove it from the offline queue too, or it would reappear and still sync.
    await deleteRecord(id);
  }

  state.donations = state.donations.filter((d) => d.id !== state.pendingDeleteId);
  closeDeleteConfirm();
  renderList();
  showToast("Donation record deleted");
}

// ============================================================================
// RENDERING
// ============================================================================

function renderChips() {
  const chipsContainer = document.getElementById("type-chips");
  if (!chipsContainer) return;
  chipsContainer.textContent = "";

  ["All Types", ...BLOOD_TYPES].forEach((type) => {
    chipsContainer.append(
      el("button", {
        type: "button",
        class: type === state.activeType ? "dl-chip active" : "dl-chip",
        text: type === "All Types" ? type : `Type ${type}`,
        onclick: () => {
          state.activeType = type;
          renderChips();
          renderList();
        }
      })
    );
  });
}

function buildCard(d) {
  const isPending = d.status === "pending";
  const statusClass = isPending ? "status-pill pending" : "status-pill synced";
  const cardClass = isPending ? "card dl-card pending-sync" : "card dl-card";

  const topRow = el("div", { class: "card-top" },
    el("div", { class: "donor-identity" },
      el("h3", {}, formatBr(d.donor_name)),
      el("span", { class: "blood-badge", text: d.blood_type }),
      el("span", { class: "component-pill" }, formatBr(d.component))
    ),
    el("div", { class: "status-col" },
      el("span", { class: statusClass },
        createIcon(isPending ? ICONS.sync : ICONS.check),
        el("span", { style: "text-align: left;" }, formatBr(isPending ? "Pending<br>Sync" : "Synced"))
      ),
      el("span", { class: "status-sub", text: d.status_sub })
    )
  );

  const meta = el("p", { class: "unit-meta", text: `${d.units} Unit${d.units > 1 ? "s" : ""} • Station: ${d.station}` });

  const details = el("div", { class: "details-list" },
    el("div", { class: "details-item" },
      el("span", { class: "icon" }, createIcon(ICONS.clock)),
      el("span", {}, el("span", { class: "label", text: "Collected: " }), document.createTextNode(`${d.collected_at} by ${d.collected_by}`))
    )
  );

  if (d.link_type && d.link_value) {
    details.append(
      el("div", { class: "details-item" },
        el("span", { class: "icon" }, createIcon(ICONS.building)),
        el("span", {}, el("span", { class: "label", text: `${d.link_type}: ` }), el("span", { class: "highlight", text: d.link_value }))
      )
    );
  }

  const clinical = el("div", { class: "clinical-notes" },
    el("strong", { text: "Clinical Observations:" }),
    el("p", { text: d.notes })
  );

  const actions = el("div", { class: "card-actions" },
    el("button", { type: "button", class: "btn-action", onclick: () => openEdit(d.id) }, createIcon(ICONS.edit), document.createTextNode(" Edit")),
    el("button", { type: "button", class: "btn-action", onclick: () => openDetails(d.id) }, createIcon(ICONS.eye), document.createTextNode(" Details"))
  );

  if (d.can_delete) {
    actions.append(el("button", { type: "button", class: "btn-action delete", onclick: () => openDeleteConfirm(d.id) }, createIcon(ICONS.trash), document.createTextNode(" Delete")));
  }

  return el("div", { class: cardClass }, topRow, meta, details, clinical, actions);
}

function renderList() {
  const list = state.donations.filter((d) => {
    const matchesType = state.activeType === "All Types" || d.blood_type === state.activeType;
    const q = state.query.trim().toLowerCase();
    const cleanName = d.donor_name.replace(/<br>/g, " ").toLowerCase();
    const matchesQuery = !q || cleanName.includes(q);
    return matchesType && matchesQuery;
  });

  if (state.sort === "oldest") list.reverse();

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
// LIVE API + OFFLINE INDEXEDDB INTEGRATION
// ============================================================================

async function syncDonationLogWithBackend() {
  const merged = [];
  let todayTotal = 0;
  const shiftGoal = 50;

  // 1. Local IndexedDB queue (Pending Sync)
  try {
    const pendingList = (await getAllRecords()).filter(r => r.status === "Pending Sync");
    pendingList.forEach((item) => {
      const p = item.payload || {};
      merged.push({
        id: item.client_uuid,
        donor_name: (p.donor_name || `Donor #${p.donor_id || 1}`).replace(" ", "<br>"),
        blood_type: p.blood_type_code || "O+",
        component: "Whole Blood<br>(450 mL)",
        units: Number(p.units || 1),
        station: "Local Queue",
        collected_at: new Date(item.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        collected_by: "Current Staff",
        link_type: "Offline Queue",
        link_value: "Stored in Local Cache",
        notes: p.notes || "Logged offline — awaiting network sync.",
        status: "pending",
        status_sub: `uuid: ${String(item.client_uuid).slice(0, 8)}`,
        can_delete: true,
      });
    });
  } catch (e) {
    console.warn("Could not read IndexedDB pending donations:", e);
  }

  // 2. Live database; the server already limits rows to the signed-in bank.
  try {
    const res = await fetch("../../api/donations.php");
    const json = await res.json();

    if (json && json.ok && json.data && Array.isArray(json.data.donations)) {
      // Local calendar date (en-CA gives YYYY-MM-DD); toISOString() would use UTC and miss early-morning donations.
      const todayStr = new Date().toLocaleDateString("en-CA");

      json.data.donations.forEach((d) => {
        const units = Number(d.units || 1);
        if (d.collected_at && d.collected_at.startsWith(todayStr) && d.status !== "discarded") todayTotal += units;

        const nameArr = String(d.full_name || "Unknown Donor").split(" ");
        const formattedName = nameArr.length > 1 ? `${nameArr[0]}<br>${nameArr.slice(1).join(" ")}` : nameArr[0];

        merged.push({
          id: `db-${d.donation_id}`,
          donor_name: formattedName,
          blood_type: d.blood_type_code || "O+",
          component: `${d.component_name || "Whole Blood"}<br>(450 mL)`,
          units: units,
          station: d.bank_name || "Central Bank",
          collected_at: d.collected_at,
          collected_by: "System Record",
          link_type: "Status",
          link_value: String(d.status || "collected").toUpperCase(),
          notes: "Verified database record.",
          status: "synced",
          status_sub: `uuid: ${String(d.client_uuid).slice(0, 8)}`,
          can_delete: false,
        });
      });
    }
  } catch (e) {
    console.warn("Could not load donations from the server:", e);
  }

  const pct = Math.min(100, Math.round((todayTotal / shiftGoal) * 100));
  const remaining = Math.max(0, shiftGoal - todayTotal);
  const safeSet = (id, text) => {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  };
  safeSet("log-quota-text", `${todayTotal} / ${shiftGoal} Units`);
  safeSet("log-quota-pct", `(${pct}%)`);
  safeSet("log-quota-remaining", `${remaining} to`);
  safeSet("log-quota-status", pct >= 100 ? "Quota Complete!" : "Tracking...");
  const bar = document.getElementById("log-quota-bar");
  if (bar) bar.style.width = `${pct}%`;

  state.donations = merged;
  renderList();
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
      showToast("Syncing logs securely...");
      syncDonationLogWithBackend();
    });
  }

  // Edit Modal
  const editForm = document.getElementById("edit-form");
  if (editForm) editForm.addEventListener("submit", handleEditSubmit);
  const cancelEditX = document.getElementById("cancel-edit-x");
  const cancelEditBtn = document.getElementById("cancel-edit-btn");
  if (cancelEditX) cancelEditX.addEventListener("click", closeEdit);
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", closeEdit);

  // Details Modal
  const closeDetailsX = document.getElementById("close-details-x");
  const closeDetailsBtn = document.getElementById("close-details-btn");
  if (closeDetailsX) closeDetailsX.addEventListener("click", closeDetails);
  if (closeDetailsBtn) closeDetailsBtn.addEventListener("click", closeDetails);

  // Delete Modal
  const cancelDelX = document.getElementById("cancel-delete-x");
  const cancelDelBtn = document.getElementById("cancel-delete-btn");
  const confirmDelBtn = document.getElementById("confirm-delete-btn");
  if (cancelDelX) cancelDelX.addEventListener("click", closeDeleteConfirm);
  if (cancelDelBtn) cancelDelBtn.addEventListener("click", closeDeleteConfirm);
  if (confirmDelBtn) confirmDelBtn.addEventListener("click", confirmDelete);

  // Initial Render
  renderChips();
  syncDonationLogWithBackend();

  // Custom event listener for IndexedDB background sync triggers
  window.addEventListener("kadugo:synced", syncDonationLogWithBackend);
});

// ============================================================================
// BROADCAST ALERT MODAL LOGIC 
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const broadcastBtn = document.getElementById("broadcast-alert-btn");
  const broadcastDialog = document.getElementById("broadcast-dialog");
  const closeBroadcastX = document.getElementById("close-broadcast-x");
  const dispatchBtn = document.getElementById("dispatch-alert-btn");

  const bloodButtons = document.querySelectorAll("#broadcast-blood-grid .blood");
  const radiusSlider = document.getElementById("broadcast-radius");
  const radiusDisplay = document.getElementById("radius-display");
  const reachDisplay = document.getElementById("reach-display");
  const msgInput = document.getElementById("broadcast-msg");
  const charCount = document.getElementById("char-count");
  const previewBody = document.getElementById("preview-body");

  // Open & Close
  if (broadcastBtn && broadcastDialog) broadcastBtn.addEventListener("click", () => broadcastDialog.showModal());
  if (closeBroadcastX && broadcastDialog) closeBroadcastX.addEventListener("click", () => broadcastDialog.close());

  // Blood Type Selection
  bloodButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      bloodButtons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      const type = btn.dataset.type;

      // Auto-update message with selected blood type
      const currentMsg = msgInput.value;
      msgInput.value = currentMsg.replace(/\b(?:O|A|B|AB)[+-]\b/g, type);
      updatePreview();
    });
  });

  // Geofence Radius Slider
  if (radiusSlider) {
    radiusSlider.addEventListener("input", (e) => {
      const val = e.target.value;
      radiusDisplay.textContent = `${val} km`;

      const estimatedDonors = { 5: 48, 10: 91, 15: 142, 20: 198, 25: 251, 30: 317 };
      reachDisplay.textContent = `${estimatedDonors[val]} Donors`;

      const footerSpan = document.querySelector(".notif-footer span");
      if (footerSpan) footerSpan.textContent = `⌾ Within ${val}km Geofence`;
    });
  }

  // Live Message Editor
  function updatePreview() {
    const text = msgInput.value;
    charCount.textContent = `${text.length} / 280`;
    previewBody.textContent = text || "Your alert message will appear here.";
  }
  if (msgInput) msgInput.addEventListener("input", updatePreview);

  // Dispatch Action
  if (dispatchBtn) {
    dispatchBtn.addEventListener("click", () => {
      const originalText = dispatchBtn.textContent;
      dispatchBtn.disabled = true;
      dispatchBtn.textContent = "Dispatching...";

      setTimeout(() => {
        broadcastDialog.close();
        showToast(`Emergency alert dispatched to ${reachDisplay.textContent}`);
        dispatchBtn.disabled = false;
        dispatchBtn.textContent = "Confirm & Dispatch Alert";
      }, 1200);
    });
  }
});