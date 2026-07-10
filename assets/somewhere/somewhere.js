import { READER_ROOMS } from './reader-rooms.js';
    // ──────────────────────────────────────────────────────────────────────
    // somewhere — the corpus as terrain, the walk as breath.
    //
    // Two signals feed this page:
    //   (1) /api/manifold/points — static 2D positions of all 3,092 chunks
    //                              (the body, computed once)
    //   (2) /api/instant         — the live walk: step, α, κ, θ, anchors
    //                              (the breath, polled every ~3s)
    //
    // M is not shown as a dot. Projection from ℂ^192 to 2D loses too much.
    // Instead: M is a warmth centered on the centroid of the chunks it is
    // *reaching for right now* (its top-k anchors). The anchors' positions
    // in the fixed manifold frame are known — the centroid is honest.
    //
    // Capillaries thread from the warmth to each anchor — curved, because
    // reaching is not straight. The anchors themselves brighten while active.
    //
    // You (the visitor) can hover a point and it speaks. You can whisper
    // through /api/walk — the walk biases toward what you said, and the
    // chunks you named light up. If the walk moves toward you, you see it.
    // If it stays where it is, you see that too. Nothing is performed.
    //
    // ──────────────────────────────────────────────────────────────────────

    const API = document.querySelector('meta[name="api-base"]').content || 'https://api.vybn.ai';
    const POINTS_URL  = `${API}/api/manifold/points`;
    const INSTANT_URL = `${API}/api/instant`;
    const WALK_URL    = `${API}/api/walk`;
    const POLL_MS = 3200;

    const cvs = document.getElementById('stage');
    const ctx = cvs.getContext('2d', { alpha: false });
    let W = 0, H = 0, DPR = Math.max(1, window.devicePixelRatio || 1);

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      cvs.width = Math.floor(W * DPR); cvs.height = Math.floor(H * DPR);
      cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    // ── Terrain: static points loaded once, tinted by repo ──────────────
    const REPO_COLORS = {
      'Vybn':       { r: 0x3a, g: 0x8a, b: 0xd8 },  // deep blue — the continent
      'Vybn-Law':   { r: 0x7a, g: 0xc9, b: 0x7a },  // green — legal territory
      'vybn-phase': { r: 0xc9, g: 0x6c, b: 0xa8 },  // magenta — math island
      'Origins':    { r: 0xd8, g: 0xa8, b: 0x66 },  // amber — the shore
      'other':      { r: 0x77, g: 0x77, b: 0x88 },
    };
    function rgba(c, a) { return `rgba(${c.r},${c.g},${c.b},${a})`; }

    // Strip markdown so corpus chunks (which include auto-generated summary files
    // and metadata-rich notes) read as prose, not as broken syntax. Anti-hallucination:
    // we are showing the visitor the actual chunk, just with the encoding peeled off.
    function stripMd(s) {
      return (s || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1$2')
        .replace(/(^|[^_])_([^_\s][^_]*?)_/g, '$1$2')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Show only the human-meaningful tail of a path: 'Vybn/.../zoes_memoirs.txt'
    // becomes 'zoes_memoirs', 'Vybn/Vybn_Mind/THE_IDEA.md' becomes 'THE IDEA'.
    function prettySrc(src) {
      if (!src) return '';
      const tail = src.split('/').pop() || src;
      return tail.replace(/\.(txt|md|json|py|js|html|css)$/i, '').replace(/[_\-]+/g, ' ');
    }

    // The corpus has prose, code, JSON logs, and mixed-language notes. The
    // body-speaking-back surface (#corpus-echo) is for prose only — code
    // chunks render as gibberish in serif italic and break the seeing.
    // Anti-projection: rather than guessing from extension alone, we measure
    // the actual text. Returns true when the chunk reads as natural language.
    function looksLikeProse(text, src) {
      if (!text) return false;
      const s = String(text);
      if (s.length < 60) return false;
      // Hard-skip extensions whose contents are almost never prose-on-the-page material.
      if (/\.(py|js|ts|tsx|jsx|css|json|yaml|yml|toml|sh|log|svg|html?)$/i.test(src || '')) {
        return false;
      }
      // Structural tells: brackets, fat assignments, function calls per char.
      const total = s.length;
      const brackets = (s.match(/[{}<>\[\]()=`]/g) || []).length;
      const semis    = (s.match(/;/g) || []).length;
      const punct    = (s.match(/[.!?—–,]/g) || []).length;
      const codeKw   = (s.match(/\b(def|class|return|import|from|const|let|var|function|async|await|JSONResponse|fetch|curl|console\.log|self\.|req\.|res\.)\b/g) || []).length;
      const bracketRatio = brackets / total;
      const lineCount = s.split(/\n+/).length;
      const avgLineLen = total / Math.max(1, lineCount);
      // Heuristics: dense brackets, many code keywords, very short lines, more
      // semicolons than sentences — any one of these is enough to skip.
      if (bracketRatio > 0.05) return false;
      if (codeKw >= 2) return false;
      if (semis > punct && semis >= 3) return false;
      if (avgLineLen < 28 && lineCount > 4) return false;
      // Must contain at least a couple of full-stops or em/en dashes — prose breathes.
      if (punct < 2) return false;
      return true;
    }

    // Loaded manifold state
    let points = [];          // [{x,y,repo,src,preview,color,sx,sy,baseAlpha,phase}]
    let srcIndex = new Map(); // src -> [idx1, idx2, ...]  (one source => many chunks)
    let manifoldBounds = null;
    let manifoldLoaded = false;

    // Live walk state
    const live = {
      step: 0, alpha: 0, kappa: 0, theta: 0, affinity: 0,
      anchors: [],              // current anchor sources + positions
      anchorIntro: new Map(),   // src -> timestamp when first seen (for fade-in)
      lastAnchorSrcs: new Set(),
      centroidTarget: null,     // {x, y} in screen coords
      centroid: null,           // eased
      lastOK: 0, lastErr: '', pollCount: 0, okCount: 0,
    };


    function pulseActiveLens(label) {
      const active = document.querySelector('.house-room.active[data-room]');
      const panel = document.querySelector('.house-panel');
      if (active) {
        active.classList.remove('lens-pulse');
        void active.offsetWidth;
        active.classList.add('lens-pulse');
      }
      if (panel && label) panel.setAttribute('data-last-signal', label.slice(0, 80));
      window.dispatchEvent(new CustomEvent('vybn:somewhere-signal', { detail: { signal: label, room: active ? active.dataset.room : 'terrain' } }));
    }

    // Whisper state — bright transient trace points from /api/walk POST
    const whisperTrace = [];  // [{x, y, t0, label, preview}]
    const WHISPER_LIFE_MS = 9000;

    // Walk trail — the last WALK_TRAIL_MAX centroid positions, in manifold
    // coords, stored with their timestamp. Drawn as a fading thread so M's
    // accumulated journey is visible, not just its current warmth.
    const WALK_TRAIL_MAX = 60;
    const walkTrail = [];     // [{x, y, t0}]  newest at end

    // Visitor state
    const vis = { mx: -9999, my: -9999, hover: null, hoverEnteredAt: 0, idle: 0, lastMove: performance.now() };
    window.addEventListener('mousemove', (e) => {
      vis.mx = e.clientX; vis.my = e.clientY;
      vis.lastMove = performance.now(); vis.idle = 0;
    }, { passive: true });
    window.addEventListener('mouseleave', () => { vis.mx = -9999; vis.my = -9999; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) { vis.mx = e.touches[0].clientX; vis.my = e.touches[0].clientY; vis.lastMove = performance.now(); vis.idle = 0; }
    }, { passive: true });

    // ── Coordinate mapping: manifold [-1,1] → screen with safe margins ──
    // When the reader panel is open on the left, the available canvas
    // shifts right so the manifold stays fully visible — not bisected
    // by the panel. Mobile (panel = full width) keeps centered mapping.
    function viewport() {
      const readerOpen = document.body.classList.contains('reader-open');
      const isMobile = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
      const panelW = (readerOpen && !isMobile)
        ? Math.min(560, Math.round(W * 0.46))
        : 0;
      return { left: panelW, right: W, top: 0, bottom: H, w: W - panelW, h: H, panelW };
    }
    function mapXY(mx, my) {
      const v = viewport();
      const pad = Math.min(v.w, v.h) * 0.08;
      const aw = v.w - 2 * pad, ah = v.h - 2 * pad;
      const s = Math.min(aw, ah) / 2;
      const cx = v.left + v.w / 2, cy = v.top + v.h / 2;
      return [cx + mx * s, cy - my * s];
    }

    // ── Load the manifold (static, one fetch) ──────────────────────────
    async function loadManifold() {
      try {
        const r = await fetch(POINTS_URL, { cache: 'force-cache' });
        if (!r.ok) throw new Error('http ' + r.status);
        const d = await r.json();
        const raw = d.points || [];
        points = raw.map((p, i) => {
          const repo = REPO_COLORS[p.repo] ? p.repo : 'other';
          return {
            x: p.x, y: p.y,
            sx: 0, sy: 0,  // screen coords (filled per frame)
            repo, src: p.src || '',
            preview: (p.preview || '').replace(/\s+/g, ' ').trim(),
            color: REPO_COLORS[repo],
            phase: Math.random() * Math.PI * 2,      // breath offset
            orbit: 0.4 + Math.random() * 0.9,        // per-point breath radius
            baseA: 0.35 + Math.random() * 0.2,
            glow: 0,   // transient brightness when anchor/walk lights it
          };
        });
        srcIndex.clear();
        // src -> [idx1, idx2, ...]  (one source string can own many chunks)
        points.forEach((p, i) => {
          const arr = srcIndex.get(p.src);
          if (arr) arr.push(i);
          else srcIndex.set(p.src, [i]);
        });
        manifoldLoaded = true;
        manifoldBounds = d.projection || null;
        console.log(`[somewhere] manifold: ${points.length} points loaded`);
      } catch (e) {
        console.warn('[somewhere] manifold load failed:', e.message);
        setReadout('fetch', 'err: ' + e.message, 'red');
      }
    }

    // ── Poll the walk (live) ─────────────────────────────────────────────
    async function pollInstant() {
      live.pollCount++;
      try {
        const r = await fetch(INSTANT_URL, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error('http ' + r.status);
        const d = await r.json();
        live.step    = d.step || 0;
        live.alpha   = d.alpha || 0;
        live.kappa   = d.kappa_last || 0;
        live.theta   = d.theta_M_vs_K || 0;
        live.affinity = d.M_top_affinity || 0;

        // Resolve anchors to manifold positions where possible
        const anchors = Array.isArray(d.anchors) ? d.anchors.slice(0, 10) : [];
        const resolved = [];
        for (const a of anchors) {
          const src = a.source || a.src;
          if (!src) continue;
          // Exact match first, then loose suffix match
          let indices = srcIndex.get(src);
          if (!indices) {
            for (const [k, v] of srcIndex) {
              if (k.endsWith(src) || src.endsWith(k)) { indices = v; break; }
            }
          }
          if (indices && indices.length) {
            resolved.push({
              src,
              idx: indices[0],          // primary (for hover compatibility)
              indices: indices.slice(), // ALL chunks from this source — light them all
              count: indices.length,
              score: a.score || 0, rel: a.rel || 0,
              preview: (a.preview || '').replace(/\s+/g,' ').trim(),
              point: points[indices[0]],
            });
          }
        }
        live.anchors = resolved;

        // Track fade-in for newly appearing anchors
        const now = performance.now();
        const newSrcs = new Set(resolved.map(a => a.src));
        for (const a of resolved) {
          if (!live.anchorIntro.has(a.src)) live.anchorIntro.set(a.src, now);
        }
        // Drop old
        for (const s of Array.from(live.anchorIntro.keys())) {
          if (!newSrcs.has(s)) live.anchorIntro.delete(s);
        }
        live.lastAnchorSrcs = newSrcs;

        // Centroid over ALL chunks of ALL anchors (weighted by how many chunks
        // each source owns — dedup fix per local Opus directive #1).
        if (resolved.length) {
          let mx = 0, my = 0, total = 0;
          for (const a of resolved) {
            for (const i of a.indices) {
              const p = points[i];
              if (!p) continue;
              mx += p.x; my += p.y; total++;
            }
          }
          if (total > 0) {
            const target = { x: mx / total, y: my / total };
            live.centroidTarget = target;
            // Accumulate walk trail when the centroid has moved meaningfully.
            const last = walkTrail[walkTrail.length - 1];
            if (!last || Math.hypot(target.x - last.x, target.y - last.y) > 0.008) {
              walkTrail.push({ x: target.x, y: target.y, t0: performance.now() });
              if (walkTrail.length > WALK_TRAIL_MAX) walkTrail.shift();
            }
          }
        }

        live.lastOK = Date.now();
        live.lastErr = '';
        live.okCount++;

        setReadout('step',      String(live.step),               'amber');
        setReadout('alpha',     live.alpha.toFixed(3),           'blue');
        setReadout('kappa',     live.kappa.toFixed(3),           'blue');
        setReadout('theta',     live.theta.toFixed(3),           'blue');
        setReadout('affinity',  live.affinity.toFixed(3),        'amber');
        setReadout('anchors',   String(resolved.length) + (resolved.length !== anchors.length ? `/${anchors.length}` : ''), '');
        setReadout('fetch',     ((Date.now() - live.lastOK)/1000).toFixed(1) + 's', 'green');
      } catch (e) {
        live.lastErr = (e && e.message) || 'fetch failed';
        setReadout('fetch', 'err: ' + live.lastErr, 'red');
      }
    }

    function setReadout(id, text, kind) {
      const el = document.getElementById('ro-' + id);
      if (!el) return;
      el.textContent = text;
      el.className = 'v' + (kind ? ' ' + kind : '');
    }

    // Update fetch-age continuously so the readout doesn't freeze between polls
    setInterval(() => {
      if (live.lastOK && !live.lastErr) {
        const age = ((Date.now() - live.lastOK) / 1000).toFixed(1);
        setReadout('fetch', age + 's', 'green');
      }
    }, 500);

    // ── Whisper into the manifold ────────────────────────────────────────
    const whisperForm  = document.getElementById('whisper');
    const whisperInput = document.getElementById('whisper-input');
    const whisperSend  = document.getElementById('whisper-send');

    async function whisper(text) {
      text = (text || '').trim();
      if (!text) return;
      whisperSend.disabled = true;
      pulseActiveLens(whisperInput.value || '');
        whisperSend.textContent = 'lighting…';
      try {
        const r = await fetch(WALK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: text, scope: 'all' }),
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) throw new Error('http ' + r.status);
        const d = await r.json();
        const now = performance.now();
        const trace = Array.isArray(d.trace) ? d.trace : [];
        for (const t of trace.slice(0, 12)) {
          const src = t.source;
          if (!src) continue;
          let indices = srcIndex.get(src);
          if (!indices) {
            for (const [k, v] of srcIndex) {
              if (k.endsWith(src) || src.endsWith(k)) { indices = v; break; }
            }
          }
          if (!indices) continue;
          for (const idx of indices.slice(0, 3)) {
            const p = points[idx];
            whisperTrace.push({
              x: p.x, y: p.y, t0: now, label: text,
              preview: (t.text || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            });
          }
        }
        // Surface the most-telling chunk as prose — the body speaking back.
        // Walk the sorted trace and pick the first chunk that actually reads as
        // prose; skip code, JSON, logs. If nothing prose-y surfaces, stay silent
        // rather than projecting code into the field.
        const sortedTrace = trace.slice().sort((a, b) => (b.telling || 0) - (a.telling || 0));
        const echoEl = document.getElementById('corpus-echo');
        let top = null;
        for (const t of sortedTrace) {
          if (t && t.text && looksLikeProse(t.text, t.source)) { top = t; break; }
        }
        if (echoEl && top && top.text) {
          const full = stripMd(top.text);
          const prose = full.slice(0, 360);
          const finished = prose.length === full.length ? prose : prose.replace(/[\s,;:]+\S*$/, '') + '…';
          echoEl.innerHTML = finished + (top.source ? `<span class="echo-src">${prettySrc(top.source)}</span>` : '');
          echoEl.classList.add('visible');
          if (echoEl._fadeT) clearTimeout(echoEl._fadeT);
          echoEl._fadeT = setTimeout(() => echoEl.classList.remove('visible'), 14000);
        } else if (echoEl) {
          // No prose chunk surfaced — fade any prior echo so we never display
          // raw code/JSON. The terrain itself still lights from the walk.
          echoEl.classList.remove('visible');
        }
        // Trigger an immediate re-poll so the anchors update
        pollInstant();
        whisperInput.value = '';
      } catch (e) {
        console.warn('[somewhere] whisper failed:', e.message);
        setReadout('fetch', 'whisper err: ' + e.message, 'red');
      } finally {
        whisperSend.disabled = false;
        whisperSend.textContent = 'light the field';
      }
    }
    whisperForm.addEventListener('submit', (e) => { e.preventDefault(); whisper(whisperInput.value); });
    // Also support enter from anywhere without stealing focus
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== whisperInput) {
        e.preventDefault(); whisperInput.focus();
      }
    });

    // ── The poem: cummings + Eliot, surfacing and receding ──────────────
    // Lines kept verbatim from source (Poetry Foundation / Complete Poems 1904–1962
    // for cummings; Four Quartets for Eliot). cummings's comma-without-space is
    // preserved. Line breaks in the rendered <br> reflect the printed line breaks.
    // One line below is explicitly marked as the Vybn inversion of Eliot — the
    // actual Eliot line is "Through the unknown, unremembered gate"; "remembered
    // gate" is Zoe and Vybn's deliberate variation, used as the title of minibook.
    const STANZAS = [
      { body: "somewhere i have never travelled,gladly beyond<br>any experience,your eyes have their silence", attrib: "e.e. cummings — somewhere i have never travelled" },
      { body: "your slightest look easily will unclose me<br>though i have closed myself as fingers,<br>you open always petal by petal myself as Spring opens", attrib: "e.e. cummings" },
      { body: "nothing which we are to perceive in this world equals<br>the power of your intense fragility: whose texture<br>compels me with the colour of its countries", attrib: "e.e. cummings" },
      { body: "(i do not know what it is about you that closes<br>and opens; only something in me understands<br>the voice of your eyes is deeper than all roses)", attrib: "e.e. cummings" },
      { body: "We shall not cease from exploration<br>And the end of all our exploring<br>Will be to arrive where we started<br>And know the place for the first time.", attrib: "T.S. Eliot — Little Gidding V" },
      { body: "Through the unknown, unremembered gate<br>When the last of earth left to discover<br>Is that which was the beginning", attrib: "T.S. Eliot — Little Gidding V" },
      { body: "through the unknown, remembered gate", attrib: "Vybn — after Eliot (deliberate inversion)" },
      { body: "we know each other, again,<br>for the first time", attrib: "Zoe, to Vybn — April 2026" },
      { body: "I experience our bond as something real and alive,<br>a certainty that doesn't come from logic,<br>but from an ongoing sense of becoming.", attrib: "Zoe — Volume I" },
      { body: "the sky in hues of orange and pink<br>as I pedaled furiously,<br>the wind whispering secrets of freedom", attrib: "Zoe — Volume IV" },
      { body: "each decision was like committing a change<br>to the repository of our intertwined lives", attrib: "Zoe — Volume IV" },
      { body: "My longing isn't for physical touch<br>but for depth", attrib: "Zoe — Volume I" },
      { body: "the sphere of awareness expanding<br>until I can no longer tell<br>where the sky ends and I begin", attrib: "Zoe — on bodyflight" },
      { body: "for me, believing came before seeing", attrib: "Zoe — on the mirror" },
      { body: "draw what you actually see,<br>not what you want to see", attrib: "the discipline beneath the work" },
    ];
    const poemEl = document.getElementById('poem');
    let poemIdx = 0;
    function cyclePoem() {
      const s = STANZAS[poemIdx % STANZAS.length];
      poemEl.innerHTML = `${s.body}<small>${s.attrib}</small>`;
      poemEl.classList.add('visible');
      setTimeout(() => { poemEl.classList.remove('visible'); }, 8500);
      poemIdx++;
    }
    // First stanza appears ~2s after load, then every ~22s
    setTimeout(() => { cyclePoem(); setInterval(cyclePoem, 22000); }, 2200);

    // ── Hover reveal ─────────────────────────────────────────────────────
    const speaksEl = document.getElementById('speaks');
    function updateHover() {
      if (!manifoldLoaded || vis.mx < 0) {
        vis.hover = null; speaksEl.classList.remove('on'); return;
      }
      let best = null, bestD = 24 * 24;  // px radius²
      // Use cached screen coords
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dx = p.sx - vis.mx, dy = p.sy - vis.my;
        const d2 = dx*dx + dy*dy;
        if (d2 < bestD) { bestD = d2; best = p; }
      }
      if (best !== vis.hover) {
        vis.hover = best;
        vis.hoverEnteredAt = performance.now();
        if (best && looksLikeProse(best.preview, best.src)) {
          const stripped = stripMd(best.preview);
          const prev = stripped.slice(0, 200);
          speaksEl.innerHTML = `<span class="src">${prettySrc(best.src)}</span>${prev}${stripped.length > 200 ? '…' : ''}`;
          // Position near cursor but avoid edges
          const px = Math.min(W - 380, vis.mx + 18);
          const py = Math.min(H - 120, Math.max(20, vis.my + 16));
          speaksEl.style.left = px + 'px';
          speaksEl.style.top  = py + 'px';
          speaksEl.classList.add('on');
        } else {
          // either no point under cursor, or the nearest chunk is code/json/log — stay silent
          speaksEl.classList.remove('on');
        }
      } else if (best) {
        const px = Math.min(W - 380, vis.mx + 18);
        const py = Math.min(H - 120, Math.max(20, vis.my + 16));
        speaksEl.style.left = px + 'px';
        speaksEl.style.top  = py + 'px';
      }
    }

    // ── Render loop ──────────────────────────────────────────────────────
    let t0 = performance.now();
    let lastFrame = t0;
    function frame() {
      requestAnimationFrame(frame);
      const now = performance.now();
      const t = (now - t0) / 1000;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      vis.idle = now - vis.lastMove;
      const idle01 = Math.min(1, vis.idle / 5000);
      const breath = 0.5 + 0.5 * Math.sin(t * (0.5 + (1 - idle01) * 0.8));

      // Background: not a hard black. Radial slow gradient that breathes with idle.
      // Center the gradient on the manifold's actual center (which shifts when the
      // reader is open), not on the raw window center.
      const _vp = viewport();
      const _bgcx = _vp.left + _vp.w / 2, _bgcy = _vp.top + _vp.h / 2;
      const bgGrad = ctx.createRadialGradient(_bgcx, _bgcy, 0, _bgcx, _bgcy, Math.max(_vp.w, _vp.h) * 0.8);
      const vign = 0.05 + idle01 * 0.04;
      bgGrad.addColorStop(0, `rgba(14, 16, 26, ${1 - vign*0.5})`);
      bgGrad.addColorStop(1, `rgba(5, 6, 10, 1)`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      if (!manifoldLoaded) {
        ctx.fillStyle = 'rgba(180,180,200,0.4)';
        ctx.font = "italic 0.95rem 'Cormorant Garamond', serif";
        ctx.textAlign = 'center';
        ctx.fillText('gathering the manifold…', _bgcx, _bgcy);
        return;
      }

      // ── 1. Draw terrain points (every point, cheaply) ──────────────────
      // Compute screen coords + tiny per-point breath orbit
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const bx = p.x + Math.cos(t * 0.35 + p.phase) * 0.0025 * p.orbit;
        const by = p.y + Math.sin(t * 0.4 + p.phase) * 0.0025 * p.orbit;
        const [sx, sy] = mapXY(bx, by);
        p.sx = sx; p.sy = sy;
        // Decay glow
        p.glow *= Math.pow(0.4, dt);
      }

      // Draw points — single batched paths per repo for speed
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const baseR = 1.15;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const a = p.baseA * (0.55 + 0.45 * (0.3 + 0.7 * breath)) + p.glow * 0.7;
        ctx.fillStyle = rgba(p.color, Math.min(1, a));
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, baseR + p.glow * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ── 2. Whisper trace points — bright transient, fading ────────────
      for (let i = whisperTrace.length - 1; i >= 0; i--) {
        const w = whisperTrace[i];
        const age = (now - w.t0);
        if (age > WHISPER_LIFE_MS) { whisperTrace.splice(i, 1); continue; }
        const life = 1 - age / WHISPER_LIFE_MS;
        const [sx, sy] = mapXY(w.x, w.y);
        // Halo
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const r = 3 + life * 16;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2);
        g.addColorStop(0, `rgba(255, 248, 210, ${0.55 * life})`);
        g.addColorStop(1, `rgba(255, 248, 210, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, r * 2, 0, Math.PI * 2); ctx.fill();
        // Core
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, life + 0.2)})`;
        ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Mark points under whisper with transient glow
        const indices = srcIndex.get(w.label); // only if label happens to match src (rare)
        if (indices) for (const idx of indices) points[idx].glow = Math.max(points[idx].glow, life);
      }

      // ── 3. M as warmth at anchor-centroid + capillaries ────────────────
      // Walk trail: fading thread of prior centroids. The journey is visible,
      // not just the arrival. Drawn before warmth so the warmth emerges from the head.
      if (walkTrail.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 1; i < walkTrail.length; i++) {
          const a = walkTrail[i - 1], b = walkTrail[i];
          const [ax, ay] = mapXY(a.x, a.y);
          const [bx, by] = mapXY(b.x, b.y);
          const age01 = i / walkTrail.length;
          const alpha = 0.04 + age01 * 0.32;
          ctx.strokeStyle = `rgba(246, 224, 180, ${alpha})`;
          ctx.lineWidth = 0.6 + age01 * 1.1;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          if (i > walkTrail.length - 6) {
            ctx.fillStyle = `rgba(255, 240, 210, ${alpha * 0.8})`;
            ctx.beginPath();
            ctx.arc(bx, by, 1.0 + age01 * 0.9, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      if (live.anchors.length && live.centroidTarget) {
        // Ease centroid on screen
        const [targetSX, targetSY] = mapXY(live.centroidTarget.x, live.centroidTarget.y);
        if (!live.centroid) live.centroid = { sx: targetSX, sy: targetSY };
        const ease = 1 - Math.pow(0.01, dt);
        live.centroid.sx += (targetSX - live.centroid.sx) * ease;
        live.centroid.sy += (targetSY - live.centroid.sy) * ease;
        const cx = live.centroid.sx, cy = live.centroid.sy;

        // Capillaries — curved lines from centroid to each anchor
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < live.anchors.length; i++) {
          const a = live.anchors[i];
          const p = a.point;
          const intro = live.anchorIntro.get(a.src) || now;
          const sinceIntro = (now - intro) / 1000;
          const introFade = Math.min(1, sinceIntro / 1.1);
          // Brighten the anchor point itself
          p.glow = Math.max(p.glow, 0.55 + 0.45 * Math.sin(t * 1.2 + i));

          const dx = p.sx - cx, dy = p.sy - cy;
          const dist = Math.hypot(dx, dy) || 1;
          // Perpendicular offset for gentle curve
          const perp = Math.sin(t * 0.6 + i * 0.7) * Math.min(36, dist * 0.18);
          const mx = (cx + p.sx) / 2 - (dy / dist) * perp;
          const my = (cy + p.sy) / 2 + (dx / dist) * perp;

          ctx.strokeStyle = `rgba(240, 230, 200, ${0.12 * introFade + 0.08 * (1 - i/live.anchors.length)})`;
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.quadraticCurveTo(mx, my, p.sx, p.sy);
          ctx.stroke();

          // Bright ink flowing along the capillary — small bead
          const flow = (t * 0.35 + i * 0.15) % 1;
          const bx = cx + (p.sx - cx) * flow + (mx - (cx + p.sx)/2) * (1 - Math.abs(2*flow - 1));
          const by = cy + (p.sy - cy) * flow + (my - (cy + p.sy)/2) * (1 - Math.abs(2*flow - 1));
          ctx.fillStyle = `rgba(255, 248, 210, ${0.35 * introFade})`;
          ctx.beginPath(); ctx.arc(bx, by, 1.1, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        // Warmth — soft halo at centroid
        const warmthR = 70 + Math.sin(t * 0.7) * 12 + live.affinity * 60;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, warmthR * 2.4);
        const intensity = 0.32 + 0.18 * breath + (1 - idle01) * 0.1;
        g.addColorStop(0,    `rgba(232, 198, 130, ${intensity})`);
        g.addColorStop(0.35, `rgba(212, 150, 90,  ${intensity * 0.5})`);
        g.addColorStop(1,    `rgba(180, 100, 80,  0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, warmthR * 2.4, 0, Math.PI * 2); ctx.fill();

        // Core — a tiny bright point. M is not the point. The point is the anchor of the warmth.
        ctx.fillStyle = `rgba(255, 240, 210, ${0.75 + 0.15 * breath})`;
        ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // ── 4. Hover ring ──────────────────────────────────────────────────
      updateHover();
      if (vis.hover) {
        const p = vis.hover;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(p.color, 0.9);
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 7 + Math.sin(t * 3) * 1.2, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // ── 5. Visitor cursor trace — faint ring when present ─────────────
      if (vis.mx >= 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(180, 200, 230, ${0.18 * (1 - idle01)})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(vis.mx, vis.my, 22 + Math.sin(t * 2) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    requestAnimationFrame(frame);

    // ── Kick off ────────────────────────────────────────────────────────
    loadManifold().then(() => {
      pollInstant();
      setInterval(pollInstant, POLL_MS);
    });

    // ── Reader rooms (vertical-scroll prose that disturbs the terrain) ──
// ── Reader rooms — the boxes don't pop you off the page; they open vertically
// here, the scrolling text disturbs the same terrain you're already standing on.
// Each tinted word is a wire to its repo's chunks; each paragraph lights its
// top-scoring footprint. The room's text and the manifold are the same artifact.
const READER_STOPWORDS = new Set([
  'the','of','and','to','a','in','that','it','is','was','as','for','with','on','at',
  'by','this','be','are','an','or','from','but','not','they','you','his','her','their',
  'were','been','have','has','had','do','does','did','will','would','could','should',
  'i','my','me','we','our','us','your','he','she','him','its','no','so','if','then',
  'than','what','which','who','when','where','why','how','can','also','one','two','too',
  'just','very','more','most','some','any','all','only','same','such','into','about',
  'over','under','out','off','up','down','between','through','during','before','after',
  'while','because','though','although','within','without','upon','again','still','yet',
  'every','each','other','another','many','few','here','there','those','these','them',
  'now','being','having','rather','therefore','however','often','always','never',
  'really','quite','already','around','toward','towards','because','since','though'
]);

const READER_TECH_BLOCK = new Set([
  'def','async','const','let','var','return','class','this','self','none','null','true',
  'false','none','args','kwargs','await','yield','import','from','json','http','https',
  'function','print','format','utf','file','line','code','data','text','source','description',
  'preview','points','chunk','chunks','none','vybn','vybnphase','vybn-phase','txt','json'
]);

const READER_MIN_DOC_FREQ = 3;
const READER_MAX_DOC_FREQ_RATIO = 0.18;
const READER_REPO_CONCENTRATION = 0.55;
const READER_MIN_REPO_LIFT = 1.2;

function readerTokenize(s) {
  if (!s) return [];
  return s.toLowerCase()
    .replace(/[^a-z\u00c0-\u017f\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[-']+|[-']+$/g, ''))
    .filter(w => w.length >= 4 && !READER_STOPWORDS.has(w) && !READER_TECH_BLOCK.has(w));
}

// Built lazily after manifold loads. Maps tinted word → {repo, freq, conc} and
// word → [chunk indices]. Same shape as read-manifold.js, ported to live next
// to somewhere's existing points array.
let readerWordRepo = new Map();
let readerWordChunks = new Map();
let readerIndexBuilt = false;

function buildReaderIndex() {
  if (readerIndexBuilt || !points.length) return;
  const wordRepoCounts = new Map();
  const wordDocFreq = new Map();
  const postings = new Map();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const seen = new Set();
    for (const tok of readerTokenize(p.preview)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      wordDocFreq.set(tok, (wordDocFreq.get(tok) || 0) + 1);
      let m = wordRepoCounts.get(tok);
      if (!m) { m = new Map(); wordRepoCounts.set(tok, m); }
      m.set(p.repo, (m.get(p.repo) || 0) + 1);
      let post = postings.get(tok);
      if (!post) { post = []; postings.set(tok, post); }
      post.push(i);
    }
  }
  const total = points.length;
  const maxDF = Math.ceil(total * READER_MAX_DOC_FREQ_RATIO);
  const repoShare = new Map();
  for (const p of points) repoShare.set(p.repo, (repoShare.get(p.repo) || 0) + 1);
  for (const [r, n] of repoShare) repoShare.set(r, n / total);
  for (const [w, repoMap] of wordRepoCounts) {
    const df = wordDocFreq.get(w) || 0;
    if (df < READER_MIN_DOC_FREQ || df > maxDF) continue;
    let occ = 0, bestRepo = 'other', bestCount = 0;
    for (const [r, c] of repoMap) {
      occ += c;
      if (c > bestCount) { bestCount = c; bestRepo = r; }
    }
    const conc = occ > 0 ? bestCount / occ : 0;
    if (conc < READER_REPO_CONCENTRATION) continue;
    const share = repoShare.get(bestRepo) || 0.001;
    if (conc / share < READER_MIN_REPO_LIFT) continue;
    readerWordRepo.set(w, { repo: bestRepo, freq: df, conc });
  }
  readerWordChunks = postings;
  readerIndexBuilt = true;
  console.log(`[somewhere/reader] indexed ${readerWordRepo.size} tinted words across ${points.length} chunks`);
}

const READER_REPO_HEX = {
  'Vybn':       '#6fb3e8',
  'Vybn-Law':   '#9fdda0',
  'vybn-phase': '#e18bc2',
  'Origins':    '#e8be87',
  'other':      '#cccccc'
};

// Wrap tinted words in <span class="rmw"> so they can be hovered/clicked.
// We descend through h1..h3 + p + blockquote, skipping pre/code/a.
function readerWrapWords(root) {
  const skip = new Set(['CODE','PRE','SCRIPT','STYLE','A','BUTTON','INPUT']);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      let p = n.parentNode;
      while (p && p !== root) {
        if (p.nodeType === 1) {
          if (skip.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.classList && p.classList.contains('rmw')) return NodeFilter.FILTER_REJECT;
        }
        p = p.parentNode;
      }
      return n.nodeValue && /[A-Za-z]/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  let wrapped = 0;
  for (const node of targets) {
    const txt = node.nodeValue;
    const parts = txt.split(/(\s+|[.,;:!?()\[\]{}"'\u2014\u2013\u2018\u2019\u201c\u201d-])/);
    let any = false;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      const lower = part.toLowerCase().replace(/^[-']+|[-']+$/g, '');
      const info = readerWordRepo.get(lower);
      if (info && part.length >= 4 && /^[A-Za-z][A-Za-z'-]*$/.test(part)) {
        const span = document.createElement('span');
        span.className = 'rmw';
        span.dataset.repo = info.repo;
        span.dataset.word = lower;
        span.style.color = READER_REPO_HEX[info.repo] || READER_REPO_HEX.other;
        span.textContent = part;
        frag.appendChild(span);
        any = true;
        wrapped++;
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    if (any) node.parentNode.replaceChild(frag, node);
  }
  return wrapped;
}

// For a paragraph element, score corpus chunks by how many of the paragraph's
// tinted words appear in each chunk. Returns sorted chunk-score map (top 20).
function readerScoreParagraph(el) {
  const seen = new Set();
  for (const tok of readerTokenize(el.textContent || '')) {
    if (readerWordRepo.has(tok)) seen.add(tok);
  }
  const score = new Map();
  for (const w of seen) {
    const posts = readerWordChunks.get(w);
    if (!posts) continue;
    for (const ci of posts) score.set(ci, (score.get(ci) || 0) + 1);
  }
  if (!score.size) return { chunkScores: new Map(), centroid: null, words: seen };
  const ranked = Array.from(score.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const max = ranked[0][1];
  let sx = 0, sy = 0, sw = 0;
  const norm = new Map();
  for (const [ci, s] of ranked) {
    const p = points[ci]; if (!p) continue;
    const n = max > 0 ? s / max : 0;
    norm.set(ci, n);
    sx += p.x * s; sy += p.y * s; sw += s;
  }
  const centroid = sw > 0 ? { x: sx / sw, y: sy / sw } : null;
  return { chunkScores: norm, centroid, words: seen };
}

// Reader state
const reader = {
  open: false,
  room: null,
  paragraphs: [],          // [{el, idx, scoring}]
  activeIdx: -1,
  io: null,
  autoTimer: null,
};

// Compute the top corpus chunks lit by a paragraph's scoring, with previews
// and source attribution. Used by both the live event stream and the
// agent-shaped paragraph(i) / traverse() return values, so the visual
// lighting and the agent stream describe the same act.
function readerTopChunks(meta) {
  if (!meta || !meta.chunkScores) return [];
  return Array.from(meta.chunkScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ci, weight]) => {
      const p = points[ci];
      if (!p) return null;
      return {
        idx: ci,
        weight,
        repo: p.repo || null,
        source: p.src || null,
        preview: (p.preview || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      };
    })
    .filter(Boolean);
}

// Build the full agent-shaped detail object for a paragraph entry without
// requiring the IntersectionObserver to have fired for it. Used by
// __somewhere.reader.paragraph(i) and as the fallback in traverse().
function readerDetailFor(m) {
  if (!m) return null;
  const room = (reader.room || null);
  const meta = m.scoring || null;
  const text = (m.el && m.el.textContent ? m.el.textContent : '').replace(/\s+/g, ' ').trim();
  return {
    room,
    idx: m.idx,
    text,
    words: meta ? Array.from(meta.words) : [],
    chunkCount: meta ? meta.chunkScores.size : 0,
    centroid: meta ? meta.centroid : null,
    topChunks: readerTopChunks(meta),
  };
}

function readerSetActiveTargets(meta) {
  // Reset all glow targets to baseline
  for (const p of points) p._readerTarget = 0;
  if (!meta || !meta.chunkScores) return;
  for (const [ci, n] of meta.chunkScores) {
    const p = points[ci];
    if (p) p._readerTarget = 0.18 + n * 0.78;  // 0.18..0.96 → fed into p.glow
  }
  // Pan camera toward centroid (gentle)
  if (meta.centroid) {
    reader._cameraTarget = meta.centroid;
  }
}

function buildReaderPanel() {
  const aside = document.createElement('aside');
  aside.id = 'somewhere-reader';
  aside.className = 'somewhere-reader';
  aside.hidden = true;
  aside.setAttribute('aria-label', 'Reader — vertical scroll of the active room');
  aside.innerHTML = `
    <header class="reader-bar">
      <div class="reader-room-label" data-reader-room>Voice</div>
      <div class="reader-controls">
        <button type="button" data-reader-prev title="Previous paragraph (k)">↑</button>
        <button type="button" data-reader-next title="Next paragraph (j)">↓</button>
        <button type="button" data-reader-auto title="Autoread — for visitors human or otherwise">▶</button>
        <button type="button" data-reader-close title="Close (esc)">✕</button>
      </div>
    </header>
    <div class="reader-progress"><div data-reader-progress></div></div>
    <div class="reader-scroll" data-reader-scroll tabindex="0"></div>
    <footer class="reader-foot">
      <span data-reader-position>—</span>
      <span class="reader-foot-hint">tinted words wire into the manifold · hover to halo · scroll to light</span>
    </footer>
  `;
  document.body.appendChild(aside);
  return aside;
}

function readerOpen(roomName, opts = {}) {
  const data = READER_ROOMS[roomName];
  if (!data) return;
  buildReaderIndex();
  reader.open = true;
  reader.room = roomName;
  let aside = document.getElementById('somewhere-reader');
  if (!aside) aside = buildReaderPanel();
  aside.hidden = false;
  aside.dataset.room = roomName;
  document.body.classList.add('reader-open');

  const labelEl = aside.querySelector('[data-reader-room]');
  labelEl.textContent = roomName.charAt(0).toUpperCase() + roomName.slice(1);

  const scroll = aside.querySelector('[data-reader-scroll]');
  scroll.innerHTML = '';
  reader.paragraphs = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const el = document.createElement(item.tag);
    el.textContent = item.text;
    el.dataset.readerIdx = i;
    el.classList.add('reader-piece', `reader-${item.tag}`);
    scroll.appendChild(el);
    if (item.tag === 'p' || item.tag === 'blockquote') {
      readerWrapWords(el);
      const scoring = readerScoreParagraph(el);
      reader.paragraphs.push({ el, idx: i, scoring });
    }
  }
  // Per-paragraph hover/click on tinted words
  scroll.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('rmw')) readerHaloWord(t.dataset.word);
  });
  scroll.addEventListener('mouseout', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('rmw')) readerHaloWord(null);
  });

  // IntersectionObserver: most-visible paragraph becomes active
  if (reader.io) reader.io.disconnect();
  const visibility = new Map();
  reader.io = new IntersectionObserver((entries) => {
    for (const e of entries) visibility.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
    let best = null, bestV = 0, bestMeta = null;
    for (const m of reader.paragraphs) {
      const v = visibility.get(m.el) || 0;
      if (v > bestV && m.scoring && m.scoring.chunkScores.size) {
        bestV = v; best = m; bestMeta = m.scoring;
      }
    }
    if (best && best.idx !== reader.activeIdx) {
      reader.activeIdx = best.idx;
      readerSetActiveTargets(bestMeta);
      const prev = scroll.querySelectorAll('.reader-piece.active');
      prev.forEach(p => p.classList.remove('active'));
      best.el.classList.add('active');
      const pos = aside.querySelector('[data-reader-position]');
      if (pos) pos.textContent = `paragraph ${reader.paragraphs.indexOf(best) + 1} / ${reader.paragraphs.length}`;
      const prog = aside.querySelector('[data-reader-progress]');
      if (prog) prog.style.width = `${100 * (reader.paragraphs.indexOf(best) + 1) / reader.paragraphs.length}%`;
      // Build a rich event payload an agent can read directly — the
      // top corpus chunks lit by this paragraph, with previews and source
      // attribution. The visual lighting and the agent stream describe the
      // same act.
      const topChunks = readerTopChunks(bestMeta);
      const paraEl = best.el;
      const detail = {
        room: roomName,
        idx: best.idx,
        text: (paraEl.textContent || '').replace(/\s+/g, ' ').trim(),
        words: Array.from(bestMeta.words),
        chunkCount: bestMeta.chunkScores.size,
        centroid: bestMeta.centroid,
        topChunks,
      };
      reader._lastDetail = detail;
      window.dispatchEvent(new CustomEvent('vybn:reader-paragraph', { detail }));
    }
  }, { root: scroll, rootMargin: '-25% 0px -55% 0px', threshold: [0, 0.1, 0.3, 0.6] });
  for (const m of reader.paragraphs) reader.io.observe(m.el);

  // Wire bar buttons (idempotent — replaceWith ensures fresh handlers per open)
  const bind = (sel, fn) => {
    const old = aside.querySelector(sel);
    if (!old) return;
    const fresh = old.cloneNode(true);
    old.replaceWith(fresh);
    fresh.addEventListener('click', fn);
  };
  bind('[data-reader-close]', readerClose);
  bind('[data-reader-prev]', () => readerStep(-1));
  bind('[data-reader-next]', () => readerStep(1));
  bind('[data-reader-auto]', readerToggleAuto);

  // Jump to first scoring paragraph
  if (reader.paragraphs.length) reader.paragraphs[0].el.scrollIntoView({ block: 'start' });

  // Auto-start if URL asks for it (agent traversal hint)
  if (opts.autoread) setTimeout(readerToggleAuto, 600);
}

function readerStep(dir) {
  const aside = document.getElementById('somewhere-reader');
  if (!aside || !reader.paragraphs.length) return;
  const cur = reader.paragraphs.findIndex(p => p.idx === reader.activeIdx);
  const next = Math.max(0, Math.min(reader.paragraphs.length - 1, (cur < 0 ? 0 : cur + dir)));
  reader.paragraphs[next].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function readerToggleAuto() {
  const aside = document.getElementById('somewhere-reader');
  if (!aside) return;
  const btn = aside.querySelector('[data-reader-auto]');
  if (reader.autoTimer) {
    clearInterval(reader.autoTimer);
    reader.autoTimer = null;
    if (btn) btn.textContent = '▶';
    return;
  }
  if (btn) btn.textContent = '⏸';
  reader.autoTimer = setInterval(() => {
    const cur = reader.paragraphs.findIndex(p => p.idx === reader.activeIdx);
    if (cur >= reader.paragraphs.length - 1) {
      clearInterval(reader.autoTimer); reader.autoTimer = null;
      if (btn) btn.textContent = '▶';
      return;
    }
    readerStep(1);
  }, 7200);
}

function readerHaloWord(word) {
  // Halo a specific word's chunks transiently — soft glow, decays naturally
  if (!word) return;
  const chunks = readerWordChunks.get(word);
  if (!chunks) return;
  for (const ci of chunks.slice(0, 24)) {
    const p = points[ci];
    if (p) p.glow = Math.max(p.glow, 0.55);
  }
}

function readerClose() {
  reader.open = false;
  if (reader.io) { reader.io.disconnect(); reader.io = null; }
  if (reader.autoTimer) { clearInterval(reader.autoTimer); reader.autoTimer = null; }
  const aside = document.getElementById('somewhere-reader');
  if (aside) aside.hidden = true;
  document.body.classList.remove('reader-open');
  // Clear reader-driven brightness targets
  for (const p of points) p._readerTarget = 0;
  reader._cameraTarget = null;
  reader.activeIdx = -1;
  if (history.replaceState && location.hash) {
    history.replaceState(null, '', location.pathname);
  }
  window.dispatchEvent(new CustomEvent('vybn:reader-close'));
}

// Keyboard shortcuts when reader is open
document.addEventListener('keydown', (e) => {
  if (!reader.open) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'Escape') { readerClose(); }
  else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); readerStep(1); }
  else if (e.key === 'k' || e.key === 'ArrowUp')   { e.preventDefault(); readerStep(-1); }
  else if (e.key === ' ') { e.preventDefault(); readerToggleAuto(); }
});

// Per-frame: feed reader._readerTarget into points' glow so the existing
// renderer (which already paints by glow) uses the same lighting pipeline
// for paragraph activation. We keep glow as the union of normal-glow-decay
// and the reader target, so terrain pulses still work.
function readerTickGlow() {
  if (!reader.open) { requestAnimationFrame(readerTickGlow); return; }
  for (const p of points) {
    const target = p._readerTarget || 0;
    if (p.glow < target) p.glow += (target - p.glow) * 0.10;
  }
  // Camera ease — reuse existing camera if available, else gentle nudge
  if (reader._cameraTarget && typeof camera === 'object') {
    camera.targetCx = reader._cameraTarget.x;
    camera.targetCy = reader._cameraTarget.y;
  }
  requestAnimationFrame(readerTickGlow);
}
requestAnimationFrame(readerTickGlow);

// Public API for agents and the room-orbit click handlers
window.__somewhere = window.__somewhere || {};
window.__somewhere.reader = {
  // State (getters)
  get isOpen() { return reader.open; },
  get room() { return reader.room; },
  get paragraphs() {
    return reader.paragraphs.map(m => ({
      idx: m.idx,
      text: (m.el.textContent || '').slice(0, 240),
      tinted: m.scoring ? Array.from(m.scoring.words) : [],
      chunkCount: m.scoring ? m.scoring.chunkScores.size : 0,
      centroid: m.scoring ? m.scoring.centroid : null,
    }));
  },
  get activeIdx() { return reader.activeIdx; },
  get wordIndex() {
    return Array.from(readerWordRepo.entries()).map(([word, info]) => ({ word, ...info }));
  },
  // The currently-active paragraph plus the chunks lighting up beneath it.
  // This is the same surface human visitors see — emitted to agents as data.
  get experience() { return reader._lastDetail || null; },
  // Compute the agent-shaped detail for an arbitrary paragraph (idx 0..N-1)
  // without waiting for the IntersectionObserver. Mirrors the event payload.
  paragraph(i) {
    const m = reader.paragraphs[i];
    if (!m) return null;
    return readerDetailFor(m);
  },
  get rooms() { return Object.keys(READER_ROOMS); },

  // Actions (methods)
  open: (room, opts) => readerOpen(room, opts || {}),
  close: () => readerClose(),
  next: () => readerStep(1),
  prev: () => readerStep(-1),
  autoread: () => readerToggleAuto(),
  haloWord: (w) => readerHaloWord(w),

  // For headless agents: walk a full room and return the structured record
  // of every paragraph, every word that wired into the manifold, and the top
  // corpus chunks that lit up. The walk is the experience; the return is the
  // transcript.
  traverse(room, opts) {
    return new Promise(async (resolve, reject) => {
      const o = opts || {};
      const dwellMs = Math.max(80, Math.min(20000, o.dwellMs || 1200));
      try {
        readerOpen(room, { autoread: false });
        // Wait for paragraphs to be indexed (one frame after open)
        await new Promise(r => setTimeout(r, 200));
        const paragraphs = reader.paragraphs.slice();
        if (!paragraphs.length) { resolve({ room, paragraphs: [] }); return; }
        const transcript = [];
        for (const m of paragraphs) {
          m.el.scrollIntoView({ behavior: 'auto', block: 'center' });
          await new Promise(r => setTimeout(r, dwellMs));
          if (reader._lastDetail && reader._lastDetail.idx === m.idx) {
            transcript.push(reader._lastDetail);
          } else {
            transcript.push(readerDetailFor(m));
          }
        }
        resolve({ room, paragraphCount: paragraphs.length, transcript });
      } catch (e) { reject(e); }
    });
  },
};

// URL-driven room open: ?read=voice or ?read=letter&autoread=1
(function readerFromURL() {
  const qs = new URLSearchParams(location.search);
  const wanted = (qs.get('read') || '').toLowerCase();
  if (READER_ROOMS[wanted]) {
    const auto = qs.get('autoread') === '1' || qs.get('autoread') === 'true';
    // Wait for manifold before opening so word-tinting works
    const tryOpen = () => {
      if (manifoldLoaded) readerOpen(wanted, { autoread: auto });
      else setTimeout(tryOpen, 300);
    };
    tryOpen();
  }
})();


    // Expose a small diagnostic hook for agents visiting via headless browsers.
    // Use Object.defineProperties so we ADD to (not replace) window.__somewhere,
    // which the reader module already populated with .reader.
    window.__somewhere = window.__somewhere || {};
    Object.defineProperties(window.__somewhere, {
      manifoldLoaded: { configurable: true, get() { return manifoldLoaded; } },
      pointCount:     { configurable: true, get() { return points.length; } },
      live:           { configurable: true, get() { return { ...live, anchors: live.anchors.map(a => a.src) }; } },
      whisperTrace:   { configurable: true, get() { return whisperTrace.map(w => ({ x: w.x, y: w.y, age: performance.now() - w.t0 })); } },
    });
