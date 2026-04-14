/**
 * Origins Portal — Voice Player
 *
 * A persistent, unobtrusive player at the bottom-right of the viewport.
 * Everything that wants to speak routes through window.voicePlayer.speak().
 *
 * Flow:
 *   1. Caller provides a prompt (NFT metadata, overlay text, section concept)
 *   2. Prompt is sent to /api/voice as the "passage" — the LLM generates
 *      a FRESH reflection, not a recitation
 *   3. The LLM's response is spoken via browser SpeechSynthesis
 *   4. The player shows status: thinking → speaking → fades away
 *
 * If the API is offline, the player stays hidden. No fallback reading.
 * The site works perfectly in silence.
 */

const VOICE = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://spark-2b7c.tail7302f3.ts.net/api',
  rate: 0.92,
  volume: 0.75,
};

let playerEl = null;
let statusEl = null;
let titleEl = null;
let closeBtn = null;
let controller = null;
let apiOnline = null;
let selectedVoice = null;

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

// ── Voice selection ──────────────────────────────────────────────
function pickVoice() {
  if (selectedVoice) return selectedVoice;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  for (const name of ['Samantha', 'Karen', 'Daniel', 'Moira', 'Google UK English Female', 'Google US English']) {
    const v = voices.find(v => v.name.includes(name));
    if (v) { selectedVoice = v; return v; }
  }
  selectedVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
  return selectedVoice;
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => { selectedVoice = null; pickVoice(); };
}

// ── Speak via browser synthesis ──────────────────────────────────
function browserSpeak(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !text) { resolve(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = VOICE.rate;
    u.volume = VOICE.volume;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
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

// ── Core: send prompt to LLM, speak the result ───────────────────
async function speak(prompt, title, sectionHint) {
  console.log(`[voice] speak() called — api=${apiOnline}, title="${title}", hint="${sectionHint}", prompt="${(prompt||'').slice(0,80)}..."`);
  if (!apiOnline) {
    console.warn('[voice] API offline — skipping');
    return;
  }

  stop(); // cancel anything in progress

  controller = new AbortController();
  const signal = controller.signal;

  showPlayer(title || '', 'thinking…');

  let full = '';

  try {
    const voiceUrl = `${VOICE.apiBase}/api/voice`;
    const body = {
      passage: prompt,
      section: sectionHint || '',
      context_hint: title
        ? `The visitor is interacting with "${title}". Speak a brief, soothing reflection — one to three sentences. Do not repeat the passage back. Generate something new.`
        : 'Speak a brief, soothing reflection — one to three sentences.',
    };
    console.log(`[voice] POST ${voiceUrl}`, body);

    const res = await fetch(voiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    console.log(`[voice] Response status: ${res.status}`);
    if (!res.ok) { console.warn(`[voice] Bad response: ${res.status}`); hidePlayer(); return; }

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
        } catch {}
      }
    }

    if (signal.aborted) return;

    const voice = clean(full);
    console.log(`[voice] Full response (${full.length} chars), cleaned (${voice.length} chars): "${voice.slice(0, 120)}..."`);
    if (voice.length < 10) { console.warn('[voice] Response too short, skipping'); hidePlayer(); return; }

    setStatus('speaking…');
    console.log('[voice] Starting SpeechSynthesis...');
    await browserSpeak(voice);
    console.log('[voice] SpeechSynthesis finished');

  } catch (e) {
    if (e.name !== 'AbortError') console.log('[voice] Error:', e.message);
  } finally {
    hidePlayer();
    controller = null;
  }
}

function stop() {
  controller?.abort();
  controller = null;
  speechSynthesis?.cancel?.();
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
// Every .text-overlay that isn't a link becomes a voice trigger.
function wireOverlays() {
  document.querySelectorAll('.text-overlay').forEach(overlay => {
    // Skip the portal gate (has actual links) and the entry title
    if (overlay.id === 'overlay-portal' || overlay.id === 'overlay-entry') return;

    overlay.style.cursor = 'default'; // not pointer — it's content, not a button
    overlay.addEventListener('click', () => {
      const text = overlay.textContent.trim();
      if (text.length < 5) return;

      // Use the overlay's heading or domain label as the title
      const heading = overlay.querySelector('h3, .insight-domain');
      const title = heading ? heading.textContent.trim() : '';

      speak(text, title, overlay.id || '');
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
            spokenSections.add(name);
            speak(sp.prompt, sp.title, name);
          }
        }
        break;
      }
    }
  }, { passive: true });
}

// ── Boot ─────────────────────────────────────────────────────────
async function boot() {
  if (!('speechSynthesis' in window)) {
    console.log('[voice] No SpeechSynthesis — voice disabled');
    return;
  }

  createPlayer();

  // Check API
  console.log(`[voice] Checking API at ${VOICE.apiBase}/api/health`);
  apiOnline = await checkApi();
  console.log(`[voice] API check result: ${apiOnline}`);
  if (!apiOnline) {
    console.log('[voice] API offline — retrying in 10s and 30s');
    setTimeout(async () => {
      apiOnline = await checkApi();
      console.log(`[voice] Retry 1: ${apiOnline}`);
      if (apiOnline) {
        wireScrollVoice();
      }
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
    console.log('[voice] Voice player active');
  }

  // Expose globally so gallery.js and anything else can trigger voice
  window.voicePlayer = { speak, stop };
}

const go = () => setTimeout(boot, 2500); // wait for page to settle
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
else go();
