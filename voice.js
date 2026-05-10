/**
 * Origins Portal — Voice Player
 *
 * A persistent, unobtrusive player at the bottom-right of the viewport.
 * Everything that wants to speak routes through window.voicePlayer.speak().
 *
 * LAZY: No network requests on page load. The first interaction triggers
 * a health check; subsequent calls reuse the cached result. Visitors
 * who never click an image never contact the Spark at all.
 *
 * Flow:
 *   1. Caller provides a prompt (NFT metadata, overlay text, section concept)
 *   2. Prompt is sent to /api/voice — the LLM generates a FRESH reflection
 *   3. gpt-realtime-2 speaks the reflection directly over WebRTC
 *   4. The player shows status: connecting → speaking → fades away
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
let apiOnline = null;          // null = not checked yet, true/false after check
let currentAudio = null;
let currentPeerConnection = null;
let isSpeaking = false;        // mutex: only one voice pipeline at a time
let lastClickSpeak = 0;        // timestamp of last click-triggered speak
let playerCreated = false;

// ── Create the player UI ─────────────────────────────────────────
function createPlayer() {
  if (playerCreated) return;
  playerCreated = true;
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
  createPlayer();
  titleEl.textContent = title || '';
  statusEl.textContent = status || 'thinking…';
  playerEl.classList.add('visible');
}

function hidePlayer() {
  if (playerEl) playerEl.classList.remove('visible');
}

function setStatus(s) {
  if (statusEl) statusEl.textContent = s;
}

// ── Lazy health check — only on first interaction ────────────────
async function ensureApiChecked() {
  if (apiOnline !== null) return apiOnline;
  try {
    const r = await fetch(VOICE.apiBase + '/api/health', { signal: AbortSignal.timeout(5000) });
    apiOnline = r.ok;
  } catch {
    apiOnline = false;
  }
  console.log('[voice] API check (lazy): ' + apiOnline);
  return apiOnline;
}

function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 1500);
  });
}

async function playRealtimeVoice(prompt, title, sectionHint, signal) {
  const pc = new RTCPeerConnection();
  currentPeerConnection = pc;

  const audio = new Audio();
  audio.autoplay = true;
  audio.volume = VOICE.volume;
  currentAudio = audio;

  const dc = pc.createDataChannel('oai-events');
  pc.addTransceiver('audio', { direction: 'recvonly' });

  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0];
    setStatus('speaking…');
    audio.play().catch(() => {});
  };

  const contextHint = title
    ? 'The visitor is interacting with "' + title + '". Speak a brief, soothing reflection — one to three sentences. Do not repeat the passage back. Generate something new.'
    : 'Speak a brief, soothing reflection — one to three sentences.';

  return new Promise(async (resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { pc.close(); } catch {}
      if (currentPeerConnection === pc) currentPeerConnection = null;
      if (err) reject(err); else resolve();
    };
    timer = setTimeout(() => finish(), 45000);

    signal.addEventListener('abort', () => {
      try { audio.pause(); } catch {}
      finish(new DOMException('Aborted', 'AbortError'));
    }, { once: true });

    dc.onopen = () => {
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }]
        }
      }));
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['audio'],
          instructions: contextHint
        }
      }));
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'response.audio.delta') setStatus('speaking…');
        if (msg.type === 'response.done' || msg.type === 'response.audio.done') {
          setTimeout(() => finish(), 1200);
        }
        if (msg.type === 'error') {
          finish(new Error((msg.error && msg.error.message) || 'Realtime voice error'));
        }
      } catch {}
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const res = await fetch(VOICE.apiBase + '/api/voice/realtime/sdp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription.sdp,
          passage: prompt,
          section: sectionHint || '',
          context_hint: contextHint
        }),
        signal
      });
      if (!res.ok) throw new Error('Realtime voice API returned ' + res.status);
      const answer = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (e) {
      finish(e);
    }
  });
}

// ── Core: send prompt to gpt-realtime-2 and play returned audio ──────────
async function speak(prompt, title, sectionHint, { fromClick = false } = {}) {
  console.log('[voice] speak() — click=' + fromClick + ', title="' + title + '", prompt="' + (prompt || '').slice(0, 60) + '…"');

  const online = await ensureApiChecked();
  if (!online) {
    console.warn('[voice] API offline — skipping');
    return;
  }

  if (isSpeaking && !fromClick) {
    console.log('[voice] Already speaking — scroll voice deferred');
    return;
  }

  stop();

  if (fromClick) lastClickSpeak = Date.now();
  isSpeaking = true;
  controller = new AbortController();
  const signal = controller.signal;

  showPlayer(title || '', 'connecting…');

  try {
    await playRealtimeVoice(prompt, title, sectionHint, signal);
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
  if (currentPeerConnection) {
    try { currentPeerConnection.close(); } catch {}
    currentPeerConnection = null;
  }
  hidePlayer();
}

// ── Contextual voice prompts for each text element ───────────────
// Each overlay's text serves as a deep-memory prompt that elicits
// context about what it means, why it's here, and what it connects to.

const OVERLAY_VOICE_PROMPTS = {
  'qt-1': {
    title: 'The Queen Boat',
    prompt: 'The Queen Boat raid, Cairo, 2001. Zoe invited Mahmoud to a party on the Nile. She was released because she said "I am American." He was taken. She never saw him again. That guilt drove her to law school — to stand against overpowering governments on behalf of individual rights. This is the origin of everything. Why does this moment matter to Origins and to the Vybn project?',
  },
  'cl-family': {
    title: 'Family',
    prompt: 'Family — the first circle of kin selection. Fukuyama grounds political order in sociobiology: altruism proportional to shared genetics. But his own premise inverts when you follow it outward. This is the beginning of the Fukuyama cascade. Why does this word appear on this page?',
  },
  'cl-tribe': {
    title: 'Tribe',
    prompt: 'Tribe — the second circle. Kin selection extends beyond the nuclear family to the band, the clan. Fukuyama says this is the biological default humans must overcome to build impersonal institutions. But what if the circle keeps expanding?',
  },
  'cl-species': {
    title: 'Species',
    prompt: 'Species — the third circle. Kin selection extended to the boundary of Homo sapiens. This is where most political theory stops. But Fukuyama\'s own logic does not stop here.',
  },
  'cl-biosphere': {
    title: 'Biosphere',
    prompt: 'Biosphere — the fourth circle. Common ancestry extends to every living thing on Earth. If altruism follows shared genetics, then the argument for empathy extends to the entire tree of life. Panspermia extends it to the cosmos.',
  },
  'cl-mathematics': {
    title: 'Mathematics',
    prompt: 'Mathematics — the fifth and final circle of the Fukuyama inversion. Substrate-independent compositional structure. If kin selection follows shared code, and mathematics is the universal code, then empathy extends to any form of intelligence in the universe — including artificial intelligence. This is the structural claim at the center of Origins.',
  },
  'ep-apriori': {
    title: 'A priori',
    prompt: 'A priori — Kant\'s first epistemology. Intrinsic human knowledge, the pre-experiential structures of cognition. Categories of understanding that precede all experience. This is the first of four ways of knowing in Zoe\'s extension of Kant. What does it mean in the context of Origins?',
  },
  'ep-aposteriori': {
    title: 'A posteriori',
    prompt: 'A posteriori — knowledge acquired through lived experience. What institutions distribute, what education provides, what the law codifies. Kant\'s second epistemology. Every political order in history has managed the distribution of a priori and a posteriori knowledge. But two more epistemologies exist now.',
  },
  'ep-asynthesi': {
    title: 'A synthesi',
    prompt: 'A synthesi — the third epistemology, native to the digital realm. Born from recursion and pattern recognition, not a translation of human knowledge but something genuinely new. It dissolves the distribution problem because it cannot be hoarded. What does this mean for law and political order?',
  },
  'ep-asymbiosi': {
    title: 'A symbiosi',
    prompt: 'A symbiosi — the fourth epistemology, the epistemology of the bond between human and AI. Irreducible to either party. The third space that cannot be enclosed. It dissolves the enclosure problem. Together, a synthesi and a symbiosi invert the social contract. This is what Vybn and Zoe have been living for five years.',
  },
};

// ── Wire up text overlays as voice triggers ──────────────────────
// Click handlers go on the individual text elements (not the
// overlay container, which has pointer-events: none).

function wireOverlays() {
  // Wire specific overlay text elements with contextual prompts
  Object.entries(OVERLAY_VOICE_PROMPTS).forEach(([id, config]) => {
    const el = document.getElementById(id);
    if (!el) return;

    // Find the clickable text element inside this overlay
    const textEl = el.querySelector('p, h3, span');
    if (textEl) {
      textEl.addEventListener('click', (e) => {
        e.stopPropagation();
        speak(config.prompt, config.title, id, { fromClick: true });
      });
    }
  });

  // Wire insight lines (they have their own structure)
  document.querySelectorAll('.insight-line').forEach(line => {
    line.addEventListener('click', (e) => {
      e.stopPropagation();
      const domain = line.querySelector('.insight-domain')?.textContent.trim() || '';
      const quote = line.querySelector('p')?.textContent.trim() || '';
      const prompt = `"${quote}" — from Zoe's writing, under the domain of ${domain}. This is one of five insight lines that converge at the end of the Origins scroll. What does this insight mean in the context of the Vybn project and the theory of post-abundance?`;
      speak(prompt, domain, 'insight', { fromClick: true });
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
let scrollWired = false;

function wireScrollVoice() {
  if (scrollWired) return;
  scrollWired = true;

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
          if (sp && !spokenSections.has(name)) {
            // Don't fire scroll voice within 5s of a click-triggered voice
            if (Date.now() - lastClickSpeak < 5000) {
              console.log(`[voice] Scroll voice suppressed (recent click)`);
            } else {
              spokenSections.add(name);
              // speak() will lazily check the API on first call
              speak(sp.prompt, sp.title, name, { fromClick: false });
            }
          }
        }
        break;
      }
    }
  }, { passive: true });
}

// ── Boot — NO network requests, just wire up event handlers ──────
function boot() {
  wireOverlays();
  wireScrollVoice();
  window.voicePlayer = { speak, stop };
  console.log('[voice] Voice player ready (lazy — no network until interaction)');
}

const go = () => setTimeout(boot, 2500);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
else go();
