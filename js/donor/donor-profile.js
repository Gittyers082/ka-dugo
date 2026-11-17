// Donor account profile (read-only details) with a confirm-before-logout dialog.
// The confirm button is a .logout-link, so js/app.js performs the actual sign-out.
import { profile, displayError, formatDate } from './donor-common.js';
import { $, setText } from '../ui/dom.js';

function setField(label, value) {
    document.querySelectorAll('.profile-field').forEach((field) => {
        if (field.querySelector('dt')?.textContent.trim() !== label) return;
        const dd = field.querySelector('dd');
        dd.textContent = value || 'Not recorded';
        dd.classList.remove('profile-unset');
    });
}

profile().then((p) => {
    setText('.profile-identity h2', p.full_name);
    setText('.profile-identity .profile-muted', `Donor ID: ${p.donor_id}`);
    setText('.profile-blood-tag', `${p.blood_type_code} Blood Type`);
    setField('Full Name', p.full_name);
    setField('Date of Birth', formatDate(p.birthdate));
    setField('Sex', p.sex);
    setField('Contact Number', p.contact_no);
    setField('Recorded Weight', `${Number(p.weight_kg).toFixed(1)} kg`);
    setField('Blood Type', p.blood_type_code);
    setField('Last Donation', formatDate(p.last_donation_date));
    setField('Recorded Donations', `${p.history_count} history records • ${p.total_units} verified units`);
    setField('Email Address', p.email);
    setField('Account Role', p.role);
    setField('Account Status', Number(p.is_active) === 1 ? 'Active' : 'Inactive');
    setField('Last Login', p.last_login || 'Not recorded');
}).catch((error) => displayError(error.message, $('.profile-page-heading')));

const dialog = $('#profile-logout-dialog');
$('#profile-logout').addEventListener('click', () => dialog.showModal());
$('#logout-cancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }); // backdrop click
