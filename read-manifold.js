// ═══════════════════════════════════════════════════════════════════════════
// read-manifold.js — the essay on the terrain
//
// The text is a path through the corpus. This module makes that literal:
//
//  (1) At load, fetch /api/manifold/points (3,092 chunks positioned in ℝ²
//      by PCA(50)→TSNE(2) on concat(Re(coupled-state), Im(coupled-state))).
//      These positions never move. The terrain is fixed.
//
//  (2) From the 240-char preview of every chunk, build a word → repo-affinity
//      index. A word is "tinted" if it occurs in ≥ MIN_DOC_FREQ chunks AND
//      its distribution over repos is concentrated enough that a single repo
//      accounts for ≥ REPO_CONCENTRATION_THRESHOLD of its mass (TF-IDF-flavored
//      but repo-aware). Tinted words are wrapped in <span class="mw"
//      data-repo="…"> by a TreeWalker on the essay body and colored.
//
//  (3) For each <p> in the essay, precompute a manifold centroid — the average
//      (x,y) of the chunks whose previews best overlap the paragraph's
//      significant words, weighted by overlap. This is the paragraph's
//      position on the terrain. The paragraph IS a neighborhood.
//
//  (4) An IntersectionObserver tracks the currently-most-in-view paragraph.
//      When it changes, the canvas pans/zooms toward that paragraph's
//      centroid, and the paragraph's associated chunks brighten. Other
//      chunks dim to near-silence. The terrain follows reading.
//
//  (5) The live coupling — /api/instant — keeps running behind the scroll
//      layer: M-warmth at the centroid of the actual walk's anchors, curved
//      capillaries, intro fade. The reader's gravity (paragraph centroid)
//      and the walk's gravity (M) coexist on the same field. When they
//      overlap, the page is resonant with the walk. When they diverge, the
//      reader is somewhere the walk hasn't reached yet.
//
//  (6) The whisper box at the bottom POSTs /api/walk and shows the trace
//      as a bright path on the terrain — same contract as somewhere.html.
//
//  (7) A reader trail accumulates: the last ~40 paragraph centroids the
//      reader has passed through, drawn as a fading thread. The path of
//      understanding.
//
// Anti-hallucination: fetch failures surface inline. No values are smoothed.
// If the manifold fails to load, the essay still reads — this layer is
// additive, not load-bearing for the text.
//
// MCP/KTP: every significant DOM node carries data-mcp-* attributes so an
// agent parsing the DOM can reconstruct the experience structurally without
// running the canvas.
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://api.vybn.ai';
const POINTS_URL  = `${API}/api/manifold/points`;
const INSTANT_URL = `${API}/api/instant`;
const WALK_URL    = `${API}/api/walk`;

const REPO_COLORS = {
  'Vybn':      { hex: '#3a8ad8', rgb: '58,138,216' },
  'Vybn-Law':  { hex: '#7ac97a', rgb: '122,201,122' },
  'vybn-phase':{ hex: '#c96ca8', rgb: '201,108,168' },
  'Origins':   { hex: '#d8a866', rgb: '216,168,102' },
  'other':     { hex: '#888899', rgb: '136,136,153' },
};

const STOPWORDS = new Set([
  'the','and','that','this','with','from','have','been','were','they','their',
  'would','could','should','which','what','when','where','there','these','those',
  'into','than','then','also','such','some','more','most','very','just','only',
  'even','like','about','over','other','because','through','between','under',
  'above','after','before','while','will','shall','might','must','does','doing',
  'done','being','having','each','every','both','either','neither','nor','not',
  'our','your','his','her','its','them','him','her','its','ours','yours','who',
  'whom','whose','how','why','yes','no','one','two','three','four','five','all',
  'any','can','for','get','got','had','has','let','may','new','now','old','out',
  'own','say','see','she','too','was','way','you','are','but','day','how','man',
  'men','off','put','run','set','top','use','web','yet','did','eat','end','fix',
  'few','hand','here','high','know','last','life','line','look','made','make',
  'much','must','name','need','next','open','part','play','read','real','said',
  'same','seem','show','side','take','tell','them','thing','think','time','turn',
  'upon','used','want','well','went','were','what','work','year','page','paper',
  'etc','null','true','false','none','only','yes','onto','unto','aren','arent',
  'didnt','doesnt','dont','hasnt','havent','isnt','wasnt','werent','wont',
  'wouldnt','couldnt','shouldnt','himself','herself','itself','myself','yourself',
  'themselves','ourselves','something','anything','nothing','everyone','someone',
  'anyone','noone','cannot','whether','whilst','although','though','still','yet',
  'per','via','among','amongst','toward','towards','within','without','against',
  'across','around','along','beyond','beside','besides','inside','outside',
  'therefore','however','moreover','furthermore','nevertheless','nonetheless',
]);

