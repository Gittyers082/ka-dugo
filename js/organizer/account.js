// Organizer account: organization profile (contact details are editable), impact numbers,
// the partner banks its drives use, and password change.
import { api } from '../api.js';
import { $, setText } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';

const profileDialog = $('#update-profile-dialog');
const passwordDialog = $('#password-dialog');

async function loadProfile() {
    try {
        const profile = await api('profile.php');
        setText('#display-org-name', profile.org_name);
        // Initials of the first three words, e.g. "Philippine Red Cross" -> "PRC".
        setText('#display-org-initials', profile.org_name.split(/\s+/).slice(0, 3).map((word) => word[0].toUpperCase()).join(''));
        setText('#display-org-code', `Organizer code ${profile.org_code}`);
        setText('#display-contact-person', profile.contact_person);
        setText('#display-email', profile.email);
        setText('#display-phone', profile.contact_no);
        $('#profile-contact-person').value = profile.contact_person;
        $('#profile-contact-no').value = profile.contact_no;
        $('#updateProfileBtn').disabled = false;
    } catch (error) {
        showToast(error.message, true);
    }
}

async function loadImpact() {
    try {
        const { drives } = await api('drives.php');
        setText('#impact-drives', drives.length);
        setText('#impact-donors', drives.reduce((sum, d) => sum + Number(d.registered_count), 0));
        const banks = [...new Set(drives.map((d) => d.bank_name).filter(Boolean))];
        setText('#display-blood-bank', banks.join(', ') || 'None yet — choose one when scheduling a drive');
    } catch {
        setText('#display-blood-bank', '—');
    }
}

async function saveProfile(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        const saved = await api('profile.php', { method: 'PUT', body: {
            contact_person: $('#profile-contact-person').value.trim(),
            contact_no: $('#profile-contact-no').value.trim(),
        } });
        setText('#display-contact-person', saved.contact_person);
        setText('#display-phone', saved.contact_no);
        profileDialog.close();
        showToast('Profile details saved.');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        submit.disabled = false;
    }
}

async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        await api('change_password.php', { method: 'POST', body: {
            current_password: $('#current-password').value,
            new_password: $('#new-password').value,
        } });
        passwordDialog.close();
        form.reset();
        showToast('Password updated.');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        submit.disabled = false;
    }
}

$('#updateProfileBtn').addEventListener('click', () => profileDialog.showModal());
$('#changePasswordBtn').addEventListener('click', () => passwordDialog.showModal());
['#cancel-profile-btn'].forEach((id) => $(id).addEventListener('click', () => profileDialog.close()));
['#cancel-password-btn'].forEach((id) => $(id).addEventListener('click', () => passwordDialog.close()));
$('#update-profile-form').addEventListener('submit', saveProfile);
$('#change-password-form').addEventListener('submit', changePassword);

loadProfile();
loadImpact();
