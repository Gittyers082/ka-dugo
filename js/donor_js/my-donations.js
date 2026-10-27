/* DONOR HISTORY - LIVE MYSQL DATA */
(async () => {
    const api = window.KaDonor, $ = selector => document.querySelector(selector);
    const grid = $('#logs-grid');
    // changes: Donation history is display-only; bank records are loaded from MySQL.
    let records = [];
    let selectedYear = 'all', selectedSource = 'all';
    const selected = selector => $(selector);
    function applyFilters() {
        const filtered = records.filter(h =>
            (selectedYear === 'all' || h.donated_on.slice(0, 4) === selectedYear) &&
            (selectedSource === 'all' || h.source === selectedSource)
        );
        grid.innerHTML = filtered.map(h => {
            const manual = h.source === 'manual';
            const sourceText = manual ? 'Self-reported donation' : (h.bank_name || h.drive_title || 'System donation record');
            return `<article class="log-card ${manual ? 'self-record' : ''}">` +
                `<div class="log-card-top">` +
                `<div class="log-title">` +
                `<span class="log-dot ${manual ? 'self' : ''}">` +
                `</span><div><h3>${api.safe(sourceText)}` +
                `</h3><p class="log-date">${api.safe(api.formatDate(h.donated_on))}` +
                `</p></div></div><span class="verification ${manual ? 'self-badge' : ''}">${api.safe(h.verification)}` +
                `</span></div><div class="component-strip">` +
                `<div><span>BLOOD TYPE &amp; UNITS` +
                `</span><strong>${api.safe(h.blood_type_code)} · ${Number(h.units).toFixed(2)} units` +
                `</strong></div><div><span>RECORD TYPE` +
                `</span><strong>${api.safe(manual ? 'Manual entry' : (h.component_name || 'System record'))}` +
                `</strong></div></div><p class="donor-reference">Reference: ${api.safe(h.public_ref)}` +
                `</p></article>`;
        }).join('');
        $('#empty-state').hidden = filtered.length > 0;
    }
    function updateYearFilters() {
        const years = [...new Set(records.map(item => String(item.donated_on).slice(0, 4)))].sort().reverse();
        if (selectedYear !== 'all' && !years.includes(selectedYear))
            selectedYear = 'all';
        $('#history-years').innerHTML = ['all', ...years].map(y => `<button type="button" class="year-tab ${selectedYear === y ? 'active' : ''}" data-year="${api.safe(y)}" aria-pressed="${selectedYear === y}">${y === 'all' ? 'All' : api.safe(y)} ` +
            `<span>(${y === 'all' ? records.length : records.filter(r => r.donated_on.slice(0, 4) === y).length})` +
            `</span></button>`).join('');
        $('#history-years').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
            selectedYear = button.dataset.year;
            updateYearFilters();
            applyFilters();
        }));
    }
    async function load() {
        const [me, data] = await Promise.all([api.profile(), api.request('history')]);
        records = data.history || [];
        const verified = records.filter(h => h.verification === 'verified' && h.source === 'system');
        $('#history-volume').innerHTML = `${verified.reduce((sum, h) => sum + Number(h.units), 0).toFixed(2)} <span>Verified units</span>`;
        $('#history-count').textContent = records.length;
        $('#history-verified').textContent = verified.length;
        $('#history-last-date').textContent = records.length ? api.formatDate(records[0].donated_on) : 'None yet';
        $('#history-blood-pill').textContent = `Blood type: ${me.blood_type_code}`;
        $('#history-eligibility').textContent = me.eligibility?.is_eligible ? 'Eligible' : 'Deferred';
        $('#donor-page-status').hidden = true;
        updateYearFilters();
        applyFilters();
    }
    document.querySelectorAll('.type-filter').forEach(button => button.addEventListener('click', () => {
        selectedSource = button.dataset.type;
        document.querySelectorAll('.type-filter').forEach(b => {
            b.classList.toggle('active', b === button);
            b.setAttribute('aria-pressed', String(b === button));
        });
        applyFilters();
    }));
    try {
        await load();
    }
    catch (error) {
        api.displayError(error.message);
    }
})();
