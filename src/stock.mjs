export class StockError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = value => typeof value === 'string' && uuid.test(value);
const isLot = value => typeof value === 'string' && /^L-\d{4}$/.test(value);
const isHolder = value => ['alfa', 'delta', 'sur'].includes(value);
const isKilos = value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000;

export function validatePass(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new StockError('INVALID_INPUT', 'Ingresá los datos del pase.');
  }
  const { requestId, lotId, originId, destinationId, kilos, reasonId = null } = body;
  if (!isId(requestId) || !isLot(lotId) || !isHolder(originId) || !isHolder(destinationId)
    || !isKilos(kilos) || (reasonId !== null && !isId(reasonId) && !['compra', 'cesion'].includes(reasonId))) {
    throw new StockError('INVALID_INPUT', 'Seleccioná el lote y los titulares e ingresá kilos enteros positivos.');
  }
  if (originId === destinationId) {
    throw new StockError('SAME_HOLDER', 'El titular de origen y el de destino deben ser distintos.');
  }
  return { requestId, lotId, originId, destinationId, kilos, reasonId };
}

const insufficientStock = () => new StockError('INSUFFICIENT_STOCK', 'El origen no tiene kilos suficientes para este pase.', 409);

export async function checkAvailability(db, workspace, params) {
  const lotId = params.get('lot');
  const originId = params.get('origin');
  const kilos = Number(params.get('kilos'));
  if (!isLot(lotId) || !isHolder(originId) || !isKilos(kilos)) {
    throw new StockError('INVALID_INPUT', 'Seleccioná el lote y el titular, e ingresá kilos enteros positivos.');
  }
  const item = await db.prepare(`SELECT
    COALESCE((SELECT kilos FROM opening_balances WHERE lot_id = l.id AND holder_id = ?), 0) +
    COALESCE((SELECT SUM(m.direction * m.kilos) FROM movements m JOIN passes p ON p.id = m.pass_id
      WHERE p.workspace = ? AND p.lot_id = l.id AND m.holder_id = ?), 0) AS available
    FROM lots l WHERE l.id = ?`).bind(originId, workspace, originId, lotId).first();
  if (!item) throw new StockError('UNKNOWN_LOT', 'El lote indicado no existe.', 404);
  if (kilos > item.available) throw insufficientStock();
  return { available: item.available };
}

export async function readStock(db, workspace) {
  const [holders, stock, passes] = await Promise.all([
    db.prepare('SELECT id, name FROM holders ORDER BY id').all(),
    db.prepare(`WITH changes AS (
      SELECT p.lot_id, m.holder_id, SUM(m.direction * m.kilos) AS adjustment
      FROM movements m JOIN passes p ON p.id = m.pass_id
      WHERE p.workspace = ? GROUP BY p.lot_id, m.holder_id
    )
    SELECT l.id AS lotId, l.description, l.depot, h.id AS holderId,
      COALESCE(b.kilos, 0) + COALESCE(c.adjustment, 0) AS kilos
    FROM lots l CROSS JOIN holders h
    LEFT JOIN opening_balances b ON b.lot_id = l.id AND b.holder_id = h.id
    LEFT JOIN changes c ON c.lot_id = l.id AND c.holder_id = h.id
    ORDER BY l.id, h.id`).bind(workspace).all(),
    db.prepare(`SELECT p.id, p.lot_id AS lotId, p.origin_id AS originId, p.destination_id AS destinationId,
      p.kilos, p.confirmed_at AS confirmedAt, r.name AS reasonName FROM passes p
      LEFT JOIN pass_reasons r ON r.id = p.reason_id
      WHERE p.workspace = ? ORDER BY p.confirmed_at DESC, p.id DESC LIMIT 25`).bind(workspace).all(),
  ]);
  return { holders: holders.results, stock: stock.results, passes: passes.results };
}

const previousPass = (db, workspace, requestId) => db.prepare(
  `SELECT id, lot_id AS lotId, origin_id AS originId, destination_id AS destinationId, kilos,
          confirmed_at AS confirmedAt, reason_id AS reasonId FROM passes WHERE workspace = ? AND request_id = ?`
).bind(workspace, requestId).first();

function matchRequest(pass, input) {
  if (['lotId', 'originId', 'destinationId', 'kilos', 'reasonId'].some(key => pass[key] !== input[key])) {
    throw new StockError('REQUEST_CONFLICT', 'Esta confirmación ya se usó con otros datos.', 409);
  }
  return { pass, repeated: true };
}

export async function recordPass(db, workspace, body) {
  const input = validatePass(body);
  const existing = await previousPass(db, workspace, input.requestId);
  if (existing) return matchRequest(existing, input);
  const { requestId, lotId, originId, destinationId, kilos, reasonId } = input;
  if (!await db.prepare('SELECT id FROM lots WHERE id = ?').bind(lotId).first()) {
    throw new StockError('UNKNOWN_LOT', 'El lote indicado no existe.', 404);
  }
  const id = crypto.randomUUID();
  const confirmedAt = new Date().toISOString();
  try {
    await db.prepare(`INSERT INTO passes
      (id, workspace, request_id, lot_id, origin_id, destination_id, kilos, confirmed_at, reason_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, workspace, requestId, lotId, originId, destinationId, kilos, confirmedAt, reasonId
    ).run();
  } catch (error) {
    const sameRequest = await previousPass(db, workspace, requestId);
    if (sameRequest) return matchRequest(sameRequest, input);
    if (error.message.includes('INSUFFICIENT_STOCK')) throw insufficientStock();
    if (reasonId && /FOREIGN KEY constraint failed/i.test(error.message)) {
      throw new StockError('UNKNOWN_REASON', 'El motivo seleccionado no está disponible.', 409);
    }
    throw error;
  }
  return { pass: { id, lotId, originId, destinationId, kilos, confirmedAt, reasonId }, repeated: false };
}
