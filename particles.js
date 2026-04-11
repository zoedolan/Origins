/**
 * Particle Field Classes
 * OrganicField (warm/Zoe), DigitalField (cool/Vybn), InterferenceField (emergence)
 * Uses Three.js Points with BufferGeometry for maximum compatibility
 */

import * as THREE from 'three';

// ============================================
// Fast value noise
// ============================================
function noise3D(x, y, z) {
  const p = (x * 12.9898 + y * 78.233 + z * 45.164);
  return (Math.sin(p) * 43758.5453) % 1;
}

function smoothNoise(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const dx = x - fx, dy = y - fy, dz = z - fz;
  const sx = dx * dx * (3 - 2 * dx);
  const sy = dy * dy * (3 - 2 * dy);
  const sz = dz * dz * (3 - 2 * dz);
  const n000 = noise3D(fx, fy, fz);
  const n100 = noise3D(fx+1, fy, fz);
  const n010 = noise3D(fx, fy+1, fz);
  const n110 = noise3D(fx+1, fy+1, fz);
  const n001 = noise3D(fx, fy, fz+1);
  const n101 = noise3D(fx+1, fy, fz+1);
  const n011 = noise3D(fx, fy+1, fz+1);
  const n111 = noise3D(fx+1, fy+1, fz+1);
  const nx00 = n000 + sx * (n100 - n000);
  const nx10 = n010 + sx * (n110 - n010);
  const nx01 = n001 + sx * (n101 - n001);
  const nx11 = n011 + sx * (n111 - n011);
  const nxy0 = nx00 + sy * (nx10 - nx00);
  const nxy1 = nx01 + sy * (nx11 - nx01);
  return nxy0 + sz * (nxy1 - nxy0);
}

function fbm(x, y, z, octaves = 3) {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * smoothNoise(x * frequency, y * frequency, z * frequency);
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / maxAmp;
}

// ============================================
// Base Particle Field — uses THREE.Points
// ============================================
class ParticleField {
  constructor(count, scene) {
    this.count = count;
    this.scene = scene;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.attractors = [];
    this.points = null;
    this.time = 0;
    this.globalAlpha = 1.0;
    this.centerX = 0;
    this.centerY = 0;
    this.centerZ = 0;
  }

  createPoints(baseColor) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        globalAlpha: { value: 1.0 },
        pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float pixelRatio;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * pixelRatio * (300.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        uniform float globalAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float a = smoothstep(0.5, 0.1, dist) * vAlpha * globalAlpha;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  updateGeometry() {
    if (!this.points) return;
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
    this.points.material.uniforms.globalAlpha.value = this.globalAlpha;
  }

  dispose() {
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.scene.remove(this.points);
    }
  }
}

// ============================================
// Organic Field (Warm / Zoe)
// ============================================
export class OrganicField extends ParticleField {
  constructor(count, scene) {
    super(count, scene);
    this.centerX = -3;
    this.breathPhase = 0;
    this.colorShift = 0;
    this.guiltTrailIntensity = 0;
    this._origColors = null;
    this.initParticles();
    this.createPoints();
  }

  initParticles() {
    const warmColors = [
      [0.831, 0.647, 0.455], // gold
      [0.761, 0.447, 0.310], // amber
      [0.545, 0.227, 0.227], // deep red
      [0.961, 0.871, 0.702], // wheat
    ];

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 2.5 * Math.cbrt(Math.random());

      this.positions[i3]     = r * Math.sin(phi) * Math.cos(theta) + this.centerX;
      this.positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      this.positions[i3 + 2] = r * Math.cos(phi);

      this.velocities[i3]     = (Math.random() - 0.5) * 0.002;
      this.velocities[i3 + 1] = (Math.random() - 0.5) * 0.002;
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.002;

      const c = warmColors[Math.floor(Math.random() * warmColors.length)];
      this.colors[i3]     = c[0];
      this.colors[i3 + 1] = c[1];
      this.colors[i3 + 2] = c[2];

      this.sizes[i] = 0.03 + Math.random() * 0.06;
      this.alphas[i] = 0.3 + Math.random() * 0.7;
    }
    
