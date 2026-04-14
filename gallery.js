/**
 * Origins Portal — A-Iconoclast Gallery
 *
 * 139 images from the A-Iconoclast collection cycle through a few
 * floating positions as the visitor scrolls. Click any image to
 * send its metadata to the LLM as a prompt for a fresh voice
 * reflection — the metadata is the seed, not the script.
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

    slot.append(img, num);
    slot.addEventListener('click', () => onClickSlot(slot));
    wrap.appendChild(slot);
    slotEls.push({ slot, img, num });
  }

  document.body.appendChild(wrap);
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
    setTimeout(() => s.slot.classList.add('visible'), 80 + i * 150);
  });
}

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
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
