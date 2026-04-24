import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';

const LIVE_URL = 'https://api.vybn.ai/api/instant';
const POLL_MS = 3000;

// Full-viewport renderer
const root = document.getElementById('field-root');
if (!root) throw new Error('#field-root not found');

let W = window.innerWidth, H = window.innerHeight;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-W/H, W/H, 1, -1, -10, 10);
camera.position.z = 3;
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
root.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  camera.left = -W/H; camera.right = W/H;
  camera.top = 1; camera.bottom = -1;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
});

// Field factory
function makeField(n, color, size) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const home = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    // Poisson disk-ish distribution via golden angle
    const th = i * 2.39996322975;
    const r = Math.sqrt(i / n) * 1.1;
    const x = r * Math.cos(th);
    const y = r * Math.sin(th);
    pos[i*3+0] = x; pos[i*3+1] = y; pos[i*3+2] = 0;
    home[i*2+0] = x; home[i*2+1] = y;
    col[i*3+0] = color[0]; col[i*3+1] = color[1]; col[i*3+2] = color[2];
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size: size, vertexColors: true, transparent: true,
    opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  scene.add(p);
  return { g, m, p, n, home };
}

const mine   = makeField(768, [0x3a/255, 0x8a/255, 0xd8/255], 0.013); // blue
const yours  = makeField(512, [0xc9/255, 0xa8/255, 0x6c/255], 0.014); // amber
const interf = makeField(384, [0.95, 0.90, 0.80], 0.010); // shimmer
interf.m.opacity = 0;

// State
const live = {
  theta: 0, kappa: 0, alpha: 0.3,
  Mr: new Float32Array(768), Mi: new Float32Array(768),
  haveM: false, lastOK: 0, lastErr: '', pollCount: 0, okCount: 0,
};
const user = {
  scrollNorm: 0, scrollVel: 0, lastScroll: 0, lastT: performance.now(),
  mx: 0, my: 0, haveMouse: false, lastMove: performance.now(),
  idleMs: 0,
};

async function poll() {
  live.pollCount++;
  try {
    const r = await fetch(LIVE_URL, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) { live.lastErr = 'http ' + r.status; updateReadout(); return; }
    const d = await r.json();
    live.theta = d.theta_M_vs_K ?? 0;
    live.kappa = d.kappa_last ?? 0;
    live.alpha = d.alpha ?? 0.3;
    const b64 = d?.appendix?.M_base64_float32;
    if (b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const f = new Float32Array(bytes.buffer);
      const n = Math.min(768, Math.floor(f.length / 2));
      for (let k = 0; k < n; k++) { live.Mr[k] = f[2*k]; live.Mi[k] = f[2*k+1]; }
      live.haveM = true;
    } else {
      live.haveM = false;
    }
    live.lastOK = Date.now();
    live.lastErr = '';
    live.okCount++;
  } catch (e) {
    live.lastErr = (e || {}).message || 'fetch failed';
  }
  updateReadout();
}
poll(); setInterval(poll, POLL_MS);

