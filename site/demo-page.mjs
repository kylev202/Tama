// The demo page: the app's own index.html, with the stand-in bridge loaded before main.js and
// the page's handle (control.js) after it. Shared by build.mjs and serve.mjs.
const ENTRY = '<script type="module" src="js/main.js"></script>';

export function demoPage(html) {
  if (!html.includes(ENTRY)) throw new Error(`src/index.html no longer loads ${ENTRY}; update site/demo-page.mjs`);
  return html
    .replace('<title>Tama</title>', '<title>Tama demo</title>\n    <meta name="robots" content="noindex" />')
    .replace(ENTRY, `<script src="bridge.js"></script>\n    ${ENTRY}\n    <script type="module" src="control.js"></script>`);
}
