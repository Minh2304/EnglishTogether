const ALARM_NAME = 'ET_FLASHCARD_POPUP_ALARM';
const DEFAULT_SERVER_URL = 'https://flashcarddatabase.vercel.app';
const DEFAULT_STATE = {
  email: '',
  displayName: 'Học viên',
  serverUrl: DEFAULT_SERVER_URL,
  flashcards: [],
  settings: {
    popupEnabled: false,
    popupIntervalMinutes: 5,
    practiceDirection: 'mixed' // 'en_to_vi' | 'vi_to_en' | 'mixed'
  },
  lastSyncedAt: null
};

// Track whether the right-side tool panel is currently open
const activeSidePanelPorts = new Set();

function isToolPanelOpen() {
  return activeSidePanelPorts.size > 0;
}

async function configureSidePanel() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (err) {
      console.warn('sidePanel.setPanelBehavior error:', err);
    }
  }
}

configureSidePanel();

async function hideAllActivePopups() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && /^https?:\/\//i.test(tab.url)) {
        chrome.tabs.sendMessage(tab.id, { type: 'HIDE_FLASHCARD_POPUP' }).catch(() => {});
      }
    }
  } catch (e) {
    // Ignore
  }
}

// Listen for Side Panel open / close lifecycle
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ET_SIDE_PANEL') {
    activeSidePanelPorts.add(port);
    // While tool panel is open: cancel countdown alarm and hide any active popup
    chrome.alarms.clear(ALARM_NAME);
    hideAllActivePopups();

    port.onDisconnect.addListener(() => {
      activeSidePanelPorts.delete(port);
      // When user closes the tool panel: start countdown timer from the beginning
      if (activeSidePanelPorts.size === 0) {
        schedulePopupAlarm();
      }
    });
  }
});

async function getStoredState() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  return {
    email: data.email ?? DEFAULT_STATE.email,
    displayName: data.displayName ?? DEFAULT_STATE.displayName,
    serverUrl: data.serverUrl || DEFAULT_SERVER_URL,
    flashcards: Array.isArray(data.flashcards) ? data.flashcards : [],
    settings: {
      ...DEFAULT_STATE.settings,
      ...(data.settings || {})
    },
    lastSyncedAt: data.lastSyncedAt ?? null
  };
}

