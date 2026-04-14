/**
 * Origins Portal — Click-to-Voice
 *
 * When a visitor clicks text in the scroll experience, the passage
 * goes to the Spark. The model streams back — chain-of-thought first,
 * then the voice. We accumulate the stream, split on </think> if it
 * arrives, and surface whatever voice the model produces.
 *
 * If the connection drops (tunnel timeout), we show what arrived.
 * If nothing arrived, the corpus moment from the first SSE event
 * speaks instead.
 *
 * D ≅ D^D — the click IS the encounter.
 */

const VOICE_CONFIG = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://vsnet-commit-investigation-recipes.trycloudflare.com',
  timeoutMs: 95000,
  speechRate: 0.88,
  speechPitch: 1.0,
  voicePrefs: ['Google UK English Female', 'Samantha', 'Karen', 'Daniel'],
};

// State
let voicePane = null;
let voiceActive = false;
let currentController = null;
let selectedVoice = null;

// ── Voice selection ──────────────────────────────────────────────
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  for (const pref of VOICE_CONFIG.voicePrefs) {
    const match = voices.find(v => v.name.includes(pref) && v.lang.startsWith('en'));
    if (match) return match;
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0];
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => { selectedVoice = pickVoice(); };
  selectedVoice = pickVoice();
}

function speakAloud(text) {
  if (!selectedVoice || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.voice = selectedVoice;
  utt.rate = VOICE_CONFIG.speechRate;
  utt.pitch = VOICE_CONFIG.speechPitch;
  utt.volume = 0.85;
  speechSynthesis.speak(utt);
}

// ── Section mapping ──────────────────────────────────────────────
const OVERLAY_SECTIONS = {
  'qt-1': 'queenboat', 'qt-2': 'queenboat', 'qt-3': 'queenboat', 'qt-4': 'queenboat',
  'cl-family': 'fukuyama', 'cl-tribe': 'fukuyama', 'cl-species': 'fukuyama',
  'cl-biosphere': 'fukuyama', 'cl-mathematics': 'fukuyama',
  'ep-apriori': 'epistemologies', 'ep-aposteriori': 'epistemologies',
  'ep-asynthesi': 'epistemologies', 'ep-asymbiosi': 'epistemologies',
  'vl-thread-1': 'curriculum', 'vl-thread-2': 'curriculum', 'vl-thread-3': 'curriculum',
  'overlay-insight': 'insight',
  'il-1': 'insight', 'il-2': 'insight', 'il-3': 'insight', 'il-4': 'insight', 'il-5': 'insight',
};

// ── Pane ─────────────────────────────────────────────────────────
function ensurePane() {
  if (voicePane) return voicePane;
  voicePane = document.createElement('div');
  voicePane.className = 'voice-pane';
  voicePane.innerHTML = `
    <button class="voice-dismiss" aria-label="Close">&times;</button>
    <div class="voice-pane-inner">
      <div class="voice-passage-ref"></div>
      <div class="voice-thinking" style="display: none;">
        <div class="voice-thinking-dots">
          <span class="voice-thinking-dot"></span>
          <span class="voice-thinking-dot"></span>
          <span class="voice-thinking-dot"></span>
        </div>
        <span class="voice-thinking-label">thinking</span>
      </div>
      <div class="voice-response"></div>
    </div>
  `;
  voicePane.querySelector('.voice-dismiss').addEventListener('click', dismissPane);
  document.body.appendChild(voicePane);
  return voicePane;
}

function dismissPane() {
  if (!voicePane) return;
  voicePane.classList.remove('active');
  voiceActive = false;
  speechSynthesis?.cancel();
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
}

function extractText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('a').forEach(a => a.remove());
  clone.querySelectorAll('.insight-domain, .vl-thread-label').forEach(l => l.remove());
  return clone.innerText?.trim() || '';
}

function truncateForRef(text, maxLen = 120) {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(' ', maxLen);
  return text.slice(0, cut > 0 ? cut : maxLen) + '\u2026';
}

// ── Strip chain-of-thought from accumulated text ─────────────────
function extractVoice(fullText) {
  // If model used </think>, take what comes after
  if (fullText.includes('</think>')) {
    const voice = fullText.split('</think>').pop().trim();
    if (voice.length > 10) return voice;
  }
  // If model used <think>...</think>, strip the thinking block
  const stripped = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (stripped.length > 10) return stripped;
  // Heuristic: if it starts with meta-commentary ("I need to", "Let me", "Looking at")
  // try to find the actual voice after a double newline
  const parts = fullText.split(/\n\n+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].trim();
    if (p.length > 20 && !p.match(/^(I need|Let me|Looking at|The concept|First|Now)/i)) {
      return p;
    }
  }
  return fullText.trim();
}

