import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { openDatabase } from './sqlite.mjs';
import worker from '../src/worker.mjs';

const port = Number(process.env.PORT ?? '4123');
mkdirSync(new URL('../.data/', import.meta.url), { recursive: true });
const { binding } = openDatabase(new URL('../.data/demo.sqlite', import.meta.url));
const assets = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']]]);
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, value.toString());
    const origin = `http://${headers.get('host') ?? `127.0.0.1:${port}`}`;
    const method = req.method ?? 'GET';
    const request = new Request(new URL(req.url ?? '/', origin), {
      method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: req, duplex: 'half' }),
    });
    const response = await worker.fetch(request, { DB: binding, ASSETS: {
      async fetch(input) {
        const item = assets.get(new URL(input.url).pathname);
        if (!item) return new Response('No encontrado', { status: 404 });
        return new Response(await readFile(new URL(`../public/${item[0]}`, import.meta.url)), {
          headers: { 'Content-Type': `${item[1]}; charset=utf-8` },
        });
      },
    }});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500).end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Panel en http://127.0.0.1:${port}`));
