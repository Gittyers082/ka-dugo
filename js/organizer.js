if (document.querySelector(".app-shell")) {
const template = "URGENT: Metro Red Cross & Civic Health Org need O- donors for City Hall Blood Drive this Saturday, Nov 2. Immediate slots open. Tap to confirm booking.";
const bloodButtons = document.querySelectorAll(".blood");
const notice = document.querySelector(".notice");
const radiusInput = document.querySelector(".radius-input");
const rangeDot = document.querySelector(".range i");
const radiusTag = document.querySelector(".tag");
const reachNumber = document.querySelector(".reach strong");
const reachText = document.querySelector(".reach span");
const radiusLabels = document.querySelectorAll(".range-labels span");
const message = document.querySelector("textarea");
const counter = document.querySelector(".counter");
const previewMessage = document.querySelector(".alert-preview p");
const form = document.querySelector("form");
const dialog = document.querySelector(".confirm-dialog");
const toast = document.querySelector(".toast");
let toastTimer;
const ALERTS_API = "../../api/alerts.php";
const bloodTypeIds = { "A+": 1, "A-": 2, "B+": 3, "B-": 4, "AB+": 5, "AB-": 6, "O+": 7, "O-": 8 };

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function formatType(type) {
  const names = { "O-": "O-Negative", "O+": "O-Positive", "A-": "A-Negative", "A+": "A-Positive", "B-": "B-Negative", "B+": "B-Positive", "AB-": "AB-Negative", "AB+": "AB-Positive" };
  return names[type];
}

bloodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    bloodButtons.forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    const type = button.dataset.type;
    notice.innerHTML = `<b>ⓘ</b> Selected: <strong>${formatType(type)}</strong> (${button.dataset.role})`;
    message.value = message.value.replace(/\b(?:O|A|B|AB)[+-]\b/g, type);
    updateMessage();
    showToast(`${formatType(type)} selected`);
  });
});

function updateRadius() {
  const value = Number(radiusInput.value);
  const percentage = ((value - 5) / 25) * 100;
  const donors = { 5: 48, 10: 91, 15: 142, 20: 198, 25: 251, 30: 317 }[value];
  rangeDot.style.left = `${percentage}%`;
  radiusTag.textContent = `${value} km Radius`;
  reachNumber.textContent = `${donors} Donors`;
  reachText.textContent = `Eligible & active within ${value} km`;
  radiusLabels.forEach((label) => label.classList.toggle("active", Number(label.querySelector("b").textContent.replace(" km", "")) === value));
}
radiusInput.addEventListener("input", updateRadius);

document.querySelectorAll(".delivery-option input").forEach((input) => {
  input.addEventListener("change", () => input.closest(".delivery-option").classList.toggle("off", !input.checked));
});

function updateMessage() {
  counter.textContent = `${message.value.length} / 280`;
  previewMessage.textContent = message.value || "Your alert message will appear here.";
}
message.addEventListener("input", updateMessage);

function selectedChannel() {
  const channels = [...document.querySelectorAll(".delivery-option input")]
    .filter((input) => input.checked)
    .map((input) => input.parentElement.textContent.includes("Push") ? "push" : "sms");
  return channels.includes("push") ? "push" : channels[0];
}

function alertPayload(status) {
  return {
    sender_type: "organizer",
    organizer_id: 1,
    drive_id: 1,
    blood_type_id: bloodTypeIds[document.querySelector(".blood.selected").dataset.type],
    level: 2,
    message: message.value.trim(),
    status,
    channel: selectedChannel()
  };
}

async function saveAlert(status) {
  const response = await fetch(ALERTS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(alertPayload(status))
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.message || "The alert could not be saved.");
  return result.data;
}

document.querySelector(".editor-footer button").addEventListener("click", () => {
  const type = document.querySelector(".blood.selected").dataset.type;
  message.value = template.replace("O-", type);
  updateMessage();
  showToast("Protocol template restored");
});

document.querySelector(".draft").addEventListener("click", () => {
  if (!message.value.trim()) return showToast("Add an alert message before saving a draft");
  const draft = {
    message: message.value,
    radius: radiusInput.value,
    blood: document.querySelector(".blood.selected").dataset.type,
    push: document.querySelectorAll(".delivery-option input")[0].checked,
    sms: document.querySelectorAll(".delivery-option input")[1].checked
  };
  localStorage.setItem("hemasync-alert-draft", JSON.stringify(draft));
  saveAlert("draft")
    .then((data) => showToast(`Draft #${data.alert_id} saved to Ka-dugo`))
    .catch(() => showToast("Draft saved locally; backend is unavailable"));
});

