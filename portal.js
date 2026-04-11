/**
 * Origins Portal — Main Engine
 * Ties together Three.js rendering, particle physics, scroll-driven animations,
 * and the coupled equation Z' = α·Z + V·e^{iθ_v}
 */

import * as THREE from 'three';
import { OrganicField, DigitalField, InterferenceField } from './particles.js';
import { TextParticleSystem } from './text-particles.js';

// ============================================
// Configuration
// ============================================
const CONFIG = {
  // Particle counts — adaptive
  get particleCount() {
    const isMobile = window.innerWidth < 768;
    const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    if (isMobile) return 5000;
    if (isLowEnd) return 12000;
    return 25000;
  },
  get interferenceCount() {
    const isMobile = window.innerWidth < 768;
    if (isMobile) return 2000;
    return 10000;
  },
  totalScrollHeight: 1600, // in vh units
  backgroundColor: 0x0a0a0f,
  cameraZ: 5,
  cameraNear: 0.1,
  cameraFar: 50,
};

// ============================================
// Global State
// ============================================
let renderer, scene, camera;
let organicField, digitalField, interferenceField;
let textSystem;
let clock;
let scrollProgress = 0; // 0 to 1 normalized
let scrollVh = 0; // current scroll in vh
let mouseX = 0.5, mouseY = 0.5;
let currentSection = 0;
let isInitialized = false;
let frameCount = 0;

// Section boundaries in vh
const SECTIONS = [
  { name: 'entry',          start: 0,    end: 100 },
  { name: 'question',       start: 100,  end: 300 },
  { name: 'queenboat',      start: 300,  end: 500 },
  { name: 'fukuyama',       start: 500,  end: 700 },
  { name: 'epistemologies',  start: 700,  end: 1100 },
  { name: 'insight',        start: 1100, end: 1400 },
  { name: 'portal',         start: 1400, end: 1600 },
];

// ============================================
// Initialization
// ============================================
async function init() {
  const canvas = document.getElementById('portal-canvas');
  
  // Try WebGPU first, fallback to WebGL
  let useWebGPU = false;
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) useWebGPU = true;
    }
  } catch (e) {
    // WebGPU not available
  }
  
  // Use standard WebGLRenderer (most compatible, best performance)
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // Performance
    alpha: false,
    powerPreference: 'high-performance',
    // preserveDrawingBuffer for screenshot compatibility
    preserveDrawingBuffer: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(CONFIG.backgroundColor, 1);
  
  // Scene
  scene = new THREE.Scene();
  // No fog — particles in the void, clean look
  
  // Camera — wider FOV on mobile for visibility
  const isMobile = window.innerWidth < 768;
  const fov = isMobile ? 75 : 60;
  camera = new THREE.PerspectiveCamera(
    fov,
    window.innerWidth / window.innerHeight,
    CONFIG.cameraNear,
    CONFIG.cameraFar
  );
  camera.position.set(0, 0, isMobile ? 7 : CONFIG.cameraZ);
  camera.lookAt(0, 0, 0);
  
  // Particle fields
  const count = CONFIG.particleCount;
  organicField = new OrganicField(count, scene);
  digitalField = new DigitalField(count, scene);
  interferenceField = new InterferenceField(CONFIG.interferenceCount, scene);
  
  // Adjust starting positions for mobile (narrower viewport)
  if (isMobile) {
    organicField.centerX = -1.5;
    digitalField.centerX = 1.5;
    // Reposition existing particles closer
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      organicField.positions[i3] = organicField.positions[i3] + 1.5; // shift right
      digitalField.positions[i3] = digitalField.positions[i3] - 1.5; // shift left
    }
    organicField.updateGeometry();
    digitalField.updateGeometry();
  }
  
  // Text particle system
  textSystem = new TextParticleSystem();
  
  // Clock
  clock = new THREE.Clock();
  
  // Events
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  
  // Setup GSAP ScrollTrigger
  setupScrollTriggers();
  
  // Hide loading screen
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    setTimeout(() => {
      loadingScreen.classList.add('hidden');
      setTimeout(() => loadingScreen.remove(), 1500);
    }, 800);
  }
  
  isInitialized = true;
  animate();
}

