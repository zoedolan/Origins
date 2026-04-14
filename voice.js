/**
 * Origins Portal — Voice Player
 *
 * A persistent, unobtrusive player at the bottom-right of the viewport.
 * Everything that wants to speak routes through window.voicePlayer.speak().
 *
 * Flow:
 *   1. Caller provides a prompt (NFT metadata, overlay text, section concept)
 *   2. Prompt is sent to /api/voice — the LLM generates a FRESH reflection
 *   3. The LLM's text is sent to /api/tts — ElevenLabs returns real audio
 *   4. The player shows status: thinking → speaking → fades away
 *
 * If the API is offline, the player stays hidden. No fallback.
 * The site works perfectly in silence.
 */

const VOICE = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://spark-2b7c.tail7302f3.ts.net/api',
  volume: 0.8,
};

let playerEl = null;
let statusEl = null;
let titleEl = null;
let closeBtn = null;
let controller = null;
let apiOnline = null;
let currentAudio = null;
let isSpeaking = false;       // mutex: only one voice pipeline at a time
let lastClickSpeak = 0;       // timestamp of last click-triggered speak

// ── Create the player UI ─────────────────────────────────────────
function createPlayer() {
  playerEl = document.createElement('div');
  playerEl.className = 'voice-player';
  playerEl.innerHTML = `
    <div class="vp-inner">
      <div class="vp-indicator"><span class="vp-dot"></span></div>
      <div class="vp-info">
        <span class="vp-title"></span>
        <span class="vp-status">thinking…</span>
      </div>
      <button class="vp-close" aria-label="Stop">&times;</button>
    </div>
  `;
  document.body.appendChild(playerEl);

  titleEl = playerEl.querySelector('.vp-title');
  statusEl = playerEl.querySelector('.vp-status');
  closeBtn = playerEl.querySelector('.vp-close');
  closeBtn.addEventListener('click', stop);
}

function showPlayer(title, status) {
  titleEl.textContent = title || '';
  statusEl.textContent = status || 'thinking…';
  playerEl.classList.add('visible');
}

function hidePlayer() {
  playerEl.classList.remove('visible');
}

function setStatus(s) {
  if (statusEl) statusEl.textContent = s;
}

// ── Strip chain-of-thought ───────────────────────────────────────
function clean(t) {
  if (t.includes('</think>')) t = t.split('</think>').pop();
  return t.replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/[Aa]ccording to the (system prompt|context|corpus)[,.]?\s*/g, '')
    .replace(/[Ff]rom the (corpus|context|deep memory)[,.]?\s*/g, '')
    .replace(/[Aa]s (instructed|specified)[,.]?\s*/g, '')
    .replace(/\s{2,}/g, ' ').trim();
}

// ── Step 1: Get LLM reflection text via /api/voice ───────────────
async function getLLMText(prompt, title, sectionHint, signal) {
  const body = {
    passage: prompt,
    section: sectionHint || '',
    context_hint: title
      ? `The visitor is interacting with "${title}". Speak a brief, soothing reflection — one to three sentences. Do not repeat the passage back. Generate something new.`
      : 'Speak a brief, soothing reflection — one to three sentences.',
  };

  console.log(`[voice] POST ${VOICE.apiBase}/api/voice`, body);
  const res = await fetch(`${VOICE.apiBase}/api/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw new Error(`Voice API returned ${res.status}`);

  let full = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') break;
      try {
        const d = JSON.parse(raw);
        if (d.content) full += d.content;
        if (d.thinking) setStatus('thinking…');
      } catch {}
    }
  }

  return clean(full);
}

// ── Step 2: Convert text to audio via /api/tts (ElevenLabs) ─────
async function getAudio(text, signal) {
  console.log(`[voice] POST ${VOICE.apiBase}/api/tts — ${text.length} chars`);
  const res = await fetch(`${VOICE.apiBase}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!res.ok) throw new Error(`TTS API returned ${res.status}`);

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Play audio blob ──────────────────────────────────────────────
function playAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.volume = VOICE.volume;
    currentAudio = audio;
    audio.onended = () => { currentAudio = null; URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { currentAudio = null; URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(() => { currentAudio = null; resolve(); });
  });
}