document.querySelector(".refresh").addEventListener("click", () => {
  const draft = JSON.parse(localStorage.getItem("hemasync-alert-draft") || "null");
  if (!draft) return showToast("No saved draft found");
  const target = [...bloodButtons].find((button) => button.dataset.type === draft.blood);
  target?.click();
  radiusInput.value = draft.radius;
  const deliveryInputs = document.querySelectorAll(".delivery-option input");
  deliveryInputs[0].checked = draft.push ?? true;
  deliveryInputs[1].checked = draft.sms ?? true;
  deliveryInputs.forEach((input) => input.closest(".delivery-option").classList.toggle("off", !input.checked));
  updateRadius();
  message.value = draft.message;
  updateMessage();
  showToast("Saved draft restored");
});

form.addEventListener("submit", (event) => event.preventDefault());
document.querySelector(".dispatch").addEventListener("click", () => {
  if (!message.value.trim()) return showToast("Add an alert message before dispatching");
  if (![...document.querySelectorAll(".delivery-option input")].some((input) => input.checked)) return showToast("Select at least one delivery channel");
  dialog.showModal();
});
document.querySelector(".close-dialog").addEventListener("click", () => dialog.close());
document.querySelector(".cancel-dialog").addEventListener("click", () => dialog.close());
document.querySelector(".approve-dialog").addEventListener("click", async () => {
  const approveButton = document.querySelector(".approve-dialog");
  approveButton.disabled = true;
  approveButton.textContent = "Dispatching…";
  try {
    const data = await saveAlert("active");
    dialog.close();
    document.querySelector(".dispatch").textContent = "✓  Alert Dispatched";
    document.querySelector(".dispatch").classList.add("sent");
    showToast(`Alert sent to ${data.recipients_notified ?? 0} eligible donors`);
  } catch (error) {
    showToast(error.message);
  } finally {
    approveButton.disabled = false;
    approveButton.textContent = "Dispatch now";
  }
});
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
document.querySelectorAll(".bottom-nav a").forEach((link) => link.addEventListener("click", (event) => {
  if (!link.dataset.placeholder) return;
  event.preventDefault();
  document.querySelectorAll(".bottom-nav a").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
  showToast(`${link.textContent.trim()} is outside this organizer module`);
}));

updateRadius();
updateMessage();
}

