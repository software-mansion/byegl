// Injected at document_start in the MAIN world when Force ByeGL is active.
//
// Strategy: inject a <script type="module"> as early as possible so that its
// top-level `await` completes before the page's own module scripts run.
// Non-module inline scripts that execute during HTML parsing may still run
// before the import resolves — this is a platform limitation.

const script = document.createElement('script');
script.type = 'module';
script.textContent = `
  import * as byegl from 'https://esm.sh/byegl';
  await byegl.enable();
`;
// Append synchronously so the browser queues this module before parsing
// the rest of the document's <script> tags.
document.documentElement.appendChild(script);