const MIN_DOC_FREQ = 3;         // word must appear in ≥ N chunk previews
const MAX_DOC_FREQ_RATIO = 0.15;// word must appear in < 15% of all chunks
const REPO_CONCENTRATION = 0.55;// dominant repo must hold ≥ 55% of occurrences
const MIN_REPO_LIFT = 1.25;     // repo concentration / repo's corpus share.
                                // Anti-dilution: Vybn is 68% of the corpus, so
                                //   a word 68% Vybn has lift 1.0 (chance).
                                //   Requires lift ≥ 1.25 — the word must be
                                //   meaningfully more concentrated in its repo
                                //   than the baseline predicts. For smaller
                                //   repos (Origins 4%, vybn-phase 7%) even
                                //   moderate concentration clears the bar.

// Code/markdown artifacts from chunk previews — structural words, not semantic.
const TECH_BLOCKLIST = new Set([
  'return','source','description','text','none','self','note','null','true','false',
  'type','class','const','function','async','await','import','export','default',
  'module','interface','struct','enum','array','object','string','number',
  'boolean','undefined','nan','error','exception','stack','trace','debug',
  'info','warn','method','params','args','value','values','keys','items',
  'index','length','width','height','size','count','total','result','output',
  'input','file','path','name','label','title','header','footer','author',
  'date','time','version','status','config','settings','options','data',
  'mdash','ndash','ndarray','vdot','conj','sqrt','alpha','norm','zero',
]);
const MAX_TINTED_PER_P = 18;    // don't turn paragraphs into rainbows
const TRAIL_MAX = 40;           // paragraph centroids retained in reader trail
const CENTROID_SMOOTH = 0.08;   // camera easing toward target
const ZOOM_SMOOTH = 0.05;

// ── State ──────────────────────────────────────────────────────────────────
let points = [];                // {i,x,y,repo,src,preview}
let srcIndex = new Map();       // src -> [idx1, idx2, ...] (dedup fix)
let wordRepoDominant = new Map(); // word -> {repo, freq, concentration}
let wordChunks = new Map();     // word -> [chunk idx, ...]  (for highlight)
let paragraphMeta = [];         // {el, centroid, chunkIdx:Set<number>, words:Set<string>}
let manifoldBounds = null;
let pointScreen = [];           // cached per-frame screen (x,y)

const live = {
  step: 0, alpha: 0, kappa: 0, theta: 0, affinity: 0,
  anchors: [],               // [{src, idx, score, rel, preview}]
  anchorIntro: new Map(),
  centroidTarget: null,      // {x,y} in manifold coords
  lastOK: 0, lastErr: '', okCount: 0, errCount: 0,
};

const camera = {
  cx: 0, cy: 0,              // center in manifold coords
  targetCx: 0, targetCy: 0,
  zoom: 1.0,                 // 1.0 = full view; > 1 zoomed in
  targetZoom: 1.0,
};

const readerTrail = [];      // [{x,y,t}]
const whisperTrace = [];     // bright transient path points
let activeParagraph = null;
let activeParagraphIdx = -1;

// ── Utilities ──────────────────────────────────────────────────────────────
function tokenize(s) {
  if (!s) return [];
  return s.toLowerCase()
    .replace(/[^a-z\u00c0-\u017f\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[-']+|[-']+$/g, ''))
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));
}

function setErr(msg) {
  const el = document.getElementById('rm-err');
  if (el) el.textContent = msg || '';
}