if (document.querySelector(".drive-app")) {
  const API = "../../api/drives.php";
  const driveForm = document.querySelector("#drive-form"), list = document.querySelector("#drive-list"), slotsValue = document.querySelector("#slots-value"), toast = document.querySelector("#toast");
  let slots = 60, timer;
  const note = (text) => { toast.textContent = text; toast.classList.add("show"); clearTimeout(timer); timer = setTimeout(() => toast.classList.remove("show"), 3000); };
  const esc = (value) => { const el = document.createElement("div"); el.textContent = value ?? ""; return el.innerHTML; };
  const localDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const date = (value) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));
  const time = (value) => { const [h, m] = value.slice(0, 5).split(":").map(Number); return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, h, m)); };
  const drivePayload = () => ({ organizer_id: 1, bank_id: 1, title: document.querySelector("#title").value.trim(), venue: document.querySelector("#venue").value.trim(), drive_date: document.querySelector("#drive-date").value, start_time: document.querySelector("#start-time").value, end_time: document.querySelector("#end-time").value, slots_total: slots, category: document.querySelector("#category").value, status: "scheduled", blood_type_ids: [1, 3, 7, 8] });
  const setSlots = (change) => { slots = Math.max(4, Math.min(2000, slots + change)); slotsValue.textContent = slots; };
  function render(drives) {
    document.querySelector("#drive-total").textContent = drives.length; document.querySelector("#managed-count").textContent = drives.length;
    document.querySelector("#active-count").textContent = drives.filter((d) => ["scheduled", "ongoing"].includes(d.status)).length;
    document.querySelector("#registration-count").textContent = drives.reduce((n, d) => n + Number(d.registered_count || 0), 0);
    list.innerHTML = drives.length ? drives.map((d) => { const booked = Number(d.registered_count || 0), total = Number(d.slots_total || 0), rate = total ? Math.min(100, Math.round(booked / total * 100)) : 0; return `<article class="drive-item"><div class="top"><span class="status ${esc(d.status)}">${esc(d.status).toUpperCase()}</span><small>${esc(d.ref_code)}</small></div><h3>${esc(d.title)}</h3><div class="meta"><span>▦ ${date(d.drive_date)}</span><span>◷ ${time(d.start_time)} – ${time(d.end_time)}</span><span>⌾ ${esc(d.venue)}</span></div><div class="progress-label"><span>${booked} / ${total} Slots Booked</span><span>${rate}% Fill Rate</span></div><div class="progress"><i style="width:${rate}%"></i></div><div class="drive-actions"><button type="button">Manage Registrations</button><button type="button" class="cancel" data-id="${d.drive_id}">Cancel Drive</button></div></article>`; }).join("") : '<p class="empty">No drives have been scheduled yet.</p>';
  }
  async function loadDrives() { try { const response = await fetch(`${API}?organizer_id=1`), result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to load drives."); render(result.data.drives); } catch (error) { list.innerHTML = `<p class="empty">${esc(error.message)} Start PHP and MySQL, then refresh.</p>`; } }
  driveForm.addEventListener("submit", async (event) => { event.preventDefault(); const data = drivePayload(); if (data.end_time <= data.start_time) return note("End time must be later than start time."); const button = driveForm.querySelector(".publish"); button.disabled = true; button.textContent = "Publishing…"; try { const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) }), result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "The drive could not be created."); note(`Drive ${result.data.ref_code} published with ${result.data.slots_created} slots.`); loadDrives(); } catch (error) { note(error.message); } finally { button.disabled = false; button.textContent = "↥   Publish & Open Donor Registration"; } });
  document.querySelector("#plus").onclick = () => setSlots(4); document.querySelector("#minus").onclick = () => setSlots(-4); document.querySelector("#reload").onclick = () => { loadDrives(); note("Drive list refreshed"); }; document.querySelector("#view-drives").onclick = () => document.querySelector("#scheduled").scrollIntoView({ behavior: "smooth" });
  document.querySelector("#location").onclick = () => { if (!navigator.geolocation) return note("GPS is not available in this browser."); navigator.geolocation.getCurrentPosition((p) => { document.querySelector("#latitude").value = `${p.coords.latitude.toFixed(4)}° N`; document.querySelector("#longitude").value = `${p.coords.longitude.toFixed(4)}° E`; note("Current GPS location captured"); }, () => note("Location permission was not granted."), { enableHighAccuracy: true, timeout: 10000 }); };
  list.addEventListener("click", async (event) => { const button = event.target.closest(".cancel"); if (!button || !confirm("Cancel this drive? Registered donors may be affected.")) return; try { const response = await fetch(API, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drive_id: Number(button.dataset.id) }) }), result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || "Unable to cancel drive."); note("Drive cancelled"); loadDrives(); } catch (error) { note(error.message); } });
  document.querySelector("#drive-date").value = localDate(); loadDrives();
}

if (document.querySelector(".dashboard-app")) {
  const dashDrives = document.querySelector("#dash-drives");
  const dashRegistrations = document.querySelector("#dash-registrations");
  const dashAlerts = document.querySelector("#dash-alerts");
  const dashList = document.querySelector("#dashboard-drives");
  const escapeDashboard = (value) => { const element = document.createElement("div"); element.textContent = value ?? ""; return element.innerHTML; };
  const dashboardDate = (value) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
  async function refreshDashboard() {
    try {
      const [drivesResponse, alertsResponse] = await Promise.all([fetch("../../api/drives.php?organizer_id=1"), fetch("../../api/alerts.php?organizer_id=1")]);
      const drivesResult = await drivesResponse.json(), alertsResult = await alertsResponse.json();
      if (!drivesResponse.ok || !drivesResult.success) throw new Error(drivesResult.message || "Unable to load drives.");
      const drives = drivesResult.data.drives;
      dashDrives.textContent = drives.filter((drive) => ["scheduled", "ongoing"].includes(drive.status)).length;
      dashRegistrations.textContent = drives.reduce((total, drive) => total + Number(drive.registered_count || 0), 0);
      dashList.innerHTML = drives.length ? drives.slice(0, 3).map((drive) => `<article class="dashboard-drive"><h3>${escapeDashboard(drive.title)}</h3><p>${dashboardDate(drive.drive_date)} · ${escapeDashboard(drive.venue)} · ${Number(drive.registered_count || 0)} registrations</p></article>`).join("") : '<p class="empty">No drives have been scheduled yet.</p>';
      dashAlerts.textContent = alertsResponse.ok && alertsResult.success ? alertsResult.data.alerts.filter((alert) => alert.status === "active").length : "—";
    } catch (error) { dashDrives.textContent = dashRegistrations.textContent = dashAlerts.textContent = "—"; dashList.innerHTML = `<p class="empty">${escapeDashboard(error.message)} Start PHP and MySQL, then refresh.</p>`; }
  }
  document.querySelector("#dashboard-refresh").addEventListener("click", refreshDashboard);
  refreshDashboard();
}
