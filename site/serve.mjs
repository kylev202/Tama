// Previews the website with its live demo straight from the sources, no build step:
// `npm run site`, then open http://localhost:5180/. Files are read fresh on every request,
// so edits to site/ or src/ show up on reload. The URL layout matches the published site.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoPage } from './demo-page.mjs';

const site = fileURLToPath(new URL('.', import.meta.url));
const src = fileURLToPath(new URL('../src/', import.meta.url));
const port = Number(process.env.PORT ?? 5180);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const STAND_INS = ['/demo/bridge.js', '/demo/control.js'];

/** The app's front end answers under /demo/ (apart from the stand-ins); site/ everywhere else. */
function locate(path) {
  if (path.startsWith('/demo/') && !STAND_INS.includes(path)) return normalize(join(src, path.slice('/demo/'.length)));
  return normalize(join(site, path));
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/demo') return res.writeHead(301, { location: '/demo/' }).end();
  if (path.endsWith('/')) path += 'index.html';
  try {
    if (path === '/demo/index.html') {
      const html = demoPage(await readFile(join(src, 'index.html'), 'utf8'));
      return res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }).end(html);
    }
    const file = locate(path);
    if (!file.startsWith(site) && !file.startsWith(src.endsWith(sep) ? src : src + sep)) throw new Error('outside the site');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Tama's website: http://localhost:${port}/`));
