// Phlebotomist scanner: QR (camera) or typed code -> donor + eligibility -> record the collection.
// Online the record goes straight to api/donations.php; offline (or if the server is down) it waits
// in IndexedDB and js/sync.js sends it when the connection returns. client_uuid prevents duplicates.
import { putRecord } from '../db.js';
import { api } from '../api.js';
import { el, $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { formatDate } from '../ui/format.js';

const MAX_UNITS = 2;

const state = {
    donor: null,       // { donor_id?, qr_code, ... } or { qr_code, unverified: true } when scanned offline
    units: 1,
    clientUuid: crypto.randomUUID(),
    stream: null,
    timer: null,
    lastCode: '',
    lastCodeAt: 0,
};

const viewport = $('#scanner-viewport');
const prompt = $('#scanner-prompt');
const panel = $('#donor-panel');
const saveBtn = $('#save-btn');

/* ---------- small UI pieces ---------- */

function setStep(step) {
    document.querySelectorAll('.progress-stepper .step').forEach((node) => {
        node.classList.toggle('active', Number(node.dataset.step) <= step);
    });
}

function showSaveMode() {
    setText('#save-mode', navigator.onLine ? 'SAVES ONLINE' : 'QUEUES OFFLINE');
}

function beep(success) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'sawtooth';
    osc.frequency.value = success ? 1046.5 : 320;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
}

function renderUnits() {
    $('#units-display').textContent = `${state.units} Unit${state.units > 1 ? 's' : ''} • ${state.units * 450} mL`;
}

function fact(label, value) {
    return el('div', { class: 'data-cell' }, el('dt', { text: label }), el('dd', { text: value }));
}

/* ---------- donor panel ---------- */

function renderDonor(donor) {
    state.donor = donor;
    panel.hidden = false;
    const box = $('#eligibility-box');

    if (donor.unverified) {
        setText('#donor-name', 'Donor details unavailable offline');
        setText('#donor-ref', `QR code: ${donor.qr_code}`);
        setText('#donor-type', '?');
        $('#donor-facts').replaceChildren();
        box.className = 'alert-box is-unverified';
        setText('#eligibility-title', 'Will be verified on sync');
        setText('#eligibility-detail', 'You are offline. The server checks this donor’s eligibility when the record syncs; ineligible records come back as “needs attention”.');
    } else {
        const { eligibility } = donor;
        setText('#donor-name', donor.full_name);
        setText('#donor-ref', `Donor #${donor.donor_id} • ${donor.qr_code}`);
        setText('#donor-type', donor.blood_type_code);
        $('#donor-facts').replaceChildren(
            fact('AGE', eligibility.age === null ? '—' : `${eligibility.age} years`),
            fact('WEIGHT', `${Number(donor.weight_kg)} kg`),
            fact('LAST DONATION', donor.last_donation_date ? formatDate(donor.last_donation_date) : 'First-time donor'),
            fact('TOTAL GIVEN', `${donor.total_units} unit(s)`),
        );
        box.className = `alert-box ${eligibility.is_eligible ? 'is-eligible' : 'is-deferred'}`;
        setText('#eligibility-title', eligibility.is_eligible ? 'Eligible to donate' : 'Not eligible today');
        setText('#eligibility-detail', eligibility.is_eligible
            ? 'Passed the 56-day interval, age, weight and deferral checks.'
            : eligibility.reasons.join(' '));
    }

    const canSave = donor.unverified || donor.eligibility.is_eligible;
    saveBtn.disabled = !canSave;
    setText('#record-ref', `Record ID ${state.clientUuid}`);
    setStep(canSave ? 3 : 2);
}

async function lookup(code) {
    const query = /^\d+$/.test(code) ? { donor_id: code } : { qr_code: code };
    try {
        const donor = await api('donors.php', { query });
        beep(donor.eligibility.is_eligible);
        renderDonor(donor);
        showToast(`${donor.full_name} (${donor.blood_type_code})`);
    } catch (error) {
        beep(false);
        // Offline and never looked up before: a QR code can still be queued and checked on sync.
        if (error.offline && !/^\d+$/.test(code)) {
            renderDonor({ qr_code: code, unverified: true });
            return;
        }
        showToast(error.offline ? 'Offline: scan the donor’s QR code to queue the record.' : error.message, true);
    }
}

/* ---------- camera + QR ---------- */

