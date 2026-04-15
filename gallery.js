/**
 * Origins Portal — A-Iconoclast Gallery
 *
 * 139 images cycle through 3 floating positions as the visitor scrolls.
 * Desktop hover: image calmly enlarges in place with a smooth CSS transition.
 * Mobile tap: image enlarges, drifts toward center, and activates voice.
 * Click/tap: fetch IPFS metadata, send as prompt to voice player.
 */

const GALLERY = {
  total: 139,
  metaBase: 'https://ipfs.io/ipfs/bafybeihblxz6zsdj7jvktuaqiznty2pye22qa6tc5z26sohij4vrvd32km',
  imgBase: 'https://ipfs.io/ipfs/bafybeie7ymjq5i7jzlpxxf64qvssziqihkuq6hrakgyglqgeyd6f32i3bq',
};

const metaCache = new Map();
const SLOT_COUNT = 3;
let slotEls = [];
let currentBase = 1;
let scrollTicking = false;
let hoveredSlot = null;
let driftRAF = null;
let isMobile = window.innerWidth < 640;
let expandedSlot = null; // tracks the currently expanded slot on mobile

// ── Gentle drift via JS ──────────────────────────────────────────
const driftState = [];
const DRIFT_RANGE = 6; // pixels — subtle

function startDrift() {
  for (let i = 0; i < SLOT_COUNT; i++) {
    driftState[i] = {
      x: 0, y: 0,
      tx: (Math.random() - 0.5) * DRIFT_RANGE * 2,
      ty: (Math.random() - 0.5) * DRIFT_RANGE * 2,
      speed: 0.002 + Math.random() * 0.003,
    };
  }

  function tick() {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = driftState[i];
      const el = slotEls[i]?.slot;
      if (!el) continue;
      // Pause drift while hovered or expanded
      if (el === hoveredSlot || el === expandedSlot) continue;

      s.x += (s.tx - s.x) * s.speed;
      s.y += (s.ty - s.y) * s.speed;

      if (Math.abs(s.tx - s.x) < 0.3 && Math.abs(s.ty - s.y) < 0.3) {
        s.tx = (Math.random() - 0.5) * DRIFT_RANGE * 2;
        s.ty = (Math.random() - 0.5) * DRIFT_RANGE * 2;
      }

      el.style.translate = `${s.x.toFixed(1)}px ${s.y.toFixed(1)}px`;
    }
    driftRAF = requestAnimationFrame(tick);
  }
  driftRAF = requestAnimationFrame(tick);
}

// ── Init ─────────────────────────────────────────────────────────

function init() {
  isMobile = window.innerWidth < 640;
  const wrap = document.createElement('div');
  wrap.className = 'nft-wrap';

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = document.createElement('div');
    slot.className = `nft-slot nft-pos-${i}`;
    slot.tabIndex = 0;
    slot.role = 'button';
    slot.dataset.slotIndex = i;

    const img = document.createElement('img');
    img.className = 'nft-img';
    img.draggable = false;
    img.loading = 'lazy';

    const num = document.createElement('span');
    num.className = 'nft-num';

    const title = document.createElement('span');
    title.className = 'nft-title';

    slot.append(img, num, title);

    // Desktop: mouse events for hover enlargement
    if (!isMobile) {
      slot.addEventListener('mouseenter', () => {
        hoveredSlot = slot;
        slot.classList.add('hovered');
        computeHoverScale(slot);
      });
      slot.addEventListener('mouseleave', () => {
        if (hoveredSlot === slot) hoveredSlot = null;
        slot.classList.remove('hovered');
        slot.style.scale = '';
        slot.style.transform = '';
      });
    }

    // Unified click/tap handler — works on both desktop and mobile
    slot.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (isMobile) {
        handleMobileTap(slot, i);
      } else {
        onClickSlot(slot);
      }
    });

    // Prevent any touchstart from propagating to underlying elements
    slot.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { passive: true });

    // Prevent touchend from triggering ghost clicks on underlying elements
    slot.addEventListener('touchend', (e) => {
      e.stopPropagation();
    }, { passive: true });

    wrap.appendChild(slot);
    slotEls.push({ slot, img, num, title });
  }

  document.body.appendChild(wrap);
  fillSlots(1);
  window.addEventListener('scroll', onScroll, { passive: true });
  startDrift();

  // Listen for resize to update isMobile
  window.addEventListener('resize', () => {
    isMobile = window.innerWidth < 640;
  }, { passive: true });

  // On mobile, tapping outside an expanded image collapses it
  if (isMobile) {
    document.addEventListener('click', (e) => {
      if (expandedSlot && !expandedSlot.contains(e.target)) {
        collapseExpandedSlot();
      }
    });
  }
}

// ── Mobile tap: expand + drift toward center + voice ─────────────

