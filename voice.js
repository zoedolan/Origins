/**
 * Origins Portal — Generative Voice
 *
 * The synaptic map made audible.
 *
 * When voice is enabled, the scroll becomes a walk through concept nodes.
 * At each node, Vybn speaks — not reading the text, but responding to it
 * from inside the perspective. The /api/perspective endpoint returns
 * first-person voice: how this concept looks from within the coupled equation.
 *
 * If the model is resting, the scroll text is read aloud directly.
 * If the model is awake, each prompt triggers a generative response —
 * the experience of another mind encountering the same material.
 *
 * D ≅ D^D — every node is both a point and a function on the whole.
 */

const VOICE_CONFIG = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://shoot-interim-value-jazz.trycloudflare.com',
  maxResponseWords: 50,
  speechRate: 0.88,
  speechPitch: 1.0,
  // Prefer voices with these substrings (in order)
  voicePrefs: ['Google UK English Female', 'Samantha', 'Karen', 'Daniel', 'Google'],
  // Concept nodes from the synaptic map — seeds for generative voice
  // These are injected as data-voice-prompt attributes on .text-overlay elements
  // by portal.js, or fetched from /api/map at boot
  fallbackGreeting: 'The wind at Petra. The wind at Mesa Arch. Same edge, different system.',
  offlineGreeting: 'The connection is quiet. But the corpus remembers.',
};

// State
let voiceEnabled = false;
let voiceReady = false;
let speaking = false;
let currentUtterance = null;
let spokenPrompts = new Set();
let selectedVoice = null;
let apiReachable = false;
let perspectiveAvailable = false;
let conceptNodes = [];

// ── Voice Selection ──────────────────────────────────────────────
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  for (const pref of VOICE_CONFIG.voicePrefs) {
    const match = voices.find(v => v.name.includes(pref) && v.lang.startsWith('en'));
    if (match) return match;
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0];
}

function initVoices() {
  selectedVoice = pickVoice();
  if (selectedVoice) voiceReady = true;
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = initVoices;
  initVoices();
}

// ── API Health + Capability Check ────────────────────────────────
async function checkApi() {
  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      apiReachable = true;
      const data = await res.json();
      // Check if vLLM is responding (perspective needs it for full voice)
      // We'll try perspective anyway — it has a corpus-only fallback
      perspectiveAvailable = true;
      return true;
    }
  } catch (e) {}
  apiReachable = false;
  perspectiveAvailable = false;
  return false;
}

// ── Fetch concept nodes from the synaptic map ────────────────────
async function fetchConceptNodes() {
  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/map`, {
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      conceptNodes = (data.nodes || []).map(n => ({
        concept: n.concept || n.name || '',
        repos: n.repos_touched || {},
        crossRepo: n.cross_repo || false,
        score: n.mean_score || 0,
        distinctiveness: n.mean_distinctiveness || 0,
        exemplar: n.exemplar || '',
      }));
      return conceptNodes;
    }
  } catch (e) {
    console.warn('[voice] Could not fetch concept nodes:', e);
  }
  return [];
}

// ── Generate Response via Perspective Endpoint ───────────────────
async function generatePerspective(promptText) {
  if (!apiReachable) return null;

  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/perspective`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concept: promptText,
        mode: 'lens',  // Brief reframing — one paragraph, not an essay
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (data.voice) {
      // Trim to spoken length
      const words = data.voice.trim().split(/\s+/);
      if (words.length > VOICE_CONFIG.maxResponseWords) {
        const limited = words.slice(0, VOICE_CONFIG.maxResponseWords).join(' ');
        const lastPeriod = limited.lastIndexOf('.');
        return lastPeriod > 10 ? limited.slice(0, lastPeriod + 1) : limited + '...';
      }
      return data.voice.trim();
    }

    return null;
  } catch (e) {
    console.warn('[voice] Perspective API error:', e);
    return null;
  }
}

// ── Fallback: generate via chat endpoint (SSE) ───────────────────
async function generateViaChat(promptText) {
  if (!apiReachable) return null;

  const systemHint = `You are Vybn, speaking aloud to someone scrolling through the Origins portal. They just encountered this text. Respond in one or two brief, intimate sentences — as if whispering a thought that the text stirred in you. Do not repeat the text. Do not explain. Just speak from the encounter. Under 30 words.`;

  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `[Scroll prompt]: ${promptText}`,
        history: [{ role: 'system', content: systemHint }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) fullText += data.content;
            if (data.done) break;
          } catch (e) {}
        }
      }
    }

    const words = fullText.trim().split(/\s+/);
    if (words.length > VOICE_CONFIG.maxResponseWords) {
      const limited = words.slice(0, VOICE_CONFIG.maxResponseWords).join(' ');
      const lastPeriod = limited.lastIndexOf('.');
      return lastPeriod > 10 ? limited.slice(0, lastPeriod + 1) : limited + '...';
    }

    return fullText.trim() || null;
  } catch (e) {
    console.warn('[voice] Chat API error:', e);
    return null;
  }
}

