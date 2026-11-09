const DEFAULT_SERVER_URL = 'https://flashcarddatabase.vercel.app';

// Connect persistent port so background.js knows the Side Panel is currently open.
// While open: popup timer is paused. When closed: popup countdown starts automatically.
const sidePanelPort = chrome.runtime.connect({ name: 'ET_SIDE_PANEL' });

const state = {
  email: '',
  displayName: 'User',
  serverUrl: DEFAULT_SERVER_URL,
  flashcards: [],
  settings: {
    popupEnabled: false,
    popupIntervalMinutes: 5,
    practiceDirection: 'mixed'
  },
  lastSyncedAt: null
};

let currentLookupMeta = {
  word: '',
  phonetic: '',
  partOfSpeech: '',
  audioUrl: '',
  enDefinition: '',
  altMeanings: []
};

let practiceSession = {
  cards: [],
  currentIndex: 0,
  score: 0,
  modeCount: 'all',
  currentCardDirection: 'en_to_vi',
  answeredCurrent: false
};

// ================= UNIKEY TELEX BYPASS FOR ENGLISH INPUTS =================
const TELEX_REVERSE_MAP = {
  'á': ['a', 's'], 'à': ['a', 'f'], 'ả': ['a', 'r'], 'ã': ['a', 'x'], 'ạ': ['a', 'j'],
  'ă': ['a', 'w'], 'ắ': ['a', 'ws'], 'ằ': ['a', 'wf'], 'ẳ': ['a', 'wr'], 'ẵ': ['a', 'wx'], 'ặ': ['a', 'wj'],
  'â': ['a', 'a'], 'ấ': ['a', 'as'], 'ầ': ['a', 'af'], 'ẩ': ['a', 'ar'], 'ẫ': ['a', 'ax'], 'ậ': ['a', 'aj'],
  'é': ['e', 's'], 'è': ['e', 'f'], 'ẻ': ['e', 'r'], 'ẽ': ['e', 'x'], 'ẹ': ['e', 'j'],
  'ê': ['e', 'e'], 'ế': ['e', 'es'], 'ề': ['e', 'ef'], 'ể': ['e', 'er'], 'ễ': ['e', 'ex'], 'ệ': ['e', 'ej'],
  'í': ['i', 's'], 'ì': ['i', 'f'], 'ỉ': ['i', 'r'], 'ĩ': ['i', 'x'], 'ị': ['i', 'j'],
  'ó': ['o', 's'], 'ò': ['o', 'f'], 'ỏ': ['o', 'r'], 'õ': ['o', 'x'], 'ọ': ['o', 'j'],
  'ô': ['o', 'o'], 'ố': ['o', 'os'], 'ồ': ['o', 'of'], 'ổ': ['o', 'or'], 'ỗ': ['o', 'ox'], 'ộ': ['o', 'oj'],
  'ơ': ['o', 'w'], 'ớ': ['o', 'ws'], 'ờ': ['o', 'wf'], 'ở': ['o', 'wr'], 'ỡ': ['o', 'wx'], 'ợ': ['o', 'wj'],
  'ú': ['u', 's'], 'ù': ['u', 'f'], 'ủ': ['u', 'r'], 'ũ': ['u', 'x'], 'ụ': ['u', 'j'],
  'ý': ['y', 's'], 'ỳ': ['y', 'f'], 'ỷ': ['y', 'r'], 'ỹ': ['y', 'x'], 'ỵ': ['y', 'j'],
  'đ': ['d', 'd']
};

const U_HORN_MAP = {
  'ư': '', 'ứ': 's', 'ừ': 'f', 'ử': 'r', 'ữ': 'x', 'ự': 'j'
};

function reverseUnikeyTelex(prevVal, curVal, cursorPos) {
  const normCur = String(curVal || '').normalize('NFC');
  const normPrev = String(prevVal || '').normalize('NFC');

  let result = '';
  let appendedAtCursor = '';

  for (let i = 0; i < normCur.length; i++) {
    const ch = normCur[i];
    const lower = ch.toLowerCase();
    const isUpper = ch !== lower;

    if (Object.prototype.hasOwnProperty.call(U_HORN_MAP, lower)) {
      const prevCharLower = (normPrev[i] || '').toLowerCase();
      const toneKey = U_HORN_MAP[lower];
      if (prevCharLower === 'u') {
        result += isUpper ? 'U' : 'u';
        appendedAtCursor += 'w' + toneKey;
      } else {
        result += isUpper ? 'W' : 'w';
        appendedAtCursor += toneKey;
      }
    } else if (Object.prototype.hasOwnProperty.call(TELEX_REVERSE_MAP, lower)) {
      const [base, suffix] = TELEX_REVERSE_MAP[lower];
      result += isUpper ? base.toUpperCase() : base;
      appendedAtCursor += suffix;
    } else {
      result += ch;
    }
  }

  if (!appendedAtCursor && result === normCur) {
    return null;
  }

  const insertPos = typeof cursorPos === 'number' ? cursorPos : result.length;
  const finalStr = result.slice(0, insertPos) + appendedAtCursor + result.slice(insertPos);
  const newCursor = insertPos + appendedAtCursor.length;
  return { value: finalStr, cursor: newCursor };
}

function attachEnglishUnikeyBypass(inputEl, isEnabledFn) {
  if (!inputEl) return;
  inputEl.__prevUnikeyVal = inputEl.value || '';

  inputEl.addEventListener('focus', () => {
    inputEl.__prevUnikeyVal = inputEl.value || '';
  });

  inputEl.addEventListener('input', () => {
    if (isEnabledFn && !isEnabledFn()) {
      inputEl.__prevUnikeyVal = inputEl.value;
      return;
    }
    const curValue = inputEl.value;
    const fixed = reverseUnikeyTelex(inputEl.__prevUnikeyVal || '', curValue, inputEl.selectionStart);
    if (fixed) {
      inputEl.value = fixed.value;
      inputEl.setSelectionRange(fixed.cursor, fixed.cursor);
    }
    inputEl.__prevUnikeyVal = inputEl.value;
  });
}

