/**
 * Origins Portal — A-Iconoclast Gallery
 *
 * 139 images cycle through 3 floating positions as the visitor scrolls.
 * Hover: image glides to viewport center and enlarges.
 * Click: fetch IPFS metadata, send as prompt to voice player.
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
let expandedSlot = null;
let collapsingSlot = null;   // slot currently animating back — drift must not touch
let driftRAF = null;

// ── Gentle drift via JS (no CSS animations to conflict) ──────────
const driftState = [];
const DRIFT_RANGE = 8; // pixels

function startDrift() {
  for (let i = 0; i < SLOT_COUNT; i++) {
    driftState[i] = {
      x: 0, y: 0,
      tx: (Math.random() - 0.5) * DRIFT_RANGE * 2,
      ty: (Math.random() - 0.5) * DRIFT_RANGE * 2,
      speed: 0.003 + Math.random() * 0.004,
    };
  }

  function tick() {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = driftState[i];
      const el = slotEls[i]?.slot;
      if (!el || el === expandedSlot || el === collapsingSlot) continue;

      // Ease toward target
      s.x += (s.tx - s.x) * s.speed;
      s.y += (s.ty - s.y) * s.speed;

      // Pick new target when close
      if (Math.abs(s.tx - s.x) < 0.5 && Math.abs(s.ty - s.y) < 0.5) {
        s.tx = (Math.random() - 0.5) * DRIFT_RANGE * 2;
        s.ty = (Math.random() - 0.5) * DRIFT_RANGE * 2;
      }

      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
    driftRAF = requestAnimationFrame(tick);
  }
  driftRAF = requestAnimationFrame(tick);
}

// ── Init ─────────────────────────────────────────────────────────

function init() {
  const wrap = document.createElement('div');
  wrap.className = 'nft-wrap';

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = document.createElement('div');
    slot.className = `nft-slot nft-pos-${i}`;
    slot.tabIndex = 0;
    slot.role = 'button';

    const img = document.createElement('img');
    img.className = 'nft-img';
    img.draggable = false;
    img.loading = 'lazy';

    const num = document.createElement('span');
    num.className = 'nft-num';

    const title = document.createElement('span');
    title.className = 'nft-title';

    slot.append(img, num, title);
    // Debounced hover — prevents rapid expand/collapse from drift movement
    let hoverTimer = null;
    slot.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => expandSlot(slot), 80);
    });
    slot.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      collapseSlot(slot);
    });
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      onClickSlot(slot);
    });
    wrap.appendChild(slot);
    slotEls.push({ slot, img, num, title });
  }

  document.body.appendChild(wrap);

  // Scrim
  const scrim = document.createElement('div');
  scrim.className = 'nft-scrim';
  scrim.addEventListener('click', () => { if (expandedSlot) collapseSlot(expandedSlot); });
  document.body.appendChild(scrim);

  fillSlots(1);
  window.addEventListener('scroll', onScroll, { passive: true });
  startDrift();
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
    s.img.src = src;
    s.img.alt = `A-Iconoclast #${id}`;
    s.num.textContent = `#${id}`;
    s.slot.dataset.tokenId = id;
    const cached = metaCache.get(id);
    s.title.textContent = cached?.name || '';
    setTimeout(() => s.slot.classList.add('visible'), 80 + i * 150);
  });
}

// ── Hover expand/collapse ────────────────────────────────────────

function expandSlot(slot) {
  if (expandedSlot === slot) return;
  if (expandedSlot) collapseSlot(expandedSlot);
  expandedSlot = slot;
  collapsingSlot = null; // cancel any in-progress collapse on this slot

  // Freeze drift position so we calculate from a stable point
  const idx = slotEls.findIndex(s => s.slot === slot);
  const d = driftState[idx] || { x: 0, y: 0 };

  // Get the slot's CSS-positioned origin (without drift)
  // We temporarily clear transform to read the true rect
  const savedTransform = slot.style.transform;
  slot.style.transition = 'none';
  slot.style.transform = 'none';
  const baseRect = slot.getBoundingClientRect();
  slot.style.transform = savedTransform;

  // Calculate offset from slot center to viewport center
  const slotCx = baseRect.left + baseRect.width / 2;
  const slotCy = baseRect.top + baseRect.height / 2;
  const vpCx = window.innerWidth / 2;
  const vpCy = window.innerHeight / 2;
  const dx = vpCx - slotCx;
  const dy = vpCy - slotCy;

  // Scale to 60% of smaller viewport dimension
  const targetSize = Math.min(window.innerWidth, window.innerHeight) * 0.6;
  const scale = targetSize / baseRect.width;

  // Force reflow before enabling transition
  void slot.offsetHeight;
  slot.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease, box-shadow 0.3s ease';
  slot.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  slot.style.opacity = '1';
  slot.style.zIndex = '50';
  slot.style.boxShadow = '0 12px 80px rgba(212, 165, 116, 0.25), 0 0 120px rgba(0, 0, 0, 0.6)';
  slot.classList.add('expanded');
  document.querySelector('.nft-scrim')?.classList.add('active');

  // Prefetch title
  const id = parseInt(slot.dataset.tokenId, 10);
  if (id) fetchMeta(id).then(m => {
    if (m?.name) {
      const t = slot.querySelector('.nft-title');
      if (t) t.textContent = m.name;
    }
  });
}

function collapseSlot(slot) {
  if (expandedSlot !== slot) return;
  expandedSlot = null;
  collapsingSlot = slot; // protect from drift during animation

  // Get drift position to return to
  const idx = slotEls.findIndex(s => s.slot === slot);
  const d = driftState[idx] || { x: 0, y: 0 };

  slot.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.4s ease, box-shadow 0.3s ease';
  slot.style.transform = `translate(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px)`;
  slot.style.opacity = '';
  slot.style.zIndex = '';
  slot.style.boxShadow = '';
  slot.classList.remove('expanded');
  document.querySelector('.nft-scrim')?.classList.remove('active');

  // Release to drift after animation completes
  slot.addEventListener('transitionend', function onEnd(e) {
    if (e.propertyName !== 'transform') return;
    slot.removeEventListener('transitionend', onEnd);
    if (collapsingSlot === slot) {
      collapsingSlot = null;
      slot.style.transition = 'none'; // let JS drift take over cleanly
    }
  });
}

// ── Scroll ───────────────────────────────────────────────────────

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    if (expandedSlot) collapseSlot(expandedSlot);
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

async function onClickSlot(slot) {
  const id = parseInt(slot.dataset.tokenId, 10);
  if (!id) return;

  // Stop any in-progress voice FIRST
  if (typeof window.voicePlayer?.stop === 'function') {
    window.voicePlayer.stop();
  }

  slot.classList.add('loading');
  console.log(`[gallery] Clicked #${id}, fetching metadata...`);
  const meta = await fetchMeta(id);
  slot.classList.remove('loading');

  if (!meta?.description) {
    console.warn(`[gallery] No description for #${id}`);
    return;
  }

  console.log(`[gallery] #${id} "${meta.name}" → voice prompt`);
  if (typeof window.voicePlayer?.speak === 'function') {
    window.voicePlayer.speak(meta.description, meta.name, `a-iconoclast #${id}`);
  }
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

// Boot
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
