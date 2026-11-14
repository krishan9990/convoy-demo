const STORAGE_KEY = 'convoy.bulk-buy.v1';
const CAR_MODELS = {
  Creta: 'Hyundai Creta',
  Venue: 'Hyundai Venue',
  Swift: 'Maruti Suzuki Swift',
  Baleno: 'Maruti Suzuki Baleno',
};
const SEED_STATE = {
  buyers: [
    { id: 'buyer-1', name: 'Aanya', model: 'Creta', variant: 'S (O) Petrol', city: 'Gurgaon' },
    { id: 'buyer-2', name: 'Rohan', model: 'Creta', variant: 'S (O) Petrol', city: 'Gurgaon' },
    { id: 'buyer-3', name: 'Meera', model: 'Venue', variant: 'SX Petrol', city: 'Noida' },
    { id: 'buyer-4', name: 'Kabir', model: 'Swift', variant: 'VXi Petrol', city: 'Noida' },
    { id: 'buyer-5', name: 'Diya', model: 'Baleno', variant: 'Zeta Petrol', city: 'Gurgaon' },
  ],
  quotes: [
    { id: 'quote-1', groupKey: 'Creta|S (O) Petrol|Gurgaon', dealer: 'Northstar Hyundai', exShowroom: 1350000, discount: 45000, otherCosts: 180000, sample: true, createdAt: '2026-11-12T10:00:00.000Z' },
    { id: 'quote-2', groupKey: 'Creta|S (O) Petrol|Gurgaon', dealer: 'Capital Hyundai', exShowroom: 1350000, discount: 35000, otherCosts: 168000, sample: true, createdAt: '2026-11-12T10:05:00.000Z' },
  ],
};

const $ = (selector) => document.querySelector(selector);
let state = loadState();
let selectedGroupKey = 'Creta|S (O) Petrol|Gurgaon';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.buyers) && Array.isArray(saved.quotes)) return saved;
  } catch (error) {
    console.warn('Saved Convoy data could not be read; starting with the sample workspace.', error);
  }
  return JSON.parse(JSON.stringify(SEED_STATE));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Convoy data could not be saved in this browser.', error);
    throw new Error('Could not save your changes in this browser. Check available storage and try again.');
  }
}

function getGroups() {
  const grouped = new Map();
  for (const buyer of state.buyers) {
    const key = `${buyer.model}|${buyer.variant}|${buyer.city}`;
    if (!grouped.has(key)) grouped.set(key, { key, model: buyer.model, variant: buyer.variant, city: buyer.city, buyers: [] });
    grouped.get(key).buyers.push(buyer);
  }
  return [...grouped.values()].sort((first, second) => {
    const firstHasQuotes = state.quotes.some((quote) => quote.groupKey === first.key);
    const secondHasQuotes = state.quotes.some((quote) => quote.groupKey === second.key);
    return Number(secondHasQuotes) - Number(firstHasQuotes)
      || second.buyers.length - first.buyers.length
      || first.model.localeCompare(second.model);
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value);
}

function getQuoteTotal(quote) {
  return quote.exShowroom - quote.discount + quote.otherCosts;
}

function renderStats() {
  $('#buyerCount').textContent = state.buyers.length;
  $('#modelCount').textContent = new Set(state.buyers.map((buyer) => buyer.model)).size;
  const liveQuotes = state.quotes.filter((quote) => !quote.sample);
  if (!liveQuotes.length) {
    $('#bestQuote').textContent = '—';
    $('#bestQuoteNote').textContent = 'Add a dealer offer to compare';
    return;
  }
  const best = liveQuotes.reduce((lowest, quote) => getQuoteTotal(quote) < getQuoteTotal(lowest) ? quote : lowest);
  $('#bestQuote').textContent = formatCurrency(getQuoteTotal(best));
  $('#bestQuoteNote').textContent = `${best.dealer} · entered quote`;
}

function renderGroups() {
  const filter = $('#cityFilter').value;
  const groups = getGroups().filter((group) => filter === 'All cities' || group.city === filter);
  $('#emptyBatches').classList.toggle('hidden', groups.length > 0);
  $('#batchRows').innerHTML = groups.map((group) => {
    const avatars = group.buyers.slice(0, 3).map((buyer) => `
      <span class="buyer-avatar" aria-label="${escapeHtml(buyer.name)}">${escapeHtml(buyer.name.slice(0, 1).toUpperCase())}</span>
    `).join('');
    const hasQuotes = state.quotes.some((quote) => quote.groupKey === group.key);
    return `
      <tr>
        <td><div class="vehicle-cell"><span class="vehicle-thumb" aria-hidden="true">⌁</span>
          <span><b>${escapeHtml(CAR_MODELS[group.model] || group.model)}</b><small>${escapeHtml(group.variant)}</small></span></div></td>
        <td>${escapeHtml(group.city)}</td>
        <td><div class="buyer-pills">${avatars}<span class="buyer-count">${group.buyers.length} ${group.buyers.length === 1 ? 'buyer' : 'buyers'}</span></div></td>
        <td><span class="stage-pill ${hasQuotes ? 'ready' : ''}">${hasQuotes ? 'Quotes in' : 'Finding buyers'}</span></td>
        <td><button class="select-group" type="button" data-group-key="${escapeHtml(group.key)}" aria-label="Compare ${escapeHtml(group.model)} quotes in ${escapeHtml(group.city)}">→</button></td>
      </tr>`;
  }).join('');
}

function renderBatchOptions() {
  const groups = getGroups();
  const select = $('#quoteBatch');
  if (!groups.length) {
    select.innerHTML = '<option value="">Join a buying group first</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = groups.map((group) => {
    const label = `${CAR_MODELS[group.model] || group.model} · ${group.variant} · ${group.city}`;
    return `<option value="${escapeHtml(group.key)}">${escapeHtml(label)}</option>`;
  }).join('');
  if (groups.some((group) => group.key === selectedGroupKey)) select.value = selectedGroupKey;
  else selectedGroupKey = select.value;
}

