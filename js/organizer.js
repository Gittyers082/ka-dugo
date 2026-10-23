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
  event.preventDefault();
  document.querySelectorAll(".bottom-nav a").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
  showToast(`${link.textContent.trim()} section selected`);
}));

updateRadius();
updateMessage();
