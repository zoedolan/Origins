/**
 * Text-to-Particle System
 * Renders text to an offscreen canvas, samples opaque pixels,
 * and returns attractor positions that pull nearby particles into letterforms.
 */

export class TextParticleSystem {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.attractors = [];
    this.active = false;
    this.targetPositions = [];
    this.assignedParticles = new Map(); // particleIndex -> {x, y}
  }

  /**
   * Generate attractor positions from text
   * @param {string} text - The text to render
   * @param {object} options - Configuration
   * @returns {Array<{x, y}>} Attractor positions in normalized [-1,1] space
   */
  generateFromText(text, options = {}) {
    const {
      fontSize = 48,
      fontFamily = "'Playfair Display', Georgia, serif",
      canvasWidth = 800,
      canvasHeight = 200,
      sampleDensity = 3, // pixels between samples
      worldScale = 6, // scale to 3D world units
      worldOffsetX = 0,
      worldOffsetY = 0,
    } = options;

    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw text centered
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Handle multi-line
    const lines = text.split('\n');
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;
    const startY = (canvasHeight - totalHeight) / 2 + lineHeight / 2;
    
    lines.forEach((line, i) => {
      ctx.fillText(line, canvasWidth / 2, startY + i * lineHeight);
    });

    // Sample pixels
    const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const pixels = imageData.data;
    const positions = [];

    for (let y = 0; y < canvasHeight; y += sampleDensity) {
      for (let x = 0; x < canvasWidth; x += sampleDensity) {
        const idx = (y * canvasWidth + x) * 4;
        // Check if pixel is lit (text)
        if (pixels[idx] > 128) {
          // Convert to normalized coords centered at origin
          const nx = ((x / canvasWidth) - 0.5) * worldScale + worldOffsetX;
          const ny = -((y / canvasHeight) - 0.5) * worldScale * (canvasHeight / canvasWidth) + worldOffsetY;
          positions.push({ x: nx, y: ny, z: -2 });
        }
      }
    }

    this.targetPositions = positions;
    this.active = true;
    return positions;
  }

  /**
   * Create attractors for particle fields from current target positions
   * @param {number} strength - How strongly particles are pulled
   * @param {number} radius - Attraction radius
   * @returns {Array} Attractor objects for particle fields
   */
  getAttractors(strength = 0.003, radius = 0.3) {
    if (!this.active || this.targetPositions.length === 0) return [];
    
    return this.targetPositions.map(pos => ({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      strength,
      radius,
    }));
  }

  /**
   * Assign specific particles from a field to specific text positions
   * Returns array of {particleIndex, targetX, targetY, targetZ}
   */
  assignParticles(field, maxAssign) {
    if (!this.active || this.targetPositions.length === 0) return [];
    
    const assignments = [];
    const numToAssign = Math.min(maxAssign || this.targetPositions.length, this.targetPositions.length, field.count);
    
    for (let i = 0; i < numToAssign; i++) {
      const target = this.targetPositions[i % this.targetPositions.length];
      assignments.push({
        particleIndex: i,
        targetX: target.x,
        targetY: target.y,
        targetZ: target.z || -2,
      });
    }
    
    return assignments;
  }

  /**
   * Apply text attractor forces to a particle field
   * Particles near target positions get pulled toward them
   */
  applyToField(field, strength = 0.015, jitter = 0.001) {
    if (!this.active || this.targetPositions.length === 0) return;
    
    const targets = this.targetPositions;
    const numTargets = targets.length;
    const particlesPerTarget = Math.ceil(field.count / numTargets);
    
    for (let t = 0; t < numTargets; t++) {
      const target = targets[t];
      // Assign a cluster of particles to each target
      const startIdx = t * particlesPerTarget;
      const endIdx = Math.min(startIdx + particlesPerTarget, field.count);
      
      for (let i = startIdx; i < endIdx; i++) {
        const i3 = i * 3;
        const dx = target.x - field.positions[i3];
        const dy = target.y - field.positions[i3 + 1];
        const dz = (target.z || -2) - field.positions[i3 + 2];
        
        // Pull toward target with some organic jitter
        field.velocities[i3] += dx * strength + (Math.random() - 0.5) * jitter;
        field.velocities[i3 + 1] += dy * strength + (Math.random() - 0.5) * jitter;
        field.velocities[i3 + 2] += dz * strength * 0.5;
      }
    }
  }

  /**
   * Release particles — remove text attractors, let them scatter
   */
  release() {
    this.active = false;
    this.targetPositions = [];
    this.assignedParticles.clear();
  }

  /**
   * Scatter particles away from text positions with some force
   */
  scatter(field, force = 0.01) {
    if (this.targetPositions.length === 0) return;
    
    for (let i = 0; i < field.count; i++) {
      const i3 = i * 3;
      // Add random outward velocity
      field.velocities[i3] += (Math.random() - 0.5) * force;
      field.velocities[i3 + 1] += (Math.random() - 0.5) * force;
      field.velocities[i3 + 2] += (Math.random() - 0.5) * force * 0.3;
    }
    
    this.release();
  }
}