function renderQuotes() {
  const group = getGroups().find((item) => item.key === selectedGroupKey);
  const label = group ? `${group.model} · ${group.city}` : 'SELECT A BUYING GROUP';
  $('#quoteGroupLabel').textContent = label;
  const quotes = state.quotes
    .filter((quote) => quote.groupKey === selectedGroupKey)
    .sort((first, second) => getQuoteTotal(first) - getQuoteTotal(second));
  $('#quoteCount').textContent = `${quotes.length} ${quotes.length === 1 ? 'offer' : 'offers'}`;
  $('#emptyQuotes').classList.toggle('hidden', quotes.length > 0);
  $('#quoteCards').innerHTML = quotes.map((quote, index) => {
    const total = getQuoteTotal(quote);
    return `
      <article class="quote-card ${index === 0 ? 'best' : ''}">
        <div class="quote-top">
          <div class="quote-dealer"><span class="dealer-avatar">${escapeHtml(quote.dealer.slice(0, 1).toUpperCase())}</span>
            <span><b>${escapeHtml(quote.dealer)}</b><small>${quote.sample ? 'Example offer · not verified' : 'Buyer-entered offer'}</small></span></div>
          ${index === 0 ? '<span class="best-label">LOWEST TOTAL</span>' : ''}
        </div>
        ${quote.sample ? '<span class="demo-label">DEMO DATA · NOT A DEALER OFFER</span>' : ''}
        <div class="quote-total"><span><small>EST. ON-ROAD TOTAL</small><strong>${formatCurrency(total)}</strong></span>
          <span class="quote-discount">${formatCurrency(quote.discount)} off</span></div>
        <div class="quote-breakdown">
          <div><span>Ex-showroom</span><b>${formatCurrency(quote.exShowroom)}</b></div>
          <div><span>Dealer discount</span><b>− ${formatCurrency(quote.discount)}</b></div>
          <div><span>Other on-road costs</span><b>+ ${formatCurrency(quote.otherCosts)}</b></div>
        </div>
      </article>`;
  }).join('');
}

function render() {
  renderStats();
  renderGroups();
  renderBatchOptions();
  renderQuotes();
}

function showMessage(selector, message, isError = false) {
  const element = $(selector);
  element.textContent = message;
  element.classList.toggle('error', isError);
}

$('#cityFilter').addEventListener('change', renderGroups);

$('#batchRows').addEventListener('click', (event) => {
  const button = event.target.closest('[data-group-key]');
  if (!button) return;
  selectedGroupKey = button.dataset.groupKey;
  renderBatchOptions();
  renderQuotes();
  $('#dealer-quotes').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#buyerForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const model = $('#buyerModel').value;
  const city = $('#buyerCity').value;
  const name = $('#buyerName').value.trim() || `Buyer ${state.buyers.length + 1}`;
  const variant = $('#buyerVariant').value.trim() || 'Variant not specified';
  const key = `${model}|${variant}|${city}`;
  try {
    state.buyers.push({ id: crypto.randomUUID(), name, model, variant, city });
    saveState();
    selectedGroupKey = key;
    render();
    $('#buyerName').value = '';
    $('#buyerVariant').value = '';
    showMessage('#buyerMessage', `You're in the ${CAR_MODELS[model]} · ${city} group. Invite others to join the same variant.`);
  } catch (error) {
    state.buyers.pop();
    showMessage('#buyerMessage', error.message, true);
  }
});

$('#quoteBatch').addEventListener('change', (event) => {
  selectedGroupKey = event.target.value;
  renderQuotes();
});

$('#quoteForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const exShowroom = Number($('#exShowroom').value);
  const discount = Number($('#discount').value);
  const otherCosts = Number($('#otherCosts').value);
  if (!Number.isSafeInteger(exShowroom) || !Number.isSafeInteger(discount) || !Number.isSafeInteger(otherCosts)
    || exShowroom <= 0 || exShowroom > 100000000 || discount < 0 || discount > 10000000
    || otherCosts < 0 || otherCosts > 10000000 || discount > exShowroom) {
    showMessage('#quoteMessage', 'Check the prices. Discount must be less than the ex-showroom price and costs must be within the listed limits.', true);
    return;
  }
  const quote = {
    id: crypto.randomUUID(),
    groupKey: $('#quoteBatch').value,
    dealer: $('#dealerName').value.trim(),
    exShowroom,
    discount,
    otherCosts,
    sample: $('#sampleQuote').checked,
    createdAt: new Date().toISOString(),
  };
  try {
    state.quotes.push(quote);
    saveState();
    selectedGroupKey = quote.groupKey;
    render();
    $('#quoteForm').reset();
    $('#sampleQuote').checked = false;
    showMessage('#quoteMessage', 'Quote added. Confirm all prices, inclusions, and validity with the dealer.');
  } catch (error) {
    state.quotes.pop();
    showMessage('#quoteMessage', error.message, true);
  }
});

render();
