(() => {
  if (window.__ET_FLASHCARD_CONTENT_LOADED__) return;
  window.__ET_FLASHCARD_CONTENT_LOADED__ = true;

  const HOST_ID = 'et-flashcard-popup-host';

  // Map Vietnamese Telex-transformed characters back to (baseChar, telexSuffix)
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

    if (!appendedAtCursor && result === curVal) {
      return null;
    }

    const insertPos = typeof cursorPos === 'number' ? cursorPos : result.length;
    const finalStr = result.slice(0, insertPos) + appendedAtCursor + result.slice(insertPos);
    const newCursor = insertPos + appendedAtCursor.length;
    return { value: finalStr, cursor: newCursor };
  }

  function attachEnglishUnikeyBypass(inputEl, isEnabledFn) {
    let prevValue = inputEl.value || '';
    inputEl.addEventListener('input', () => {
      if (isEnabledFn && !isEnabledFn()) {
        prevValue = inputEl.value;
        return;
      }
      const curValue = inputEl.value;
      const fixed = reverseUnikeyTelex(prevValue, curValue, inputEl.selectionStart);
      if (fixed) {
        inputEl.value = fixed.value;
        inputEl.setSelectionRange(fixed.cursor, fixed.cursor);
      }
      prevValue = inputEl.value;
    });
  }

  function normalizeText(str) {
    return String(str || '')
      .normalize('NFC')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
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

  function closePopupAndRestartTimer(hostEl) {
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    try {
      chrome.runtime.sendMessage({ type: 'POPUP_CLOSED_OR_COMPLETED' });
    } catch (e) {
      // Ignore
    }
  }

  function renderPopup(payload) {
    if (!payload || !payload.card) return;

    const existing = document.getElementById(HOST_ID);
    if (existing) {
      existing.remove();
    }

    const { card, direction } = payload;
    const isEnToVi = direction !== 'vi_to_en';
    const promptLabel = isEnToVi ? 'English' : 'Vietnamese';
    const promptValue = isEnToVi ? card.english : card.vietnamese;
    const answerPlaceholder = isEnToVi ? 'Vietnamese...' : 'English...';
    const expectedAnswer = isEnToVi ? card.vietnamese : card.english;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 2147483647; pointer-events: auto;';

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      }
      .et-popup-card {
        width: 340px;
        background: linear-gradient(145deg, #1e293b 0%, #0f172a 100%);
        color: #f8fafc;
        border: 1px solid rgba(99, 102, 241, 0.45);
        border-radius: 16px;
        padding: 18px 18px 16px;
        box-shadow: 0 20px 45px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06);
        animation: etSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
      }
      @keyframes etSlideIn {
        from { opacity: 0; transform: translateY(-14px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .et-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .et-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #a5b4fc;
        background: rgba(99, 102, 241, 0.16);
        padding: 4px 10px;
        border-radius: 999px;
      }
      .et-close-btn {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(30, 41, 59, 0.8);
        color: #94a3b8;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }
      .et-close-btn:hover {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.4);
      }
      .et-prompt-box {
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 12px;
        padding: 14px;
        text-align: center;
        margin-bottom: 12px;
      }
      .et-prompt-label {
        font-size: 11px;
        color: #94a3b8;
        margin-bottom: 4px;
      }
      .et-prompt-word {
        font-size: 22px;
        font-weight: 700;
        color: #ffffff;
        word-break: break-word;
      }
      .et-phonetic {
        font-size: 12px;
        color: #38bdf8;
        margin-top: 4px;
      }
      .et-input-row {
        display: flex;
        gap: 8px;
      }
      .et-input {
        flex: 1;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 10px 12px;
        color: #f8fafc;
        font-size: 14px;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .et-input:focus {
        border-color: #6366f1;
      }
      .et-input.error {
        border-color: #ef4444;
        animation: etShake 0.3s ease;
      }
      .et-input.success {
        border-color: #10b981;
        background: rgba(16, 185, 129, 0.12);
      }
      @keyframes etShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }
      .et-submit-btn {
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: #ffffff;
        border: none;
        border-radius: 10px;
        padding: 0 14px;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .et-submit-btn:hover {
        opacity: 0.92;
      }
      .et-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
        min-height: 20px;
        font-size: 12px;
      }
      .et-feedback {
        color: #94a3b8;
      }
      .et-feedback.ok {
        color: #34d399;
        font-weight: 600;
      }
      .et-feedback.err {
        color: #f87171;
      }
      .et-hint-btn {
        background: none;
        border: none;
        color: #64748b;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        padding: 0;
      }
      .et-hint-btn:hover {
        color: #cbd5e1;
      }
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'et-popup-card';
    wrapper.innerHTML = `
      <div class="et-header">
        <span class="et-badge">⚡ Flashcard Check</span>
        <button class="et-close-btn" id="etCloseBtn" title="Close">&times;</button>
      </div>
      <div class="et-prompt-box">
        <div class="et-prompt-label">${promptLabel}</div>
        <div class="et-prompt-word">${escapeHtml(promptValue)}</div>
        ${isEnToVi && card.phonetic ? `<div class="et-phonetic">${escapeHtml(card.phonetic)}</div>` : ''}
      </div>
      <form id="etQuizForm" class="et-input-row" autocomplete="off">
        <input type="text" id="etAnswerInput" class="et-input" lang="${isEnToVi ? 'vi' : 'en'}" spellcheck="false" placeholder="${answerPlaceholder}" />
        <button type="submit" class="et-submit-btn">Check</button>
      </form>
      <div class="et-footer">
        <span id="etFeedback" class="et-feedback">Press Enter to check</span>
        <button type="button" id="etHintBtn" class="et-hint-btn">Hint</button>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(wrapper);
    document.documentElement.appendChild(host);

    const closeBtn = shadow.getElementById('etCloseBtn');
    const form = shadow.getElementById('etQuizForm');
    const input = shadow.getElementById('etAnswerInput');
    const feedback = shadow.getElementById('etFeedback');
    const hintBtn = shadow.getElementById('etHintBtn');

    // Bypass Unikey when typing English answer (VI -> EN)
    attachEnglishUnikeyBypass(input, () => !isEnToVi);

    ['keydown', 'keyup', 'keypress'].forEach(evtName => {
      input.addEventListener(evtName, (e) => {
        e.stopPropagation();
        if (evtName === 'keydown' && e.key === 'Escape') {
          closePopupAndRestartTimer(host);
        }
      });
    });

    setTimeout(() => input.focus(), 50);

    closeBtn.addEventListener('click', () => {
      closePopupAndRestartTimer(host);
    });

    hintBtn.addEventListener('click', () => {
      const clean = String(expectedAnswer || '').normalize('NFC').trim();
      const masked = clean.length <= 2
        ? clean
        : clean[0] + '_'.repeat(Math.min(6, clean.length - 2)) + clean[clean.length - 1];
      feedback.className = 'et-feedback';
      feedback.textContent = `Hint: ${masked} (${clean.length} chars)`;
      input.focus();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value;
      if (isAnswerCorrect(val, expectedAnswer)) {
        input.classList.remove('error');
        input.classList.add('success');
        feedback.className = 'et-feedback ok';
        feedback.textContent = '✓ Correct!';
        setTimeout(() => {
          closePopupAndRestartTimer(host);
        }, 650);
      } else {
        input.classList.remove('error');
        void input.offsetWidth;
        input.classList.add('error');
        feedback.className = 'et-feedback err';
        feedback.textContent = '✗ Try again!';
        input.select();
      }
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'SHOW_FLASHCARD_POPUP') {
      renderPopup(message.payload);
      sendResponse({ ok: true });
    } else if (message?.type === 'HIDE_FLASHCARD_POPUP') {
      const existing = document.getElementById(HOST_ID);
      if (existing) existing.remove();
      sendResponse({ ok: true });
    }
  });
})();
