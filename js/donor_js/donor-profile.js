/* DONOR ACCOUNT PROFILE - SESSION DATA AND SECURE LOGOUT */
(() => {
    const $ = selector => document.querySelector(selector);
    const api = window.KaDonor;
    function setField(label, value) {
        document.querySelectorAll('.profile-field').forEach(field => {
            if (field.querySelector('dt')?.textContent.trim() === label) {
                const dd = field.querySelector('dd');
                if (dd) {
                    dd.textContent = value || 'Not recorded';
                    dd.classList.remove('profile-unset');
                }
            }
        });
    }
    api.profile().then(profile => {
        $('.profile-identity h2').textContent = profile.full_name;
        $('.profile-identity .profile-muted').textContent = `Donor ID: ${profile.donor_id}`;
        $('.profile-blood-tag').textContent = `${profile.blood_type_code} Blood Type`;
        setField('Full Name', profile.full_name);
        setField('Date of Birth', api.formatDate(profile.birthdate));
        setField('Sex', profile.sex);
        setField('Contact Number', profile.contact_no);
        setField('Recorded Weight', `${Number(profile.weight_kg).toFixed(1)} kg`);
        setField('Blood Type', profile.blood_type_code);
        setField('Last Donation', api.formatDate(profile.last_donation_date));
        setField('Recorded Donations', `${profile.history_count} history records · ${profile.total_units} verified units`);
        setField('Email Address', profile.email);
        setField('Account Role', profile.role);
        setField('Account Status', Number(profile.is_active) === 1 ? 'Active' : 'Inactive');
        setField('Last Login', profile.last_login || 'Not recorded');
    }).catch(error => api.displayError(error.message, $('.profile-page-heading')));
    const dialog = $('#profile-logout-dialog');
    $('#profile-logout')?.addEventListener('click', () => {
        $('#logout-status').hidden = true;
        dialog?.showModal();
    });
    $('#logout-cancel')?.addEventListener('click', () => dialog?.close());
    dialog?.addEventListener('click', event => {
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right ||
            event.clientY < r.top || event.clientY > r.bottom)
            dialog.close();
    });
    $('#logout-confirm')?.addEventListener('click', async () => {
        $('#logout-confirm').disabled = true;
        try {
            await api.request('logout', {});
            window.location.replace('../../index.html');
        }
        catch (error) {
            const status = $('#logout-status');
            status.textContent = error.message;
            status.hidden = false;
            $('#logout-confirm').disabled = false;
        }
    });
})();
