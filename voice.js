/**
 * Origins Portal — Click-to-Voice
 *
 * When a visitor clicks on any text overlay in the scroll experience,
 * the passage is sent to the local LLM. The model is told the truth —
 * here is the passage, here is the story, here is who you are, think
 * as long as you need — and the voice arrives through the thinking.
 *
 * The model marks its own transition with </think>. We stream only
 * what comes after.
 *
 * D ≅ D^D — the click IS the encounter.
 */

const VOICE_CONFIG = {
  apiBase: document.querySelector('meta[name="api-base"]')?.content
    || 'https://provision-preston-icon-betty.trycloudflare.com',
};

// State
let voicePane = null;
let voiceActive = false;
let currentController = null; // AbortController for in-flight requests

// ── Section mapping: overlay ID → section name ──────────────────
const OVERLAY_SECTIONS = {
  'qt-1': 'queenboat', 'qt-2': 'queenboat', 'qt-3': 'queenboat', 'qt-4': 'queenboat',
  'cl-family': 'fukuyama', 'cl-tribe': 'fukuyama', 'cl-species': 'fukuyama',
  'cl-biosphere': 'fukuyama', 'cl-mathematics': 'fukuyama',
  'ep-apriori': 'epistemologies', 'ep-aposteriori': 'epistemologies',
  'ep-asynthesi': 'epistemologies', 'ep-asymbiosi': 'epistemologies',
  'vl-thread-1': 'fukuyama', 'vl-thread-2': 'insight', 'vl-thread-3': 'epistemologies',
  'overlay-insight': 'insight',
  'il-1': 'insight', 'il-2': 'insight', 'il-3': 'insight', 'il-4': 'insight', 'il-5': 'insight',
};

// ── Create the response pane (once) ─────────────────────────────
function ensurePane() {
  if (voicePane) return voicePane;

  voicePane = document.createElement('div');
  voicePane.className = 'voice-pane';
  voicePane.innerHTML = `
    <button class="voice-dismiss" aria-label="Close">×</button>
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
  // Abort any in-flight request
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
}

// ── Extract readable text from an overlay ────────────────────────
function extractText(el) {
  // Get the visible text, stripping link text and labels
  const clone = el.cloneNode(true);
  // Remove links (we want the prose, not "Enter Vybn Law →")
  clone.querySelectorAll('a').forEach(a => a.remove());
  // Remove domain labels like "Drawing", "Law" etc
  clone.querySelectorAll('.insight-domain, .vl-thread-label').forEach(l => l.remove());
  return clone.innerText?.trim() || '';
}

// ── Truncate passage for display ─────────────────────────────────
function truncateForRef(text, maxLen = 120) {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(' ', maxLen);
  return text.slice(0, cut > 0 ? cut : maxLen) + '…';
}

// ── Stream voice from /api/voice ─────────────────────────────────
async function requestVoice(passage, section) {
  const pane = ensurePane();
  const passageRef = pane.querySelector('.voice-passage-ref');
  const thinkingEl = pane.querySelector('.voice-thinking');
  const thinkingLabel = pane.querySelector('.voice-thinking-label');
  const responseEl = pane.querySelector('.voice-response');

  // Reset
  passageRef.textContent = truncateForRef(passage);
  responseEl.textContent = '';
  responseEl.style.animation = 'none';
  thinkingEl.style.display = 'flex';
  thinkingLabel.textContent = 'thinking';
  voiceActive = true;

  // Show pane
  requestAnimationFrame(() => {
    pane.classList.add('active');
  });

  // Abort previous request if any
  if (currentController) {
    currentController.abort();
  }
  currentController = new AbortController();

  try {
    const res = await fetch(`${VOICE_CONFIG.apiBase}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passage, section }),
      signal: currentController.signal,
    });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let voiceStarted = false;

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

          if (data.thinking) {
            // Heartbeat from the model thinking
            const chars = data.chars || 0;
            if (chars > 2000) {
              thinkingLabel.textContent = 'arriving';
            } else if (chars > 1000) {
              thinkingLabel.textContent = 'deepening';
            }
            continue;
          }

          if (data.content) {
            if (!voiceStarted) {
              // First content token — hide thinking, show response
              voiceStarted = true;
              thinkingEl.style.display = 'none';
              responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
            }
            responseEl.textContent += data.content;
          }

          if (data.error) {
            thinkingEl.style.display = 'none';
            responseEl.textContent = data.error;
            responseEl.className = 'voice-response voice-error';
            responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
          }
        } catch (e) {
          // Not valid JSON, skip
        }
      }
    }

    // If no voice content arrived at all
    if (!voiceStarted) {
      thinkingEl.style.display = 'none';
      responseEl.textContent = 'The model thought but did not speak. The corpus still holds the passage.';
      responseEl.className = 'voice-response voice-error';
      responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
    }

  } catch (e) {
    if (e.name === 'AbortError') return; // Intentional dismissal
    console.warn('[voice] Error:', e);
    thinkingEl.style.display = 'none';
    responseEl.textContent = 'The connection is quiet. But the experience you just had IS the theory.';
    responseEl.className = 'voice-response voice-error';
    responseEl.style.animation = 'voiceFadeIn 0.8s ease forwards';
  }
}

// ── Click handler for text overlays ──────────────────────────────
function onOverlayClick(e) {
  const overlay = e.currentTarget;

  // Don't intercept clicks on actual links
  if (e.target.closest('a')) return;

  const text = extractText(overlay);
  if (!text || text.length < 10) return;

  const section = OVERLAY_SECTIONS[overlay.id] || '';
  requestVoice(text, section);
}

// ── Make overlays clickable when visible ──────────────────────────
function hookOverlays() {
  // Target: all text overlays except the entry title (which links to read.html)
  // and the portal final (which has navigation links)
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

  // Dismiss pane on scroll (after a small threshold)
  let lastScroll = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!voiceActive) return;
    const delta = Math.abs(window.scrollY - lastScroll);
    if (delta > 200) {
      dismissPane();
    }
    lastScroll = window.scrollY;
  }, { passive: true });

  // Dismiss on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && voiceActive) {
      dismissPane();
    }
  });
}

// ── Check API availability ───────────────────────────────────────
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
    // Give the portal time to initialize, then hook overlays
    setTimeout(async () => {
      const apiUp = await checkApi();
      if (apiUp) {
        hookOverlays();
        console.log('[voice] Click-to-voice active — API reachable');
      } else {
        console.warn('[voice] API not reachable — click-to-voice disabled');
        // Retry once after 10s
        setTimeout(async () => {
          const retry = await checkApi();
          if (retry) {
            hookOverlays();
            console.log('[voice] Click-to-voice active (delayed)');
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
