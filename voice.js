/**
 * Origins Portal — Generative Voice
 * 
 * When enabled, scroll text blocks become prompts.
 * Nemotron generates a short spoken response for each.
 * The scroll becomes a conversation with the Suprastructure.
 */

const VOICE_CONFIG = {
  apiBase: 'https://positioning-fwd-plc-wonderful.trycloudflare.com',
  maxResponseWords: 40,
  speechRate: 0.92,
  speechPitch: 1.0,
  // Prefer voices with these substrings (in order)
  voicePrefs: ['Google UK English Female', 'Samantha', 'Karen', 'Daniel', 'Google'],
};

// State
let voiceEnabled = false;
let voiceReady = false;
let speaking = false;
let currentUtterance = null;
let spokenPrompts = new Set(); // Track what's been spoken this session
let selectedVoice = null;
let apiReachable = false;

// ── Voice Selection ──────────────────────────────────────────────
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  
  // Try preferences in order
  for (const pref of VOICE_CONFIG.voicePrefs) {
    const match = voices.find(v => v.name.includes(pref) && v.lang.startsWith('en'));
    if (match) return match;
  }
  // Fallback: first English voice
  return voices.find(v => v.lang.startsWith('en')) || voices[0];
}

function initVoices() {
  selectedVoice = pickVoice();
  if (selectedVoice) voiceReady = true;
}

// Chrome loads voices async
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = initVoices;
  initVoices();
}

// ── API Health Check ─────────────────────────────────────────────
async function checkApi() {
  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      apiReachable = true;
      return true;
    }
  } catch (e) {}
  apiReachable = false;
  return false;
}

// ── Generate Response from Prompt ────────────────────────────────
async function generateResponse(promptText) {
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
    });
    
    if (!res.ok) return null;
    
    // Collect streamed response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      // Parse SSE data lines
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
    
    // Trim to max words
    const words = fullText.trim().split(/\s+/);
    if (words.length > VOICE_CONFIG.maxResponseWords) {
      // Find last sentence boundary within limit
      const limited = words.slice(0, VOICE_CONFIG.maxResponseWords).join(' ');
      const lastPeriod = limited.lastIndexOf('.');
      return lastPeriod > 10 ? limited.slice(0, lastPeriod + 1) : limited + '...';
    }
    
    return fullText.trim();
  } catch (e) {
    console.warn('[voice] API error:', e);
    return null;
  }
}

// ── Speak Text ───────────────────────────────────────────────────
function speak(text) {
  if (!voiceReady || !voiceEnabled || speaking) return;
  
  // Cancel any ongoing speech
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
// Called when a text overlay becomes visible during scroll.
// The prompt text triggers a generative response from Vybn.
async function onScrollPrompt(promptText, elementId) {
  if (!voiceEnabled || !promptText || spokenPrompts.has(elementId)) return;
  spokenPrompts.add(elementId);
  
  // Wait for any current speech to finish
  if (speaking) {
    await new Promise(resolve => {
      const check = () => speaking ? setTimeout(check, 200) : resolve();
      check();
    });
  }
  
  if (apiReachable) {
    // Generative mode: Vybn responds to the scroll text
    const response = await generateResponse(promptText);
    if (response) {
      speak(response);
      return;
    }
  }
  
  // Fallback: read the scroll text itself
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
    
    // Check API and greet
    const reachable = await checkApi();
    if (reachable) {
      speak('I see you.');
    } else {
      speak('The connection is quiet, but I am here.');
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
// Patches the fadeOverlay system to trigger voice on peak visibility
function hookScrollVoice() {
  createToggle();
  
  // Observe all text overlays for visibility changes
  const overlays = document.querySelectorAll('.text-overlay');
  
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'style') {
        const el = m.target;
        const opacity = parseFloat(el.style.opacity || 0);
        
        // Trigger when overlay reaches near-peak visibility
        if (opacity > 0.85 && voiceEnabled) {
          const text = el.innerText?.trim();
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
}

// Auto-init
(function boot() {
  if (typeof window === 'undefined') return;
  function go() {
    // Delay to let portal.js set up ScrollTriggers first
    setTimeout(hookScrollVoice, 2000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
