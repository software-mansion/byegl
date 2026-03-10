// Runs in the extension's ISOLATED world.
// Listens for detection events from the MAIN world script and forwards
// them to the background service worker.

let lastDetected = null;

window.addEventListener('__byegl_detection__', (e) => {
  const { detected } = e.detail;
  if (detected === lastDetected) return;
  lastDetected = detected;
  chrome.runtime.sendMessage({ type: 'BYEGL_DETECTION', detected }).catch(() => {});
});
