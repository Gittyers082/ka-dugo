// Donor history (read-only): verified donations from the blood banks, filtered by year.
import { request, profile, displayError, formatDate } from './donor-common.js';
import { el, $, setText } from '../ui/dom.js';

const state = { records: [], year: 'all', source: 'all' };

function card(h) {
    return el('li', { class: 'row' },
        el('span', { class: 'badge-box is-soft', text: h.blood_type_code }),
        el('div', { class: 'row-main' },
            el('strong', { text: h.bank_name || h.drive_title || 'Blood bank record' }),
            el('span', { text: `${formatDate(h.donated_on)} • ${Number(h.units).toFixed(2)} unit(s) ${h.component_name || ''}` }),
            el('span', { text: `Reference ${h.public_ref}` })),
        el('span', { class: `pill ${h.verification === 'verified' ? 'is-ok' : 'is-warn'}`, text: h.verification }));
}

function applyFilters() {
    const shown = state.records.filter((h) =>
        (state.year === 'all' || h.donated_on.slice(0, 4) === state.year)
        && (state.source === 'all' || h.source === state.source));
    $('#logs-grid').replaceChildren(...shown.map(card));
    $('#empty-state').hidden = shown.length > 0;
}

function renderYears() {
    const years = [...new Set(state.records.map((h) => h.donated_on.slice(0, 4)))].sort().reverse();
    if (state.year !== 'all' && !years.includes(state.year)) state.year = 'all';
    $('#history-years').replaceChildren(...['all', ...years].map((year) => {
        const count = year === 'all' ? state.records.length : state.records.filter((h) => h.donated_on.startsWith(year)).length;
        return el('button', {
            type: 'button',
            'aria-pressed': String(state.year === year),
            onclick: () => { state.year = year; renderYears(); applyFilters(); },
        }, year === 'all' ? 'All ' : `${year} `, el('span', { text: `(${count})` }));
    }));
}

document.querySelectorAll('.type-filter').forEach((button) => button.addEventListener('click', () => {
    state.source = button.dataset.type;
    document.querySelectorAll('.type-filter').forEach((other) => {
        other.setAttribute('aria-pressed', String(other === button));
    });
    applyFilters();
}));

try {
    const [me, data] = await Promise.all([profile(), request('history')]);
    // Only bank-recorded history counts; old self-reported rows are ignored.
    state.records = (data.history || []).filter((h) => h.source === 'system');
    const verified = state.records.filter((h) => h.verification === 'verified');
    setText('#history-volume', verified.reduce((sum, h) => sum + Number(h.units), 0).toFixed(2));
    setText('#history-count', state.records.length);
    setText('#history-verified', verified.length);
    setText('#history-last-date', state.records.length ? formatDate(state.records[0].donated_on) : 'None yet');
    setText('#history-blood-pill', me.blood_type_code);
    setText('#history-eligibility', me.eligibility?.is_eligible ? 'Eligible' : 'Deferred');
    $('#donor-page-status').hidden = true;
    renderYears();
    applyFilters();
} catch (error) {
    displayError(error.message);
}