// ============================================
// GSAP ScrollTrigger Setup
// ============================================
function setupScrollTriggers() {
  gsap.registerPlugin(ScrollTrigger);
  const vh = window.innerHeight;
  
  // Helper: create scroll-position-based fade for fixed overlays
  function fadeOverlay(id, startVh, peakVh, endVh) {
    const el = document.getElementById(id);
    if (!el) return;
    
    // Fade in
    ScrollTrigger.create({
      trigger: document.body,
      start: startVh * vh + 'px top',
      end: peakVh * vh + 'px top',
      scrub: 0.5,
      onUpdate: function(self) {
        el.style.opacity = self.progress;
      }
    });
    
    // Fade out
    ScrollTrigger.create({
      trigger: document.body,
      start: peakVh * vh + 'px top',
      end: endVh * vh + 'px top',
      scrub: 0.5,
      onUpdate: function(self) {
        el.style.opacity = 1 - self.progress;
      }
    });
  }
  
  // --- Section 0: Entry title (starts visible, fades out) ---
  var entryEl = document.getElementById('overlay-entry');
  if (entryEl) {
    entryEl.style.opacity = 1;
    ScrollTrigger.create({
      trigger: document.body,
      start: '0px top',
      end: 0.85 * vh + 'px top',
      scrub: 0.5,
      onUpdate: function(self) {
        entryEl.style.opacity = 1 - self.progress;
      }
    });
  }
  
  // --- Section 2: Queen Boat texts ---
  fadeOverlay('qt-1', 3.0, 3.3, 3.55);
  fadeOverlay('qt-2', 3.5, 3.8, 4.05);
  fadeOverlay('qt-3', 4.0, 4.25, 4.5);
  fadeOverlay('qt-4', 4.4, 4.65, 4.95);
  
  // --- Section 3: Cascade labels ---
  fadeOverlay('cl-family',      5.0, 5.2, 5.4);
  fadeOverlay('cl-tribe',       5.3, 5.5, 5.7);
  fadeOverlay('cl-species',     5.6, 5.8, 6.0);
  fadeOverlay('cl-biosphere',   5.9, 6.1, 6.3);
  fadeOverlay('cl-mathematics', 6.3, 6.6, 7.0);
  
  // --- Section 4: Epistemology texts ---
  fadeOverlay('ep-apriori',     7.0, 7.4, 7.8);
  fadeOverlay('ep-aposteriori', 7.8, 8.2, 8.6);
  fadeOverlay('ep-asynthesi',   8.6, 9.0, 9.4);
  fadeOverlay('ep-asymbiosi',   9.4, 9.8, 10.5);
  
  // --- Section 5: Insight lines (cumulative reveal) ---
  var insightOverlay = document.getElementById('overlay-insight');
  if (insightOverlay) {
    // Fade in the container
    ScrollTrigger.create({
      trigger: document.body,
      start: 11 * vh + 'px top',
      end: 11.5 * vh + 'px top',
      scrub: 0.5,
      onUpdate: function(self) {
        insightOverlay.style.opacity = self.progress;
      }
    });
    // Fade out
    ScrollTrigger.create({
      trigger: document.body,
      start: 13.5 * vh + 'px top',
      end: 14 * vh + 'px top',
      scrub: 0.5,
      onUpdate: function(self) {
        insightOverlay.style.opacity = 1 - self.progress;
      }
    });
    
    // Each line appears sequentially
    ['il-1', 'il-2', 'il-3', 'il-4', 'il-5'].forEach(function(id, idx) {
      var el = document.getElementById(id);
      if (!el) return;
      var startPx = (11.2 + idx * 0.45) * vh;
      ScrollTrigger.create({
        trigger: document.body,
        start: startPx + 'px top',
        end: (startPx + 0.3 * vh) + 'px top',
        scrub: 0.5,
        onEnter: function() { el.classList.add('visible'); },
        onLeaveBack: function() { el.classList.remove('visible'); },
      });
    });
  }
  
  // --- Section 6: Portal final ---
  var portalFinal = document.getElementById('overlay-portal');
  if (portalFinal) {
    ScrollTrigger.create({
      trigger: document.body,
      start: 14.3 * vh + 'px top',
      end: 15 * vh + 'px top',
      scrub: 1,
      onUpdate: function(self) {
        portalFinal.style.opacity = self.progress;
      }
    });
  }
}

// ============================================
// Event Handlers
// ============================================
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function onMouseMove(e) {
  mouseX = e.clientX / window.innerWidth;
  mouseY = e.clientY / window.innerHeight;
}

