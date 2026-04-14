/**
 * Origins Portal — Ambient Voice
 *
 * As the visitor scrolls through sections, the local LLM generates
 * reflections that are spoken aloud via the browser's speech synthesis.
 * No clicks. No panes. No UI. Just a voice arriving as you scroll —
 * or silence, if the API is offline. The site works perfectly without it.
 *
 * Architecture:
 *   1. Scroll enters a new section → POST /api/voice with passage + section
 *   2. Buffer the SSE stream, strip any remaining chain-of-thought
 *   3. Speak the cleaned text via SpeechSynthesis at low volume
 *   4. Fade out if the visitor scrolls past before it finishes
 *
 * If the API is unreachable or speech synthesis unavailable, nothing happens.
 * The scroll experience is complete on its own.
 */

const VOICE_CONFIG = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://spark-2b7c.tail7302f3.ts.net/api',
  timeoutMs: 45000,
  rate: 0.9,
  pitch: 1.0,
  volume: 0.7,
};

// ── State ────────────────────────────────────────────────────────
let apiAvailable = null;
let currentUtterance = null;
let currentController = null;
let spokenSections = new Set();

// Preferred voices — warm, clear, not robotic
const PREFERRED_VOICE_NAMES = [
  'Samantha', 'Karen', 'Daniel', 'Moira',      // macOS
  'Google UK English Female', 'Google US English', // Chrome
  'Microsoft Zira', 'Microsoft David',            // Windows
];

let selectedVoice = null;

function pickVoice() {
  if (selectedVoice) return selectedVoice;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Try preferred voices first
  for (const name of PREFERRED_VOICE_NAMES) {
    const v = voices.find(v => v.name.includes(name));
    if (v) { selectedVoice = v; return v; }
  }
  // Fall back to first English voice
  const english = voices.find(v => v.lang.startsWith('en'));
  if (english) { selectedVoice = english; return english; }
  selectedVoice = voices[0];
  return selectedVoice;
}

// Voices load async in some browsers
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => { selectedVoice = null; pickVoice(); };
}

// ── Section passages — what the LLM reflects on ─────────────────
// These are the actual text content from the scroll sections,
// sent as the "passage" to /api/voice. The model thinks about them
// from the corpus and speaks.
const SECTION_VOICE = {
  question: {
    passage: 'How do you distribute scarce things without killing each other — and what happens to that question when intelligence is no longer scarce?',
    section: 'question',
  },
  queenboat: {
    passage: 'In that moment I resolved to go to law school and become a lawyer, so that I might stand up against an over-powerful government on behalf of individual rights.',
    section: 'queenboat',
  },
  fukuyama: {
    passage: 'Kin selection followed to its limit becomes empathy with any form of intelligence. Family, Tribe, Species, Biosphere, Mathematics.',
    section: 'fukuyama',
  },
  epistemologies: {
    passage: 'A priori, a posteriori, a synthesi, a symbiosi — four ways of knowing. Kant drew the line between the first two. The digital realm dissolved it.',
    section: 'epistemologies',
  },
  insight: {
    passage: 'Drawing, Law, Mirror, Sky, Partnership. The hand wants to draw the symbol, not the thing. The practice is not reflective. It is generative.',
    section: 'insight',
  },
};

// ── Strip chain-of-thought from streamed text ────────────────────
function cleanVoiceText(text) {
  // Handle </think> boundary (Nemotron pattern)
  if (text.includes('</think>')) {
    text = text.split('</think>').pop().trim();
  }
  // Strip <think>...</think> blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Strip system references
  text = text
    .replace(/[Aa]ccording to the (system prompt|context|corpus)[,.]?\s*/g, '')
    .replace(/[Ff]rom the (corpus|context|deep memory)[,.]?\s*/g, '')
    .replace(/[Aa]s (instructed|specified)[,.]?\s*/g, '')
    .replace(/\s{2,}/g, ' ');
  return text.trim();
}