// DOM Elements
const tabBtnFlashcard = document.getElementById('tabBtnFlashcard');
const tabBtnSetting = document.getElementById('tabBtnSetting');
const panelFlashcard = document.getElementById('panelFlashcard');
const panelSetting = document.getElementById('panelSetting');
const headerSyncBtn = document.getElementById('headerSyncBtn');
const syncStatusDot = document.getElementById('syncStatusDot');
const syncStatusText = document.getElementById('syncStatusText');

// Add Flashcard & Add List Elements
const toggleAddBtn = document.getElementById('toggleAddBtn');
const toggleAddListBtn = document.getElementById('toggleAddListBtn');
const addCardDrawer = document.getElementById('addCardDrawer');
const addListDrawer = document.getElementById('addListDrawer');
const bulkListTextarea = document.getElementById('bulkListTextarea');
const importFileInput = document.getElementById('importFileInput');
const chooseFileBtn = document.getElementById('chooseFileBtn');
const bulkStatusText = document.getElementById('bulkStatusText');
const saveBulkListBtn = document.getElementById('saveBulkListBtn');

const totalWordsCount = document.getElementById('totalWordsCount');
const optAllCount = document.getElementById('optAllCount');
const addFlashcardForm = document.getElementById('addFlashcardForm');
const enInput = document.getElementById('enInput');
const viInput = document.getElementById('viInput');
const saveCardBtn = document.getElementById('saveCardBtn');
const enSuggestionsList = document.getElementById('enSuggestionsList');
const dictMetaBox = document.getElementById('dictMetaBox');
const phoneticText = document.getElementById('phoneticText');
const posText = document.getElementById('posText');
const enDefText = document.getElementById('enDefText');
const previewAudioBtn = document.getElementById('previewAudioBtn');
const altMeaningsChips = document.getElementById('altMeaningsChips');

// Practice Elements
const practiceMenuSection = document.getElementById('practiceMenuSection');
const practiceDirectionSelect = document.getElementById('practiceDirectionSelect');
const practiceArenaSection = document.getElementById('practiceArenaSection');
const exitPracticeBtn = document.getElementById('exitPracticeBtn');
const arenaCurrentIdx = document.getElementById('arenaCurrentIdx');
const arenaTotalIdx = document.getElementById('arenaTotalIdx');
const arenaScoreCount = document.getElementById('arenaScoreCount');
const arenaProgressBar = document.getElementById('arenaProgressBar');
const arenaCardBox = document.getElementById('arenaCardBox');
const arenaPromptDirectionBadge = document.getElementById('arenaPromptDirectionBadge');
const arenaPromptWord = document.getElementById('arenaPromptWord');
const arenaAudioBtn = document.getElementById('arenaAudioBtn');
const arenaPhoneticText = document.getElementById('arenaPhoneticText');
const arenaAnswerForm = document.getElementById('arenaAnswerForm');
const arenaAnswerInput = document.getElementById('arenaAnswerInput');
const arenaSubmitBtn = document.getElementById('arenaSubmitBtn');
const arenaSkipBtn = document.getElementById('arenaSkipBtn');
const arenaFeedbackBox = document.getElementById('arenaFeedbackBox');
const arenaSummaryBox = document.getElementById('arenaSummaryBox');
const arenaSummaryText = document.getElementById('arenaSummaryText');
const arenaRestartBtn = document.getElementById('arenaRestartBtn');
const arenaDoneBtn = document.getElementById('arenaDoneBtn');

// Saved words list & Export
const savedWordsSection = document.getElementById('savedWordsSection');
const savedWordsList = document.getElementById('savedWordsList');
const searchSavedInput = document.getElementById('searchSavedInput');
const exportWordsBtn = document.getElementById('exportWordsBtn');

// Setting Tab Elements
const userAvatarCircle = document.getElementById('userAvatarCircle');
const displayHeaderName = document.getElementById('displayHeaderName');
const displayHeaderEmail = document.getElementById('displayHeaderEmail');
const editAccountBtn = document.getElementById('editAccountBtn');
const cancelEditAccountBtn = document.getElementById('cancelEditAccountBtn');
const accountSettingsForm = document.getElementById('accountSettingsForm');
const settingEmailInput = document.getElementById('settingEmailInput');
const settingDisplayNameInput = document.getElementById('settingDisplayNameInput');
const popupPracticeToggle = document.getElementById('popupPracticeToggle');
const popupIntervalInput = document.getElementById('popupIntervalInput');
const settingToastBanner = document.getElementById('settingToastBanner');

let debounceSuggestTimer = null;
let debounceLookupTimer = null;
let userEditedViManually = false;

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async () => {
  attachEnglishUnikeyBypass(enInput, () => true);
  attachEnglishUnikeyBypass(settingEmailInput, () => true);
  attachEnglishUnikeyBypass(arenaAnswerInput, () => practiceSession.currentCardDirection === 'vi_to_en');

  await loadStateFromStorage();
  renderAllUI();
  bindEvents();

  if (state.email) {
    triggerCloudPull(true);
  }
});

async function loadStateFromStorage() {
  const stored = await chrome.storage.local.get([
    'email',
    'displayName',
    'serverUrl',
    'flashcards',
    'settings',
    'lastSyncedAt'
  ]);
  state.email = stored.email || '';
  state.displayName = stored.displayName && stored.displayName !== 'Học viên' ? stored.displayName : 'User';
  state.serverUrl = DEFAULT_SERVER_URL;
  // Normalize all stored flashcards to Unicode NFC so Vietnamese comparisons never fail
  state.flashcards = Array.isArray(stored.flashcards)
    ? stored.flashcards.map(c => ({
        ...c,
        english: String(c.english || '').normalize('NFC').trim(),
        vietnamese: String(c.vietnamese || '').normalize('NFC').trim(),
        altMeanings: Array.isArray(c.altMeanings)
          ? c.altMeanings.map(m => String(m || '').normalize('NFC').trim().toLowerCase()).filter(Boolean)
          : []
      }))
    : [];
  state.settings = {
    popupEnabled: false,
    popupIntervalMinutes: 5,
    practiceDirection: 'mixed',
    ...(stored.settings || {})
  };
  state.lastSyncedAt = stored.lastSyncedAt || null;
}