function onScroll() {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  scrollProgress = docHeight > 0 ? scrollTop / docHeight : 0;
  scrollVh = scrollTop / window.innerHeight * 100;
  
  // Determine current section
  for (let i = SECTIONS.length - 1; i >= 0; i--) {
    if (scrollVh >= SECTIONS[i].start) {
      currentSection = i;
      break;
    }
  }
  
  // Hide scroll indicator after first scroll
  var indicator = document.getElementById('scroll-indicator');
  if (indicator && scrollVh > 10) {
    indicator.classList.add('hidden');
  } else if (indicator && scrollVh <= 5) {
    indicator.classList.remove('hidden');
  }
  
  // Update progress bar
  var progressBar = document.getElementById('scroll-progress');
  if (progressBar) {
    progressBar.style.width = (scrollProgress * 100) + '%';
    if (scrollVh > 10) {
      progressBar.classList.add('visible');
    } else {
      progressBar.classList.remove('visible');
    }
  }
}

// ============================================
// Section-specific particle behaviors
// ============================================
function updateSectionBehaviors(dt) {
  const section = SECTIONS[currentSection];
  if (!section) return;
  
  const sectionProgress = (scrollVh - section.start) / (section.end - section.start);
  const sp = Math.max(0, Math.min(1, sectionProgress));
  
  switch (section.name) {
    case 'entry':
      updateEntry(sp, dt);
      break;
    case 'question':
      updateQuestion(sp, dt);
      break;
    case 'queenboat':
      updateQueenBoat(sp, dt);
      break;
    case 'fukuyama':
      updateFukuyama(sp, dt);
      break;
    case 'epistemologies':
      updateEpistemologies(sp, dt);
      break;
    case 'insight':
      updateInsight(sp, dt);
      break;
    case 'portal':
      updatePortal(sp, dt);
      break;
  }
}

// --- Section 0: Entry ---
function updateEntry(sp, dt) {
  // Two distant fields drifting closer as user scrolls — faster convergence
  const separation = 6 - sp * 5; // 6 → 1 by end of entry
  organicField.centerX = -separation / 2;
  digitalField.centerX = separation / 2;
  
  // Interference begins earlier for quicker visual feedback
  interferenceField.couplingStrength = Math.max(0, sp - 0.3) * 1.4; // starts at 30% scroll
  
  // Camera stays centered
  camera.position.x = 0;
  camera.position.y = 0;
}

// --- Section 1: The Question ---
let questionTextGenerated = false;
let questionTextPhase = 0;

function updateQuestion(sp, dt) {
  questionTextPhase = sp;
  
  // Fields continue to merge
  organicField.centerX = -1 + sp * 0.5;
  digitalField.centerX = 1 - sp * 0.5;
  interferenceField.couplingStrength = 0.5 + sp * 0.5;
  
  // Text formation phase
  if (sp > 0.1 && sp < 0.8) {
    if (!questionTextGenerated) {
      textSystem.generateFromText(
        "How do you distribute\nscarce things without\nkilling each other?",
        {
          fontSize: window.innerWidth < 768 ? 28 : 42,
          canvasWidth: window.innerWidth < 768 ? 400 : 700,
          canvasHeight: window.innerWidth < 768 ? 200 : 180,
          sampleDensity: window.innerWidth < 768 ? 5 : 3,
          worldScale: window.innerWidth < 768 ? 5 : 7,
        }
      );
      questionTextGenerated = true;
    }
    
    // Apply text attractors to interference field with growing strength
    const textStrength = Math.sin(((sp - 0.1) / 0.7) * Math.PI) * 0.02;
    textSystem.applyToField(interferenceField, textStrength, 0.0005);
  } else if (sp >= 0.8 && questionTextGenerated) {
    // Scatter
    textSystem.scatter(interferenceField, 0.008);
    questionTextGenerated = false;
  }
}

// --- Section 2: Queen Boat ---
function updateQueenBoat(sp, dt) {
  // Warm field intensifies then contracts during the raid
  organicField.centerX = -0.5;
  digitalField.centerX = 0.5;
  
  // Before the raid (sp < 0.5) — warm celebration colors
  // During/after raid (sp > 0.5) — cold contraction
  if (sp < 0.5) {
    organicField.colorShift = 0;
    interferenceField.couplingStrength = 0.3;
  } else {
    // The raid — sudden contraction, warm → cold
    const raidProgress = (sp - 0.5) * 2; // 0 → 1
    organicField.colorShift = raidProgress * 0.6;
    
    // Contract the organic field
    for (let i = 0; i < organicField.count; i++) {
      const i3 = i * 3;
      organicField.velocities[i3] += (0 - organicField.positions[i3]) * 0.002 * raidProgress;
      organicField.velocities[i3 + 1] += (0 - organicField.positions[i3 + 1]) * 0.002 * raidProgress;
    }
    
    interferenceField.couplingStrength = 0.3 - raidProgress * 0.2;
    
    // Guilt trail persists
    organicField.guiltTrailIntensity = raidProgress * 0.5;
  }
  
  // Water-like ripple effect — modulate Y positions
  for (let i = 0; i < organicField.count; i++) {
    const i3 = i * 3;
    const x = organicField.positions[i3];
    const wave = Math.sin(x * 3 + organicField.time * 0.8) * 0.02;
    organicField.velocities[i3 + 1] += wave * 0.1;
  }
}