// ── Fetch manifold & build indices ─────────────────────────────────────────
async function loadManifold() {
  const r = await fetch(POINTS_URL, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`manifold http ${r.status}`);
  const d = await r.json();

  points = (d.points || []).map(p => ({
    i: p.i, x: p.x, y: p.y,
    repo: REPO_COLORS[p.repo] ? p.repo : 'other',
    src: p.src,
    preview: p.preview || '',
    _brightness: 0,
    _relevant: 0,      // set when paragraph in view highlights this chunk
  }));

  // src -> [idx,...]  (one src can own multiple chunks; light them all up)
  srcIndex = new Map();
  for (const p of points) {
    const arr = srcIndex.get(p.src);
    if (arr) arr.push(p.i);
    else srcIndex.set(p.src, [p.i]);
  }

  manifoldBounds = d.projection || null;

  // Build word → repo distribution + word → chunk postings
  const wordRepoCounts = new Map(); // word -> Map(repo -> count)
  const wordDocFreq = new Map();    // word -> count of chunks it appears in
  const postings = new Map();       // word -> Array<chunkIdx>

  for (const p of points) {
    const seen = new Set();
    for (const tok of tokenize(p.preview)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      wordDocFreq.set(tok, (wordDocFreq.get(tok) || 0) + 1);
      let m = wordRepoCounts.get(tok);
      if (!m) { m = new Map(); wordRepoCounts.set(tok, m); }
      m.set(p.repo, (m.get(p.repo) || 0) + 1);
      let post = postings.get(tok);
      if (!post) { post = []; postings.set(tok, post); }
      post.push(p.i);
    }
  }

  const total = points.length;
  const maxDocFreq = Math.ceil(total * MAX_DOC_FREQ_RATIO);

  wordRepoDominant = new Map();
  // Compute corpus share of each repo (for the lift calculation)
  const repoShare = new Map();
  for (const p of points) repoShare.set(p.repo, (repoShare.get(p.repo) || 0) + 1);
  for (const [r, n] of repoShare) repoShare.set(r, n / points.length);

  for (const [word, repoMap] of wordRepoCounts) {
    if (TECH_BLOCKLIST.has(word)) continue;
    const df = wordDocFreq.get(word) || 0;
    if (df < MIN_DOC_FREQ) continue;
    if (df > maxDocFreq) continue;
    let occ = 0, bestRepo = 'other', bestCount = 0;
    for (const [repo, count] of repoMap) {
      occ += count;
      if (count > bestCount) { bestCount = count; bestRepo = repo; }
    }
    const conc = occ > 0 ? bestCount / occ : 0;
    if (conc < REPO_CONCENTRATION) continue;
    // Purity lift — concentration over baseline share. Corrects for Vybn
    // being so large that mere presence looks concentrated.
    const share = repoShare.get(bestRepo) || 0.001;
    const lift = conc / share;
    if (lift < MIN_REPO_LIFT) continue;
    wordRepoDominant.set(word, { repo: bestRepo, freq: df, conc, lift });
  }
  wordChunks = postings;

  return points.length;
}