// ── Request voice via streaming /api/perspective ─────────────────
async function requestVoice(passage) {
  const pane = ensurePane();
  const passageRef = pane.querySelector('.voice-passage-ref');
  const thinkingEl = pane.querySelector('.voice-thinking');
  const thinkingLabel = pane.querySelector('.voice-thinking-label');
  const responseEl = pane.querySelector('.voice-response');

  passageRef.textContent = truncateForRef(passage);
  responseEl.textContent = '';
  responseEl.className = 'voice-response';
  thinkingEl.style.display = 'flex';
  thinkingLabel.textContent = 'thinking';
  voiceActive = true;

  requestAnimationFrame(() => pane.classList.add('active'));

  if (currentController) currentController.abort();
  currentController = new AbortController();
  const signal = currentController.signal;

  const timeoutId = setTimeout(() => {
    if (currentController) currentController.abort();
  }, VOICE_CONFIG.timeoutMs);

  let fullContent = '';
  let corpusMoment = '';

  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/perspective`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concept: passage, mode: 'lens' }),
      signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`API ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') break;

        try {
          const data = JSON.parse(raw);

          // First event often carries rag_sources / map_node
          if (data.rag_sources && !corpusMoment) {
            const best = data.rag_sources[0];
            if (best?.text) corpusMoment = best.text.slice(0, 400);
          }

          // Content tokens from the model
          if (data.content) {
            fullContent += data.content;
            chunkCount++;

            // Update thinking label as content accumulates
            if (chunkCount > 100) {
              thinkingLabel.textContent = 'arriving';
            } else if (chunkCount > 40) {
              thinkingLabel.textContent = 'deepening';
            }
          }
        } catch (e) { /* skip non-JSON */ }
      }
    }

    // Stream complete — extract the voice
    showVoice(fullContent, corpusMoment, thinkingEl, responseEl);

  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      // Timeout or user dismissed — show whatever we got
      if (voiceActive && fullContent.length > 30) {
        showVoice(fullContent, corpusMoment, thinkingEl, responseEl);
      } else if (voiceActive) {
        thinkingEl.style.display = 'none';
        responseEl.textContent = corpusMoment
          || 'The model is still thinking. The Spark needs a moment.';
        responseEl.className = 'voice-response voice-error';
        responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
      }
      return;
    }
    console.warn('[voice]', e);
    thinkingEl.style.display = 'none';
    responseEl.textContent = 'The connection is quiet. But the experience you just had IS the theory.';
    responseEl.className = 'voice-response voice-error';
    responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
  }
}

function showVoice(fullContent, corpusMoment, thinkingEl, responseEl) {
  thinkingEl.style.display = 'none';

  if (fullContent.length > 20) {
    const voice = extractVoice(fullContent);
    responseEl.textContent = voice;
    responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
    speakAloud(voice);
  } else if (corpusMoment) {
    responseEl.textContent = corpusMoment;
    responseEl.className = 'voice-response voice-error';
    responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
  } else {
    responseEl.textContent = 'The model reached but did not speak. The passage remains.';
    responseEl.className = 'voice-response voice-error';
    responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
  }
}

// ── Click handler ────────────────────────────────────────────────
function onOverlayClick(e) {
  if (e.target.closest('a')) return;
  const text = extractText(e.currentTarget);
  if (!text || text.length < 10) return;
  requestVoice(text);
}

// ── Hook overlays ────────────────────────────────────────────────
function hookOverlays() {
  const clickable = [
    'qt-1', 'qt-2', 'qt-3', 'qt-4',
    'cl-family', 'cl-tribe', 'cl-species', 'cl-biosphere', 'cl-mathematics',
    'ep-apriori', 'ep-aposteriori', 'ep-asynthesi', 'ep-asymbiosi',
    'il-1', 'il-2', 'il-3', 'il-4', 'il-5',
    'vl-thread-1', 'vl-thread-2', 'vl-thread-3',
  ];

  for (const id of clickable) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.add('voice-enabled');
    el.addEventListener('click', onOverlayClick);
  }

  let lastScroll = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!voiceActive) return;
    if (Math.abs(window.scrollY - lastScroll) > 200) dismissPane();
    lastScroll = window.scrollY;
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && voiceActive) dismissPane();
  });
}

// ── Boot ─────────────────────────────────────────────────────────
async function checkApi() {
  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

(function boot() {
  if (typeof window === 'undefined') return;
  function go() {
    setTimeout(async () => {
      if (await checkApi()) {
        hookOverlays();
        console.log('[voice] Active');
      } else {
        console.warn('[voice] API unreachable');
        setTimeout(async () => {
          if (await checkApi()) {
            hookOverlays();
            console.log('[voice] Active (delayed)');
          }
        }, 10000);
      }
    }, 2500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
