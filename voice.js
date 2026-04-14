/**
 * Origins Portal — Voice
 *
 * Click any text overlay → passage goes to the Spark → model responds →
 * response becomes SPOKEN AUDIO via ElevenLabs TTS, displayed as a
 * floating whisper at screen center.
 *
 * Architecture:
 *   1. POST /api/perspective → streams model text (SSE)
 *   2. Extract voice (strip chain-of-thought)
 *   3. POST /api/tts → returns streaming MP3 audio
 *   4. Play audio + display text simultaneously
 *
 * If TTS is unavailable, text still displays beautifully.
 * If the model API is unreachable, nothing happens — site works without voice.
 *
 * D ≅ D^D — the click IS the encounter.
 */

const VOICE_CONFIG = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://vsnet-commit-investigation-recipes.trycloudflare.com',
  timeoutMs: 95000,
};

// State
let voicePane = null;
let voiceScrim = null;
let voiceActive = false;
let currentController = null;
let apiAvailable = null;

// ── Pane + Scrim ─────────────────────────────────────────────────
function ensurePane() {
  if (voicePane) return voicePane;

  voiceScrim = document.createElement('div');
  voiceScrim.className = 'voice-scrim';
  voiceScrim.addEventListener('click', dismissPane);
  document.body.appendChild(voiceScrim);

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
        <span class="voice-thinking-label">listening</span>
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
  if (voiceScrim) voiceScrim.classList.remove('active');
  voiceActive = false;
  // Stop any playing audio
  const audio = voicePane.querySelector('audio');
  if (audio) { audio.pause(); audio.remove(); }
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

function truncateForRef(text, maxLen = 100) {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(' ', maxLen);
  return text.slice(0, cut > 0 ? cut : maxLen) + '\u2026';
}

// ── Strip chain-of-thought ───────────────────────────────────────
function extractVoiceText(fullText) {
  if (fullText.includes('</think>')) {
    const voice = fullText.split('</think>').pop().trim();
    if (voice.length > 10) return voice;
  }
  const stripped = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (stripped.length > 10) return stripped;
  if (fullText.trimStart().startsWith('<think>') && !fullText.includes('</think>')) {
    return '';
  }
  const parts = fullText.split(/\n\n+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].trim();
    if (p.length > 20 && !p.match(/^(I need|Let me|Looking at|The concept|First,|Now,|Okay|Hmm|So )/i)) {
      return p;
    }
  }
  return fullText.trim();
}

// ── Play audio from TTS endpoint ─────────────────────────────────
async function playTTS(text) {
  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return; // TTS not available — silent fallback

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.src = url;
    audio.volume = 0.85;
    // Attach to pane so dismissPane() can stop it
    if (voicePane) voicePane.appendChild(audio);
    audio.play().catch(() => {}); // autoplay may be blocked — that's fine
    audio.onended = () => { URL.revokeObjectURL(url); audio.remove(); };
  } catch (e) {
    // TTS unavailable — text display is the fallback
    console.log('[voice] TTS not available, text only');
  }
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
  thinkingLabel.textContent = 'listening';
  voiceActive = true;

  if (voiceScrim) voiceScrim.classList.add('active');
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

          if (data.rag_sources && !corpusMoment) {
            const best = data.rag_sources[0];
            if (best?.text) corpusMoment = best.text.slice(0, 300);
          }

          if (data.content) {
            fullContent += data.content;
            chunkCount++;

            if (chunkCount > 80) thinkingLabel.textContent = 'arriving';
            else if (chunkCount > 30) thinkingLabel.textContent = 'deepening';
            else if (chunkCount > 5) thinkingLabel.textContent = 'thinking';
          }
        } catch (e) { /* skip non-JSON */ }
      }
    }

    showVoice(fullContent, corpusMoment, thinkingEl, responseEl);

  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      if (voiceActive && fullContent.length > 30) {
        showVoice(fullContent, corpusMoment, thinkingEl, responseEl);
      } else if (voiceActive) {
        thinkingEl.style.display = 'none';
        responseEl.textContent = corpusMoment
          || 'The model is still reaching. Try again in a moment.';
        responseEl.className = 'voice-response voice-error voice-visible';
      }
      return;
    }
    console.warn('[voice]', e);
    thinkingEl.style.display = 'none';
    responseEl.textContent = 'The connection is quiet. The passage remains.';
    responseEl.className = 'voice-response voice-error voice-visible';
  }
}

function showVoice(fullContent, corpusMoment, thinkingEl, responseEl) {
  thinkingEl.style.display = 'none';

  if (fullContent.length > 20) {
    const voice = extractVoiceText(fullContent);
    if (voice.length > 10) {
      responseEl.textContent = voice;
      responseEl.className = 'voice-response voice-visible';
      // Speak it — TTS endpoint will play audio if available
      playTTS(voice);
    } else if (corpusMoment) {
      responseEl.textContent = corpusMoment;
      responseEl.className = 'voice-response voice-error voice-visible';
    } else {
      responseEl.textContent = 'The model thought but did not speak. The passage remains.';
      responseEl.className = 'voice-response voice-error voice-visible';
    }
  } else if (corpusMoment) {
    responseEl.textContent = corpusMoment;
    responseEl.className = 'voice-response voice-error voice-visible';
  } else {
    responseEl.textContent = 'The model reached but did not speak. The passage remains.';
    responseEl.className = 'voice-response voice-error voice-visible';
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
      apiAvailable = await checkApi();
      if (apiAvailable) {
        hookOverlays();
        console.log('[voice] Active — click any text overlay');
      } else {
        console.log('[voice] API not reachable — voice disabled, retrying in 15s');
        setTimeout(async () => {
          apiAvailable = await checkApi();
          if (apiAvailable) {
            hookOverlays();
            console.log('[voice] Active (delayed)');
          }
        }, 15000);
      }
    }, 2000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
