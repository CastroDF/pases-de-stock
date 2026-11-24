const elementIds = [
  'lot', 'lot-total', 'depot', 'calendar', 'balances', 'stock-location', 'pass-form',
  'origin', 'destination', 'kilos', 'available', 'form-message', 'confirm', 'passes',
  'empty', 'empty-message', 'notice', 'pass-count', 'search', 'new-pass', 'pass-dialog',
  'close-dialog', 'cancel-pass', 'dialog-lot', 'pass-lot',
];
const ui = Object.fromEntries(elementIds.map(id => [id, document.getElementById(id)]));
const dialog = ui['pass-dialog'];
const number = new Intl.NumberFormat('es-AR');
const day = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' });
const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Cordoba',
});
const kiloText = amount => `${number.format(amount)} kg`;
const passNumber = id => id.slice(0, 8).toUpperCase();
const normalized = value => value.toLocaleLowerCase('es-AR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
let state;
let submitting = false;
let repeatable = null;

async function request(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? 'No se pudo completar la operación.');
  return result;
}

function setOptions(select, rows) {
  const selected = select.value;
  select.replaceChildren(...rows.map(([id, label]) => new Option(label, id)));
  if (rows.some(([id]) => id === selected)) select.value = selected;
}

function row(values, numeric) {
  const element = document.createElement('tr');
  values.forEach((value, index) => {
    const cell = element.insertCell();
    cell.textContent = value;
    if (index === numeric) cell.className = 'number';
  });
  return element;
}

function showMessage(element, message, type = 'error') {
  element.hidden = !message;
  element.textContent = message;
  element.dataset.type = type;
}

const activeStock = () => state.stock.filter(item => item.lotId === ui.lot.value);

function updateAvailability() {
  const balance = activeStock().find(item => item.holderId === ui.origin.value)?.kilos ?? 0;
  ui.available.textContent = `Disponible en origen: ${kiloText(balance)}.`;
}

function renderLot() {
  const items = activeStock();
  if (!items.length) return;
  const lot = items[0];
  const names = new Map(state.holders.map(item => [item.id, item.name]));
  ui['stock-location'].textContent = `${lot.lotId} · ${lot.description}`;
  ui['dialog-lot'].textContent = lot.depot;
  ui['lot-total'].textContent = kiloText(items.reduce((total, item) => total + item.kilos, 0));
  ui.depot.textContent = lot.depot;
  ui.balances.replaceChildren(...items.map(item => row([names.get(item.holderId), kiloText(item.kilos)], 1)));
  updateAvailability();
}

function renderHistory() {
  const names = new Map(state.holders.map(item => [item.id, item.name]));
  const query = normalized(ui.search.value.trim());
  const rows = state.passes.map(pass => [
    passNumber(pass.id), dateTime.format(new Date(pass.confirmedAt)),
    names.get(pass.originId), names.get(pass.destinationId), pass.lotId, kiloText(pass.kilos),
  ]).filter(values => !query || normalized(values.join(' ')).includes(query));
  ui.passes.replaceChildren(...rows.map(values => row(values, 5)));
  ui['pass-count'].textContent = number.format(state.passes.length);
  ui.empty.hidden = rows.length > 0;
  ui['empty-message'].textContent = state.passes.length
    ? 'No hay pases que coincidan con la búsqueda.'
    : 'Todavía no hay pases en esta sesión.';
}

async function reload() {
  state = await request('/api/stock');
  const lots = new Map(state.stock.map(item => [item.lotId, `${item.lotId} · ${item.description}`]));
  setOptions(ui.lot, [...lots]);
  setOptions(ui['pass-lot'], [...lots]);
  ui['pass-lot'].value = ui.lot.value;
  const holders = state.holders.map(item => [item.id, item.name]);
  const firstLoad = ui.destination.options.length === 0;
  setOptions(ui.origin, holders);
  setOptions(ui.destination, holders);
  if (firstLoad) ui.destination.selectedIndex = Math.min(1, holders.length - 1);
  ui.lot.disabled = false;
  ui['new-pass'].disabled = false;
  ui.confirm.disabled = submitting;
  renderLot();
  renderHistory();
}

function setSubmitting(active) {
  submitting = active;
  ui.confirm.disabled = active;
  ui.confirm.textContent = active ? 'Confirmando…' : 'Confirmar pase';
  ui['close-dialog'].disabled = active;
  ui['cancel-pass'].disabled = active;
  for (const control of [ui['pass-lot'], ui.origin, ui.destination, ui.kilos]) {
    control.disabled = active;
  }
}

ui.lot.addEventListener('change', () => {
  ui['pass-lot'].value = ui.lot.value;
  renderLot();
});
ui['pass-lot'].addEventListener('change', () => {
  ui.lot.value = ui['pass-lot'].value;
  showMessage(ui['form-message'], '');
  renderLot();
});
ui.origin.addEventListener('change', updateAvailability);
ui.search.addEventListener('input', () => { if (state) renderHistory(); });

const navLinks = document.querySelectorAll('.nav-link');
function highlightLocation() {
  const hash = location.hash === '#stock' ? '#stock' : '#pases';
  for (const link of navLinks) {
    if (link.hash === hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', highlightLocation);
highlightLocation();

ui['new-pass'].addEventListener('click', () => {
  showMessage(ui.notice, '');
  showMessage(ui['form-message'], '');
  dialog.showModal();
});
ui['close-dialog'].addEventListener('click', () => dialog.close());
ui['cancel-pass'].addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });

ui['pass-form'].addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !state) return;
  const data = {
    lotId: ui['pass-lot'].value,
    originId: ui.origin.value,
    destinationId: ui.destination.value,
    kilos: Number(ui.kilos.value),
  };
  const fingerprint = JSON.stringify(data);
  const requestId = repeatable?.fingerprint === fingerprint ? repeatable.id : crypto.randomUUID();
  repeatable = { fingerprint, id: requestId };
  setSubmitting(true);
  showMessage(ui['form-message'], '');
  try {
    const { pass } = await request('/api/passes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, requestId }),
    });
    const confirmation = `Pase ${passNumber(pass.id)} confirmado.`;
    ui.kilos.value = '';
    try {
      await reload();
      repeatable = null;
      showMessage(ui.notice, confirmation, 'success');
    } catch {
      showMessage(ui.notice, `${confirmation} Recargá para ver el saldo actualizado.`, 'success');
    }
    dialog.close();
  } catch (error) {
    showMessage(ui['form-message'], error.message);
  } finally {
    setSubmitting(false);
  }
});

request('/api/calendar').then(({ date }) => {
  ui.calendar.textContent = date ? day.format(new Date(`${date}T12:00:00Z`)) : 'Sin datos';
}).catch(() => { ui.calendar.textContent = 'Sin datos'; });

reload().catch(() => {
  ui['empty-message'].textContent = 'No se pudieron cargar los pases.';
  showMessage(ui.notice, 'No se pudieron cargar los saldos. Recargá la página.');
});
