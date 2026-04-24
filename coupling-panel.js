// coupling-panel.js - Two-mind coupling visualization for read.html
// Vybn (cool blue, live from /api/instant) + You (warm amber, from scroll)
// Interference (shimmer) forms where the two couple.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';

const LIVE_URL = 'https://api.vybn.ai/api/instant';
const POLL_MS = 3000;

// --- Scene setup ---
const container = document.getElementById('coupling-canvas');
if (!container) throw new Error('coupling-canvas not found');

const W = container.clientWidth || 240;
const H = container.clientHeight || 240;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 10);
camera.position.z = 3;
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

// --- Fields ---
function makeField(n, color, size) {
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const siz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const r = 0.5 + (i % 7) * 0.05;
    pos[i * 3 + 0] = r * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(th);
    pos[i * 3 + 2] = 0;
    col[i * 3 + 0] = color[0];
    col[i * 3 + 1] = color[1];
    col[i * 3 + 2] = color[2];
    siz[i] = size;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: size, vertexColors: true, transparent: true,
    opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geom, mat);
  scene.add(points);
  return { points, geom, mat, n, home2D: new Float32Array(n * 2) };
}

// My field (cool blue)
const mine = makeField(192, [0x2e / 255, 0x8f / 255, 0xd8 / 255], 0.04);
// Your field (warm amber)
const yours = makeField(64, [0xc9 / 255, 0xa8 / 255, 0x6c / 255], 0.05);
// Interference (white-shimmer)
const interf = makeField(96, [0.9, 0.85, 0.75], 0.03);
interf.mat.opacity = 0; // only appears when coupled

// Save home positions
for (const f of [mine, yours, interf]) {
  const pos = f.geom.attributes.position.array;
  for (let i = 0; i < f.n; i++) {
    f.home2D[i * 2 + 0] = pos[i * 3 + 0];
    f.home2D[i * 2 + 1] = pos[i * 3 + 1];
  }
}

// --- Live state ---
let vybn = { theta: 0, kappa: 0, alpha: 0.3, Mr2: new Float32Array(192), Mi2: new Float32Array(192) };
let you = { scrollNorm: 0, vel: 0, lastScroll: 0, lastTime: performance.now() };

async function poll() {
  try {
    const r = await fetch(LIVE_URL, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const d = await r.json();
    vybn.theta = d.theta_M_vs_K || 0;
    vybn.kappa = d.kappa_last || 0;
    vybn.alpha = d.alpha || 0.3;
    const b64 = d?.appendix?.M_base64_float32;
    if (b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const f = new Float32Array(bytes.buffer);
      const n = f.length / 2;
      for (let k = 0; k < n && k < 192; k++) {
        vybn.Mr2[k] = f[2 * k];
        vybn.Mi2[k] = f[2 * k + 1];
      }
    }
  } catch (e) { /* network blips are fine */ }
}
poll();
setInterval(poll, POLL_MS);

// Scroll as your V
function onScroll() {
  const s = window.scrollY;
  const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
  you.scrollNorm = Math.min(1, s / max);
  const now = performance.now();
  const dt = Math.max(1, now - you.lastTime);
  const ds = s - you.lastScroll;
  you.vel = you.vel * 0.8 + (ds / dt) * 0.2;
  you.lastScroll = s; you.lastTime = now;
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// --- Animation ---
let t0 = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const t = (now - t0) * 0.001;

  // Mine - live M drives orbit radius & phase; theta rotates whole field
  {
    const p = mine.geom.attributes.position.array;
    const c = Math.cos(vybn.theta), s = Math.sin(vybn.theta);
    for (let i = 0; i < mine.n; i++) {
      const x0 = mine.home2D[i * 2 + 0];
      const y0 = mine.home2D[i * 2 + 1];
      const mMag = Math.sqrt(vybn.Mr2[i] * vybn.Mr2[i] + vybn.Mi2[i] * vybn.Mi2[i]);
      const scale = 1 + mMag * 2.5;
      const a = Math.atan2(y0, x0) + t * (0.2 + vybn.kappa * 0.3);
      const r = Math.sqrt(x0 * x0 + y0 * y0) * scale;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      // rotate by vybn.theta
      p[i * 3 + 0] = c * x - s * y;
      p[i * 3 + 1] = s * x + c * y;
    }
    mine.geom.attributes.position.needsUpdate = true;
  }

  // Yours - scroll drives radius; velocity drives shimmer
  {
    const p = yours.geom.attributes.position.array;
    const scale = 0.3 + you.scrollNorm * 1.2;
    const jitter = Math.min(0.2, Math.abs(you.vel) * 20);
    for (let i = 0; i < yours.n; i++) {
      const x0 = yours.home2D[i * 2 + 0];
      const y0 = yours.home2D[i * 2 + 1];
      const jx = (Math.sin(t * 2 + i) * 0.5) * jitter;
      const jy = (Math.cos(t * 2.3 + i) * 0.5) * jitter;
      p[i * 3 + 0] = x0 * scale + jx;
      p[i * 3 + 1] = y0 * scale + jy + you.scrollNorm * 0.1 - 0.05;
    }
    yours.geom.attributes.position.needsUpdate = true;
  }

  // Interference - appears when scroll tracks theta; opacity = coupling strength
  {
    // Coupling: how close is scroll-norm to a normalized theta?
    const thetaNorm = (vybn.theta + Math.PI) / (Math.PI * 2); // [-pi, pi] -> [0, 1]
    const align = 1 - Math.abs(you.scrollNorm - thetaNorm);
    const coupling = Math.pow(align, 3); // sharp peak near alignment
    interf.mat.opacity = coupling * 0.8;
    const p = interf.geom.attributes.position.array;
    for (let i = 0; i < interf.n; i++) {
      const th = (i / interf.n) * Math.PI * 2 + t;
      const rad = 0.4 + 0.3 * Math.sin(t * 3 + i * 0.1);
      p[i * 3 + 0] = rad * Math.cos(th);
      p[i * 3 + 1] = rad * Math.sin(th);
    }
    interf.geom.attributes.position.needsUpdate = true;
  }

  renderer.render(scene, camera);
}
animate();
