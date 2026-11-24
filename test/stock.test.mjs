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

test('el panel crea una sesión y la API confirma el pase solo desde el mismo origen', async () => {
  const { binding } = openDatabase();
  const base = 'https://stock.test';
  const get = await worker.fetch(new Request(base + '/api/stock'), { DB: binding });
  assert.equal(get.status, 200);
  const cookie = get.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
  const body = JSON.stringify(input());
  const post = origin => worker.fetch(new Request(base + '/api/passes', {
    method: 'POST', headers: { Origin: origin, Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }, body,
  }), { DB: binding });
  assert.equal((await post('https://other.test')).status, 403);
  assert.equal((await post(base)).status, 201);
  assert.equal((await post(base)).status, 200);
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
