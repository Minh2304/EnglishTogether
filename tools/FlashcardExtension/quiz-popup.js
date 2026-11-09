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
  let result = '';
  let appendedAtCursor = '';

  for (let i = 0; i < curVal.length; i++) {
    const ch = curVal[i];
    const lower = ch.toLowerCase();
    const isUpper = ch !== lower;

    if (Object.prototype.hasOwnProperty.call(U_HORN_MAP, lower)) {
      const prevCharLower = (prevVal[i] || '').toLowerCase();
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

  if (!appendedAtCursor && result === curVal) return null;
  const insertPos = typeof cursorPos === 'number' ? cursorPos : result.length;
  const finalStr = result.slice(0, insertPos) + appendedAtCursor + result.slice(insertPos);
  return { value: finalStr, cursor: insertPos + appendedAtCursor.length };
}

function attachEnglishUnikeyBypass(inputEl, isEnabledFn) {
  let prevValue = inputEl.value || '';
  inputEl.addEventListener('input', () => {
    if (isEnabledFn && !isEnabledFn()) {
      prevValue = inputEl.value;
      return;
    }
    const fixed = reverseUnikeyTelex(prevValue, inputEl.value, inputEl.selectionStart);
    if (fixed) {
      inputEl.value = fixed.value;
      inputEl.setSelectionRange(fixed.cursor, fixed.cursor);
    }
    prevValue = inputEl.value;
  });
}

function normalizeText(str) {
  return String(str || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAnswerCorrect(userAnswer, targetText) {
  const cleanUser = normalizeText(userAnswer);
  if (!cleanUser) return false;
  const cleanTarget = normalizeText(targetText);
  if (cleanUser === cleanTarget) return true;

  const parts = cleanTarget
    .split(/[,;/|]+/)
    .map(s => normalizeText(s.replace(/\([^)]*\)/g, '')))
    .filter(Boolean);

  return parts.includes(cleanUser);
}

function closeAndRestartTimer() {
  chrome.runtime.sendMessage({ type: 'POPUP_CLOSED_OR_COMPLETED' }, () => {
    window.close();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get(['activeQuizPayload']);
  const payload = data.activeQuizPayload;
  if (!payload || !payload.card) {
    closeAndRestartTimer();
    return;
  }

  const { card, direction } = payload;
  const isEnToVi = direction !== 'vi_to_en';
  const expectedAnswer = isEnToVi ? card.vietnamese : card.english;

  document.getElementById('promptLabel').textContent = isEnToVi ? 'English' : 'Vietnamese';
  document.getElementById('promptWord').textContent = isEnToVi ? card.english : card.vietnamese;
  document.getElementById('phoneticText').textContent = isEnToVi && card.phonetic ? card.phonetic : '';

  const input = document.getElementById('answerInput');
  const feedback = document.getElementById('feedbackText');
  input.placeholder = isEnToVi ? 'Vietnamese...' : 'English...';
  attachEnglishUnikeyBypass(input, () => !isEnToVi);
  input.focus();

  document.getElementById('closeBtn').addEventListener('click', closeAndRestartTimer);
  window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({ type: 'POPUP_CLOSED_OR_COMPLETED' });
  });

  document.getElementById('hintBtn').addEventListener('click', () => {
    const clean = String(expectedAnswer || '').normalize('NFC').trim();
    const masked = clean.length <= 2
      ? clean
      : clean[0] + '_'.repeat(Math.min(6, clean.length - 2)) + clean[clean.length - 1];
    feedback.className = 'et-feedback';
    feedback.textContent = `Hint: ${masked} (${clean.length} chars)`;
    input.focus();
  });

  document.getElementById('quizForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isAnswerCorrect(input.value, expectedAnswer)) {
      input.classList.remove('error');
      input.classList.add('success');
      feedback.className = 'et-feedback ok';
      feedback.textContent = '✓ Correct!';
      setTimeout(closeAndRestartTimer, 600);
    } else {
      input.classList.add('error');
      feedback.className = 'et-feedback err';
      feedback.textContent = '✗ Try again!';
      input.select();
    }
  });
});