// ── Wrap significant words in the essay ────────────────────────────────────
function wrapWords(rootSel) {
  const root = document.querySelector(rootSel);
  if (!root) return 0;
  const skipTags = new Set(['CODE','PRE','SCRIPT','STYLE','NOSCRIPT','SVG','H1','H2','H3','H4','A']);
  // We DO descend into <em>, <strong>, <blockquote>, <p>; we skip <a> so
  // existing links aren't broken by inner spans.
  const filter = {
    acceptNode(node) {
      let p = node.parentNode;
      while (p && p !== root) {
        if (p.nodeType === 1) {
          if (skipTags.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.classList && p.classList.contains('mw')) return NodeFilter.FILTER_REJECT;
        }
        p = p.parentNode;
      }
      return node.nodeValue && /[A-Za-z]/.test(node.nodeValue)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, filter);
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  let wrapped = 0;
  for (const textNode of targets) {
    const txt = textNode.nodeValue;
    // Split while preserving whitespace & punctuation.
    const parts = txt.split(/(\s+|[.,;:!?()\[\]{}"'—–-])/);
    let anyTinted = false;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      const lower = part.toLowerCase().replace(/^[-']+|[-']+$/g, '');
      const info = wordRepoDominant.get(lower);
      if (info && part.length >= 4 && /^[A-Za-z][A-Za-z'-]*$/.test(part)) {
        const span = document.createElement('span');
        span.className = 'mw';
        span.dataset.repo = info.repo;
        span.dataset.word = lower;
        span.dataset.conc = info.conc.toFixed(2);
        span.dataset.freq = String(info.freq);
        span.textContent = part;
        frag.appendChild(span);
        anyTinted = true;
        wrapped++;
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    if (anyTinted) textNode.parentNode.replaceChild(frag, textNode);
  }
  return wrapped;
}

// ── Paragraph → manifold centroid ──────────────────────────────────────────
function indexParagraphs(rootSel) {
  const root = document.querySelector(rootSel);
  if (!root) return 0;
  const paras = Array.from(root.querySelectorAll('p'));
  paragraphMeta = [];
  let idx = 0;
  for (const p of paras) {
    const words = new Set();
    for (const tok of tokenize(p.textContent || '')) {
      if (wordRepoDominant.has(tok)) words.add(tok);
    }
    if (words.size === 0) {
      paragraphMeta.push({ el: p, centroid: null, chunkIdx: new Set(), words, idx });
      p.dataset.mcpPara = String(idx++);
      continue;
    }
    // Score each chunk by how many of this paragraph's words appear in its preview
    const chunkScore = new Map();
    for (const w of words) {
      const posts = wordChunks.get(w);
      if (!posts) continue;
      for (const ci of posts) {
        chunkScore.set(ci, (chunkScore.get(ci) || 0) + 1);
      }
    }
    if (!chunkScore.size) {
      paragraphMeta.push({ el: p, centroid: null, chunkIdx: new Set(), words, idx });
      p.dataset.mcpPara = String(idx++);
      continue;
    }
    // Take top-k chunks by score; compute weighted centroid from them
    const ranked = Array.from(chunkScore.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24);
    let sx = 0, sy = 0, sw = 0;
    const keep = new Set();
    for (const [ci, score] of ranked) {
      const pt = points[ci];
      if (!pt) continue;
      sx += pt.x * score;
      sy += pt.y * score;
      sw += score;
      keep.add(ci);
    }
    const centroid = sw > 0 ? { x: sx / sw, y: sy / sw } : null;
    const repoTally = new Map();
    for (const ci of keep) {
      const r = points[ci].repo;
      repoTally.set(r, (repoTally.get(r) || 0) + 1);
    }
    const dominantRepo = [...repoTally.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] || 'other';
    p.dataset.mcpPara = String(idx);
    p.dataset.mcpRepo = dominantRepo;
    if (centroid) {
      p.dataset.mcpX = centroid.x.toFixed(4);
      p.dataset.mcpY = centroid.y.toFixed(4);
    }
    paragraphMeta.push({ el: p, centroid, chunkIdx: keep, words, idx, dominantRepo });
    idx++;
  }
  return paragraphMeta.length;
}

// ── Canvas rendering ───────────────────────────────────────────────────────
const canvas = document.getElementById('manifold-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let W = 0, H = 0, DPR = 1;

function resize() {
  if (!canvas) return;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width  = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function manifoldToScreen(mx, my) {
  // View region: [cx - r, cx + r] × [cy - r, cy + r] with r = 1/zoom
  const r = 1 / camera.zoom;
  const sx = (mx - camera.cx + r) / (2 * r);
  const sy = (my - camera.cy + r) / (2 * r);
  return {
    x: sx * W,
    y: (1 - sy) * H, // flip so +y is up
  };
}

function easeCamera() {
  camera.cx += (camera.targetCx - camera.cx) * CENTROID_SMOOTH;
  camera.cy += (camera.targetCy - camera.cy) * CENTROID_SMOOTH;
  camera.zoom += (camera.targetZoom - camera.zoom) * ZOOM_SMOOTH;
}

function renderFrame(t) {
  if (!ctx) return;
  easeCamera();
  ctx.clearRect(0, 0, W, H);
  if (!points.length) return;

  // Cache projected positions
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const s = manifoldToScreen(p.x, p.y);
    pointScreen[i] = s;
  }

  // 1) Ambient glow of the active paragraph's centroid region
  if (activeParagraph && activeParagraph.centroid) {
    const s = manifoldToScreen(activeParagraph.centroid.x, activeParagraph.centroid.y);
    const repo = activeParagraph.dominantRepo || 'other';
    const col = REPO_COLORS[repo].rgb;
    const r = Math.max(W, H) * 0.35 / camera.zoom * 0.6;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    g.addColorStop(0, `rgba(${col}, 0.12)`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 2) Reader trail (the path of understanding)
  if (readerTrail.length > 1) {
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (let i = 1; i < readerTrail.length; i++) {
      const a = readerTrail[i - 1], b = readerTrail[i];
      const age = (readerTrail.length - i) / readerTrail.length;
      const alpha = 0.05 + age * 0.30;
      const sa = manifoldToScreen(a.x, a.y);
      const sb = manifoldToScreen(b.x, b.y);
      ctx.strokeStyle = `rgba(232, 220, 195, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }
  }

  // 3) Points — dim by default, bright if in active paragraph's set,
  //    repo-colored.
  const activeSet = activeParagraph ? activeParagraph.chunkIdx : null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const s = pointScreen[i];
    const onscreen = s.x > -8 && s.x < W + 8 && s.y > -8 && s.y < H + 8;
    if (!onscreen) continue;
    const active = activeSet && activeSet.has(i);
    const base = active ? 0.72 : 0.10;
    const col = REPO_COLORS[p.repo].rgb;
    const radius = active ? 1.5 : 0.9;
    ctx.fillStyle = `rgba(${col}, ${base})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4) Capillaries from the paragraph centroid to its top chunks
  if (activeParagraph && activeParagraph.centroid && activeSet && activeSet.size) {
    const c = manifoldToScreen(activeParagraph.centroid.x, activeParagraph.centroid.y);
    let drawn = 0;
    for (const ci of activeSet) {
      if (drawn++ > 10) break;
      const p = points[ci];
      const s = pointScreen[ci];
      const col = REPO_COLORS[p.repo].rgb;
      ctx.strokeStyle = `rgba(${col}, 0.22)`;
      ctx.lineWidth = 0.7;
      const mx = (c.x + s.x) / 2 + (Math.sin(t * 0.0007 + ci) * 14);
      const my = (c.y + s.y) / 2 + (Math.cos(t * 0.0009 + ci) * 14);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.quadraticCurveTo(mx, my, s.x, s.y);
      ctx.stroke();
    }
  }

  // 5) Live M-warmth at the walk-anchor centroid (from /api/instant)
  if (live.anchors.length && live.centroidTarget) {
    const m = manifoldToScreen(live.centroidTarget.x, live.centroidTarget.y);
    const warmthR = 42 + Math.sin(t * 0.0009) * 8 + live.affinity * 40;
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, warmthR * 2.2);
    g.addColorStop(0, 'rgba(246,232,198,0.28)');
    g.addColorStop(0.35, 'rgba(214,164,96,0.14)');
    g.addColorStop(1, 'rgba(180,110,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, warmthR * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Capillaries M → live anchors (ALL chunks per src — dedup fix)
    for (let i = 0; i < live.anchors.length; i++) {
      const a = live.anchors[i];
      const indices = srcIndex.get(a.src) || [a.idx];
      const intro = live.anchorIntro.get(a.src) || performance.now();
      const introFade = Math.min(1, (performance.now() - intro) / 900);
      for (const idx of indices) {
        const p = points[idx];
        if (!p) continue;
        const s = manifoldToScreen(p.x, p.y);
        ctx.fillStyle = `rgba(246,232,198,${0.55 * introFade})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(240,230,200,${0.10 * introFade})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
    }

    // Core
    ctx.fillStyle = 'rgba(255,248,228,0.85)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6) Whisper trace — bright transient points along the query's walk
  if (whisperTrace.length) {
    const now = performance.now();
    for (let i = whisperTrace.length - 1; i >= 0; i--) {
      const w = whisperTrace[i];
      const age = (now - w.t0) / 1000;
      if (age > 14) { whisperTrace.splice(i, 1); continue; }
      const alpha = Math.max(0, 1 - age / 14);
      const s = manifoldToScreen(w.x, w.y);
      ctx.fillStyle = `rgba(255,255,240,${0.75 * alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,240,${0.25 * alpha})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7 + age * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  requestAnimationFrame(renderFrame);
}

// ── Live /api/instant polling (parallel to somewhere.html) ────────────────
async function pollInstant() {
  try {
    const r = await fetch(INSTANT_URL, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`instant http ${r.status}`);
    const d = await r.json();
    live.step    = d.step || 0;
    live.alpha   = d.alpha || 0;
    live.kappa   = d.kappa_last || 0;
    live.theta   = d.theta_M_vs_K || 0;
    live.affinity = d.M_top_affinity || 0;

    const anchors = Array.isArray(d.anchors) ? d.anchors.slice(0, 10) : [];
    const resolved = [];
    for (const a of anchors) {
      const src = a.source || a.src;
      if (!src) continue;
      let indices = srcIndex.get(src);
      if (!indices) {
        for (const [k, v] of srcIndex) {
          if (k.endsWith(src) || src.endsWith(k)) { indices = v; break; }
        }
      }
      if (!indices) continue;
      resolved.push({
        src, idx: indices[0],
        score: a.score || 0, rel: a.rel || 0,
        preview: (a.preview || '').replace(/\s+/g,' ').trim(),
      });
    }
    live.anchors = resolved;
    const now = performance.now();
    const newSrcs = new Set(resolved.map(a => a.src));
    for (const a of resolved) {
      if (!live.anchorIntro.has(a.src)) live.anchorIntro.set(a.src, now);
    }
    for (const s of Array.from(live.anchorIntro.keys())) {
      if (!newSrcs.has(s)) live.anchorIntro.delete(s);
    }
    if (resolved.length) {
      let mx = 0, my = 0, total = 0;
      for (const a of resolved) {
        const indices = srcIndex.get(a.src) || [a.idx];
        for (const i of indices) {
          const p = points[i];
          if (!p) continue;
          mx += p.x; my += p.y; total++;
        }
      }
      if (total > 0) live.centroidTarget = { x: mx / total, y: my / total };
    }
    live.lastOK = Date.now();
    live.lastErr = '';
    live.okCount++;
    setErr('');
  } catch (e) {
    live.errCount++;
    live.lastErr = (e && e.message) || 'fetch failed';
    setErr(`manifold: ${live.lastErr}`);
  }
}

// ── Paragraph IntersectionObserver ─────────────────────────────────────────
function setupObserver() {
  if (!paragraphMeta.length) return;
  const visibility = new Map(); // el -> ratio
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visibility.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
    // Pick the paragraph with highest visibility that has a centroid
    let best = null, bestV = 0;
    for (const [el, v] of visibility) {
      if (v <= 0.0) continue;
      const meta = paragraphMeta.find(m => m.el === el);
      if (!meta || !meta.centroid) continue;
      if (v > bestV) { bestV = v; best = meta; }
    }
    if (best && best !== activeParagraph) {
      activeParagraph = best;
      activeParagraphIdx = best.idx;
      // Pan toward its centroid; mild zoom-in for tight neighborhoods
      camera.targetCx = best.centroid.x;
      camera.targetCy = best.centroid.y;
      // Zoom is a function of how tight the chunk cluster is
      const spread = estimateSpread(best);
      camera.targetZoom = clamp(1.0 / Math.max(0.18, spread) * 0.55, 1.0, 3.5);

      // Push into reader trail
      readerTrail.push({ x: best.centroid.x, y: best.centroid.y, t: performance.now() });
      if (readerTrail.length > TRAIL_MAX) readerTrail.shift();

      // Mark active paragraph visually
      document.querySelectorAll('.article-body p.active-para').forEach(p => p.classList.remove('active-para'));
      best.el.classList.add('active-para');
    }
  }, {
    root: null,
    rootMargin: '-20% 0px -40% 0px',
    threshold: [0, 0.1, 0.25, 0.5, 0.75],
  });
  for (const m of paragraphMeta) io.observe(m.el);
}

function estimateSpread(meta) {
  if (!meta || !meta.chunkIdx || meta.chunkIdx.size < 2) return 0.4;
  let sx = 0, sy = 0, n = 0;
  for (const ci of meta.chunkIdx) {
    const p = points[ci]; if (!p) continue;
    sx += p.x; sy += p.y; n++;
  }
  if (!n) return 0.4;
  const cx = sx / n, cy = sy / n;
  let v = 0;
  for (const ci of meta.chunkIdx) {
    const p = points[ci]; if (!p) continue;
    v += Math.hypot(p.x - cx, p.y - cy);
  }
  return v / n;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Whisper box ────────────────────────────────────────────────────────────
function setupWhisper() {
  const form  = document.getElementById('rm-whisper');
  const input = document.getElementById('rm-whisper-input');
  const button= document.getElementById('rm-whisper-send');
  if (!form || !input || !button) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    button.disabled = true;
    button.textContent = 'reaching…';
    try {
      const r = await fetch(WALK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: text, scope: 'all' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      const now = performance.now();
      const trace = Array.isArray(d.trace) ? d.trace : [];
      for (const t of trace.slice(0, 14)) {
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
      input.value = '';
      pollInstant();
    } catch (err) {
      setErr('whisper: ' + ((err && err.message) || 'failed'));
    } finally {
      button.disabled = false;
      button.textContent = 'whisper';
    }
  });
}

// ── Hover on tinted word: log the chunks it appears in (agent-readable) ────
function setupHover() {
  document.addEventListener('mouseover', (e) => {
    const tgt = e.target;
    if (!tgt || !tgt.classList || !tgt.classList.contains('mw')) return;
    const w = tgt.dataset.word;
    const chunks = wordChunks.get(w) || [];
    tgt.title = `${w} · ${chunks.length} chunks · ${tgt.dataset.repo} (${tgt.dataset.conc})`;
  });
}

// ── Degradation: if manifold fails, hide canvas but keep essay readable ───
// Expose __readManifold early so agents can probe state even when the API is down.
window.__readManifold = {
  ready: false,
  errText: null,
  get points() { return points; },
  get paragraphs() { return paragraphMeta.map(m => ({
    idx: m.idx,
    centroid: m.centroid,
    words: [...m.words],
    chunks: [...(m.chunkIdx || [])],
    repo: m.dominantRepo,
  })); },
  get wordIndex() {
    const out = [];
    for (const [w, info] of wordRepoDominant) out.push({ word: w, ...info });
    return out;
  },
  get live() { return { ...live, anchors: live.anchors.map(a => a.src) }; },
  get camera() { return { ...camera }; },
  whisper: async (text) => {
    const input = document.getElementById('rm-whisper-input');
    if (input) input.value = text;
    document.getElementById('rm-whisper')?.requestSubmit();
  },
};

async function init() {
  if (!canvas || !ctx) return;
  resize();
  window.addEventListener('resize', resize);

  let count = 0;
  try {
    count = await loadManifold();
    setErr(`manifold · ${count} chunks · ${wordRepoDominant.size} tinted words`);
  } catch (e) {
    const msg = (e && e.message) || 'fetch failed';
    setErr('manifold unavailable: ' + msg);
    window.__readManifold.errText = msg;
    // Without manifold: still wire whisper + keep essay readable
    setupWhisper();
    return;
  }

  const wrapped = wrapWords('.article-body');
  const pcount  = indexParagraphs('.article-body');
  console.log(`[read-manifold] ${wrapped} words tinted across ${pcount} paragraphs`);

  setupObserver();
  setupWhisper();
  setupHover();

  // Initial camera: centered on first paragraph with a centroid
  const firstWithCentroid = paragraphMeta.find(m => m.centroid);
  if (firstWithCentroid) {
    camera.cx = camera.targetCx = firstWithCentroid.centroid.x;
    camera.cy = camera.targetCy = firstWithCentroid.centroid.y;
    activeParagraph = firstWithCentroid;
  }

  window.__readManifold.ready = true;

  pollInstant();
  setInterval(pollInstant, 5000);
  requestAnimationFrame(renderFrame);
}

init();
