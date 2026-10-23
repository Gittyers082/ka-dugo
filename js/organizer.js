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

document.querySelector(".editor-footer button").addEventListener("click", () => {
  const type = document.querySelector(".blood.selected").dataset.type;
  message.value = template.replace("O-", type);
  updateMessage();
  showToast("Protocol template restored");
});

document.querySelector(".draft").addEventListener("click", () => {
  const draft = { message: message.value, radius: radiusInput.value, blood: document.querySelector(".blood.selected").dataset.type };
  localStorage.setItem("hemasync-alert-draft", JSON.stringify(draft));
  showToast("Draft saved on this device");
});

document.querySelector(".refresh").addEventListener("click", () => {
  const draft = JSON.parse(localStorage.getItem("hemasync-alert-draft") || "null");
  if (!draft) return showToast("No saved draft found");
  const target = [...bloodButtons].find((button) => button.dataset.type === draft.blood);
  target?.click();
  radiusInput.value = draft.radius;
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
document.querySelector(".approve-dialog").addEventListener("click", () => {
  dialog.close();
  document.querySelector(".dispatch").textContent = "✓  Alert Dispatched";
  document.querySelector(".dispatch").classList.add("sent");
  showToast("Alert dispatched to eligible donors");
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