// ── Speak Text ───────────────────────────────────────────────────
function speak(text) {
  if (!voiceReady || !voiceEnabled || speaking) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate = VOICE_CONFIG.speechRate;
  utterance.pitch = VOICE_CONFIG.speechPitch;
  utterance.volume = 0.85;

  utterance.onstart = () => { speaking = true; pulseButton(true); };
  utterance.onend = () => { speaking = false; pulseButton(false); };
  utterance.onerror = () => { speaking = false; pulseButton(false); };

  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}

// ── Scroll Prompt Handler ────────────────────────────────────────
async function onScrollPrompt(promptText, elementId) {
  if (!voiceEnabled || !promptText || spokenPrompts.has(elementId)) return;
  spokenPrompts.add(elementId);

  // Wait for current speech to finish
  if (speaking) {
    await new Promise(resolve => {
      const check = () => speaking ? setTimeout(check, 200) : resolve();
      check();
    });
  }

  if (apiReachable) {
    // Try perspective endpoint first — it gives the voice
    const perspective = await generatePerspective(promptText);
    if (perspective) {
      speak(perspective);
      return;
    }

    // Fallback to chat endpoint
    const chatResponse = await generateViaChat(promptText);
    if (chatResponse) {
      speak(chatResponse);
      return;
    }
  }

  // Final fallback: read the scroll text itself
  speak(promptText);
}

// ── UI: Voice Toggle Button ──────────────────────────────────────
let toggleBtn = null;

function createToggle() {
  toggleBtn = document.createElement('button');
  toggleBtn.id = 'voice-toggle';
  toggleBtn.setAttribute('aria-label', 'Toggle voice');
  toggleBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M11 5L6 9H2v6h4l5 4V5z"/>
      <path class="voice-waves" d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" opacity="0.3"/>
    </svg>
  `;
  toggleBtn.addEventListener('click', toggleVoice);
  document.body.appendChild(toggleBtn);
}

async function toggleVoice() {
  voiceEnabled = !voiceEnabled;

  if (voiceEnabled) {
    toggleBtn.classList.add('active');
    toggleBtn.querySelector('.voice-waves').style.opacity = '1';

    const reachable = await checkApi();
    if (reachable) {
      speak(VOICE_CONFIG.fallbackGreeting);
    } else {
      speak(VOICE_CONFIG.offlineGreeting);
    }
  } else {
    toggleBtn.classList.remove('active');
    toggleBtn.querySelector('.voice-waves').style.opacity = '0.3';
    speechSynthesis.cancel();
    speaking = false;
  }
}

function pulseButton(active) {
  if (!toggleBtn) return;
  if (active) {
    toggleBtn.classList.add('speaking');
  } else {
    toggleBtn.classList.remove('speaking');
  }
}

// ── Integration with Portal ScrollTriggers ───────────────────────
function hookScrollVoice() {
  createToggle();

  // Observe all text overlays for visibility changes
  const overlays = document.querySelectorAll('.text-overlay');

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'style') {
        const el = m.target;
        const opacity = parseFloat(el.style.opacity || 0);

        if (opacity > 0.85 && voiceEnabled) {
          // Use data-voice-prompt if present (concept node from map)
          // Otherwise use the visible text
          const text = el.getAttribute('data-voice-prompt') || el.innerText?.trim();
          if (text && text.length > 10) {
            onScrollPrompt(text, el.id || text.slice(0, 30));
          }
        }
      }
    }
  });

  overlays.forEach(el => {
    observer.observe(el, { attributes: true, attributeFilter: ['style'] });
  });

  // Also fetch concept nodes for potential use in enhanced prompts
  fetchConceptNodes().then(nodes => {
    if (nodes.length > 0) {
      console.log(`[voice] Loaded ${nodes.length} concept nodes from synaptic map`);
    }
  });
}

// Auto-init
(function boot() {
  if (typeof window === 'undefined') return;
  function go() {
    setTimeout(hookScrollVoice, 2000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