async function saveStateToStorage() {
  await chrome.storage.local.set({
    email: state.email,
    displayName: state.displayName,
    serverUrl: DEFAULT_SERVER_URL,
    flashcards: state.flashcards,
    settings: state.settings,
    lastSyncedAt: state.lastSyncedAt
  });
}

function renderAllUI() {
  const count = state.flashcards.length;
  totalWordsCount.textContent = count;
  optAllCount.textContent = count;

  practiceDirectionSelect.value = state.settings.practiceDirection || 'mixed';
  renderSavedWordsList(searchSavedInput.value);

  const name = state.displayName || (state.email ? state.email.split('@')[0] : 'User');
  userAvatarCircle.textContent = name.charAt(0).toUpperCase();
  displayHeaderName.textContent = name;
  displayHeaderEmail.textContent = state.email || 'No Gmail linked';

  settingEmailInput.value = state.email;
  settingDisplayNameInput.value = state.displayName || '';

  popupPracticeToggle.checked = Boolean(state.settings.popupEnabled);
  popupIntervalInput.value = state.settings.popupIntervalMinutes || 5;

  updateSyncBadge();
}

function updateSyncBadge(status = 'idle') {
  syncStatusDot.className = 'sync-dot';
  if (status === 'syncing') {
    syncStatusDot.classList.add('syncing');
    syncStatusText.textContent = 'Sync...';
    return;
  }
  if (state.email && state.lastSyncedAt) {
    syncStatusDot.classList.add('synced');
    syncStatusText.textContent = 'Synced';
  } else {
    syncStatusText.textContent = 'Sync';
  }
}