async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        showToast('Camera unavailable. Type the donor ID or QR code instead.', true);
        return;
    }
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
        showToast('Camera permission denied or no camera found.', true);
        return;
    }

    const video = viewport.querySelector('video') || el('video', { class: 'scanner-video', playsinline: true, muted: true });
    video.muted = true;
    viewport.prepend(video);
    video.srcObject = state.stream;
    await video.play();
    viewport.classList.add('camera-active');
    prompt.textContent = 'ALIGN THE DONOR QR (TAP TO STOP)';

    const decode = await qrDecoder(video);
    if (!decode) {
        setText('#scanner-engine', 'No QR decoder available. Type the code below.');
        return;
    }
    setText('#scanner-engine', '');
    state.timer = setInterval(async () => {
        if (video.readyState < 2) return;
        const value = (await decode())?.trim();
        if (!value) return;
        const now = Date.now();
        if (value === state.lastCode && now - state.lastCodeAt < 3000) return; // same card still in view
        state.lastCode = value;
        state.lastCodeAt = now;
        $('#donor-code').value = value;
        viewport.classList.add('scan-success');
        setTimeout(() => viewport.classList.remove('scan-success'), 700);
        lookup(value);
    }, 250);
}

// Returns a function that reads one frame and resolves to the QR text (or null).
// Uses the browser's BarcodeDetector when it supports QR codes (Android, macOS);
// otherwise the bundled jsQR decoder (js/vendor/jsQR.js, works offline) reads the pixels.
async function qrDecoder(video) {
    if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
        if (formats.includes('qr_code')) {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            return async () => (await detector.detect(video).catch(() => []))[0]?.rawValue || null;
        }
    }
    if (typeof window.jsQR !== 'function') return null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async () => {
        // Downscale large frames: decoding is faster and QR cards fill most of the view anyway.
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data || null;
    };
}

function stopCamera() {
    clearInterval(state.timer);
    state.timer = null;
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    viewport.classList.remove('camera-active', 'flash-boost');
    prompt.textContent = 'TAP TO START CAMERA';
}

async function toggleFlash() {
    const btn = $('#flash-btn');
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    viewport.classList.toggle('flash-boost', on);
    const track = state.stream?.getVideoTracks()[0];
    if (track?.getCapabilities?.().torch) {
        await track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
    }
}

/* ---------- save ---------- */

// Local wall-clock time, so a record synced tomorrow still counts on the day it was collected.
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

function resetForm() {
    state.donor = null;
    state.units = 1;
    state.clientUuid = crypto.randomUUID();
    panel.hidden = true;
    $('#donor-code').value = '';
    renderUnits();
    setStep(1);
}

async function queueOffline(payload, message) {
    await putRecord({
        client_uuid: payload.client_uuid,
        payload,
        status: 'Pending Sync',
        created_at: new Date().toISOString(),
        label: state.donor.full_name || state.donor.qr_code,
    });
    window.dispatchEvent(new Event('kadugo:queued'));
    showToast(message);
    resetForm();
}

async function save(event) {
    event.preventDefault();
    if (!state.donor) return;

    const driveId = $('#drive').value;
    const payload = {
        client_uuid: state.clientUuid,
        component_id: Number($('#component').value),
        units: state.units,
        drive_id: driveId ? Number(driveId) : null,
        collected_at: localNow(),
        ...(state.donor.unverified ? { qr_code: state.donor.qr_code } : { donor_id: state.donor.donor_id }),
    };

    saveBtn.disabled = true;
    try {
        await api('donations.php', { method: 'POST', body: payload, redirectOn401: false });
        showToast('Donation saved.');
        resetForm();
    } catch (error) {
        if (error.offline || error.status >= 500 || error.status === 401) {
            const why = error.status === 401 ? 'Session ended: saved on this device. Sign in again to sync it.'
                : 'Saved on this device. It will sync automatically.';
            await queueOffline(payload, why).catch(() => {
                showToast('Could not save on this device. Keep the form open and try again.', true);
            });
        } else {
            showToast(error.message, true); // the server rejected it (e.g. not eligible): queueing would fail again
        }
    } finally {
        saveBtn.disabled = !state.donor;
    }
}

/* ---------- drives at this bank ---------- */

async function loadDrives() {
    try {
        const { drives } = await api('drives.php', { query: { status: 'scheduled' } });
        const ongoing = await api('drives.php', { query: { status: 'ongoing' } }).then((d) => d.drives).catch(() => []);
        $('#drive').append(...[...ongoing, ...drives].map((d) => new Option(`${d.title} — ${formatDate(d.drive_date)}`, d.drive_id)));
    } catch {
        // Offline with no cached list: walk-in is still available.
    }
}

/* ---------- wiring ---------- */

viewport.addEventListener('click', () => (state.stream ? stopCamera() : startCamera()));
$('#flash-btn').addEventListener('click', toggleFlash);
$('#lookup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    lookup($('#donor-code').value.trim());
});
$('#units-minus').addEventListener('click', () => { state.units = Math.max(1, state.units - 1); renderUnits(); });
$('#units-plus').addEventListener('click', () => { state.units = Math.min(MAX_UNITS, state.units + 1); renderUnits(); });
$('#collection-form').addEventListener('submit', save);
$('#collection-form').addEventListener('reset', () => resetForm());
window.addEventListener('online', showSaveMode);
window.addEventListener('offline', showSaveMode);
window.addEventListener('pagehide', stopCamera);

showSaveMode();
renderUnits();
loadDrives();
