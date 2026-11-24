import { authenticate, sessionCookie, sessionRole } from './auth.mjs';
import { checkAvailability, readStock, recordPass, StockError } from './stock.mjs';
import { listReasons, saveReason, deleteReason } from './reasons.mjs';
import { nextBusinessDay } from './calendar.mjs';

const workspace = 'dc8e9bcd-f663-4a28-bfd8-a3591df630d3';
const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

async function readInput(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new StockError('INVALID_INPUT', 'El cuerpo debe estar en JSON.', 415);
  }
  const raw = await request.text();
  if (raw.length > 4096) throw new StockError('INVALID_INPUT', 'La solicitud es demasiado larga.', 413);
  try { return JSON.parse(raw); } catch { throw new StockError('INVALID_INPUT', 'El JSON no es válido.'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (method !== 'GET' && request.headers.get('Origin') !== url.origin) {
        throw new StockError('INVALID_ORIGIN', 'Abrí el panel para continuar.', 403);
      }
      const secure = url.protocol === 'https:';
      if (method === 'POST' && pathname === '/api/login') {
        const role = await authenticate(env, (await readInput(request)) ?? {});
        if (!role) throw new StockError('INVALID_LOGIN', 'Usuario o contraseña incorrectos.', 401);
        return json({ role }, 200, { 'Set-Cookie': await sessionCookie(env, role, secure) });
      }
      if (method === 'POST' && pathname === '/api/logout') {
        return json({}, 200, { 'Set-Cookie': await sessionCookie(env, null, secure) });
      }
      const role = await sessionRole(request, env);
      if (!role) throw new StockError('AUTH_REQUIRED', 'Iniciá sesión para continuar.', 401);
      if (method === 'GET' && pathname === '/api/session') return json({ role });
      if (method === 'GET' && pathname === '/api/stock') return json(await readStock(env.DB, workspace));
      if (method === 'GET' && pathname === '/api/calendar') return json(await nextBusinessDay());
      if (method === 'GET' && pathname === '/api/passes/availability') {
        return json(await checkAvailability(env.DB, workspace, url.searchParams));
      }
      if (method === 'POST' && pathname === '/api/passes') {
        if (role !== 'operador') {
          throw new StockError('FORBIDDEN', 'Solo Operación puede confirmar pases.', 403);
        }
        const result = await recordPass(env.DB, workspace, await readInput(request));
        return json(result, result.repeated ? 200 : 201);
      }
      if (method === 'GET' && pathname === '/api/reasons') return json(await listReasons(env.DB));
      const reason = pathname.match(/^\/api\/reasons\/([a-z0-9-]{1,36})$/);
      if ((method === 'POST' && pathname === '/api/reasons') || (reason && ['PUT', 'DELETE'].includes(method))) {
        if (role !== 'supervisor') {
          throw new StockError('FORBIDDEN', 'Solo Supervisión puede administrar motivos.', 403);
        }
        if (method === 'DELETE') {
          await deleteReason(env.DB, reason[1]);
          return new Response(null, { status: 204 });
        }
        return json(await saveReason(env.DB, reason?.[1], await readInput(request)), reason ? 200 : 201);
      }
      return json({ error: 'NOT_FOUND', message: 'No se encontró la operación.' }, 404);
    } catch (error) {
      if (error instanceof StockError) return json({ error: error.code, message: error.message }, error.status);
      console.error('Request failed', { path: pathname, error: error.name });
      return json({ error: 'UNAVAILABLE', message: 'El servicio no está disponible. Intentá de nuevo.' }, 503);
    }
  },
};