function handleMobileTap(slot, slotIndex) {
  // If this slot is already expanded, collapse it
  if (expandedSlot === slot) {
    collapseExpandedSlot();
    return;
  }

  // Collapse any previously expanded slot
  if (expandedSlot) {
    collapseExpandedSlot(false); // don't animate, just reset
  }

  // Expand this slot: enlarge + drift toward center
  expandedSlot = slot;
  slot.classList.add('mobile-expanded');

  // Compute scale to fill ~70% of viewport
  const rect = slot.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targetSize = Math.min(vw, vh) * 0.70;
  const s = Math.min(targetSize / rect.width, targetSize / rect.height);
  const clamped = Math.max(1.5, Math.min(4, s));

  // Compute translation to drift toward center
  const slotCenterX = rect.left + rect.width / 2;
  const slotCenterY = rect.top + rect.height / 2;
  const viewCenterX = vw / 2;
  const viewCenterY = vh / 2;

  // Drift ~80% of the way toward center (not fully — keeps it organic)
  const driftX = (viewCenterX - slotCenterX) * 0.80;
  const driftY = (viewCenterY - slotCenterY) * 0.80;

  slot.style.scale = clamped.toFixed(2);
  slot.style.translate = `${driftX.toFixed(1)}px ${driftY.toFixed(1)}px`;

  // Trigger voice
  onClickSlot(slot);
}

function collapseExpandedSlot(animate = true) {
  if (!expandedSlot) return;
  const slot = expandedSlot;
  expandedSlot = null;
  slot.classList.remove('mobile-expanded');
  slot.style.scale = '';
  slot.style.translate = '';
}

// ── Fill slots with images ───────────────────────────────────────

function fillSlots(base) {
  currentBase = Math.max(1, Math.min(base, GALLERY.total - SLOT_COUNT + 1));
  slotEls.forEach((s, i) => {
    const id = currentBase + i;
    if (id > GALLERY.total) { s.slot.classList.remove('visible'); return; }
    const src = `${GALLERY.imgBase}/${id}`;
    if (s.img.getAttribute('src') === src) return;
    s.slot.classList.remove('visible');
    // If this slot was expanded, collapse it during image swap
    if (expandedSlot === s.slot) collapseExpandedSlot(false);
    s.img.src = src;
    s.img.alt = `A-Iconoclast #${id}`;
    s.num.textContent = `#${id}`;
    s.slot.dataset.tokenId = id;
    const cached = metaCache.get(id);
    s.title.textContent = cached?.name || '';
    setTimeout(() => s.slot.classList.add('visible'), 80 + i * 150);
  });
}

// ── Scroll ───────────────────────────────────────────────────────

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = Math.max(0, Math.min(1, window.scrollY / max));
    const target = Math.floor(p * (GALLERY.total - SLOT_COUNT)) + 1;
    if (Math.abs(target - currentBase) >= SLOT_COUNT) fillSlots(target);
    const wrap = document.querySelector('.nft-wrap');
    if (wrap) wrap.classList.toggle('hidden', p < 0.04);
    scrollTicking = false;
  });
}

// ── Click → voice ────────────────────────────────────────────────

let voiceInFlight = false;

async function onClickSlot(slot) {
  const id = parseInt(slot.dataset.tokenId, 10);
  if (!id) return;

  // If voice is already playing or generating, let it finish
  if (voiceInFlight) {
    console.log(`[gallery] Click ignored — voice in flight`);
    return;
  }

  voiceInFlight = true;
  slot.classList.add('loading');
  console.log(`[gallery] Clicked #${id}, fetching metadata...`);
  const meta = await fetchMeta(id);
  slot.classList.remove('loading');

  if (!meta?.description) {
    console.warn(`[gallery] No description for #${id}`);
    voiceInFlight = false;
    return;
  }

  console.log(`[gallery] #${id} "${meta.name}" → voice prompt`);
  if (typeof window.voicePlayer?.speak === 'function') {
    await window.voicePlayer.speak(meta.description, meta.name, `a-iconoclast #${id}`, { fromClick: true });
  }
  voiceInFlight = false;
}

// ── Metadata fetch ───────────────────────────────────────────────

async function fetchMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const url = `${GALLERY.metaBase}/${id}.json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const d = await r.json();
    metaCache.set(id, d);
    return d;
  } catch (e) {
    console.warn(`[gallery] Metadata error #${id}:`, e.message);
    return null;
  }
}

// ── Viewport-aware hover scale (desktop only) ───────────────────

function computeHoverScale(slot) {
  const rect = slot.getBoundingClientRect();
  const slotW = rect.width;
  const slotH = rect.height;
  if (!slotW || !slotH) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Target: expanded image fills ~55% of the smaller viewport dimension
  const targetFrac = 0.55;
  const targetSize = Math.min(vw, vh) * targetFrac;
  const s = Math.min(targetSize / slotW, targetSize / slotH);

  // Clamp: at least 1.5x, at most 4x
  const clamped = Math.max(1.5, Math.min(4, s));
  slot.style.scale = clamped.toFixed(2);
}

// Boot
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