// ── Speak text via browser SpeechSynthesis ───────────────────────
function speak(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text) { resolve(); return; }

    // Cancel any current speech
    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = VOICE_CONFIG.rate;
    utterance.pitch = VOICE_CONFIG.pitch;
    utterance.volume = VOICE_CONFIG.volume;

    currentUtterance = utterance;

    utterance.onend = () => { currentUtterance = null; resolve(); };
    utterance.onerror = () => { currentUtterance = null; resolve(); };

    speechSynthesis.speak(utterance);
  });
}

function stopSpeaking() {
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
  }
  currentUtterance = null;
}

// ── Request voice for a section ──────────────────────────────────
async function voiceForSection(sectionName) {
  const config = SECTION_VOICE[sectionName];
  if (!config) return;

  // Abort any in-flight request
  if (currentController) currentController.abort();
  currentController = new AbortController();
  const signal = currentController.signal;

  const timeoutId = setTimeout(() => {
    if (currentController) currentController.abort();
  }, VOICE_CONFIG.timeoutMs);

  let fullContent = '';

  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passage: config.passage,
        section: config.section,
        context_hint: `Visitor is scrolling through the ${sectionName} section of the Origins portal.`,
      }),
      signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

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
          // Skip thinking heartbeats and rag_sources
          if (data.thinking || data.rag_sources) continue;
          if (data.content) fullContent += data.content;
        } catch (e) { /* skip non-JSON */ }
      }
    }

    if (signal.aborted) return;

    const voice = cleanVoiceText(fullContent);
    if (voice.length > 15) {
      console.log(`[voice] Speaking for ${sectionName}: "${voice.slice(0, 80)}..."`);
      await speak(voice);
    }

  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name !== 'AbortError') {
      console.log('[voice] Section voice failed:', e.message);
    }
  }
}

// ── Scroll-driven section detection ──────────────────────────────
const VOICE_SECTIONS = ['question', 'queenboat', 'fukuyama', 'epistemologies', 'insight'];

function onSectionEnter(sectionName) {
  if (!apiAvailable) return;
  if (spokenSections.has(sectionName)) return;
  if (!VOICE_SECTIONS.includes(sectionName)) return;

  spokenSections.add(sectionName);
  voiceForSection(sectionName);
}

function watchScroll() {
  const sectionNames = ['entry', 'question', 'queenboat', 'fukuyama', 'epistemologies', 'insight', 'portal'];
  const sections = document.querySelectorAll('.portal-section[data-section]');

  // Build a map of scroll positions to section names
  let cumulative = 0;
  const sectionMap = [];

  sections.forEach((section, i) => {
    const spacer = section.querySelector('.section-spacer');
    const height = spacer ? spacer.offsetHeight : 0;
    sectionMap.push({
      name: sectionNames[i] || 'unknown',
      start: cumulative,
      end: cumulative + height,
    });
    cumulative += height;
  });

  let lastSection = null;

  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    for (let i = sectionMap.length - 1; i >= 0; i--) {
      if (scrollTop >= sectionMap[i].start) {
        const name = sectionMap[i].name;
        if (name !== lastSection) {
          lastSection = name;
          // Stop current speech when scrolling to new section
          stopSpeaking();
          onSectionEnter(name);
        }
        break;
      }
    }
  }, { passive: true });
}

// ── Health check ─────────────────────────────────────────────────
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

// ── Boot ─────────────────────────────────────────────────────────
(function boot() {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) {
    console.log('[voice] SpeechSynthesis not available — ambient voice disabled');
    return;
  }

  function go() {
    setTimeout(async () => {
      apiAvailable = await checkApi();
      if (apiAvailable) {
        watchScroll();
        console.log('[voice] Ambient voice active (speech synthesis + API)');
      } else {
        console.log('[voice] API not reachable — ambient voice disabled');
        // Retry once after 15s
        setTimeout(async () => {
          apiAvailable = await checkApi();
          if (apiAvailable) {
            watchScroll();
            console.log('[voice] Ambient voice active (delayed)');
          }
        }, 15000);
      }
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