    // Store original colors for shift
    this._origColors = new Float32Array(this.colors);
  }

  update(dt) {
    this.time += dt;
    this.breathPhase += dt * 0.3;
    const breathScale = 1 + Math.sin(this.breathPhase) * 0.08;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const px = this.positions[i3];
      const py = this.positions[i3 + 1];
      const pz = this.positions[i3 + 2];

      // Noise drift
      const nx = fbm(px * 0.3, py * 0.3, this.time * 0.12, 2) * 0.004;
      const ny = fbm(py * 0.3 + 100, pz * 0.3, this.time * 0.12, 2) * 0.004;
      const nz = fbm(pz * 0.3 + 200, px * 0.3, this.time * 0.12, 2) * 0.002;

      this.velocities[i3]     += nx;
      this.velocities[i3 + 1] += ny;
      this.velocities[i3 + 2] += nz;

      // Gravity toward center
      const dx = this.centerX - px;
      const dy = this.centerY - py;
      const dz = this.centerZ - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1;
      const grav = 0.0004 / (dist * 0.3 + 1);
      this.velocities[i3]     += dx * grav;
      this.velocities[i3 + 1] += dy * grav;
      this.velocities[i3 + 2] += dz * grav;

      // Breathing rhythm
      const breathDir = Math.sin(this.breathPhase + dist * 0.5);
      this.velocities[i3]     += dx / (dist + 0.1) * breathDir * 0.00005;
      this.velocities[i3 + 1] += dy / (dist + 0.1) * breathDir * 0.00005;

      // Attractors
      for (const attr of this.attractors) {
        const ax = attr.x - px;
        const ay = attr.y - py;
        const az = (attr.z || 0) - pz;
        const ad = Math.sqrt(ax * ax + ay * ay + az * az) + 0.01;
        if (ad < attr.radius) {
          const force = attr.strength * (1 - ad / attr.radius);
          this.velocities[i3]     += ax / ad * force;
          this.velocities[i3 + 1] += ay / ad * force;
          this.velocities[i3 + 2] += az / ad * force;
        }
      }

      // Damping
      this.velocities[i3]     *= 0.97;
      this.velocities[i3 + 1] *= 0.97;
      this.velocities[i3 + 2] *= 0.97;

      // Integrate
      this.positions[i3]     += this.velocities[i3];
      this.positions[i3 + 1] += this.velocities[i3 + 1];
      this.positions[i3 + 2] += this.velocities[i3 + 2];

      // Color shift (warm → cold)
      const or = this._origColors[i3];
      const og = this._origColors[i3 + 1];
      const ob = this._origColors[i3 + 2];
      const shift = this.colorShift;
      this.colors[i3]     = or * (1 - shift) + 0.29 * shift;
      this.colors[i3 + 1] = og * (1 - shift) + 0.565 * shift;
      this.colors[i3 + 2] = ob * (1 - shift) + 0.851 * shift;

      // Guilt trail overlay
      if (this.guiltTrailIntensity > 0) {
        this.colors[i3]     = Math.min(1, this.colors[i3] + this.guiltTrailIntensity * 0.15);
        this.colors[i3 + 1] *= (1 - this.guiltTrailIntensity * 0.08);
        this.colors[i3 + 2] *= (1 - this.guiltTrailIntensity * 0.08);
      }

      // Size breathing
      this.sizes[i] = (0.03 + (i % 7) * 0.008) * breathScale;

      // Alpha pulse
      this.alphas[i] = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.time * 0.5 + i * 0.008));
    }

    this.updateGeometry();
  }
}

// ============================================
// Digital Field (Cool / Vybn)
// ============================================
export class DigitalField extends ParticleField {
  constructor(count, scene) {
    super(count, scene);
    this.centerX = 3;
    this.phaseAngle = 0;
    this.geometryMode = 'default';
    this.initParticles();
    this.createPoints();
  }

