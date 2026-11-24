import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await mkdir(dist, { recursive: true });

const sources = ['worker.mjs', 'stock.mjs', 'calendar.mjs'];
await Promise.all(sources.map(name => copyFile(new URL(`src/${name}`, root), new URL(name, dist))));

const staticFiles = {
  'index.html': 'text/html; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'app.js': 'application/javascript; charset=utf-8',
};
const assets = Object.fromEntries(await Promise.all(Object.entries(staticFiles).map(async ([name, type]) =>
  [`/${name}`, { type, body: await readFile(new URL(`public/${name}`, root), 'utf8') }],
)));

await writeFile(new URL('site.mjs', dist), `import worker from './worker.mjs';
const files = ${JSON.stringify(assets)};
const ASSETS = { fetch(request) {
  const url = new URL(request.url);
  const file = Object.hasOwn(files, url.pathname === '/' ? '/index.html' : url.pathname)
    ? files[url.pathname === '/' ? '/index.html' : url.pathname]
    : null;
  if (!file) return new Response(null, { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : file.body, {
    headers: {
      'Content-Type': file.type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    },
  });
} };
export default { fetch: (request, env) => worker.fetch(request, { DB: env.DB, ASSETS }) };
`);
