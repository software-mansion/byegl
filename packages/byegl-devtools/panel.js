const tabId = chrome.devtools.inspectedWindow.tabId;

// --- DOM refs ---
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const statusVersion = document.getElementById('status-version');
const inspectBanner = document.getElementById('inspect-banner');
const contextsRow = document.getElementById('contexts-row');
const contextsCount = document.getElementById('contexts-count');
const inspectCheckbox = document.getElementById('inspect-checkbox');
const forceByeglCheckbox = document.getElementById('force-byegl-checkbox');
const reloadBtn = document.getElementById('reload-btn');

// --- State ---
let state = { detected: false, inspectMode: false, forceByegl: false };

// --- Background port ---
let port = null;

function connect() {
  port = chrome.runtime.connect({ name: `panel-${tabId}` });

  port.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      applyState(message.state);
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    // Reconnect if the service worker was restarted
    setTimeout(connect, 500);
  });

  port.postMessage({ type: 'GET_STATE' });
}

function sendToBackground(message) {
  port?.postMessage(message);
}

// --- UI update ---

function applyState(newState) {
  state = { ...state, ...newState };

  // Detection status
  if (state.detected) {
    statusDot.className = 'dot on';
    statusLabel.textContent = 'ByeGL detected';
    statusVersion.textContent = `v${state.version ?? '?'}`;
    statusVersion.classList.remove('hidden');
  } else {
    statusDot.className = 'dot off';
    statusLabel.textContent = 'Not detected';
    statusVersion.classList.add('hidden');
  }

  // Inspect Mode
  inspectCheckbox.checked = state.inspectMode;
  inspectBanner.classList.toggle('active', state.inspectMode);
  contextsRow.classList.toggle('hidden', !state.inspectMode);

  // Force ByeGL
  forceByeglCheckbox.checked = state.forceByegl;
}

// --- Context count polling ---
// Evaluated in the inspected page's MAIN world via the DevTools API

let contextsPollTimer = null;

function startContextPolling() {
  stopContextPolling();
  contextsPollTimer = setInterval(pollContexts, 1000);
  pollContexts();
}

function stopContextPolling() {
  if (contextsPollTimer != null) {
    clearInterval(contextsPollTimer);
    contextsPollTimer = null;
  }
}

function pollContexts() {
  chrome.devtools.inspectedWindow.eval(
    '(globalThis.__BYEGL__ ? globalThis.__BYEGL__.contexts.length : 0)',
    (result, err) => {
      if (err) return;
      contextsCount.textContent = String(result ?? 0);
    },
  );

  // Also re-check the version if not yet known
  if (state.detected && state.version == null) {
    chrome.devtools.inspectedWindow.eval('globalThis.__BYEGL__?.version ?? null', (result) => {
      if (result != null) applyState({ version: result });
    });
  }
}

// --- Event handlers ---

inspectCheckbox.addEventListener('change', () => {
  sendToBackground({ type: 'SET_INSPECT_MODE', enabled: inspectCheckbox.checked });
});

forceByeglCheckbox.addEventListener('change', () => {
  sendToBackground({ type: 'SET_FORCE_BYEGL', enabled: forceByeglCheckbox.checked });
});

reloadBtn.addEventListener('click', () => {
  sendToBackground({ type: 'RELOAD' });
});

// --- Init ---

connect();
startContextPolling();
