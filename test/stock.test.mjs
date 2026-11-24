import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../scripts/sqlite.mjs';
import { readStock, recordPass } from '../src/stock.mjs';
import worker from '../src/worker.mjs';
import { nextBusinessDay } from '../src/calendar.mjs';

const workspace = '9e7c1eaf-4d39-4544-8718-5a1551fc93c1';
const input = (overrides = {}) => ({
  requestId: crypto.randomUUID(), lotId: 'L-0101', originId: 'alfa', destinationId: 'delta',
  kilos: 500, ...overrides,
});
const balances = async (db, id = workspace) => (await readStock(db, id)).stock
  .filter(item => item.lotId === 'L-0101').map(item => item.kilos);

test('R1: un pase de 500 kg deja 300 y 600 kg y conserva los 900 kg del lote', async () => {
  const { db, binding } = openDatabase();
  await recordPass(binding, workspace, input());
  assert.deepEqual(await balances(binding), [300, 600, 0]);
  assert.deepEqual(db.prepare('SELECT direction, kilos FROM movements ORDER BY direction').all()
    .map(row => [row.direction, row.kilos]), [[-1, 500], [1, 500]]);
});

test('R1: rechaza un pase sin saldo o entre titulares iguales', async () => {
  const { db, binding } = openDatabase();
  await assert.rejects(recordPass(binding, workspace, input({ kilos: 801 })), { code: 'INSUFFICIENT_STOCK' });
  await assert.rejects(recordPass(binding, workspace, input({ destinationId: 'alfa' })), { code: 'SAME_HOLDER' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movements').get().n, 0);
  assert.equal((await readStock(binding, workspace)).passes.length, 0);
});

test('un reintento devuelve el mismo pase y detecta cambios en la solicitud', async () => {
  const { binding } = openDatabase();
  const body = input();
  const results = await Promise.all([
    recordPass(binding, workspace, body), recordPass(binding, workspace, body),
  ]);
  assert.equal(results[0].pass.id, results[1].pass.id);
  assert.equal(results.filter(row => row.repeated).length, 1);
  await assert.rejects(recordPass(binding, workspace, { ...body, kilos: 400 }), { code: 'REQUEST_CONFLICT' });
  assert.deepEqual(await balances(binding), [300, 600, 0]);
});

test('dos confirmaciones sobre el mismo saldo no pueden dejarlo negativo', async () => {
  const { binding } = openDatabase();
  const results = await Promise.allSettled([
    recordPass(binding, workspace, input()), recordPass(binding, workspace, input()),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(await balances(binding), [300, 600, 0]);
  assert.deepEqual(await balances(binding, crypto.randomUUID()), [800, 100, 0]);
});

test('un fallo al escribir el ingreso revierte el encabezado y el egreso', async () => {
  const { db, binding } = openDatabase();
  db.exec(`CREATE TRIGGER test_fail_ingress BEFORE INSERT ON movements WHEN NEW.direction = 1
    BEGIN SELECT RAISE(ABORT, 'TEST_FAIL'); END`);
  await assert.rejects(recordPass(binding, workspace, input()), /TEST_FAIL/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movements').get().n, 0);
  assert.equal((await readStock(binding, workspace)).passes.length, 0);
});

function api(binding) {
  const base = 'https://stock.test';
  const env = {
    DB: binding, SESSION_SECRET: 'test-secret-only-for-ephemeral-sqlite',
    DEMO_OPERATOR_PASSWORD: 'operator-test', DEMO_SUPERVISOR_PASSWORD: 'supervisor-test',
  };
  const request = (path, { method = 'GET', cookie, data, origin = base } = {}) => worker.fetch(
    new Request(base + path, {
      method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    }), env);
  const login = async role => {
    const response = await request('/api/login', { method: 'POST', data: {
      username: role, password: role === 'operador' ? env.DEMO_OPERATOR_PASSWORD : env.DEMO_SUPERVISOR_PASSWORD,
    } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('Set-Cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict; Secure/);
    return cookie.split(';')[0];
  };
  return { request, login };
}

test('login, control de rol y confirmación del pase por API', async () => {
  const { binding } = openDatabase();
  const { request, login } = api(binding);
  assert.equal((await request('/api/stock')).status, 401);
  assert.equal((await request('/api/login', { method: 'POST', data: { username: 'operador', password: 'incorrecta' } })).status, 401);
  const operator = await login('operador');
  const supervisor = await login('supervisor');
  const body = input({ reasonId: 'compra' });
  const post = (cookie, origin) => request('/api/passes', { method: 'POST', cookie, origin, data: body });
  assert.equal((await post(supervisor)).status, 403);
  const before = await (await request('/api/stock', { cookie: supervisor })).json();
  assert.equal(before.passes.length, 0);
  assert.equal((await post(operator, 'https://other.test')).status, 403);
  assert.equal((await post(operator)).status, 201);
  assert.equal((await post(operator)).status, 200);
  const after = await (await request('/api/stock', { cookie: supervisor })).json();
  assert.equal(after.passes[0].reasonName, 'Compra');
  assert.deepEqual(after.stock.filter(item => item.lotId === 'L-0101').map(item => item.kilos), [300, 600, 0]);
});

test('consulta de disponibilidad distingue entrada inválida, falta de saldo y éxito sin registrar un pase', async () => {
  const { binding } = openDatabase();
  const { request, login } = api(binding);
  const cookie = await login('operador');
  const endpoint = '/api/passes/availability?lot=L-0101&origin=alfa&kilos=';
  const invalid = await request(endpoint + 'abc', { cookie });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'INVALID_INPUT');
  const conflict = await request(endpoint + '801', { cookie });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'INSUFFICIENT_STOCK');
  assert.deepEqual(await (await request(endpoint + '500', { cookie })).json(), { available: 800 });
  assert.equal((await (await request('/api/stock', { cookie })).json()).passes.length, 0);
});

test('Supervisión administra motivos y la base conserva las referencias de los pases', async () => {
  const { binding } = openDatabase();
  const { request, login } = api(binding);
  const operator = await login('operador');
  const supervisor = await login('supervisor');
  const data = { name: 'Ajuste de contrato' };
  assert.equal((await request('/api/reasons', { method: 'POST', cookie: operator, data })).status, 403);
  const created = await request('/api/reasons', { method: 'POST', cookie: supervisor, data });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const url = `/api/reasons/${id}`;
  const updated = await request(url, { method: 'PUT', cookie: supervisor, data: { name: 'Contrato actualizado' } });
  assert.deepEqual(await updated.json(), { id, name: 'Contrato actualizado' });
  const reasons = await (await request('/api/reasons', { cookie: operator })).json();
  assert.ok(reasons.some(reason => reason.id === id));
  assert.equal((await request(url, { method: 'DELETE', cookie: supervisor })).status, 204);
  assert.equal((await request('/api/passes', { method: 'POST', cookie: operator, data: input({ reasonId: 'compra' }) })).status, 201);
  assert.equal((await request('/api/reasons/compra', { method: 'DELETE', cookie: supervisor })).status, 409);
});

test('dos sesiones contra el mismo saldo reciben una confirmación y un conflicto HTTP', async () => {
  const { binding } = openDatabase();
  const { request, login } = api(binding);
  const cookies = await Promise.all([login('operador'), login('operador')]);
  assert.notEqual(cookies[0], cookies[1]);
  const results = await Promise.all(cookies.map(cookie =>
    request('/api/passes', { method: 'POST', cookie, data: input() })));
  assert.deepEqual(results.map(response => response.status).sort(), [201, 409]);
  assert.equal((await results.find(response => response.status === 409).json()).error, 'INSUFFICIENT_STOCK');
});

test('el calendario salta el fin de semana y los feriados nacionales', async () => {
  const now = new Date('2026-11-21T01:00:00Z');
  const fetcher = async url => {
    assert.equal(url, 'https://date.nager.at/api/v3/PublicHolidays/2026/AR');
    return Response.json([{ date: '2026-11-23', global: true }]);
  };
  assert.deepEqual(await nextBusinessDay(now, fetcher), { date: '2026-11-24', source: 'Nager.Date' });
  assert.deepEqual(await nextBusinessDay(now, async () => new Response(null, { status: 503 })),
    { date: null, source: null });
});
