# byegl-devtools

A Chrome DevTools extension for [ByeGL](https://docs.swmansion.com/byegl) — WebGL running on WebGPU.

## Features

- **Toolbar icon** switches between colored (detected) and gray (not detected) based on whether `globalThis.__BYEGL__` is present on the current page.
- **ByeGL panel** in DevTools (alongside Console, Network, etc.) shows:
  - Detection status and library version
  - Live count of WebGL contexts created (in Inspect Mode)
  - **Inspect Mode** — sets `globalThis.__BYEGL_INSPECT__ = true` before any page scripts run, enabling context tracking
  - **Force ByeGL** — imports byegl from `esm.sh` and calls `enable()` early, intercepting `canvas.getContext()` on pages that don't use ByeGL themselves

## Code structure

```
byegl-devtools/
├── manifest.json            # MV3 manifest
├── background.js            # Service worker: icon state, dynamic script registration, panel ports
├── content-detect-main.js  # MAIN world: polls globalThis.__BYEGL__, dispatches DOM event
├── content-detect.js        # ISOLATED world: relays detection event → background
├── devtools.html/js         # Creates the DevTools panel tab
├── panel.html/js            # Panel UI and logic
├── injected/
│   └── inspect-mode.js      # Sets __BYEGL_INSPECT__ = true (MAIN world, document_start)
│
├── dist/
|   └── injected/
│       └── force-byegl.iife.js   # Injects <script type="module"> that imports & enables byegl
│
└── icons/
    ├── byegl-on.svg         # Colored logomark (detected)
    └── byegl-off.svg        # Grayscale logomark (not detected)
```

### How injection works

Inspect Mode and Force ByeGL use `chrome.scripting.registerContentScripts()` with `world: 'MAIN'` and `runAt: 'document_start'`. This guarantees execution before any page scripts — the only reliable MV3 mechanism for this. Scripts are registered globally but with `persistAcrossSessions: false`, so they're cleared on browser restart. Toggling either checkbox registers/unregisters the script immediately; you then reload the page to apply.

> **Force ByeGL timing note:** the injected module script runs before other `<script type="module">` tags on the page. Non-module inline scripts that execute during HTML parsing may still run before the `await byegl.enable()` resolves — this is a browser platform limitation.

## Loading locally

The **Force ByeGL** feature requires a build step to bundle byegl into the injected script:

```sh
pnpm install
pnpm --filter byegl-devtools build
```

Then:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `packages/byegl-devtools/` directory

Re-run the build step whenever byegl or `src/force-byegl.ts` changes, then click the **↺ reload** button on the extension card.

## Testing

### Detection

Open any page that uses ByeGL (e.g. the [ByeGL docs examples](https://docs.swmansion.com/byegl)). The toolbar icon should turn colored and the panel should show "ByeGL detected" with the library version.

For a quick local test, open DevTools Console on any page and run:

```js
globalThis.__BYEGL__ = { version: '0.2.6', contexts: [] };
```

The icon and panel status should update within ~500 ms.

### Inspect Mode

1. Open the ByeGL panel in DevTools
2. Check **Inspect Mode** and click **Reload page**
3. In the Console, verify `globalThis.__BYEGL_INSPECT__ === true` before any app code runs
4. The panel should show the live context count incrementing as WebGL contexts are created

### Force ByeGL

1. Navigate to a page with WebGL that does **not** use ByeGL (e.g. a Three.js demo)
2. Check **Force ByeGL** and click **Reload page**
3. In the Console, verify `HTMLCanvasElement.prototype.getContext` has been patched by ByeGL

**How it works:** `byegl.enableSync()` patches `getContext` synchronously at `document_start` using a `RecordingDevice` proxy. All WebGPU API calls made before the real device is ready are recorded and replayed once `tgpu.init()` resolves. Draw calls issued before activation are silently dropped — the page's render loop reissues them on the next frame.

### Iterating on extension code

After editing any file, go to `chrome://extensions` and click the **↺ reload** button on the byegl-devtools card. Then close and reopen DevTools on the target page.

## Icons

`byegl-on.svg` and `byegl-off.svg` are SVG placeholders derived from the ByeGL logomark. The toolbar icon is drawn programmatically via `OffscreenCanvas` in the service worker. To use custom PNG variants, add `byegl-on-16.png`, `byegl-on-48.png`, etc. to `icons/` and update `background.js` to load them instead.
