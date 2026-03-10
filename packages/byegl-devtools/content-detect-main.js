// Runs in the page's MAIN world.
// Dispatches __byegl_detection__ events so the isolated-world content script
// can relay them to the background service worker.

(function poll() {
  const detected = typeof globalThis.__BYEGL__ !== 'undefined';
  window.dispatchEvent(
    new CustomEvent('__byegl_detection__', {
      detail: {
        detected,
        version: globalThis.__BYEGL__?.version ?? null,
      },
    }),
  );
  setTimeout(poll, 500);
})();