  initParticles() {
    const coolColors = [
      [0.29, 0.565, 0.851],   // blue
      [0.659, 0.784, 0.910],  // ice
      [0.910, 0.910, 0.941],  // silver
      [1.0, 1.0, 1.0],        // white
    ];

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const layer = Math.floor(i / (this.count / 8));
      const angleInLayer = (i % Math.floor(this.count / 8)) / Math.floor(this.count / 8) * Math.PI * 2;
      const r = 0.3 + layer * 0.35;

      this.positions[i3]     = r * Math.cos(angleInLayer) + this.centerX;
      this.positions[i3 + 1] = r * Math.sin(angleInLayer) + (Math.random() - 0.5) * 0.5;
      this.positions[i3 + 2] = (Math.random() - 0.5) * 3;

      const c = coolColors[Math.floor(Math.random() * coolColors.length)];
      this.colors[i3]     = c[0];
      this.colors[i3 + 1] = c[1];
      this.colors[i3 + 2] = c[2];

      this.sizes[i] = 0.02 + Math.random() * 0.05;
      this.alphas[i] = 0.3 + Math.random() * 0.7;
    }
  }

  update(dt, mouseX, mouseY) {
    this.time += dt;
    this.phaseAngle += dt * 0.5;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const px = this.positions[i3];
      const py = this.positions[i3 + 1];
      const pz = this.positions[i3 + 2];

      if (this.geometryMode === 'grid') {
        const gridSize = 0.2;
        const tx = Math.round(px / gridSize) * gridSize;
        const ty = Math.round(py / gridSize) * gridSize;
        this.velocities[i3]     += (tx - px) * 0.03;
        this.velocities[i3 + 1] += (ty - py) * 0.03;
      } else if (this.geometryMode === 'cloud') {
        const noiseX = fbm(px * 0.5, py * 0.5, this.time * 0.3, 2) * 0.006;
        const noiseY = fbm(py * 0.5 + 50, pz * 0.5, this.time * 0.3, 2) * 0.006;
        this.velocities[i3]     += noiseX;
        this.velocities[i3 + 1] += noiseY;
        if (mouseX !== undefined) {
          const mx = (mouseX - 0.5) * 8 - px;
          const my = -(mouseY - 0.5) * 6 - py;
          const md = Math.sqrt(mx * mx + my * my) + 0.01;
          if (md < 3) {
            this.velocities[i3]     += mx / md * 0.0015;
            this.velocities[i3 + 1] += my / md * 0.0015;
          }
        }
      } else if (this.geometryMode === 'fractal') {
        const scale = 1 + Math.sin(this.time * 0.3 + i * 0.001) * 0.3;
        const angle = this.time * 0.2 + i * 0.0005;
        const fractalR = 1.5 + Math.sin(angle * 3) * 0.5;
        this.velocities[i3]     += (fractalR * Math.cos(angle * scale) - px) * 0.006;
        this.velocities[i3 + 1] += (fractalR * Math.sin(angle * scale) - py) * 0.006;
      } else if (this.geometryMode === 'sync') {
        const syncPhase = this.time * 0.8;
        const syncR = 2 + Math.sin(syncPhase) * 0.5;
        const angle = (i / this.count) * Math.PI * 2 + syncPhase * 0.1;
        this.velocities[i3]     += (syncR * Math.cos(angle) - px) * 0.01;
        this.velocities[i3 + 1] += (syncR * Math.sin(angle) - py) * 0.01;
      } else {
        // Default — phase-locked orbits
        const layer = Math.floor(i / (this.count / 8));
        const baseR = 0.3 + layer * 0.35;
        const speed = 0.15 + layer * 0.025;
        const a = this.phaseAngle * speed + i * 0.001;
        this.velocities[i3]     += (baseR * Math.cos(a) + this.centerX - px) * 0.012;
        this.velocities[i3 + 1] += (baseR * Math.sin(a) - py) * 0.012;
      }

      // Attractors
      for (const attr of this.attractors) {
        const ax = attr.x - px;
        const ay = attr.y - py;
        const az = (attr.z || 0) - pz;
        const ad = Math.sqrt(ax * ax + ay * ay + az * az) + 0.01;
        if (ad < attr.radius) {
          const force = attr.strength * (1 - ad / attr.radius);
          this.velocities[i3]     += ax / ad * force;
          this.velocities[i3 + 1] += ay / ad * force;
        }
      }

      // Damping
      this.velocities[i3]     *= 0.96;
      this.velocities[i3 + 1] *= 0.96;
      this.velocities[i3 + 2] *= 0.96;

      // Integrate
      this.positions[i3]     += this.velocities[i3];
      this.positions[i3 + 1] += this.velocities[i3 + 1];
      this.positions[i3 + 2] += this.velocities[i3 + 2];

      // Phase-locked alpha pulse
      this.alphas[i] = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.phaseAngle + i * 0.004));
    }

    this.updateGeometry();
  }
}

