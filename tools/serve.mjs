// Serveur statique minimal, sans dépendance : `npm start` puis http://localhost:8000
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 8000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const file = join(root, rel);
    if (!file.startsWith(root)) throw new Error('hors racine');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('404');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