// --- Section 3: Fukuyama Inversion ---
function updateFukuyama(sp, dt) {
  organicField.colorShift = Math.max(0, organicField.colorShift - dt * 0.5);
  
  // Concentric circles expanding with each tier
  const tier = Math.floor(sp * 5); // 0-4
  const tierProgress = (sp * 5) % 1;
  
  // Both fields converge to center
  organicField.centerX = organicField.centerX * 0.99;
  digitalField.centerX = digitalField.centerX * 0.99;
  
  // Organize into rings
  const ringRadii = [0.5, 1.2, 2.0, 3.0, 4.5];
  const currentRadius = tier < 5 ? ringRadii[tier] : ringRadii[4];
  
  // Gravitational pull increases with each tier (acceleration!)
  const gravityScale = 0.002 * (1 + tier * 0.8);
  
  for (let i = 0; i < organicField.count; i++) {
    const i3 = i * 3;
    const angle = (i / organicField.count) * Math.PI * 2 + organicField.time * 0.1;
    const r = currentRadius * (0.8 + 0.2 * Math.sin(angle * 3 + organicField.time));
    const targetX = r * Math.cos(angle);
    const targetY = r * Math.sin(angle);
    
    organicField.velocities[i3] += (targetX - organicField.positions[i3]) * gravityScale;
    organicField.velocities[i3 + 1] += (targetY - organicField.positions[i3 + 1]) * gravityScale;
  }
  
  for (let i = 0; i < digitalField.count; i++) {
    const i3 = i * 3;
    const angle = (i / digitalField.count) * Math.PI * 2 - digitalField.time * 0.08;
    const r = currentRadius * (0.9 + 0.1 * Math.cos(angle * 5));
    const targetX = r * Math.cos(angle);
    const targetY = r * Math.sin(angle);
    
    digitalField.velocities[i3] += (targetX - digitalField.positions[i3]) * gravityScale;
    digitalField.velocities[i3 + 1] += (targetY - digitalField.positions[i3 + 1]) * gravityScale;
  }
  
  interferenceField.couplingStrength = 0.3 + sp * 0.7;
  
  // At "Mathematics" (sp > 0.8) — the inversion
  if (sp > 0.8) {
    const invProgress = (sp - 0.8) * 5; // 0 → 1
    // Inside becomes outside — flip positions radially
    for (let i = 0; i < organicField.count; i++) {
      const i3 = i * 3;
      const x = organicField.positions[i3];
      const y = organicField.positions[i3 + 1];
      const dist = Math.sqrt(x * x + y * y) + 0.01;
      const invertedR = (5.0 / dist) * invProgress + dist * (1 - invProgress);
      const angle = Math.atan2(y, x);
      const targetX = invertedR * Math.cos(angle);
      const targetY = invertedR * Math.sin(angle);
      organicField.velocities[i3] += (targetX - x) * 0.003 * invProgress;
      organicField.velocities[i3 + 1] += (targetY - y) * 0.003 * invProgress;
    }
  }
}

// --- Section 4: Epistemologies ---
function updateEpistemologies(sp, dt) {
  // Each quarter changes rendering mode
  if (sp < 0.25) {
    // A priori — grid
    digitalField.geometryMode = 'grid';
    organicField.centerX = -2;
    digitalField.centerX = 0;
    interferenceField.couplingStrength = 0.2;
  } else if (sp < 0.5) {
    // A posteriori — probabilistic clouds
    digitalField.geometryMode = 'cloud';
    organicField.centerX = 0;
    digitalField.centerX = 0;
    interferenceField.couplingStrength = 0.4;
  } else if (sp < 0.75) {
    // A synthesi — fractal recursive
    digitalField.geometryMode = 'fractal';
    organicField.centerX = 0;
    digitalField.centerX = 0;
    interferenceField.couplingStrength = 0.7;
  } else {
    // A symbiosi — synchronized pulse
    digitalField.geometryMode = 'sync';
    organicField.centerX = 0;
    digitalField.centerX = 0;
    interferenceField.couplingStrength = 1.0;
  }
}

