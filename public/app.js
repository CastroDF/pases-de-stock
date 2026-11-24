const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['lot','lot-total','depot','calendar','balances','stock-location','pass-form',
  'origin','destination','kilos','available','form-message','confirm','passes','history-table','empty','notice'].map(id => [id,$(id)]));
const number = new Intl.NumberFormat('es-AR');
const day = new Intl.DateTimeFormat('es-AR',{dateStyle:'medium',timeZone:'UTC'});
const dateTime = new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Cordoba'});
const kilos = amount => `${number.format(amount)} kg`;
let state;
let submitting = false;
let repeatable = null;

async function request(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? 'No se pudo completar la operación.');
  return result;
}

function options(select, rows) {
  const value = select.value;
  select.replaceChildren(...rows.map(([id, label]) => new Option(label,id)));
  if (rows.some(([id])=>id===value)) select.value=value;
}

function row(values, numeric = -1) {
  const element = document.createElement('tr');
  values.forEach((value,index) => {
    const cell = element.insertCell();
    cell.textContent = value;
    if (index === numeric) cell.className = 'number';
  });
  return element;
}

function showMessage(message, type) {
  ui['form-message'].hidden=!message;
  ui['form-message'].textContent=message;
  ui['form-message'].dataset.type=type;
}

const activeStock = () => state.stock.filter(item => item.lotId === ui.lot.value);
function updateAvailability() {
  const balance = activeStock().find(x=>x.holderId===ui.origin.value)?.kilos ?? 0;
  ui.available.textContent=`Disponible en origen: ${kilos(balance)}.`;
}

function renderLot() {
  const items = activeStock();
  if (!items.length) return;
  const names = new Map(state.holders.map(x=>[x.id,x.name]));
  ui['stock-location'].textContent = `${items[0].lotId} · ${items[0].description}`;
  ui['lot-total'].textContent=kilos(items.reduce((total,item)=>total+item.kilos,0));
  ui.depot.textContent=items[0].depot;
  ui.balances.replaceChildren(...items.map(x=>row([names.get(x.holderId),kilos(x.kilos)],1)));
  updateAvailability();
}

async function reload() {
  state = await request('/api/stock');
  const lots = new Map(state.stock.map(x=>[x.lotId,`${x.lotId} · ${x.description}`]));
  options(ui.lot,[...lots]);
  const holders = state.holders.map(x=>[x.id,x.name]);
  const firstLoad = ui.destination.options.length===0;
  options(ui.origin,holders);
  options(ui.destination,holders);
  if(firstLoad) ui.destination.selectedIndex = Math.min(1,holders.length-1);
  ui.lot.disabled=false;
  renderLot();
  const names = new Map(holders);
  ui.passes.replaceChildren(...state.passes.map(p=>row([
    p.id.slice(0,8).toUpperCase(), p.lotId, names.get(p.originId), names.get(p.destinationId),
    kilos(p.kilos), dateTime.format(new Date(p.confirmedAt)),
  ],4)));
  ui.empty.hidden=state.passes.length>0;
  ui['history-table'].hidden=!state.passes.length;
  ui.confirm.disabled=submitting;
}

ui.lot.addEventListener('change',()=>{ showMessage(''); renderLot(); });
ui.origin.addEventListener('change',updateAvailability);
ui['pass-form'].addEventListener('submit',async event=>{
  event.preventDefault();
  if (submitting || !state) return;
  const data = {lotId:ui.lot.value, originId:ui.origin.value, destinationId:ui.destination.value, kilos:Number(ui.kilos.value)};
  const fingerprint=JSON.stringify(data);
  const requestId=repeatable?.fingerprint===fingerprint ? repeatable.id : crypto.randomUUID();
  repeatable={fingerprint,id:requestId};
  submitting=true;
  ui.confirm.disabled=true;
  ui.confirm.textContent='Confirmando…';
  showMessage('');
  try {
    const {pass} = await request('/api/passes',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...data,requestId})});
    showMessage(`Pase ${pass.id.slice(0,8).toUpperCase()} confirmado. Se registraron el egreso y el ingreso.`,'success');
    ui.kilos.value='';
    try { await reload(); repeatable=null; }
    catch { ui.notice.textContent='El pase se registró. Recargá la página para ver el saldo actualizado.'; }
  } catch (error) { showMessage(error.message,'error'); }
  finally { submitting=false; ui.confirm.disabled=false; ui.confirm.textContent='Confirmar pase'; }
});

request('/api/calendar').then(({date})=>{
  ui.calendar.textContent=date?day.format(new Date(`${date}T12:00:00Z`)):'Calendario no disponible';
}).catch(()=>ui.calendar.textContent='Calendario no disponible');

reload().catch(()=>showMessage('No se pudieron cargar los saldos. Recargá la página.','error'));