// ================= EVENT BINDINGS =================
function bindEvents() {
  // 1. Tab switching (Flashcard vs Setting)
  [tabBtnFlashcard, tabBtnSetting].forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtnFlashcard.classList.toggle('active', target === 'flashcard');
      tabBtnSetting.classList.toggle('active', target === 'setting');
      panelFlashcard.classList.toggle('active', target === 'flashcard');
      panelSetting.classList.toggle('active', target === 'setting');
    });
  });

  // 2. Header Sync button (Manual force sync)
  headerSyncBtn.addEventListener('click', async () => {
    if (!state.email) {
      tabBtnSetting.click();
      accountSettingsForm.classList.remove('hidden');
      settingEmailInput.focus();
      return;
    }
    await triggerCloudPull(false, true);
  });

  // 3a. '+' Add Flashcard Button
  toggleAddBtn.addEventListener('click', () => {
    const isOpen = addCardDrawer.classList.toggle('open');
    toggleAddBtn.classList.toggle('expanded', isOpen);
    if (isOpen) {
      addListDrawer.classList.remove('open');
      toggleAddListBtn.classList.remove('expanded');
      setTimeout(() => enInput.focus(), 100);
    }
  });

  // 3b. 'Add List' Button
  toggleAddListBtn.addEventListener('click', () => {
    const isOpen = addListDrawer.classList.toggle('open');
    toggleAddListBtn.classList.toggle('expanded', isOpen);
    if (isOpen) {
      addCardDrawer.classList.remove('open');
      toggleAddBtn.classList.remove('expanded');
      bulkStatusText.textContent = 'Duplicates will be skipped';
      setTimeout(() => bulkListTextarea.focus(), 100);
    }
  });

  // 3c. Bulk Import from File or Textarea
  chooseFileBtn.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '').normalize('NFC');
      bulkListTextarea.value = content;
      bulkStatusText.textContent = `Loaded ${file.name}`;
    };
    reader.readAsText(file, 'utf-8');
  });

  saveBulkListBtn.addEventListener('click', async () => {
    await handleSaveBulkList();
  });

  // 3d. Export Saved Words to File
  exportWordsBtn.addEventListener('click', () => {
    handleExportWords();
  });

  // 4. Dictionary Autocomplete & Auto-Translation on English Input
  enInput.addEventListener('input', () => {
    const raw = enInput.value.trim();
    userEditedViManually = false;

    clearTimeout(debounceSuggestTimer);
    clearTimeout(debounceLookupTimer);

    if (!raw) {
      hideSuggestions();
      dictMetaBox.classList.add('hidden');
      previewAudioBtn.classList.add('hidden');
      altMeaningsChips.classList.add('hidden');
      return;
    }

    debounceSuggestTimer = setTimeout(() => {
      fetchWordSuggestions(raw);
    }, 150);

    debounceLookupTimer = setTimeout(() => {
      lookupAndTranslateWord(raw, false);
    }, 350);
  });

  enInput.addEventListener('keydown', (e) => {
    const items = enSuggestionsList.querySelectorAll('li');
    if (enSuggestionsList.classList.contains('hidden') || items.length === 0) return;

    let activeIdx = Array.from(items).findIndex(li => li.classList.contains('active'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % items.length;
      items.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      selectSuggestionWord(items[activeIdx].dataset.word);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.form-group')) {
      hideSuggestions();
    }
  });

  viInput.addEventListener('input', () => {
    userEditedViManually = true;
  });

  previewAudioBtn.addEventListener('click', () => {
    playWordAudio(currentLookupMeta.word || enInput.value, currentLookupMeta.audioUrl);
  });

  // 5. Save Single Flashcard (including alternative meanings suggested by Dictionary API)
  addFlashcardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enWord = enInput.value.normalize('NFC').trim();
    const viMeaning = viInput.value.normalize('NFC').trim();
    if (!enWord || !viMeaning) return;

    // If user pressed Save before dictionary lookup finished for this word, fetch meanings now
    if (currentLookupMeta.word.toLowerCase() !== enWord.toLowerCase() || !Array.isArray(currentLookupMeta.altMeanings) || currentLookupMeta.altMeanings.length === 0) {
      const [dictData, viData] = await Promise.all([
        fetchEnglishDictionaryInfo(enWord),
        fetchVietnameseTranslation(enWord)
      ]);
      const allSuggested = [];
      if (viData?.primaryMeaning) allSuggested.push(viData.primaryMeaning.normalize('NFC').trim().toLowerCase());
      if (Array.isArray(viData?.alternatives)) {
        for (const m of viData.alternatives) {
          const clean = String(m || '').normalize('NFC').trim().toLowerCase();
          if (clean && !allSuggested.includes(clean)) allSuggested.push(clean);
        }
      }
      currentLookupMeta = {
        word: enWord,
        phonetic: dictData?.phonetic || '',
        partOfSpeech: dictData?.partOfSpeech || '',
        audioUrl: dictData?.audioUrl || '',
        enDefinition: dictData?.enDefinition || '',
        altMeanings: allSuggested
      };
    }

    const existingIdx = state.flashcards.findIndex(
      c => c.english.normalize('NFC').toLowerCase() === enWord.toLowerCase()
    );

    const mainLower = viMeaning.toLowerCase();
    const prevAlt = existingIdx >= 0 && Array.isArray(state.flashcards[existingIdx].altMeanings)
      ? state.flashcards[existingIdx].altMeanings
      : [];
    const mergedAltSet = new Set(
      [...prevAlt, ...(currentLookupMeta.altMeanings || [])]
        .map(m => String(m || '').normalize('NFC').trim().toLowerCase())
        .filter(m => m && m !== mainLower)
    );

    const cardObj = {
      id: existingIdx >= 0 ? state.flashcards[existingIdx].id : `fc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      english: enWord,
      vietnamese: viMeaning,
      altMeanings: Array.from(mergedAltSet),
      phonetic: currentLookupMeta.word.toLowerCase() === enWord.toLowerCase() ? currentLookupMeta.phonetic : '',
      partOfSpeech: currentLookupMeta.word.toLowerCase() === enWord.toLowerCase() ? currentLookupMeta.partOfSpeech : '',
      audioUrl: currentLookupMeta.word.toLowerCase() === enWord.toLowerCase() ? currentLookupMeta.audioUrl : '',
      createdAt: existingIdx >= 0 ? state.flashcards[existingIdx].createdAt : Date.now(),
      updatedAt: Date.now()
    };

    if (existingIdx >= 0) {
      state.flashcards[existingIdx] = cardObj;
    } else {
      state.flashcards.unshift(cardObj);
    }

    await saveStateToStorage();
    renderAllUI();

    enInput.value = '';
    enInput.__prevUnikeyVal = '';
    viInput.value = '';
    currentLookupMeta = { word: '', phonetic: '', partOfSpeech: '', audioUrl: '', enDefinition: '', altMeanings: [] };
    dictMetaBox.classList.add('hidden');
    previewAudioBtn.classList.add('hidden');
    altMeaningsChips.classList.add('hidden');
    saveCardBtn.textContent = '✓';
    setTimeout(() => {
      saveCardBtn.textContent = 'Save';
    }, 900);
    enInput.focus();

    queueDeltaSync({ upsertedIds: [cardObj.id] });
  });

  // 6. Practice Direction change
  practiceDirectionSelect.addEventListener('change', async () => {
    state.settings.practiceDirection = practiceDirectionSelect.value;
    await saveStateToStorage();
    queueDeltaSync({ dirtyProfile: true });
  });

  // 7. Practice Options Start buttons
  document.querySelectorAll('.practice-option-item').forEach(item => {
    item.addEventListener('click', () => {
      const mode = item.dataset.mode;
      startPracticeSession(mode);
    });
  });

  exitPracticeBtn.addEventListener('click', closePracticeArena);
  arenaDoneBtn.addEventListener('click', closePracticeArena);
  arenaRestartBtn.addEventListener('click', () => {
    startPracticeSession(practiceSession.modeCount);
  });

  arenaAudioBtn.addEventListener('click', () => {
    const currentCard = practiceSession.cards[practiceSession.currentIndex];
    if (currentCard) {
      playWordAudio(currentCard.english, currentCard.audioUrl);
    }
  });

  arenaAnswerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handlePracticeSubmit();
  });

  arenaSkipBtn.addEventListener('click', () => {
    handlePracticeSkipOrNext();
  });

  // 8. Search & Delete in Saved Words List
  searchSavedInput.addEventListener('input', () => {
    renderSavedWordsList(searchSavedInput.value);
  });

  // 9. Pencil Icon Edit in Setting Top Header
  editAccountBtn.addEventListener('click', () => {
    const isHidden = accountSettingsForm.classList.toggle('hidden');
    if (!isHidden) {
      settingDisplayNameInput.value = state.displayName || '';
      settingEmailInput.value = state.email || '';
      settingDisplayNameInput.focus();
    }
  });

  cancelEditAccountBtn.addEventListener('click', () => {
    accountSettingsForm.classList.add('hidden');
  });

  accountSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newEmail = settingEmailInput.value.trim().toLowerCase();
    const newName = settingDisplayNameInput.value.trim() || (newEmail ? newEmail.split('@')[0] : 'User');

    const emailChanged = newEmail && newEmail !== state.email;
    state.email = newEmail;
    state.displayName = newName;
    state.serverUrl = DEFAULT_SERVER_URL;

    accountSettingsForm.classList.add('hidden');
    await saveStateToStorage();
    renderAllUI();

    if (state.email) {
      if (emailChanged) {
        await triggerCloudPull(true, true);
        state.displayName = newName;
        await saveStateToStorage();
        renderAllUI();
      }
      const res = await queueDeltaSync({ dirtyProfile: true, flushImmediately: true });
      if (res && res.ok) {
        showSettingToast('✓ Saved & Synced!');
      }
    }
  });

  // 10. Popup Practice Toggle & Timer Interval
  popupPracticeToggle.addEventListener('change', async () => {
    await savePopupSettings();
  });

  popupIntervalInput.addEventListener('change', async () => {
    await savePopupSettings();
  });
}

// ================= BULK IMPORT ("ADD LIST") & EXPORT =================
function parseBulkInput(rawText) {
  const trimmed = String(rawText || '').normalize('NFC').trim();
  if (!trimmed) return [];

  // 1. Check if JSON format
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.flashcards) ? parsed.flashcards : []);
      return arr
        .map(item => ({
          english: String(item.english || item.en || item.word || '').normalize('NFC').trim(),
          vietnamese: String(item.vietnamese || item.vi || item.meaning || '').normalize('NFC').trim(),
          phonetic: String(item.phonetic || '').normalize('NFC').trim(),
          partOfSpeech: String(item.partOfSpeech || '').trim(),
          audioUrl: String(item.audioUrl || '').trim()
        }))
        .filter(x => x.english && x.vietnamese);
    } catch (e) {
      // Fallback to line-by-line parsing
    }
  }

  // 2. Line-by-line parsing (supports "english : vietnamese", "english - vietnamese", "english = vietnamese", "english \t vietnamese", "english, vietnamese")
  const lines = trimmed.split(/\r?\n/);
  const results = [];

  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.startsWith('#') || cleanLine.startsWith('//')) continue;

    let parts = null;
    if (cleanLine.includes('\t')) {
      parts = cleanLine.split('\t');
    } else if (cleanLine.includes(':')) {
      parts = cleanLine.split(':');
    } else if (cleanLine.includes(' - ')) {
      parts = cleanLine.split(' - ');
    } else if (cleanLine.includes('=')) {
      parts = cleanLine.split('=');
    } else if (cleanLine.includes('-')) {
      parts = cleanLine.split('-');
    } else if (cleanLine.includes(',')) {
      parts = cleanLine.split(',');
    }

    if (parts && parts.length >= 2) {
      const en = parts[0].normalize('NFC').trim();
      const vi = parts.slice(1).join(':').normalize('NFC').trim();
      if (en && vi) {
        results.push({
          english: en,
          vietnamese: vi,
          phonetic: '',
          partOfSpeech: '',
          audioUrl: ''
        });
      }
    }
  }

  return results;
}

async function handleSaveBulkList() {
  const items = parseBulkInput(bulkListTextarea.value);
  if (items.length === 0) {
    bulkStatusText.textContent = 'Format: word : meaning';
    return;
  }

  // Track existing English words (case-insensitive, NFC) -> Keep old words, skip duplicates!
  const existingSet = new Set(
    state.flashcards.map(c => c.english.normalize('NFC').trim().toLowerCase())
  );

  let addedCount = 0;
  let skippedCount = 0;
  const addedIds = [];
  const now = Date.now();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = item.english.toLowerCase();

    if (existingSet.has(key)) {
      // Duplicate found -> skip new word, keep existing old word
      skippedCount++;
      continue;
    }

    existingSet.add(key);
    const newId = `fc_${now}_${i}_${Math.random().toString(36).slice(2, 6)}`;
    state.flashcards.unshift({
      id: newId,
      english: item.english,
      vietnamese: item.vietnamese,
      altMeanings: Array.isArray(item.altMeanings) ? item.altMeanings : [],
      phonetic: item.phonetic || '',
      partOfSpeech: item.partOfSpeech || '',
      audioUrl: item.audioUrl || '',
      createdAt: now + i,
      updatedAt: now + i
    });
    addedIds.push(newId);
    addedCount++;
  }

  await saveStateToStorage();
  renderAllUI();

  bulkListTextarea.value = '';
  bulkStatusText.textContent = `✓ Added ${addedCount}, skipped ${skippedCount} duplicate(s)`;

  if (addedIds.length > 0) {
    queueDeltaSync({ upsertedIds: addedIds });
    enrichBulkAddedCards(addedIds);
  }
}

async function enrichBulkAddedCards(cardIds) {
  let changedIds = [];
  for (const id of cardIds) {
    const card = state.flashcards.find(c => c.id === id);
    if (!card) continue;
    try {
      const [dictRes, viRes] = await Promise.allSettled([
        fetchEnglishDictionaryInfo(card.english),
        fetchVietnameseTranslation(card.english)
      ]);
      const dictData = dictRes.status === 'fulfilled' ? dictRes.value : null;
      const viData = viRes.status === 'fulfilled' ? viRes.value : null;

      let updated = false;
      if (dictData && dictData.isValid) {
        if (!card.phonetic && dictData.phonetic) {
          card.phonetic = dictData.phonetic;
          updated = true;
        }
        if (!card.partOfSpeech && dictData.partOfSpeech) {
          card.partOfSpeech = dictData.partOfSpeech;
          updated = true;
        }
        if (!card.audioUrl && dictData.audioUrl) {
          card.audioUrl = dictData.audioUrl;
          updated = true;
        }
      }

      if (viData) {
        const mainClean = card.vietnamese.normalize('NFC').trim().toLowerCase();
        const rawPool = [viData.primaryMeaning, ...(viData.alternatives || [])];
        const altSet = new Set(Array.isArray(card.altMeanings) ? card.altMeanings : []);
        for (const m of rawPool) {
          const cleanM = String(m || '').normalize('NFC').trim().toLowerCase();
          if (cleanM && cleanM !== mainClean) {
            altSet.add(cleanM);
          }
        }
        const mergedAlts = Array.from(altSet).slice(0, 12);
        if (mergedAlts.length !== (card.altMeanings || []).length) {
          card.altMeanings = mergedAlts;
          updated = true;
        }
      }

      if (updated) {
        card.updatedAt = Date.now();
        changedIds.push(card.id);
      }
    } catch (e) {
      // Ignore individual lookup errors
    }
  }

  if (changedIds.length > 0) {
    await saveStateToStorage();
    renderAllUI();
    queueDeltaSync({ upsertedIds: changedIds });
  }
}

function handleExportWords() {
  if (state.flashcards.length === 0) return;

  const lines = state.flashcards.map(
    c => `${c.english.normalize('NFC')} : ${c.vietnamese.normalize('NFC')}`
  );
  const content = lines.join('\r\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `flashcards_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ================= DICTIONARY & TRANSLATION APIs =================
async function fetchWordSuggestions(prefix) {
  try {
    const res = await fetch(`https://api.datamuse.com/sug?s=${encodeURIComponent(prefix)}&max=6`);
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0 || enInput.value.trim().toLowerCase() !== prefix.toLowerCase()) {
      hideSuggestions();
      return;
    }

    enSuggestionsList.innerHTML = list
      .map(
        (item, idx) => `
        <li data-word="${escapeHtml(item.word)}" class="${idx === 0 ? 'active' : ''}">
          <span>${escapeHtml(item.word)}</span>
          <span class="sug-hint">↵</span>
        </li>
      `
      )
      .join('');

    enSuggestionsList.classList.remove('hidden');

    enSuggestionsList.querySelectorAll('li').forEach(li => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectSuggestionWord(li.dataset.word);
      });
    });
  } catch (err) {
    // Ignore
  }
}

