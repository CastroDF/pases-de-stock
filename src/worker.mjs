import { isId, readStock, recordPass, StockError } from './stock.mjs';
import { nextBusinessDay } from './calendar.mjs';

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

function workspaceOf(request) {
  const cookie = (request.headers.get('Cookie') ?? '').split(';').map(s => s.trim())
    .find(s => s.startsWith('stock_demo='));
  const id = cookie?.slice('stock_demo='.length);
  return isId(id) ? id : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const workspace = workspaceOf(request);
    try {
      if (request.method === 'GET' && pathname === '/api/stock') {
        const id = workspace ?? crypto.randomUUID();
        const state = await readStock(env.DB, id);
        const secure = url.protocol === 'https:' ? '; Secure' : '';
        return json(state, 200, workspace ? {} : {
          'Set-Cookie': `stock_demo=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`,
        });
      }
      if (request.method === 'GET' && pathname === '/api/calendar') {
        return json(await nextBusinessDay());
      }
      if (request.method === 'POST' && pathname === '/api/passes') {
        if (request.headers.get('Origin') !== url.origin) {
          throw new StockError('INVALID_ORIGIN', 'Abrí el panel para confirmar un pase.', 403);
        }
        if (!workspace) throw new StockError('WORKSPACE_REQUIRED', 'Volvé a cargar el panel.', 403);
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
          throw new StockError('INVALID_INPUT', 'El cuerpo debe estar en JSON.', 415);
        }
        const raw = await request.text();
        if (raw.length > 4096) throw new StockError('INVALID_INPUT', 'La solicitud es demasiado larga.', 413);
        let input;
        try { input = JSON.parse(raw); } catch { throw new StockError('INVALID_INPUT', 'El JSON no es válido.'); }
        const result = await recordPass(env.DB, workspace, input);
        return json(result, result.repeated ? 200 : 201);
      }
      return json({ error: 'NOT_FOUND', message: 'No se encontró la operación.' }, 404);
    } catch (error) {
      if (error instanceof StockError) return json({ error: error.code, message: error.message }, error.status);
      console.error('Request failed', { path: pathname, error: error.name });
      return json({ error: 'UNAVAILABLE', message: 'El servicio no está disponible. Intentá de nuevo.' }, 503);
    }
  },
};
