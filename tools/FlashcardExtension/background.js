const ALARM_NAME = 'ET_FLASHCARD_POPUP_ALARM';
const SYNC_DEBOUNCE_ALARM = 'ET_SYNC_FLUSH_ALARM';
const DEFAULT_SERVER_URL = 'https://flashcarddatabase.vercel.app';
const AUTO_PULL_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours cooldown for automatic pulls
const POPUP_REPEAT_COOLDOWN_COUNT = 5; // Do not repeat a word for the next 5 popup appearances

const DEFAULT_STATE = {
  email: '',
  displayName: 'User',
  serverUrl: DEFAULT_SERVER_URL,
  flashcards: [],
  settings: {
    popupEnabled: false,
    popupIntervalMinutes: 5,
    practiceDirection: 'mixed'
  },
  lastSyncedAt: null,
  lastPulledAt: 0,
  serverVersionAt: 0,
  dirtyCardIds: [],
  deletedCardIds: [],
  dirtyProfile: false,
  recentPopupCardIds: []
};

const activeSidePanelPorts = new Set();
let flushInProgress = false;

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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ET_SIDE_PANEL') {
    activeSidePanelPorts.add(port);
    chrome.alarms.clear(ALARM_NAME);
    hideAllActivePopups();

    port.onDisconnect.addListener(async () => {
      activeSidePanelPorts.delete(port);
      if (activeSidePanelPorts.size === 0) {
        await chrome.alarms.clear(SYNC_DEBOUNCE_ALARM);
        await flushPendingDeltaToServer();
        await schedulePopupAlarm();
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
    lastSyncedAt: data.lastSyncedAt ?? null,
    lastPulledAt: Number(data.lastPulledAt) || 0,
    serverVersionAt: Number(data.serverVersionAt) || 0,
    dirtyCardIds: Array.isArray(data.dirtyCardIds) ? data.dirtyCardIds : [],
    deletedCardIds: Array.isArray(data.deletedCardIds) ? data.deletedCardIds : [],
    dirtyProfile: Boolean(data.dirtyProfile),
    recentPopupCardIds: Array.isArray(data.recentPopupCardIds) ? data.recentPopupCardIds : []
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

function mergeAltMeanings(arr1 = [], arr2 = []) {
  const set = new Set();
  for (const m of [...(Array.isArray(arr1) ? arr1 : []), ...(Array.isArray(arr2) ? arr2 : [])]) {
    const clean = String(m || '').normalize('NFC').trim().toLowerCase();
    if (clean) set.add(clean);
  }
  return Array.from(set);
}

function mergeFlashcardsLocal(localCards = [], remoteCards = [], deletedIds = []) {
  const deletedSet = new Set(deletedIds);
  const map = new Map();
  for (const c of remoteCards) {
    if (c && c.id && !deletedSet.has(c.id)) {
      map.set(c.id, {
        ...c,
        altMeanings: mergeAltMeanings(c.altMeanings)
      });
    }
  }
  for (const c of localCards) {
    if (c && c.id && !deletedSet.has(c.id)) {
      const existing = map.get(c.id);
      if (!existing) {
        map.set(c.id, {
          ...c,
          altMeanings: mergeAltMeanings(c.altMeanings)
        });
      } else {
        const newer = (c.updatedAt || 0) >= (existing.updatedAt || 0) ? c : existing;
        const older = newer === c ? existing : c;
        map.set(c.id, {
          ...older,
          ...newer,
          phonetic: newer.phonetic || older.phonetic || '',
          partOfSpeech: newer.partOfSpeech || older.partOfSpeech || '',
          audioUrl: newer.audioUrl || older.audioUrl || '',
          altMeanings: mergeAltMeanings(newer.altMeanings, older.altMeanings)
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function schedulePopupAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  if (isToolPanelOpen()) return;

  const state = await getStoredState();
  const enabled = Boolean(state.settings?.popupEnabled);
  const minutes = Math.max(0.5, Number(state.settings?.popupIntervalMinutes) || 5);

  if (enabled) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: minutes
    });
  }
}

async function scheduleDebouncedFlush() {
  await chrome.alarms.clear(SYNC_DEBOUNCE_ALARM);
  await chrome.alarms.create(SYNC_DEBOUNCE_ALARM, {
    delayInMinutes: 0.5
  });
}

async function flushPendingDeltaToServer() {
  if (flushInProgress) return { ok: true, skipped: true };
  const state = await getStoredState();
  const email = String(state.email || '').trim().toLowerCase();
  const baseUrl = normalizeServerUrl(state.serverUrl);

  const hasDirtyCards = state.dirtyCardIds.length > 0;
  const hasDeletedCards = state.deletedCardIds.length > 0;
  const hasDirtyProfile = state.dirtyProfile;

  if (!email || !baseUrl || (!hasDirtyCards && !hasDeletedCards && !hasDirtyProfile)) {
    return { ok: true, noChanges: true, state };
  }

  flushInProgress = true;
  try {
    const dirtySet = new Set(state.dirtyCardIds);
    const upserts = state.flashcards.filter(c => c && dirtySet.has(c.id));
    const deletedIds = [...state.deletedCardIds];

    const res = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        displayName: state.displayName,
        settings: state.settings,
        upserts,
        deletedIds,
        lightResponse: true
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.error || 'Sync failed');
    }

    const latest = await getStoredState();
    const sentDirtySet = dirtySet;
    const sentDelSet = new Set(deletedIds);

    const remainingDirty = latest.dirtyCardIds.filter(id => !sentDirtySet.has(id));
    const remainingDeleted = latest.deletedCardIds.filter(id => !sentDelSet.has(id));
    const now = Date.now();

    await chrome.storage.local.set({
      dirtyCardIds: remainingDirty,
      deletedCardIds: remainingDeleted,
      dirtyProfile: false,
      lastSyncedAt: now,
      serverVersionAt: Number(json.updatedAt) || now
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    flushInProgress = false;
  }
}

async function pullFromServer(force = false) {
  const state = await getStoredState();
  const email = String(state.email || '').trim().toLowerCase();
  const baseUrl = normalizeServerUrl(state.serverUrl);

  if (!email || !baseUrl) {
    return { ok: false, reason: 'missing_config', state };
  }

  // Check if any local cards are missing altMeanings (e.g. from before the altMeanings upgrade)
  const needsAltMeaningsUpgrade = state.flashcards.some(c => !Array.isArray(c.altMeanings));

  const now = Date.now();
  if (
    !force &&
    !needsAltMeaningsUpgrade &&
    state.flashcards.length > 0 &&
    state.lastPulledAt > 0 &&
    now - state.lastPulledAt < AUTO_PULL_COOLDOWN_MS
  ) {
    return { ok: true, cached: true, state };
  }

  await flushPendingDeltaToServer();
  const freshState = await getStoredState();

  try {
    const sinceParam =
      freshState.flashcards.length > 0 && !needsAltMeaningsUpgrade
        ? freshState.serverVersionAt
        : 0;
    const res = await fetch(
      `${baseUrl}/api/sync?email=${encodeURIComponent(email)}&since=${sinceParam}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' }
      }
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.error || 'Invalid response from server');
    }

    if (json.unchanged) {
      await chrome.storage.local.set({
        lastPulledAt: Date.now(),
        lastSyncedAt: Date.now()
      });
      return { ok: true, unchanged: true, state: freshState };
    }

    const remote = json.data || {};
    const mergedCards = mergeFlashcardsLocal(
      freshState.flashcards,
      remote.flashcards || [],
      freshState.deletedCardIds
    );

    const remoteIdSet = new Set((remote.flashcards || []).map(c => c.id));
    const localOnlyIds = freshState.flashcards
      .filter(c => c && c.id && !remoteIdSet.has(c.id))
      .map(c => c.id);

    const updatedState = {
      email,
      displayName: remote.displayName || freshState.displayName || email.split('@')[0],
      serverUrl: baseUrl,
      flashcards: mergedCards,
      settings: {
        ...freshState.settings,
        ...(remote.settings || {})
      },
      lastSyncedAt: Date.now(),
      lastPulledAt: Date.now(),
      serverVersionAt: Number(remote.updatedAt) || Date.now(),
      dirtyCardIds: Array.from(new Set([...freshState.dirtyCardIds, ...localOnlyIds]))
    };

    await chrome.storage.local.set(updatedState);
    await schedulePopupAlarm();

    if (localOnlyIds.length > 0) {
      await flushPendingDeltaToServer();
    }

    return { ok: true, state: updatedState };
  } catch (err) {
    return { ok: false, error: err.message, state: freshState };
  }
}

function pickRandomQuizPayload(flashcards, preferredDirection = 'mixed', recentPopupCardIds = []) {
  if (!Array.isArray(flashcards) || flashcards.length === 0) return null;

  // Exclude the last 5 shown words (or flashcards.length - 1 if user has <= 5 words)
  const maxExclusion = Math.min(POPUP_REPEAT_COOLDOWN_COUNT, Math.max(0, flashcards.length - 1));
  const excludedSet = new Set((recentPopupCardIds || []).slice(0, maxExclusion));

  let eligibleCards = flashcards.filter(c => c && c.id && !excludedSet.has(c.id));
  if (eligibleCards.length === 0) {
    eligibleCards = flashcards;
  }

  const randomIndex = Math.floor(Math.random() * eligibleCards.length);
  const card = eligibleCards[randomIndex];

  // Record this card at the front of the 5-slot cooldown queue
  const nextRecentIds = [
    card.id,
    ...(recentPopupCardIds || []).filter(id => id !== card.id)
  ].slice(0, POPUP_REPEAT_COOLDOWN_COUNT);

  let direction = preferredDirection;
  if (direction !== 'en_to_vi' && direction !== 'vi_to_en') {
    direction = Math.random() < 0.5 ? 'en_to_vi' : 'vi_to_en';
  }

  return {
    card,
    direction,
    totalCards: flashcards.length,
    nextRecentIds
  };
}

async function triggerTopRightPopup(forceShow = false) {
  if (!forceShow && isToolPanelOpen()) {
    await chrome.alarms.clear(ALARM_NAME);
    return { ok: false, reason: 'panel_open' };
  }

  const state = await getStoredState();
  if (!forceShow && !state.settings?.popupEnabled) {
    return { ok: false, reason: 'disabled' };
  }

  const quiz = pickRandomQuizPayload(
    state.flashcards,
    state.settings?.practiceDirection,
    state.recentPopupCardIds
  );
  if (!quiz) {
    if (state.settings?.popupEnabled && !isToolPanelOpen()) {
      await schedulePopupAlarm();
    }
    return { ok: false, reason: 'no_cards' };
  }

  // Save updated 5-card cooldown history
  await chrome.storage.local.set({ recentPopupCardIds: quiz.nextRecentIds });

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
          displayName: state.displayName === 'User' ? email.split('@')[0] : state.displayName
        });
        await pullFromServer(true);
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
  await pullFromServer(false);
  await schedulePopupAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await triggerTopRightPopup(false);
  } else if (alarm.name === SYNC_DEBOUNCE_ALARM) {
    await flushPendingDeltaToServer();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'SYNC_PULL': {
        const res = await pullFromServer(Boolean(message.force));
        sendResponse(res);
        break;
      }
      case 'SYNC_QUEUE_DELTA': {
        const state = await getStoredState();
        const dirtySet = new Set(state.dirtyCardIds);
        const delSet = new Set(state.deletedCardIds);

        if (Array.isArray(message.upsertedIds)) {
          for (const id of message.upsertedIds) {
            dirtySet.add(id);
            delSet.delete(id);
          }
        }
        if (Array.isArray(message.deletedIds)) {
          for (const id of message.deletedIds) {
            delSet.add(id);
            dirtySet.delete(id);
          }
        }

        await chrome.storage.local.set({
          dirtyCardIds: Array.from(dirtySet),
          deletedCardIds: Array.from(delSet),
          dirtyProfile: Boolean(state.dirtyProfile || message.dirtyProfile)
        });

        await schedulePopupAlarm();

        if (message.flushImmediately) {
          await chrome.alarms.clear(SYNC_DEBOUNCE_ALARM);
          const res = await flushPendingDeltaToServer();
          sendResponse(res);
        } else {
          await scheduleDebouncedFlush();
          sendResponse({ ok: true, queued: true });
        }
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