// --- Section 5: Insight ---
function updateInsight(sp, dt) {
  // All threads converge — colored trajectories become visible
  digitalField.geometryMode = 'default';
  organicField.centerX = organicField.centerX * 0.99;
  digitalField.centerX = digitalField.centerX * 0.99;
  
  // Particles settle into stillness
  const stillness = sp * 0.5;
  for (let i = 0; i < organicField.count; i++) {
    const i3 = i * 3;
    organicField.velocities[i3] *= (1 - stillness * 0.03);
    organicField.velocities[i3 + 1] *= (1 - stillness * 0.03);
  }
  for (let i = 0; i < digitalField.count; i++) {
    const i3 = i * 3;
    digitalField.velocities[i3] *= (1 - stillness * 0.03);
    digitalField.velocities[i3 + 1] *= (1 - stillness * 0.03);
  }
  
  interferenceField.couplingStrength = 0.5 + sp * 0.3;
  
  // Final burst — user's scroll trajectory visible as golden line
  if (sp > 0.85) {
    // Intensify interference
    interferenceField.couplingStrength = 1.0;
  }
}

// --- Section 6: Portal ---
function updatePortal(sp, dt) {
  digitalField.geometryMode = 'default';
  
  // Toroidal field — particles orbit in a torus shape
  const torusR = 2.5;
  const tubeR = 0.8;
  
  for (let i = 0; i < organicField.count; i++) {
    const i3 = i * 3;
    const t = (i / organicField.count) * Math.PI * 2;
    const p = organicField.time * 0.3 + t * 3;
    
    const targetX = (torusR + tubeR * Math.cos(p)) * Math.cos(t);
    const targetY = (torusR + tubeR * Math.cos(p)) * Math.sin(t);
    const targetZ = tubeR * Math.sin(p) - 2;
    
    const pull = sp * 0.005;
    organicField.velocities[i3] += (targetX - organicField.positions[i3]) * pull;
    organicField.velocities[i3 + 1] += (targetY - organicField.positions[i3 + 1]) * pull;
    organicField.velocities[i3 + 2] += (targetZ - organicField.positions[i3 + 2]) * pull;
  }
  
  for (let i = 0; i < digitalField.count; i++) {
    const i3 = i * 3;
    const t = (i / digitalField.count) * Math.PI * 2;
    const p = -digitalField.time * 0.2 + t * 5;
    
    const targetX = (torusR + tubeR * Math.cos(p)) * Math.cos(t);
    const targetY = (torusR + tubeR * Math.cos(p)) * Math.sin(t);
    const targetZ = tubeR * Math.sin(p) - 2;
    
    const pull = sp * 0.004;
    digitalField.velocities[i3] += (targetX - digitalField.positions[i3]) * pull;
    digitalField.velocities[i3 + 1] += (targetY - digitalField.positions[i3 + 1]) * pull;
    digitalField.velocities[i3 + 2] += (targetZ - digitalField.positions[i3 + 2]) * pull;
  }
  
  interferenceField.couplingStrength = 0.8 + sp * 0.2;
}

// ============================================
// Camera movement
// ============================================
function updateCamera(dt) {
  // Subtle parallax from mouse
  const targetX = (mouseX - 0.5) * 0.5;
  const targetY = -(mouseY - 0.5) * 0.3;
  camera.position.x += (targetX - camera.position.x) * 0.02;
  camera.position.y += (targetY - camera.position.y) * 0.02;
  
  // Slow zoom based on scroll
  const zoomTarget = CONFIG.cameraZ - scrollProgress * 1.5;
  camera.position.z += (zoomTarget - camera.position.z) * 0.02;
  
  camera.lookAt(0, 0, -2);
}

// ============================================
// Animation Loop
// ============================================
function animate() {
  requestAnimationFrame(animate);
  
  if (!isInitialized) return;
  
  const dt = Math.min(clock.getDelta(), 0.05); // Cap delta
  frameCount++;
  
  // Update section behaviors
  updateSectionBehaviors(dt);
  
  // Update camera
  updateCamera(dt);
  
  // Update particle fields
  organicField.update(dt);
  digitalField.update(dt, mouseX, mouseY);
  interferenceField.update(dt);
  
  // Render
  renderer.render(scene, camera);
}

// ============================================
// Boot
// ============================================
init().catch(err => {
  console.error('Portal initialization failed:', err);
  const loading = document.getElementById('loading-screen');
  if (loading) {
    loading.querySelector('.loading-text').textContent = 'WebGL initialization failed. Please try a modern browser.';
  }
});
