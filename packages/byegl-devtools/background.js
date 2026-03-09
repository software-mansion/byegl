// Tab state: Map<tabId, { detected: boolean, inspectMode: boolean, forceByegl: boolean }>
const tabState = new Map();

// Panel ports: Map<tabId, Port>
const panelPorts = new Map();

const INSPECT_MODE_SCRIPT_ID = 'byegl-inspect-mode';
const FORCE_BYEGL_SCRIPT_ID = 'byegl-force-byegl';

// --- Icon Drawing ---

function drawIcon(size, detected) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size;

  const headColor = detected ? '#FFC97E' : '#C0C0C0';
  const bodyColor = detected ? '#FF8B7E' : '#A0A0A0';
  const sideColor = detected ? '#E46551' : '#888888';
  const eyeColor = detected ? '#323232' : '#606060';

  // Sides / arms
  ctx.fillStyle = sideColor;
  ctx.beginPath();
  ctx.roundRect(0, Math.round(s * 0.5), Math.round(s * 0.14), Math.round(s * 0.36), Math.round(s * 0.06));
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(Math.round(s * 0.86), Math.round(s * 0.5), Math.round(s * 0.14), Math.round(s * 0.36), Math.round(s * 0.06));
  ctx.fill();

  // Body
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(Math.round(s * 0.5), Math.round(s * 0.67), Math.round(s * 0.38), Math.round(s * 0.28), 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = headColor;
  ctx.beginPath();
  ctx.ellipse(Math.round(s * 0.5), Math.round(s * 0.36), Math.round(s * 0.34), Math.round(s * 0.27), 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(Math.round(s * 0.37), Math.round(s * 0.34), Math.round(s * 0.075), 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(Math.round(s * 0.63), Math.round(s * 0.32), Math.round(s * 0.075), 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, s, s);
}

async function updateTabIcon(tabId, detected) {
  try {
    await chrome.action.setIcon({
      tabId,
      imageData: {
        16: drawIcon(16, detected),
        32: drawIcon(32, detected),
      },
    });
  } catch {
    // Tab may have been closed
  }
}

// --- State helpers ---

function getTabState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { detected: false, inspectMode: false, forceByegl: false });
  }
  return tabState.get(tabId);
}

function notifyPanel(tabId, message) {
  panelPorts.get(tabId)?.postMessage(message);
}

// --- Dynamic content script helpers ---

async function registerContentScript(id, file) {
  try {
    await chrome.scripting.registerContentScripts([{
      id,
      matches: ['<all_urls>'],
      js: [file],
      world: 'MAIN',
      runAt: 'document_start',
      persistAcrossSessions: false,
    }]);
  } catch {
    // Already registered — update it instead
    try {
      await chrome.scripting.updateContentScripts([{ id }]);
    } catch {
      // Ignore
    }
  }
}

async function unregisterContentScript(id) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // Not registered
  }
}

async function getRegisteredScriptIds() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return new Set(scripts.map((s) => s.id));
  } catch {
    return new Set();
  }
}

// --- Lifecycle ---

// On install/update, clean up leftover dynamic registrations
chrome.runtime.onInstalled.addListener(async () => {
  await unregisterContentScript(INSPECT_MODE_SCRIPT_ID);
  await unregisterContentScript(FORCE_BYEGL_SCRIPT_ID);
});

// On service worker startup, sync in-memory state with existing registrations
(async () => {
  const registered = await getRegisteredScriptIds();
  // If scripts are registered (e.g. from before SW restart), reflect that in state
  // We can't know which tab triggered it so we'll leave tabState empty —
  // panels will re-query and toggle UI will reflect the registration state via the panel query
  if (!registered.has(INSPECT_MODE_SCRIPT_ID) && !registered.has(FORCE_BYEGL_SCRIPT_ID)) {
    return;
  }
  // Store global flags so panels can read them
  await chrome.storage.session.set({
    inspectModeActive: registered.has(INSPECT_MODE_SCRIPT_ID),
    forceByeglActive: registered.has(FORCE_BYEGL_SCRIPT_ID),
  });
})();

// --- Messages from content scripts ---

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'BYEGL_DETECTION') {
    const tabId = sender.tab?.id;
    if (tabId == null) return;

    const state = getTabState(tabId);
    if (state.detected === message.detected) return;

    state.detected = message.detected;
    updateTabIcon(tabId, message.detected);
    notifyPanel(tabId, { type: 'STATE_UPDATE', state: { ...state } });
  }
});

// --- Port-based communication with DevTools panels ---

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('panel-')) return;

  const tabId = parseInt(port.name.slice(6), 10);
  panelPorts.set(tabId, port);

  port.onDisconnect.addListener(() => {
    panelPorts.delete(tabId);
  });

  port.onMessage.addListener(async (message) => {
    const state = getTabState(tabId);

    switch (message.type) {
      case 'GET_STATE': {
        // Also include global registration state
        const registered = await getRegisteredScriptIds();
        state.inspectMode = registered.has(INSPECT_MODE_SCRIPT_ID);
        state.forceByegl = registered.has(FORCE_BYEGL_SCRIPT_ID);
        port.postMessage({ type: 'STATE_UPDATE', state: { ...state } });
        break;
      }

      case 'SET_INSPECT_MODE': {
        state.inspectMode = message.enabled;
        if (message.enabled) {
          await registerContentScript(INSPECT_MODE_SCRIPT_ID, 'injected/inspect-mode.js');
        } else {
          await unregisterContentScript(INSPECT_MODE_SCRIPT_ID);
        }
        port.postMessage({ type: 'STATE_UPDATE', state: { ...state } });
        break;
      }

      case 'SET_FORCE_BYEGL': {
        state.forceByegl = message.enabled;
        if (message.enabled) {
          await registerContentScript(FORCE_BYEGL_SCRIPT_ID, 'dist/injected/force-byegl.iife.js');
        } else {
          await unregisterContentScript(FORCE_BYEGL_SCRIPT_ID);
        }
        port.postMessage({ type: 'STATE_UPDATE', state: { ...state } });
        break;
      }

      case 'RELOAD':
        await chrome.tabs.reload(tabId);
        break;
    }
  });
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  panelPorts.delete(tabId);
});

// Set default icon on all existing tabs at startup
chrome.tabs.query({}).then((tabs) => {
  for (const tab of tabs) {
    if (tab.id != null) {
      updateTabIcon(tab.id, false).catch(() => {});
    }
  }
});