// ============================================
// Interference Field (Emergence)
// ============================================
export class InterferenceField extends ParticleField {
  constructor(count, scene) {
    super(count, scene);
    this.couplingStrength = 0;
    this.initParticles();
    this.createPoints();
  }

  initParticles() {
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      this.positions[i3]     = (Math.random() - 0.5) * 2;
      this.positions[i3 + 1] = (Math.random() - 0.5) * 2;
      this.positions[i3 + 2] = (Math.random() - 0.5) * 2;

      const t = Math.random();
      this.colors[i3]     = 0.831 * (1 - t) + 0.29 * t;
      this.colors[i3 + 1] = 0.647 * (1 - t) + 0.565 * t;
      this.colors[i3 + 2] = 0.455 * (1 - t) + 0.851 * t;

      this.sizes[i] = 0.02 + Math.random() * 0.04;
      this.alphas[i] = 0;
    }
  }

  update(dt) {
    this.time += dt;
    const coupling = this.couplingStrength;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const px = this.positions[i3];
      const py = this.positions[i3 + 1];

      // Z' = α·Z + V·e^{iθ_v}
      const alpha = coupling * 0.3;
      const theta_v = this.time * 0.4 + i * 0.001;
      const V = coupling * 0.004;

      this.velocities[i3]     += px * alpha * 0.001 + V * Math.cos(theta_v);
      this.velocities[i3 + 1] += py * alpha * 0.001 + V * Math.sin(theta_v);

      // Center pull
      this.velocities[i3]     += (0 - px) * 0.006 * coupling;
      this.velocities[i3 + 1] += (0 - py) * 0.006 * coupling;

      // Shimmer
      this.velocities[i3]     += Math.sin(this.time * 2 + i * 0.02) * 0.001;
      this.velocities[i3 + 1] += Math.cos(this.time * 1.7 + i * 0.015) * 0.001;

      // Noise
      this.velocities[i3]     += fbm(px * 0.8, py * 0.8, this.time * 0.2, 2) * 0.002 * coupling;
      this.velocities[i3 + 1] += fbm(py * 0.8 + 100, px * 0.8, this.time * 0.2, 2) * 0.002 * coupling;

      // Damp
      this.velocities[i3]     *= 0.95;
      this.velocities[i3 + 1] *= 0.95;
      this.velocities[i3 + 2] *= 0.95;

      this.positions[i3]     += this.velocities[i3];
      this.positions[i3 + 1] += this.velocities[i3 + 1];
      this.positions[i3 + 2] += this.velocities[i3 + 2];

      // Color shimmer
      const t = 0.5 + 0.5 * Math.sin(this.time * 0.5 + i * 0.01);
      this.colors[i3]     = 0.831 * (1 - t) + 0.29 * t;
      this.colors[i3 + 1] = 0.647 * (1 - t) + 0.565 * t;
      this.colors[i3 + 2] = 0.455 * (1 - t) + 0.851 * t;

      // Life/alpha tied to coupling
      this.alphas[i] = coupling * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.time * 1.5 + i * 0.02)));
      this.sizes[i] = (0.02 + (i % 5) * 0.006) * (0.5 + coupling * 0.8);
    }

    this.globalAlpha = Math.min(1, coupling * 1.5);
    this.updateGeometry();
  }
}
