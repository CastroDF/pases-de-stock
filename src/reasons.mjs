import { StockError } from './stock.mjs';

export async function listReasons(db) {
  return (await db.prepare('SELECT id, name FROM pass_reasons ORDER BY name').all()).results;
}

export async function saveReason(db, id, body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 60) {
    throw new StockError('INVALID_REASON', 'Ingresá un motivo de entre 2 y 60 caracteres.');
  }
  try {
    if (id) {
      const row = await db.prepare('UPDATE pass_reasons SET name = ? WHERE id = ? RETURNING id, name')
        .bind(name, id).first();
      if (!row) throw new StockError('UNKNOWN_REASON', 'El motivo no existe.', 404);
      return row;
    }
    const reason = { id: crypto.randomUUID(), name };
    await db.prepare('INSERT INTO pass_reasons (id, name) VALUES (?, ?)').bind(reason.id, name).run();
    return reason;
  } catch (error) {
    if (/UNIQUE constraint failed: pass_reasons.name/i.test(error.message)) {
      throw new StockError('DUPLICATE_REASON', 'Ya existe un motivo con ese nombre.', 409);
    }
    throw error;
  }
}

export async function deleteReason(db, id) {
  try {
    const deleted = await db.prepare('DELETE FROM pass_reasons WHERE id = ? RETURNING id').bind(id).first();
    if (!deleted) throw new StockError('UNKNOWN_REASON', 'El motivo no existe.', 404);
  } catch (error) {
    if (/FOREIGN KEY constraint failed/i.test(error.message)) {
      throw new StockError('REASON_IN_USE', 'Ese motivo ya está asociado a un pase.', 409);
    }
    throw error;
  }
}