function normalizeServerUrl(url) {
  const trimmed = String(url || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SERVER_URL;
  if (trimmed.endsWith('/api/sync')) {
    return trimmed.slice(0, -9);
  }
  return trimmed;
}

function mergeFlashcardsLocal(localCards = [], remoteCards = []) {
  const map = new Map();
  for (const c of remoteCards) {
    if (c && c.id) map.set(c.id, c);
  }
  for (const c of localCards) {
    if (c && c.id) {
      const existing = map.get(c.id);
      if (!existing || (c.updatedAt || 0) >= (existing.updatedAt || 0)) {
        map.set(c.id, c);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function schedulePopupAlarm() {
  await chrome.alarms.clear(ALARM_NAME);

  // Do NOT start countdown while the tool Side Panel is open
  if (isToolPanelOpen()) {
    return;
  }

  const state = await getStoredState();
  const enabled = Boolean(state.settings?.popupEnabled);
  const minutes = Math.max(0.5, Number(state.settings?.popupIntervalMinutes) || 5);

  if (enabled) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: minutes
    });
  }
}

async function pullFromServer() {
  const state = await getStoredState();
  const email = String(state.email || '').trim().toLowerCase();
  const baseUrl = normalizeServerUrl(state.serverUrl);

  if (!email || !baseUrl) {
    return { ok: false, reason: 'missing_config', state };
  }

  try {
    const res = await fetch(`${baseUrl}/api/sync?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.ok || !json.data) {
      throw new Error(json.error || 'Invalid response from server');
    }

    const remote = json.data;
    const mergedCards = mergeFlashcardsLocal(state.flashcards, remote.flashcards || []);
    const updatedState = {
      email,
      displayName: remote.displayName || state.displayName || email.split('@')[0],
      serverUrl: baseUrl,
      flashcards: mergedCards,
      settings: {
        ...state.settings,
        ...(remote.settings || {})
      },
      lastSyncedAt: Date.now()
    };

    await chrome.storage.local.set(updatedState);
    await schedulePopupAlarm();

    if (mergedCards.length !== (remote.flashcards || []).length) {
      await pushToServer(false);
    }

    return { ok: true, storageMode: json.storageMode, state: updatedState };
  } catch (err) {
    return { ok: false, error: err.message, state };
  }
}

async function pushToServer(replaceAll = false) {
  const state = await getStoredState();
  const email = String(state.email || '').trim().toLowerCase();
  const baseUrl = normalizeServerUrl(state.serverUrl);

  if (!email || !baseUrl) {
    return { ok: false, reason: 'missing_config', state };
  }

  try {
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        displayName: state.displayName,
        flashcards: state.flashcards,
        settings: state.settings,
        replaceAll
      })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.ok || !json.data) {
      throw new Error(json.error || 'Sync failed');
    }

    const updatedState = {
      ...state,
      displayName: json.data.displayName || state.displayName,
      flashcards: Array.isArray(json.data.flashcards) ? json.data.flashcards : state.flashcards,
      settings: {
        ...state.settings,
        ...(json.data.settings || {})
      },
      lastSyncedAt: Date.now()
    };

    await chrome.storage.local.set(updatedState);
    return { ok: true, storageMode: json.storageMode, state: updatedState };
  } catch (err) {
    return { ok: false, error: err.message, state };
  }
}

function pickRandomQuizPayload(flashcards, preferredDirection = 'mixed') {
  if (!Array.isArray(flashcards) || flashcards.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * flashcards.length);
  const card = flashcards[randomIndex];

  let direction = preferredDirection;
  if (direction !== 'en_to_vi' && direction !== 'vi_to_en') {
    direction = Math.random() < 0.5 ? 'en_to_vi' : 'vi_to_en';
  }

  return {
    card,
    direction,
    totalCards: flashcards.length
  };
}

async function triggerTopRightPopup(forceShow = false) {
  // Never trigger timed popup if the Side Panel tool is currently open
  if (!forceShow && isToolPanelOpen()) {
    await chrome.alarms.clear(ALARM_NAME);
    return { ok: false, reason: 'panel_open' };
  }

  const state = await getStoredState();
  if (!forceShow && !state.settings?.popupEnabled) {
    return { ok: false, reason: 'disabled' };
  }

  const quiz = pickRandomQuizPayload(state.flashcards, state.settings?.practiceDirection);
  if (!quiz) {
    if (state.settings?.popupEnabled && !isToolPanelOpen()) {
      await schedulePopupAlarm();
    }
    return { ok: false, reason: 'no_cards' };
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  let targetTab = tabs.find(t => t.url && /^https?:\/\//i.test(t.url));

  if (!targetTab) {
    const allTabs = await chrome.tabs.query({});
    targetTab = allTabs.find(t => t.url && /^https?:\/\//i.test(t.url));
  }

  if (targetTab && targetTab.id) {
    try {
      await chrome.tabs.sendMessage(targetTab.id, {
        type: 'SHOW_FLASHCARD_POPUP',
        payload: quiz
      });
      return { ok: true, mode: 'content_script' };
    } catch (err) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(targetTab.id, {
          type: 'SHOW_FLASHCARD_POPUP',
          payload: quiz
        });
        return { ok: true, mode: 'injected_content_script' };
      } catch (injectErr) {
        console.warn('Could not inject into tab, falling back to popup window:', injectErr);
      }
    }
  }

  try {
    await chrome.storage.local.set({ activeQuizPayload: quiz });
    const currentWin = await chrome.windows.getLastFocused();
    const width = 365;
    const height = 250;
    const left = currentWin && currentWin.left !== undefined && currentWin.width
      ? Math.max(0, currentWin.left + currentWin.width - width - 24)
      : 1000;
    const top = currentWin && currentWin.top !== undefined
      ? Math.max(0, currentWin.top + 60)
      : 40;

    await chrome.windows.create({
      url: chrome.runtime.getURL('quiz-popup.html'),
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true
    });
    return { ok: true, mode: 'popup_window' };
  } catch (winErr) {
    await schedulePopupAlarm();
    return { ok: false, reason: 'no_injectable_tab' };
  }
}

async function tryAutoDetectEmail() {
  const state = await getStoredState();
  if (state.email) return;
  if (chrome.identity && chrome.identity.getProfileUserInfo) {
    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, async (info) => {
      if (info && info.email) {
        const email = info.email.trim().toLowerCase();
        await chrome.storage.local.set({
          email,
          displayName: state.displayName === 'Học viên' ? email.split('@')[0] : state.displayName
        });
        await pullFromServer();
      }
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await configureSidePanel();
  const existing = await chrome.storage.local.get(null);
  if (!existing || Object.keys(existing).length === 0) {
    await chrome.storage.local.set(DEFAULT_STATE);
  }
  await tryAutoDetectEmail();
  await schedulePopupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await configureSidePanel();
  await tryAutoDetectEmail();
  await pullFromServer();
  await schedulePopupAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await triggerTopRightPopup(false);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'SYNC_PULL': {
        const res = await pullFromServer();
        sendResponse(res);
        break;
      }
      case 'SYNC_PUSH': {
        const res = await pushToServer(Boolean(message.replaceAll));
        await schedulePopupAlarm();
        sendResponse(res);
        break;
      }
      case 'UPDATE_ALARM': {
        await schedulePopupAlarm();
        sendResponse({ ok: true });
        break;
      }
      case 'POPUP_CLOSED_OR_COMPLETED': {
        await schedulePopupAlarm();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;
});