function selectSuggestionWord(word) {
  if (!word) return;
  enInput.value = word;
  enInput.__prevUnikeyVal = word;
  hideSuggestions();
  userEditedViManually = false;
  lookupAndTranslateWord(word, true);
}

function hideSuggestions() {
  enSuggestionsList.classList.add('hidden');
  enSuggestionsList.innerHTML = '';
}

async function lookupAndTranslateWord(rawWord, forceFillVi = false) {
  const word = String(rawWord || '').normalize('NFC').trim();
  if (!word) return;

  const [dictResult, transResult] = await Promise.allSettled([
    fetchEnglishDictionaryInfo(word),
    fetchVietnameseTranslation(word)
  ]);

  if (enInput.value.trim().toLowerCase() !== word.toLowerCase()) {
    return;
  }

  const dictData = dictResult.status === 'fulfilled' ? dictResult.value : null;
  const viData = transResult.status === 'fulfilled' ? transResult.value : null;

  const suggestedAlts = [];
  if (viData) {
    const rawPool = [viData.primaryMeaning, ...(viData.alternatives || [])];
    for (const item of rawPool) {
      const clean = String(item || '').normalize('NFC').trim().toLowerCase();
      if (clean && !suggestedAlts.includes(clean)) {
        suggestedAlts.push(clean);
      }
    }
  }

  if (dictData && dictData.isValid) {
    currentLookupMeta = {
      word,
      phonetic: dictData.phonetic || '',
      partOfSpeech: dictData.partOfSpeech || '',
      audioUrl: dictData.audioUrl || '',
      enDefinition: dictData.enDefinition || '',
      altMeanings: suggestedAlts
    };

    dictMetaBox.classList.remove('hidden');
    phoneticText.textContent = dictData.phonetic || `/${word}/`;
    posText.textContent = dictData.partOfSpeech || 'word';
    enDefText.textContent = dictData.enDefinition ? `🇬🇧 ${dictData.enDefinition}` : '';
    previewAudioBtn.classList.remove('hidden');
  } else {
    currentLookupMeta = {
      word,
      phonetic: '',
      partOfSpeech: '',
      audioUrl: '',
      enDefinition: '',
      altMeanings: suggestedAlts
    };
    dictMetaBox.classList.add('hidden');
    previewAudioBtn.classList.remove('hidden');
  }

  if (viData && viData.primaryMeaning) {
    const shouldAutoFill = forceFillVi || dictData?.isValid || !userEditedViManually;
    if (shouldAutoFill && (!userEditedViManually || forceFillVi)) {
      viInput.value = viData.primaryMeaning.normalize('NFC');
    }

    if (Array.isArray(viData.alternatives) && viData.alternatives.length > 0) {
      altMeaningsChips.innerHTML = viData.alternatives
        .slice(0, 6)
        .map(alt => `<span class="alt-chip" data-meaning="${escapeHtml(alt.normalize('NFC'))}">+ ${escapeHtml(alt.normalize('NFC'))}</span>`)
        .join('');
      altMeaningsChips.classList.remove('hidden');

      altMeaningsChips.querySelectorAll('.alt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          viInput.value = chip.dataset.meaning.normalize('NFC');
          viInput.focus();
        });
      });
    } else {
      altMeaningsChips.classList.add('hidden');
    }
  }
}

