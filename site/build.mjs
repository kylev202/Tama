// Builds the website into _site/: the pages in site/, plus the app's own front end (src/)
// under demo/, with the stand-in bridge loaded first so the real island runs in the page.
// No dependencies: `node site/build.mjs`, then serve _site/.
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const out = new URL('_site/', root);

await rm(out, { recursive: true, force: true });
await cp(new URL('site/', root), out, { recursive: true, filter: (path) => !path.endsWith('build.mjs') });
await cp(new URL('src/', root), new URL('demo/', out), { recursive: true });

const page = new URL('demo/index.html', out);
const entry = '<script type="module" src="js/main.js"></script>';
const html = await readFile(page, 'utf8');
if (!html.includes(entry)) throw new Error(`src/index.html no longer loads ${entry}; update site/build.mjs`);
await writeFile(
  page,
  html
    .replace('<title>Tama</title>', '<title>Tama demo</title>\n    <meta name="robots" content="noindex" />')
    .replace(entry, `<script src="bridge.js"></script>\n    ${entry}\n    <script type="module" src="control.js"></script>`),
);
console.log(`Built ${fileURLToPath(out)}`);
