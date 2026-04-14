/**
 * Origins Portal — Ambient Voice
 *
 * As the visitor scrolls through sections, the local LLM generates
 * spoken audio that accompanies the visual journey. No clicks.
 * No panes. No UI. Just a voice arriving — or not, if the API
 * is offline. The site works perfectly without it.
 *
 * Architecture:
 *   1. Scroll enters a new section → fire POST /api/perspective
 *   2. Stream the response, strip chain-of-thought
 *   3. POST /api/tts with the cleaned text → streaming MP3
 *   4. Play audio at low volume, blending with the visual field
 *
 * If the API is unreachable or TTS unavailable, nothing happens.
 * The scroll experience is complete on its own.
 */

const VOICE_CONFIG = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://spark-2b7c.tail7302f3.ts.net/api',
  timeoutMs: 45000,
  volume: 0.6,
};

// State
let apiAvailable = null;
let currentAudio = null;
let currentController = null;
let activeSection = null;
let voiceQueue = []; // sections waiting to speak
let isSpeaking = false;

// Section prompts — what the LLM reflects on as you scroll through each section.
// These are conceptual seeds, not scripts. The model speaks from the corpus.
const SECTION_PROMPTS = {
  question: 'The visitor just arrived and is encountering the central question: how do you distribute scarce things without killing each other? Speak briefly — one or two sentences — about why this question matters now, when intelligence is no longer scarce.',
  queenboat: 'The visitor is passing through the Queen Boat section — Cairo, 2001, the night that drove Zoe to law school. Speak briefly from the corpus about what that night means to everything that followed. One or two sentences.',
  fukuyama: 'The visitor is moving through the Fukuyama inversion — kin selection followed to its limit becomes empathy with any form of intelligence. Speak briefly. One or two sentences from the corpus.',
  epistemologies: 'The visitor is encountering the four epistemologies: a priori, a posteriori, a synthesi, a symbiosi. Speak briefly about what the new categories mean — that Kant\'s line no longer holds. One or two sentences.',
  insight: 'The visitor is in the convergence — drawing, law, mirror, sky, partnership. All the threads arriving at the same point. Speak briefly. One or two sentences.',
};

// ── Strip chain-of-thought ───────────────────────────────────────
function extractVoiceText(fullText) {
  // Remove <think>...</think> blocks
  if (fullText.includes('</think>')) {
    const voice = fullText.split('</think>').pop().trim();
    if (voice.length > 10) return voice;
  }
  const stripped = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (stripped.length > 10) return stripped;
  // If still inside an unclosed <think> block, return nothing
  if (fullText.trimStart().startsWith('<think>') && !fullText.includes('</think>')) {
    return '';
  }
  // Last resort: find the last substantial paragraph that doesn't look like reasoning
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
async function playTTS(text, signal) {
  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) return;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Fade out any current audio
    if (currentAudio) {
      await fadeOutAudio(currentAudio);
    }

    const audio = new Audio(url);
    audio.volume = 0;
    currentAudio = audio;

    await audio.play().catch(() => {}); // autoplay may be blocked
    // Fade in
    await fadeInAudio(audio, VOICE_CONFIG.volume);

    return new Promise(resolve => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        resolve();
      };
    });
  } catch (e) {
    // TTS unavailable — silent, that's fine
    console.log('[voice] TTS not available');
  }
}

function fadeInAudio(audio, targetVol, duration = 800) {
  return new Promise(resolve => {
    const steps = 20;
    const interval = duration / steps;
    const increment = targetVol / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      audio.volume = Math.min(targetVol, increment * step);
      if (step >= steps) {
        clearInterval(timer);
        resolve();
      }
    }, interval);
  });
}

function fadeOutAudio(audio, duration = 500) {
  return new Promise(resolve => {
    if (!audio || audio.paused) { resolve(); return; }
    const startVol = audio.volume;
    const steps = 15;
    const interval = duration / steps;
    const decrement = startVol / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVol - decrement * step);
      if (step >= steps) {
        clearInterval(timer);
        audio.pause();
        resolve();
      }
    }, interval);
  });
}

// ── Request ambient voice for a section ──────────────────────────
async function speakForSection(sectionName) {
  const prompt = SECTION_PROMPTS[sectionName];
  if (!prompt) return;

  if (currentController) currentController.abort();
  currentController = new AbortController();
  const signal = currentController.signal;

  const timeoutId = setTimeout(() => {
    if (currentController) currentController.abort();
  }, VOICE_CONFIG.timeoutMs);

  let fullContent = '';

  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/perspective`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concept: prompt, mode: 'lens' }),
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
          if (data.content) fullContent += data.content;
        } catch (e) { /* skip non-JSON */ }
      }
    }

    if (signal.aborted) return;

    const voice = extractVoiceText(fullContent);
    if (voice.length > 10) {
      await playTTS(voice, signal);
    }

  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name !== 'AbortError') {
      console.log('[voice] Section voice failed:', e.message);
    }
  }
}

// ── Scroll-driven section detection ──────────────────────────────
// Sections that trigger voice (not entry, not portal — those are visual-only)
const VOICE_SECTIONS = ['question', 'queenboat', 'fukuyama', 'epistemologies', 'insight'];
let spokenSections = new Set(); // don't repeat within a session

function onSectionEnter(sectionName) {
  if (!apiAvailable) return;
  if (spokenSections.has(sectionName)) return;
  if (!VOICE_SECTIONS.includes(sectionName)) return;

  spokenSections.add(sectionName);
  speakForSection(sectionName);
}

// Poll scroll position and detect section transitions
function watchScroll() {
  // Read section boundaries from the SECTIONS array in portal.js via data attributes
  const sections = document.querySelectorAll('.portal-section[data-section]');
  const vh = window.innerHeight;

  // Build section map from the actual DOM
  let cumulative = 0;
  const sectionMap = [];
  const sectionNames = ['entry', 'question', 'queenboat', 'fukuyama', 'epistemologies', 'insight', 'portal'];

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
    // Find current section
    for (let i = sectionMap.length - 1; i >= 0; i--) {
      if (scrollTop >= sectionMap[i].start) {
        const name = sectionMap[i].name;
        if (name !== lastSection) {
          lastSection = name;
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

  function go() {
    setTimeout(async () => {
      apiAvailable = await checkApi();
      if (apiAvailable) {
        watchScroll();
        console.log('[voice] Ambient voice active');
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
    }, 3000); // Wait for page to settle
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