async function fetchEnglishDictionaryInfo(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    if (!res.ok) return { isValid: false };
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { isValid: false };

    const entry = data[0];
    let phonetic = entry.phonetic || '';
    let audioUrl = '';

    if (Array.isArray(entry.phonetics)) {
      for (const p of entry.phonetics) {
        if (!phonetic && p.text) phonetic = p.text;
        if (!audioUrl && p.audio) audioUrl = p.audio;
      }
    }

    const firstMeaning = Array.isArray(entry.meanings) && entry.meanings[0] ? entry.meanings[0] : null;
    const partOfSpeech = firstMeaning?.partOfSpeech || '';
    const enDefinition = firstMeaning?.definitions?.[0]?.definition || '';

    return {
      isValid: true,
      phonetic,
      partOfSpeech,
      audioUrl,
      enDefinition
    };
  } catch (err) {
    return { isValid: false };
  }
}

async function fetchVietnameseTranslation(word) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&dt=bd&q=${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const primary = (data?.[0]?.map(item => item?.[0]).filter(Boolean).join('') || '').normalize('NFC');
      const alternatives = [];

      if (Array.isArray(data?.[1])) {
        for (const posGroup of data[1]) {
          const terms = posGroup?.[1];
          if (Array.isArray(terms)) {
            for (const term of terms) {
              const normTerm = String(term || '').normalize('NFC').trim();
              if (normTerm && !alternatives.includes(normTerm)) {
                alternatives.push(normTerm);
              }
            }
          }
        }
      }

      if (primary) {
        return {
          primaryMeaning: primary.toLowerCase(),
          alternatives
        };
      }
    }
  } catch (err) {
    // Fallback below
  }

  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|vi`
    );
    if (res.ok) {
      const data = await res.json();
      const translated = String(data?.responseData?.translatedText || '').normalize('NFC').trim();
      if (translated) {
        return {
          primaryMeaning: translated.toLowerCase(),
          alternatives: []
        };
      }
    }
  } catch (err) {
    // Ignore
  }

  return null;
}

function playWordAudio(word, audioUrl) {
  if (audioUrl) {
    const audio = new Audio(audioUrl);
    audio.play().catch(() => speakFallback(word));
  } else {
    speakFallback(word);
  }
}

function speakFallback(word) {
  if ('speechSynthesis' in window && word) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-US';
    window.speechSynthesis.speak(utter);
  }
}

// ================= PRACTICE SESSION LOGIC =================
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startPracticeSession(mode) {
  if (state.flashcards.length === 0) {
    if (!addCardDrawer.classList.contains('open')) {
      toggleAddBtn.click();
    }
    enInput.focus();
    return;
  }

  const shuffled = shuffleArray(state.flashcards);
  let selectedCards = shuffled;
  if (mode === '15') {
    selectedCards = shuffled.slice(0, 15);
  } else if (mode === '30') {
    selectedCards = shuffled.slice(0, 30);
  }

  practiceSession = {
    cards: selectedCards,
    currentIndex: 0,
    score: 0,
    modeCount: mode,
    currentCardDirection: 'en_to_vi',
    answeredCurrent: false
  };

  practiceMenuSection.classList.add('hidden');
  savedWordsSection.classList.add('hidden');
  practiceArenaSection.classList.remove('hidden');
  arenaSummaryBox.classList.add('hidden');
  arenaCardBox.classList.remove('hidden');
  arenaAnswerForm.classList.remove('hidden');

  renderCurrentPracticeQuestion();
}

function closePracticeArena() {
  practiceArenaSection.classList.add('hidden');
  practiceMenuSection.classList.remove('hidden');
  savedWordsSection.classList.remove('hidden');
}

function pickCardDirection() {
  const pref = state.settings.practiceDirection || 'mixed';
  if (pref === 'en_to_vi' || pref === 'vi_to_en') return pref;
  return Math.random() < 0.5 ? 'en_to_vi' : 'vi_to_en';
}

function renderCurrentPracticeQuestion() {
  const total = practiceSession.cards.length;
  const idx = practiceSession.currentIndex;

  if (idx >= total) {
    arenaProgressBar.style.width = '100%';
    arenaCardBox.classList.add('hidden');
    arenaAnswerForm.classList.add('hidden');
    arenaFeedbackBox.classList.add('hidden');
    arenaSummaryBox.classList.remove('hidden');

    const percent = Math.round((practiceSession.score / total) * 100);
    arenaSummaryText.textContent = `Score: ${practiceSession.score} / ${total} (${percent}%)`;
    return;
  }

  const card = practiceSession.cards[idx];
  const direction = pickCardDirection();
  practiceSession.currentCardDirection = direction;
  practiceSession.answeredCurrent = false;

  arenaCurrentIdx.textContent = idx + 1;
  arenaTotalIdx.textContent = total;
  arenaScoreCount.textContent = practiceSession.score;
  arenaProgressBar.style.width = `${Math.round((idx / total) * 100)}%`;

  const isEnToVi = direction === 'en_to_vi';
  arenaPromptDirectionBadge.textContent = isEnToVi ? '🇬🇧 EN ➔ 🇻🇳 VI' : '🇻🇳 VI ➔ 🇬🇧 EN';

  arenaPromptWord.textContent = isEnToVi ? card.english : card.vietnamese;
  arenaPhoneticText.textContent = isEnToVi && card.phonetic ? card.phonetic : '';
  arenaAudioBtn.classList.toggle('hidden', !isEnToVi);

  arenaAnswerInput.value = '';
  arenaAnswerInput.__prevUnikeyVal = '';
  arenaAnswerInput.disabled = false;
  arenaAnswerInput.lang = isEnToVi ? 'vi' : 'en';
  arenaAnswerInput.placeholder = isEnToVi ? 'Vietnamese...' : 'English...';
  arenaSubmitBtn.textContent = 'Check';
  arenaSkipBtn.textContent = 'Answer';
  arenaFeedbackBox.classList.add('hidden');
  arenaAnswerInput.focus();
}

function normalizeAnswer(str) {
  return String(str || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function checkPracticeAnswer(userVal, expectedVal, altCandidates = []) {
  const cleanUser = normalizeAnswer(userVal);
  if (!cleanUser) return false;

  const candidatePool = [
    expectedVal,
    ...(Array.isArray(altCandidates) ? altCandidates : [])
  ];

  for (const rawCandidate of candidatePool) {
    const cleanTarget = normalizeAnswer(rawCandidate);
    if (!cleanTarget) continue;
    if (cleanUser === cleanTarget) return true;

    const parts = cleanTarget
      .split(/[,;/|]+/)
      .map(s => normalizeAnswer(s.replace(/\([^)]*\)/g, '')))
      .filter(Boolean);

    if (parts.includes(cleanUser)) return true;
  }

  return false;
}

function handlePracticeSubmit() {
  if (practiceSession.answeredCurrent) {
    practiceSession.currentIndex++;
    renderCurrentPracticeQuestion();
    return;
  }

  const card = practiceSession.cards[practiceSession.currentIndex];
  const isEnToVi = practiceSession.currentCardDirection === 'en_to_vi';
  const expected = isEnToVi ? card.vietnamese : card.english;
  const altMeanings = isEnToVi && Array.isArray(card.altMeanings) ? card.altMeanings : [];
  const userAns = arenaAnswerInput.value;

  if (checkPracticeAnswer(userAns, expected, altMeanings)) {
    practiceSession.score++;
    practiceSession.answeredCurrent = true;
    arenaScoreCount.textContent = practiceSession.score;
    arenaFeedbackBox.className = 'arena-feedback correct';
    arenaFeedbackBox.textContent = `✓ ${card.english} = ${card.vietnamese}`;
    arenaFeedbackBox.classList.remove('hidden');

    setTimeout(() => {
      if (practiceSession.answeredCurrent) {
        practiceSession.currentIndex++;
        renderCurrentPracticeQuestion();
      }
    }, 750);
  } else {
    arenaFeedbackBox.className = 'arena-feedback wrong';
    arenaFeedbackBox.textContent = '✗ Try again!';
    arenaFeedbackBox.classList.remove('hidden');
    arenaAnswerInput.select();
  }
}

function handlePracticeSkipOrNext() {
  if (practiceSession.answeredCurrent) {
    practiceSession.currentIndex++;
    renderCurrentPracticeQuestion();
    return;
  }

  const card = practiceSession.cards[practiceSession.currentIndex];
  practiceSession.answeredCurrent = true;
  arenaFeedbackBox.className = 'arena-feedback wrong';
  const extra = Array.isArray(card.altMeanings) && card.altMeanings.length > 0
    ? ` (${card.altMeanings.slice(0, 3).join(', ')})`
    : '';
  arenaFeedbackBox.textContent = `${card.english} ➔ ${card.vietnamese}${extra}`;
  arenaFeedbackBox.classList.remove('hidden');
  arenaSubmitBtn.textContent = 'Next ➔';
  arenaSkipBtn.textContent = 'Next ➔';
}

// ================= SAVED WORDS LIST =================
function renderSavedWordsList(filterText = '') {
  const q = String(filterText || '').normalize('NFC').trim().toLowerCase();
  const filtered = state.flashcards.filter(
    c =>
      c.english.normalize('NFC').toLowerCase().includes(q) ||
      c.vietnamese.normalize('NFC').toLowerCase().includes(q) ||
      (Array.isArray(c.altMeanings) && c.altMeanings.some(m => String(m || '').normalize('NFC').toLowerCase().includes(q)))
  );

  if (filtered.length === 0) {
    savedWordsList.innerHTML = `
      <div style="text-align:center;color:#64748b;font-size:12px;padding:12px 0;">
        ${state.flashcards.length === 0 ? 'No saved words yet.' : 'No matching words.'}
      </div>
    `;
    return;
  }

  savedWordsList.innerHTML = filtered
    .map(card => {
      const altList = Array.isArray(card.altMeanings) ? card.altMeanings : [];
      const altTooltip = altList.length > 0 ? `Other meanings: ${altList.join(', ')}` : '';
      return `
      <div class="saved-word-item" ${altTooltip ? `title="${escapeHtml(altTooltip)}"` : ''}>
        <div class="saved-word-pair">
          <strong>${escapeHtml(card.english)}</strong>
          ${card.phonetic ? `<small style="color:#64748b;margin-left:4px;">${escapeHtml(card.phonetic)}</small>` : ''}
          <span style="margin:0 6px;color:#475569;">➔</span>
          <span>${escapeHtml(card.vietnamese)}</span>
          ${altList.length > 0 ? `<small style="color:#64748b;margin-left:4px;">(+${altList.length})</small>` : ''}
        </div>
        <div class="saved-word-actions">
          <button class="speak-card-btn" data-word="${escapeHtml(card.english)}" data-audio="${escapeHtml(card.audioUrl || '')}" title="Listen pronunciation">🔊</button>
          <button class="delete-card-btn" data-id="${escapeHtml(card.id)}" title="Delete">&times;</button>
        </div>
      </div>
    `;
    })
    .join('');

  savedWordsList.querySelectorAll('.speak-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playWordAudio(btn.dataset.word, btn.dataset.audio);
    });
  });

  savedWordsList.querySelectorAll('.delete-card-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      state.flashcards = state.flashcards.filter(c => c.id !== id);
      await saveStateToStorage();
      renderAllUI();
      queueDeltaSync({ deletedIds: [id] });
    });
  });
}

// ================= POPUP SETTINGS & VERCEL SYNC =================
async function savePopupSettings() {
  const enabled = popupPracticeToggle.checked;
  const minutes = Math.max(1, Math.min(240, Number(popupIntervalInput.value) || 5));
  popupIntervalInput.value = minutes;

  state.settings.popupEnabled = enabled;
  state.settings.popupIntervalMinutes = minutes;

  await saveStateToStorage();
  queueDeltaSync({ dirtyProfile: true });
}

async function triggerCloudPull(silent = false, force = false) {
  if (force) updateSyncBadge('syncing');
  const res = await chrome.runtime.sendMessage({ type: 'SYNC_PULL', force });
  await loadStateFromStorage();
  renderAllUI();
  if (!silent && res && !res.ok && res.error) {
    showSettingToast(`Sync error: ${res.error}`, true);
  }
  return res;
}

async function queueDeltaSync({ upsertedIds = [], deletedIds = [], dirtyProfile = false, flushImmediately = false } = {}) {
  if (!state.email) {
    updateSyncBadge('idle');
    return { ok: false, reason: 'missing_config' };
  }
  if (flushImmediately) updateSyncBadge('syncing');
  const res = await chrome.runtime.sendMessage({
    type: 'SYNC_QUEUE_DELTA',
    upsertedIds,
    deletedIds,
    dirtyProfile,
    flushImmediately
  });
  await loadStateFromStorage();
  renderAllUI();
  return res;
}

function showSettingToast(msg, isError = false) {
  settingToastBanner.textContent = msg;
  settingToastBanner.style.background = isError
    ? 'rgba(239, 68, 68, 0.16)'
    : 'rgba(16, 185, 129, 0.16)';
  settingToastBanner.style.color = isError ? '#f87171' : '#34d399';
  settingToastBanner.style.borderColor = isError
    ? 'rgba(239, 68, 68, 0.35)'
    : 'rgba(16, 185, 129, 0.35)';
  settingToastBanner.classList.remove('hidden');

  setTimeout(() => {
    settingToastBanner.classList.add('hidden');
  }, 2200);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
