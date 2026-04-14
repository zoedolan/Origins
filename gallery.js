/**
 * Origins Portal — A-Iconoclast Gallery
 *
 * 139 images from the A-Iconoclast collection cycle through a few
 * floating positions as the visitor scrolls. Click any image to
 * send its metadata to the LLM as a prompt for a fresh voice
 * reflection — the metadata is the seed, not the script.
 *
 * Hover: image glides toward the center of the viewport and enlarges
 * to near full-view. Release: it drifts back to its floating position.
 */

const GALLERY = {
  total: 139,
  metaBase: 'https://ipfs.io/ipfs/bafybeihblxz6zsdj7jvktuaqiznty2pye22qa6tc5z26sohij4vrvd32km',
  imgBase: 'https://ipfs.io/ipfs/bafybeie7ymjq5i7jzlpxxf64qvssziqihkuq6hrakgyglqgeyd6f32i3bq',
};

const metaCache = new Map();

// 3 floating slots — positioned via CSS
const SLOT_COUNT = 3;
let slotEls = [];
let currentBase = 1;
let scrollTicking = false;
let expandedSlot = null; // track which slot is currently expanded

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

    // Title overlay shown on hover
    const title = document.createElement('span');
    title.className = 'nft-title';

    slot.append(img, num, title);
    slot.addEventListener('click', () => onClickSlot(slot));
    slot.addEventListener('mouseenter', () => expandSlot(slot));
    slot.addEventListener('mouseleave', () => collapseSlot(slot));
    wrap.appendChild(slot);
    slotEls.push({ slot, img, num, title });
  }

  document.body.appendChild(wrap);

  // Add the scrim for expanded state
  const scrim = document.createElement('div');
  scrim.className = 'nft-scrim';
  scrim.addEventListener('click', () => { if (expandedSlot) collapseSlot(expandedSlot); });
  document.body.appendChild(scrim);

  fillSlots(1);
  window.addEventListener('scroll', onScroll, { passive: true });
}

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
    // Show title if we have cached metadata
    const cached = metaCache.get(id);
    s.title.textContent = cached?.name || '';
    setTimeout(() => s.slot.classList.add('visible'), 80 + i * 150);
  });
}

// ── Hover expand/collapse ────────────────────────────────────────

function expandSlot(slot) {
  if (expandedSlot === slot) return;
  expandedSlot = slot;

  // Kill drift animation completely — it conflicts with transform
  slot.style.animation = 'none';
  slot.style.translate = 'none';

  // Force layout so the browser registers the animation stop before we read position
  void slot.offsetHeight;

  const rect = slot.getBoundingClientRect();
  const slotCx = rect.left + rect.width / 2;
  const slotCy = rect.top + rect.height / 2;

  const vpCx = window.innerWidth / 2;
  const vpCy = window.innerHeight / 2;

  // How far to move to reach center
  const dx = vpCx - slotCx;
  const dy = vpCy - slotCy;

  // Target size: 65% of the smaller viewport dimension
  const targetSize = Math.min(window.innerWidth, window.innerHeight) * 0.65;
  const currentSize = rect.width;
  const scaleFactor = targetSize / currentSize;

  slot.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease, box-shadow 0.4s ease';
  slot.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleFactor})`;
  slot.style.opacity = '1';
  slot.style.zIndex = '50';
  slot.style.borderRadius = '10px';
  slot.style.boxShadow = '0 12px 80px rgba(212, 165, 116, 0.25), 0 0 120px rgba(0, 0, 0, 0.6)';
  slot.classList.add('expanded');

  // Show scrim
  document.querySelector('.nft-scrim')?.classList.add('active');

  // Prefetch metadata for the title
  const id = parseInt(slot.dataset.tokenId, 10);
  if (id) {
    fetchMeta(id).then(meta => {
      if (meta?.name) {
        const titleEl = slot.querySelector('.nft-title');
        if (titleEl) titleEl.textContent = meta.name;
      }
    });
  }
}

function collapseSlot(slot) {
  if (expandedSlot !== slot) return;
  expandedSlot = null;

  slot.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.4s ease, box-shadow 0.3s ease';
  slot.style.transform = '';
  slot.style.opacity = '';
  slot.style.zIndex = '';
  slot.style.borderRadius = '';
  slot.style.boxShadow = '';
  slot.classList.remove('expanded');

  // Restore drift animation after collapse transition finishes
  setTimeout(() => {
    slot.style.animation = '';
    slot.style.translate = '';
  }, 500);

  // Hide scrim
  document.querySelector('.nft-scrim')?.classList.remove('active');
}

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    // Collapse any expanded image on scroll
    if (expandedSlot) collapseSlot(expandedSlot);

    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = Math.max(0, Math.min(1, window.scrollY / max));
    const target = Math.floor(p * (GALLERY.total - SLOT_COUNT)) + 1;
    if (Math.abs(target - currentBase) >= SLOT_COUNT) fillSlots(target);
    // Hide in entry section
    const wrap = document.querySelector('.nft-wrap');
    if (wrap) wrap.classList.toggle('hidden', p < 0.04);
    scrollTicking = false;
  });
}

async function onClickSlot(slot) {
  const id = parseInt(slot.dataset.tokenId, 10);
  if (!id) return;
  slot.classList.add('loading');
  console.log(`[gallery] Clicked A-Iconoclast #${id}, fetching metadata...`);
  const meta = await fetchMeta(id);
  slot.classList.remove('loading');
  if (!meta) {
    console.warn(`[gallery] No metadata returned for #${id}`);
    return;
  }
  if (!meta.description) {
    console.warn(`[gallery] Metadata for #${id} has no description:`, meta);
    return;
  }

  console.log(`[gallery] #${id} "${meta.name}" — sending description as voice prompt:`, meta.description.slice(0, 100) + '...');

  // Dispatch to the voice player (defined in voice.js)
  if (typeof window.voicePlayer?.speak === 'function') {
    window.voicePlayer.speak(meta.description, meta.name, `a-iconoclast #${id}`);
  } else {
    console.warn('[gallery] window.voicePlayer.speak not available');
  }
}

async function fetchMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const url = `${GALLERY.metaBase}/${id}.json`;
  console.log(`[gallery] Fetching metadata: ${url}`);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) {
      console.warn(`[gallery] Metadata fetch failed: ${r.status} ${r.statusText}`);
      return null;
    }
    const d = await r.json();
    console.log(`[gallery] Metadata for #${id}:`, d.name, '—', (d.description || '').slice(0, 80));
    metaCache.set(id, d);
    return d;
  } catch (e) {
    console.warn(`[gallery] Metadata fetch error for #${id}:`, e.message);
    return null;
  }
}

// Boot
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
