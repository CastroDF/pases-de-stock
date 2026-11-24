const encoder = new TextEncoder();
const ttl = 4 * 60 * 60;
const accounts = { operador: 'DEMO_OPERATOR_PASSWORD', supervisor: 'DEMO_SUPERVISOR_PASSWORD' };

function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function authenticate(env, { username, password } = {}) {
  if (typeof username !== 'string' || !Object.hasOwn(accounts, username)
    || typeof password !== 'string' || password.length > 128) return null;
  const expected = env[accounts[username]];
  if (!expected || typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32) return null;
  const signingKey = await key(env.SESSION_SECRET);
  const expectedSignature = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(expected));
  const valid = await crypto.subtle.verify('HMAC', signingKey, expectedSignature, encoder.encode(password));
  return valid ? username : null;
}

export async function sessionCookie(env, role, secure) {
  const suffix = `; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  if (!role) return `pases_session=; Max-Age=0${suffix}`;
  const data = `${role}.${Math.floor(Date.now() / 1000) + ttl}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await key(env.SESSION_SECRET), encoder.encode(data));
  const token = btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('/', '_').replaceAll('+', '-').replace(/=+$/, '');
  return `pases_session=${data}.${token}; Max-Age=${ttl}${suffix}`;
}

export async function sessionRole(request, env) {
  const cookie = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith('pases_session='));
  const token = cookie?.slice('pases_session='.length);
  const parts = token?.match(/^(operador|supervisor)\.(\d{10})\.([a-f0-9-]{36})\.([a-zA-Z0-9_-]{43})$/);
  if (!parts || !env.SESSION_SECRET) return null;
  const [, role, expiration, nonce, signature] = parts;
  if (Number(expiration) <= Math.floor(Date.now() / 1000)) return null;
  const bytes = Uint8Array.from(atob(signature.replaceAll('_', '/').replaceAll('-', '+')), char => char.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', await key(env.SESSION_SECRET), bytes,
    encoder.encode(`${role}.${expiration}.${nonce}`));
  return valid ? role : null;
}