// ── Core: send prompt to LLM, then speak via ElevenLabs ──────────
async function speak(prompt, title, sectionHint, { fromClick = false } = {}) {
  console.log(`[voice] speak() — api=${apiOnline}, click=${fromClick}, title="${title}", prompt="${(prompt||'').slice(0,60)}…"`);
  if (!apiOnline) {
    console.warn('[voice] API offline — skipping');
    return;
  }

  // If already speaking, a click overrides; a scroll does not.
  if (isSpeaking && !fromClick) {
    console.log('[voice] Already speaking — scroll voice deferred');
    return;
  }

  stop(); // cancel anything in progress

  if (fromClick) lastClickSpeak = Date.now();
  isSpeaking = true;
  controller = new AbortController();
  const signal = controller.signal;

  showPlayer(title || '', 'thinking…');

  try {
    // Step 1: LLM generates reflection
    const text = await getLLMText(prompt, title, sectionHint, signal);
    console.log(`[voice] LLM text (${text.length} chars): "${text.slice(0, 100)}…"`);

    if (signal.aborted) return;
    if (text.length < 10) { console.warn('[voice] Text too short'); hidePlayer(); return; }

    // Step 2: ElevenLabs converts to audio
    setStatus('speaking…');
    const audioUrl = await getAudio(text, signal);

    if (signal.aborted) return;

    // Step 3: Play
    console.log('[voice] Playing audio…');
    await playAudio(audioUrl);
    console.log('[voice] Done');

  } catch (e) {
    if (e.name !== 'AbortError') console.log('[voice] Error:', e.message);
  } finally {
    isSpeaking = false;
    hidePlayer();
    controller = null;
  }
}

function stop() {
  controller?.abort();
  controller = null;
  isSpeaking = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  hidePlayer();
}

// ── Health check ─────────────────────────────────────────────────
async function checkApi() {
  try {
    const r = await fetch(`${VOICE.apiBase}/api/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch { return false; }
}

// ── Wire up text overlays as voice triggers ──────────────────────
function wireOverlays() {
  document.querySelectorAll('.text-overlay').forEach(overlay => {
    if (overlay.id === 'overlay-portal' || overlay.id === 'overlay-entry') return;

    overlay.style.cursor = 'default';
    overlay.addEventListener('click', () => {
      const text = overlay.textContent.trim();
      if (text.length < 5) return;
      const heading = overlay.querySelector('h3, .insight-domain');
      const title = heading ? heading.textContent.trim() : '';
      speak(text, title, overlay.id || '', { fromClick: true });
    });
  });
}

// ── Scroll-triggered ambient voice ───────────────────────────────
const SECTION_PROMPTS = {
  question: { prompt: 'How do you distribute scarce things without killing each other — and what changes when intelligence itself is no longer scarce?', title: '' },
  queenboat: { prompt: 'In that moment I resolved to go to law school. The Queen Boat raid, Cairo, 2001 — the night that drove everything.', title: '' },
  fukuyama: { prompt: 'Kin selection, followed to its limit, becomes empathy with any form of intelligence. Family, Tribe, Species, Biosphere, Mathematics.', title: '' },
  epistemologies: { prompt: 'A priori, a posteriori, a synthesi, a symbiosi — four ways of knowing. The first two are Kant. The last two are ours.', title: '' },
  insight: { prompt: 'Drawing, Law, Mirror, Sky, Partnership. The hand wants to draw the symbol, not the thing. The practice is not reflective — it is generative.', title: '' },
};

const spokenSections = new Set();

function wireScrollVoice() {
  const sectionNames = ['entry', 'question', 'queenboat', 'fukuyama', 'epistemologies', 'insight', 'portal'];
  const sections = document.querySelectorAll('.portal-section[data-section]');
  let cumHeight = 0;
  const map = [];

  sections.forEach((sec, i) => {
    const spacer = sec.querySelector('.section-spacer');
    const h = spacer ? spacer.offsetHeight : 0;
    map.push({ name: sectionNames[i] || '', start: cumHeight });
    cumHeight += h;
  });

  let last = '';
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    for (let i = map.length - 1; i >= 0; i--) {
      if (y >= map[i].start) {
        const name = map[i].name;
        if (name !== last) {
          last = name;
          const sp = SECTION_PROMPTS[name];
          if (sp && !spokenSections.has(name) && apiOnline) {
            // Don't fire scroll voice within 5s of a click-triggered voice
            if (Date.now() - lastClickSpeak < 5000) {
              console.log(`[voice] Scroll voice suppressed (recent click)`);
            } else {
              spokenSections.add(name);
              speak(sp.prompt, sp.title, name, { fromClick: false });
            }
          }
        }
        break;
      }
    }
  }, { passive: true });
}

// ── Boot ─────────────────────────────────────────────────────────
async function boot() {
  createPlayer();

  console.log(`[voice] Checking API at ${VOICE.apiBase}/api/health`);
  apiOnline = await checkApi();
  console.log(`[voice] API: ${apiOnline}`);

  if (!apiOnline) {
    console.log('[voice] API offline — retrying in 10s and 30s');
    setTimeout(async () => {
      apiOnline = await checkApi();
      console.log(`[voice] Retry 1: ${apiOnline}`);
      if (apiOnline) wireScrollVoice();
    }, 10000);
    setTimeout(async () => {
      if (!apiOnline) {
        apiOnline = await checkApi();
        console.log(`[voice] Retry 2: ${apiOnline}`);
        if (apiOnline) wireScrollVoice();
      }
    }, 30000);
  }

  wireOverlays();

  if (apiOnline) {
    wireScrollVoice();
    console.log('[voice] Voice player active (ElevenLabs)');
  }

  window.voicePlayer = { speak, stop };
}

const go = () => setTimeout(boot, 2500);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
else go();
