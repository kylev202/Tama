// Builds the website into _site/: the pages in site/, plus the app's own front end (src/)
// under demo/, with the stand-in bridge loaded first so the real island runs in the page.
// No dependencies: `node site/build.mjs`. To preview, `npm run site` serves the same thing
// straight from the sources.
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { demoPage } from './demo-page.mjs';

const root = new URL('../', import.meta.url);
const out = new URL('_site/', root);
const TOOLS = ['build.mjs', 'serve.mjs', 'demo-page.mjs'];

await rm(out, { recursive: true, force: true });
await cp(new URL('site/', root), out, { recursive: true, filter: (path) => !TOOLS.some((tool) => path.endsWith(tool)) });
// Over the placeholder site/demo/index.html, which only explains how to preview.
await cp(new URL('src/', root), new URL('demo/', out), { recursive: true });

const page = new URL('demo/index.html', out);
await writeFile(page, demoPage(await readFile(page, 'utf8')));
console.log(`Built ${fileURLToPath(out)}`);
