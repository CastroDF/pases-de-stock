const elementIds = [
  'lot', 'lot-total', 'depot', 'calendar', 'balances', 'stock-location', 'pass-form',
  'origin', 'destination', 'kilos', 'available', 'form-message', 'confirm', 'passes',
  'empty', 'empty-message', 'notice', 'pass-count', 'search', 'new-pass', 'pass-dialog',
  'close-dialog', 'cancel-pass', 'dialog-lot', 'pass-lot',
  'sidebar', 'workspace', 'login', 'login-form', 'username', 'password', 'sign-in', 'login-message', 'current-role', 'logout',
  'reason-panel', 'reason-form', 'reason-name', 'save-reason', 'cancel-reason', 'reasons-list', 'reasons-message',
  'pass-reason', 'preview-pass', 'preview-message', 'depot-map', 'map-frame',
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
let role;
let editingReason;
let checkingAvailability = false;

async function request(url, options) {
  const response = await fetch(url, options);
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message ?? 'No se pudo completar la operación.'), { status: response.status });
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

function updateMap() {
  if (!ui['depot-map'].open || !state) return;
  const north = activeStock()[0]?.depot === 'Depósito Norte';
  const marker = north ? '-32.9117,-60.6850' : '-33.0010,-60.6510';
  const bbox = north ? '-60.701,-32.922,-60.669,-32.901' : '-60.669,-33.012,-60.633,-32.989';
  const url = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
  if (ui['map-frame'].src !== url) ui['map-frame'].src = url;
}

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
  updateMap();
}

function renderHistory() {
  const names = new Map(state.holders.map(item => [item.id, item.name]));
  const query = normalized(ui.search.value.trim());
  const rows = state.passes.map(pass => [
    passNumber(pass.id), dateTime.format(new Date(pass.confirmedAt)),
    names.get(pass.originId), names.get(pass.destinationId), pass.lotId, pass.reasonName ?? '—', kiloText(pass.kilos),
  ]).filter(values => !query || normalized(values.join(' ')).includes(query));
  ui.passes.replaceChildren(...rows.map(values => row(values, 6)));
  ui['pass-count'].textContent = number.format(state.passes.length);
  ui.empty.hidden = rows.length > 0;
  ui['empty-message'].textContent = state.passes.length
    ? 'No hay pases que coincidan con la búsqueda.'
    : 'Todavía no hay pases confirmados.';
}

function editReason(reason) {
  editingReason = reason?.id;
  ui['reason-name'].value = reason?.name ?? '';
  ui['save-reason'].textContent = reason ? 'Guardar motivo' : 'Agregar motivo';
  ui['cancel-reason'].hidden = !reason;
  if (reason) ui['reason-name'].focus();
}

async function reloadReasons() {
  const reasons = await request('/api/reasons');
  setOptions(ui['pass-reason'], reasons.map(reason => [reason.id, reason.name]));
  if (role !== 'supervisor') return;
  ui['reasons-list'].replaceChildren(...reasons.map(reason => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = reason.name;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.textContent = 'Editar';
    edit.addEventListener('click', () => editReason(reason));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = 'Eliminar';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`¿Eliminar el motivo ${reason.name}?`)) return;
      showMessage(ui['reasons-message'], '');
      try {
        await request(`/api/reasons/${reason.id}`, { method: 'DELETE' });
        if (editingReason === reason.id) editReason();
        await reloadReasons();
      } catch (error) {
        showMessage(ui['reasons-message'], error.message);
      }
    });
    item.append(name, edit, remove);
    return item;
  }));
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
  for (const control of [ui['pass-lot'], ui.origin, ui.destination, ui.kilos, ui['pass-reason']]) {
    control.disabled = active;
  }
  ui['preview-pass'].disabled = active || checkingAvailability;
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
ui['depot-map'].addEventListener('toggle', updateMap);

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

ui['new-pass'].addEventListener('click', async () => {
  showMessage(ui.notice, '');
  showMessage(ui['form-message'], '');
  showMessage(ui['preview-message'], '');
  try {
    await reloadReasons();
    if (role === 'operador' && !dialog.open) dialog.showModal();
  } catch (error) {
    showMessage(ui.notice, error.message);
  }
});
ui['close-dialog'].addEventListener('click', () => dialog.close());
ui['cancel-pass'].addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });

for (const control of [ui['pass-lot'], ui.origin, ui.kilos]) {
  control.addEventListener('input', () => showMessage(ui['preview-message'], ''));
}

ui['preview-pass'].addEventListener('click', async () => {
  showMessage(ui['form-message'], '');
  showMessage(ui['preview-message'], '');
  if (!ui.kilos.reportValidity()) return;
  const params = new URLSearchParams({ lot: ui['pass-lot'].value, origin: ui.origin.value, kilos: ui.kilos.value });
  checkingAvailability = true;
  ui['preview-pass'].disabled = true;
  let message;
  let target = ui['preview-message'];
  try {
    const { available } = await request(`/api/passes/availability?${params}`);
    message = `Saldo suficiente: ${kiloText(available)} disponibles.`;
  } catch (error) {
    target = ui['form-message'];
    message = error.message;
  } finally {
    checkingAvailability = false;
    ui['preview-pass'].disabled = submitting;
  }
  if (dialog.open && !submitting && params.get('lot') === ui['pass-lot'].value
    && params.get('origin') === ui.origin.value && params.get('kilos') === ui.kilos.value) {
    showMessage(target, message);
  }
});

ui['pass-form'].addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !state) return;
  const data = {
    lotId: ui['pass-lot'].value,
    originId: ui.origin.value,
    destinationId: ui.destination.value,
    kilos: Number(ui.kilos.value),
    reasonId: ui['pass-reason'].value,
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
    if (error.status === 409) reload().catch(() => {});
  } finally {
    setSubmitting(false);
  }
});

ui['cancel-reason'].addEventListener('click', () => editReason());
ui['reason-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const id = editingReason;
  showMessage(ui['reasons-message'], '');
  ui['save-reason'].disabled = true;
  try {
    await request(id ? `/api/reasons/${id}` : '/api/reasons', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ui['reason-name'].value }),
    });
    editReason();
    await reloadReasons();
  } catch (error) {
    showMessage(ui['reasons-message'], error.message);
  } finally {
    ui['save-reason'].disabled = false;
  }
});

async function showWorkspace(session) {
  role = session.role;
  ui['current-role'].textContent = role === 'operador' ? 'Operación' : 'Supervisión';
  ui['new-pass'].hidden = role !== 'operador';
  ui['reason-panel'].hidden = role !== 'supervisor';
  ui.login.hidden = true;
  ui.sidebar.hidden = false;
  ui.workspace.hidden = false;
  showMessage(ui.notice, '');
  request('/api/calendar').then(({ date }) => {
    ui.calendar.textContent = date ? day.format(new Date(`${date}T12:00:00Z`)) : 'Sin datos';
  }).catch(() => { ui.calendar.textContent = 'Sin datos'; });
  try {
    await Promise.all([reload(), reloadReasons()]);
  } catch (error) {
    showMessage(ui.notice, error.message);
  }
}

ui['login-form'].addEventListener('submit', async event => {
  event.preventDefault();
  ui['sign-in'].disabled = true;
  showMessage(ui['login-message'], '');
  try {
    const session = await request('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ui.username.value.trim(), password: ui.password.value }),
    });
    ui['login-form'].reset();
    await showWorkspace(session);
  } catch (error) {
    showMessage(ui['login-message'], error.message);
  } finally {
    ui['sign-in'].disabled = false;
  }
});

ui.logout.addEventListener('click', async () => {
  ui.logout.disabled = true;
  try {
    await request('/api/logout', { method: 'POST' });
    role = state = repeatable = null;
    editReason();
    ui['depot-map'].open = false;
    ui['map-frame'].removeAttribute('src');
    ui.sidebar.hidden = true;
    ui.workspace.hidden = true;
    ui.login.hidden = false;
    ui.username.focus();
  } catch (error) {
    showMessage(ui.notice, error.message);
  } finally {
    ui.logout.disabled = false;
  }
});

request('/api/session').then(showWorkspace).catch(error => {
  if (error.status !== 401) showMessage(ui['login-message'], error.message);
});