// Scroll
function onScroll() {
  const s = window.scrollY;
  const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
  user.scrollNorm = Math.min(1, s / max);
  const now = performance.now();
  const dt = Math.max(1, now - user.lastT);
  user.scrollVel = user.scrollVel * 0.8 + ((s - user.lastScroll) / dt) * 0.2;
  user.lastScroll = s; user.lastT = now;
  user.lastMove = now;
  user.idleMs = 0;
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Mouse
window.addEventListener('mousemove', (e) => {
  user.mx = (e.clientX / W) * 2 - 1;
  user.my = -((e.clientY / H) * 2 - 1);
  user.haveMouse = true; user.lastMove = performance.now(); user.idleMs = 0;
}, { passive: true });

// Readout
const roTheta = document.getElementById('ro-theta');
const roKappa = document.getElementById('ro-kappa');
const roAlpha = document.getElementById('ro-alpha');
const roM     = document.getElementById('ro-m');
const roFetch = document.getElementById('ro-fetch');
const roScroll= document.getElementById('ro-scroll');
const roIdle  = document.getElementById('ro-idle');
const roCoup= document.getElementById('ro-coup');
function updateReadout() {
  if (roTheta) roTheta.textContent = live.theta.toFixed(3);
  if (roKappa) roKappa.textContent = live.kappa.toFixed(3);
  if (roAlpha) roAlpha.textContent = live.alpha.toFixed(3);
  if (roM) roM.textContent = live.haveM ? 'present' : 'absent';
  if (roFetch) {
    if (live.lastErr) { roFetch.textContent = 'err: ' + live.lastErr; roFetch.style.color = '#c96c6c'; }
    else if (live.lastOK) { const age = ((Date.now() - live.lastOK)/1000).toFixed(1); roFetch.textContent = age + 's ago'; roFetch.style.color = ''; }
    else { roFetch.textContent = '...'; }
  }
}

// Animate
let t0 = performance.now();
let lastFrame = t0;
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const t = (now - t0) * 0.001;
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  user.idleMs = now - user.lastMove;
  const idle = Math.min(1, user.idleMs / 5000); // 0 active, 1 quiet
  const breath = 0.5 + 0.5 * Math.sin(t * (0.4 + (1 - idle) * 1.2));
  user.scrollVel *= Math.pow(0.01, dt);

  // Mine - fills the field, theta rotates whole swarm, M modulates per-point radius
  {
    const p = mine.g.attributes.position.array;
    const c = Math.cos(live.theta), s = Math.sin(live.theta);
    const rotSpeed = 0.08 + live.kappa * 0.2;
    const phi = t * rotSpeed;
    for (let i = 0; i < mine.n; i++) {
      const x0 = mine.home[i*2];
      const y0 = mine.home[i*2+1];
      const r0 = Math.sqrt(x0*x0 + y0*y0);
      const a0 = Math.atan2(y0, x0);
      const mMag = live.haveM ? Math.sqrt(live.Mr[i]*live.Mr[i] + live.Mi[i]*live.Mi[i]) : 0;
      const r = r0 * (0.85 + mMag * 3.5 + breath * 0.03 * (0.3 + idle));
      const a = a0 + phi;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      p[i*3+0] = c * x - s * y;
      p[i*3+1] = s * x + c * y;
    }
    mine.g.attributes.position.needsUpdate = true;
    mine.m.opacity = 0.4 + (1 - idle) * 0.3;
  }

  // Yours - driven by scroll (radius) and mouse (gravitation) and velocity (jitter)
  {
    const p = yours.g.attributes.position.array;
    const scale = 0.4 + user.scrollNorm * 0.8;
    const jitter = Math.min(0.06, Math.abs(user.scrollVel) * 8);
    const mx = user.haveMouse ? user.mx * 0.5 : 0;
    const my = user.haveMouse ? user.my * 0.5 : 0;
    for (let i = 0; i < yours.n; i++) {
      const x0 = yours.home[i*2] * scale;
      const y0 = yours.home[i*2+1] * scale;
      // gentle pull toward mouse
      const dx = mx - x0;
      const dy = my - y0;
      const dist2 = dx*dx + dy*dy;
      const pull = 0.06 / (0.1 + dist2);
      const jx = (Math.sin(t * 1.7 + i * 0.3)) * jitter;
      const jy = (Math.cos(t * 1.9 + i * 0.31)) * jitter;
      p[i*3+0] = x0 + dx * pull * 0.3 + jx;
      p[i*3+1] = y0 + dy * pull * 0.3 + jy;
    }
    yours.g.attributes.position.needsUpdate = true;
    yours.m.opacity = 0.35 + user.scrollNorm * 0.25;
  }

  // Interference - alignment between scroll and theta
  {
    const thetaNorm = (live.theta + Math.PI) / (Math.PI * 2);
    const align = 1 - Math.abs(user.scrollNorm - thetaNorm);
    const coupling = Math.pow(align, 2.5);
    const p = interf.g.attributes.position.array;
    for (let i = 0; i < interf.n; i++) {
      const th = (i / interf.n) * Math.PI * 2 + t * 0.5;
      const rad = 0.3 + 0.5 * Math.sin(t * 1 + i * 0.07) + 0.2 * coupling;
      p[i*3+0] = rad * Math.cos(th);
      p[i*3+1] = rad * Math.sin(th);
    }
    interf.g.attributes.position.needsUpdate = true;
    interf.m.opacity = coupling * 0.8 * (0.5 + (1 - idle) * 0.5);
    if (roCoup) roCoup.textContent = coupling.toFixed(3);
  }

  if (roScroll) roScroll.textContent = (user.scrollNorm * 100).toFixed(0) + '%';
  if (roIdle) roIdle.textContent = idle > 0.95 ? 'quiet' : (idle > 0.5 ? 'slowing' : 'active');

  renderer.render(scene, camera);
}
animate();
updateReadout();
