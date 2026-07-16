import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontJson from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { LETTERS, randomWordFor } from './words.js';
import { playPop, playSuccess, playSad, playWhoosh, playBoing, playSlideWhistle, playHonk } from './audio.js';
import { speak } from './speech.js';
import { getScore, addScore } from './scoreboard.js';
import { getDifficulty } from './settings.js';

const MASH_WINDOW_MS = 1500;
const MASH_THRESHOLD = 5;
const ENCOURAGE_INTERVAL_MS = 6000;

const ENCOURAGEMENTS = [
  'Almost! Just press {L}!',
  'You can do it! Just press {L}!',
  'So close! One finger — press {L}!',
  'Slow down, buddy! Just press {L}!'
];
const IDLE_REPROMPT_MS = 14000;
const SHOWER_POOL = 80;
const CONFETTI_COUNT = 220;
const SPARKLE_POOL = 140;
const SPARKLE_Z = 4; // world plane the trail lives on, in front of the letter

// Scene themes rotate every letter: background gradient, particle sprite,
// and particle motion all change so the world keeps feeling new.
const THEMES = [
  { name: 'night', colors: ['#31146b', '#1a0b2e', '#0b1e3d'], glow: 'rgba(124, 77, 255, 0.5)', sprite: 'circle', dir: 1, speed: 0.28 },
  { name: 'ocean', colors: ['#01497c', '#013a63', '#01243d'], glow: 'rgba(64, 196, 255, 0.45)', sprite: 'circle', dir: 1, speed: 0.5 },
  { name: 'sunset', colors: ['#7a1f5c', '#47102e', '#1f0a2e'], glow: 'rgba(255, 111, 145, 0.45)', sprite: 'heart', dir: -1, speed: 0.22 },
  { name: 'meadow', colors: ['#0b4d3a', '#06301f', '#021710'], glow: 'rgba(105, 240, 174, 0.4)', sprite: 'circle', dir: 1, speed: 0.14, twinkle: true },
  { name: 'candy', colors: ['#5f1a89', '#8e1e5f', '#2a1259'], glow: 'rgba(255, 238, 88, 0.4)', sprite: 'star', dir: -1, speed: 0.35 },
  { name: 'space', colors: ['#0d1b4b', '#091034', '#03071c'], glow: 'rgba(224, 64, 251, 0.4)', sprite: 'star', dir: 0, speed: 0.3, twinkle: true }
];

function makeBackgroundTexture({ colors, glow }) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(0.55, colors[1]);
  grad.addColorStop(1, colors[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const glowGrad = g.createRadialGradient(256, 200, 20, 256, 200, 300);
  glowGrad.addColorStop(0, glow);
  glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = glowGrad;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSprite(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (kind === 'star') {
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.translate(32, 34);
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const outer = ((i * 4 * Math.PI) / 5) - Math.PI / 2;
      const inner = outer + (2 * Math.PI) / 5;
      g.lineTo(Math.cos(outer) * 26, Math.sin(outer) * 26);
      g.lineTo(Math.cos(inner) * 11, Math.sin(inner) * 11);
    }
    g.closePath();
    g.fill();
  } else if (kind === 'heart') {
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.translate(32, 30);
    g.beginPath();
    g.moveTo(0, 8);
    g.bezierCurveTo(-26, -12, -10, -28, 0, -12);
    g.bezierCurveTo(10, -28, 26, -12, 0, 8);
    g.lineTo(0, 22);
    g.bezierCurveTo(-4, 16, -18, 4, 0, 22);
    g.closePath();
    g.fill();
  } else {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export class LetterGame {
  constructor(canvas, { onProgress } = {}) {
    this.canvas = canvas;
    this.onProgress = onProgress || (() => {});
    this.running = false;
    this.paused = false;
    this.overlayMode = false;
    this.stars = getScore('letters');
    this.pressTimes = [];
    this.wrongSinceHint = 0;
    this.lastPromptAt = 0;
    this.celebrating = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 0.4, 11);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 8);
    this.scene.add(key);
    this.lightA = new THREE.PointLight(0xff4fd8, 40, 40);
    this.lightB = new THREE.PointLight(0x40c4ff, 40, 40);
    this.scene.add(this.lightA, this.lightB);

    this.font = new FontLoader().parse(fontJson);
    this.geometryCache = new Map();
    this.spriteCache = new Map();

    this._initParticles();
    this._initShower();
    this._initConfetti();
    this._initSparkles();
    this._initPointerTracking();
    this._initTapReactions();

    this.letterGroup = new THREE.Group();
    this.scene.add(this.letterGroup);
    this.letterMesh = null;

    this.theme = THEMES[0];
    this._applyTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);

    this.sequence = [...LETTERS].sort(() => Math.random() - 0.5);
    this.sequenceIndex = 0;
    this.target = this.sequence[0];

    this.clock = new THREE.Clock();
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();

    this.renderer.setAnimationLoop(() => this._tick());
  }

  // --- geometry helpers ---------------------------------------------------

  _charGeometry(char) {
    let geo = this.geometryCache.get(char);
    if (!geo) {
      geo = new TextGeometry(char, {
        font: this.font,
        size: 1,
        depth: 0.35,
        curveSegments: 8,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.03,
        bevelSegments: 2
      });
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
      this.geometryCache.set(char, geo);
    }
    return geo;
  }

  _sprite(kind) {
    let tex = this.spriteCache.get(kind);
    if (!tex) {
      tex = makeSprite(kind);
      this.spriteCache.set(kind, tex);
    }
    return tex;
  }

  // --- themes ---------------------------------------------------------------

  _applyTheme(theme) {
    this.theme = theme;
    this.backgroundTexture = makeBackgroundTexture(theme);
    if (!this.overlayMode) this.scene.background = this.backgroundTexture;
    this.particles.material.map = this._sprite(theme.sprite);
    this.particles.material.needsUpdate = true;
  }

  _nextTheme() {
    const options = THEMES.filter((t) => t !== this.theme);
    this._applyTheme(options[Math.floor(Math.random() * options.length)]);
  }

  // When another mode's overlay is on top, the canvas turns into a
  // transparent effects layer: only the key shower and confetti render.
  setOverlayMode(overlay) {
    this.overlayMode = overlay;
    this.scene.background = overlay ? null : this.backgroundTexture;
    this.letterGroup.visible = !overlay;
    this.particles.visible = !overlay;
  }

  // --- floating background particles ---------------------------------------

  _initParticles() {
    const count = 90;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.particleSeeds = new Float32Array(count);
    this.particleVel = new Float32Array(count * 2);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 2] = -4 - Math.random() * 12;
      color.setHSL(Math.random(), 0.8, 0.7);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      this.particleSeeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.7,
      map: this._sprite ? this._sprite('circle') : makeSprite('circle'),
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  _updateParticles(dt, t) {
    const pos = this.particles.geometry.attributes.position;
    const { dir, speed, twinkle } = this.theme;
    const ray = this.pointerActive ? this._pointerRay() : null;
    const damp = Math.exp(-2.2 * dt);
    for (let i = 0; i < pos.count; i++) {
      const seed = this.particleSeeds[i];
      let x = pos.getX(i);
      let y = pos.getY(i);
      let vx = this.particleVel[i * 2];
      let vy = this.particleVel[i * 2 + 1];

      // pointer influence: some particles are curious, some are shy
      if (ray) {
        const z = pos.getZ(i);
        const rt = (z - ray.origin.z) / ray.dir.z;
        const tx = ray.origin.x + ray.dir.x * rt;
        const ty = ray.origin.y + ray.dir.y * rt;
        const dx = tx - x;
        const dy = ty - y;
        const dist = Math.hypot(dx, dy);
        const radius = 8;
        if (dist < radius && dist > 0.001) {
          const falloff = 1 - dist / radius;
          if (seed < 0.45) {
            // follower: drifts toward the pointer
            const pull = 5 * falloff * dt;
            vx += (dx / dist) * pull;
            vy += (dy / dist) * pull;
          } else if (seed > 0.7) {
            // avoider: scoots away, more urgently the closer it gets
            const push = 9 * falloff * falloff * dt;
            vx -= (dx / dist) * push;
            vy -= (dy / dist) * push;
          }
        }
      }

      vx *= damp;
      vy *= damp;
      x += vx + Math.sin(t * (0.3 + seed) + seed * 20) * dt * 0.4;
      y += vy + dt * dir * (speed + seed * speed * 2);

      if (y > 9.5) y = -9.5;
      if (y < -9.5) y = 9.5;
      if (x > 16) x = -16;
      if (x < -16) x = 16;
      this.particleVel[i * 2] = vx;
      this.particleVel[i * 2 + 1] = vy;
      pos.setX(i, x);
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    this.particles.material.opacity = twinkle ? 0.45 + Math.sin(t * 2.4) * 0.3 : 0.7;
  }

  // --- pointer tracking + sparkle trail --------------------------------------

  _initPointerTracking() {
    this.pointerNdc = new THREE.Vector2();
    this.pointerActive = false;
    this.lastSparkleWorld = null;
    window.addEventListener('pointermove', (e) => {
      this.pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.pointerActive = true;
    });
    window.addEventListener('pointerleave', () => {
      this.pointerActive = false;
      this.lastSparkleWorld = null;
    });
    document.addEventListener('mouseleave', () => {
      this.pointerActive = false;
      this.lastSparkleWorld = null;
    });
  }

  // --- tap reactions: poking things makes them spin, hop, flip, wobble ------

  _initTapReactions() {
    this.raycaster = new THREE.Raycaster();
    this.reaction = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      // don't steal focus: tapping the scene must not dismiss the on-screen
      // keyboard a little hand just summoned
      e.preventDefault();
      if (this.paused || this.overlayMode) return;
      const ndc = new THREE.Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      this.raycaster.setFromCamera(ndc, this.camera);

      // the big letter first
      if (this.letterMesh && !this.celebrating) {
        if (this.raycaster.intersectObject(this.letterMesh, false).length) {
          this._reactLetter();
          return;
        }
      }

      // then the falling shower letters
      const live = this.shower.filter((s) => s.alive).map((s) => s.mesh);
      const hit = this.raycaster.intersectObjects(live, false)[0];
      if (hit) {
        this._kickShowerLetter(hit.object);
        return;
      }

      // empty space: a little sparkle puff
      const world = this._pointerWorldAt(SPARKLE_Z);
      if (world) {
        for (let i = 0; i < 10; i++) this._spawnSparkle(world);
        playPop();
      }
    });
  }

  _reactLetter() {
    const types = ['spin', 'flip', 'hop', 'wobble'];
    const type = types[Math.floor(Math.random() * types.length)];
    this.reaction = { type, start: this.clock.elapsedTime, dur: type === 'wobble' ? 0.9 : 0.75 };
    if (type === 'spin') playSlideWhistle(true);
    else if (type === 'flip') playSlideWhistle(false);
    else if (type === 'hop') playBoing();
    else playHonk();
  }

  _kickShowerLetter(mesh) {
    const item = this.shower.find((s) => s.mesh === mesh);
    if (!item) return;
    item.vel.y = 7 + Math.random() * 4;
    item.vel.x = (Math.random() - 0.5) * 6;
    item.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    mesh.material.color.setHSL(Math.random(), 0.9, 0.6);
    mesh.material.emissive.copy(mesh.material.color).multiplyScalar(0.35);
    playBoing(1.6 + Math.random() * 0.8);
  }

  _applyReaction(t) {
    if (!this.reaction || !this.letterMesh || this.celebrating) return;
    const p = Math.min(1, (t - this.reaction.start) / this.reaction.dur);
    const easeInOut = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const arc = Math.sin(p * Math.PI);
    switch (this.reaction.type) {
      case 'spin':
        this.letterMesh.rotation.y += easeInOut * Math.PI * 4;
        break;
      case 'flip':
        this.letterMesh.rotation.x += easeInOut * Math.PI * 2;
        break;
      case 'hop':
        this.letterMesh.position.y += arc * 2.1;
        this.letterMesh.scale.y *= 1 + arc * 0.3;
        this.letterMesh.scale.x *= 1 - arc * 0.15;
        break;
      case 'wobble':
        this.letterMesh.rotation.z += Math.sin(p * Math.PI * 6) * (1 - p) * 0.55;
        break;
    }
    if (p >= 1) this.reaction = null;
  }

  _pointerRay() {
    const origin = this.camera.position;
    const target = new THREE.Vector3(this.pointerNdc.x, this.pointerNdc.y, 0.5).unproject(this.camera);
    const dir = target.sub(origin).normalize();
    return { origin, dir };
  }

  _pointerWorldAt(z) {
    const ray = this._pointerRay();
    if (Math.abs(ray.dir.z) < 1e-6) return null;
    const t = (z - ray.origin.z) / ray.dir.z;
    return new THREE.Vector3().copy(ray.dir).multiplyScalar(t).add(ray.origin);
  }

  _initSparkles() {
    const positions = new Float32Array(SPARKLE_POOL * 3);
    const colors = new Float32Array(SPARKLE_POOL * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.42,
      map: this._sprite('star'),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // additive: fading a color to black fades the sparkle to invisible
      blending: THREE.AdditiveBlending
    });
    this.sparkles = new THREE.Points(geo, mat);
    this.sparkles.frustumCulled = false;
    this.scene.add(this.sparkles);
    this.sparkleState = new Array(SPARKLE_POOL).fill(null).map(() => ({
      life: 0,
      maxLife: 1,
      vel: new THREE.Vector3(),
      color: new THREE.Color(0, 0, 0)
    }));
    this.sparkleCursor = 0;
  }

  _spawnSparkle(world) {
    const i = this.sparkleCursor;
    this.sparkleCursor = (this.sparkleCursor + 1) % SPARKLE_POOL;
    const s = this.sparkleState[i];
    s.maxLife = 0.5 + Math.random() * 0.6;
    s.life = s.maxLife;
    s.color.setHSL(Math.random(), 0.9, 0.65);
    s.vel.set((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6);
    const pos = this.sparkles.geometry.attributes.position;
    pos.setXYZ(
      i,
      world.x + (Math.random() - 0.5) * 0.35,
      world.y + (Math.random() - 0.5) * 0.35,
      world.z + (Math.random() - 0.5) * 0.5
    );
  }

  _updateSparkles(dt) {
    // spawn along the pointer's path so fast swipes leave a full trail
    if (this.pointerActive && !this.paused) {
      const world = this._pointerWorldAt(SPARKLE_Z);
      if (world) {
        const prev = this.lastSparkleWorld;
        if (!prev) {
          this.lastSparkleWorld = world.clone();
        } else {
          const moved = world.distanceTo(prev);
          if (moved > 0.12) {
            const steps = Math.min(6, Math.max(1, Math.floor(moved / 0.25)));
            for (let k = 1; k <= steps; k++) {
              this._spawnSparkle(new THREE.Vector3().lerpVectors(prev, world, k / steps));
            }
            this.lastSparkleWorld.copy(world);
          }
        }
      }
    }

    const pos = this.sparkles.geometry.attributes.position;
    const col = this.sparkles.geometry.attributes.color;
    for (let i = 0; i < SPARKLE_POOL; i++) {
      const s = this.sparkleState[i];
      if (s.life <= 0) {
        col.setXYZ(i, 0, 0, 0);
        continue;
      }
      s.life -= dt;
      s.vel.y -= 1.2 * dt;
      pos.setXYZ(i, pos.getX(i) + s.vel.x * dt, pos.getY(i) + s.vel.y * dt, pos.getZ(i) + s.vel.z * dt);
      const fade = Math.max(0, s.life / s.maxLife);
      const flicker = 0.75 + Math.random() * 0.25;
      col.setXYZ(i, s.color.r * fade * flicker, s.color.g * fade * flicker, s.color.b * fade * flicker);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // --- key shower ----------------------------------------------------------

  _initShower() {
    this.shower = [];
    this.showerGroup = new THREE.Group();
    this.scene.add(this.showerGroup);
  }

  spawnKeyLetter(char) {
    let item = this.shower.find((s) => !s.alive);
    if (!item) {
      if (this.shower.length >= SHOWER_POOL) {
        item = this.shower[0]; // recycle the oldest
      } else {
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15 });
        const mesh = new THREE.Mesh(this._charGeometry(char), mat);
        this.showerGroup.add(mesh);
        item = { mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), alive: false };
        this.shower.push(item);
      }
    }
    const { mesh } = item;
    mesh.geometry = this._charGeometry(char);
    mesh.material.color.setHSL(Math.random(), 0.9, 0.6);
    mesh.material.emissive.copy(mesh.material.color).multiplyScalar(0.35);
    mesh.position.set((Math.random() - 0.5) * 14, 7.5 + Math.random() * 2, (Math.random() - 0.5) * 4);
    mesh.scale.setScalar(0.7 + Math.random() * 0.9);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.visible = true;
    item.vel.set((Math.random() - 0.5) * 3, -1 - Math.random() * 2.5, 0);
    item.spin.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    item.alive = true;
  }

  _updateShower(dt) {
    for (const item of this.shower) {
      if (!item.alive) continue;
      item.vel.y -= 6 * dt;
      item.mesh.position.addScaledVector(item.vel, dt);
      item.mesh.rotation.x += item.spin.x * dt;
      item.mesh.rotation.y += item.spin.y * dt;
      item.mesh.rotation.z += item.spin.z * dt;
      if (item.mesh.position.y < -9) {
        item.alive = false;
        item.mesh.visible = false;
      }
    }
  }

  // --- confetti -------------------------------------------------------------

  _initConfetti() {
    const geo = new THREE.PlaneGeometry(0.16, 0.28);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
    this.confetti = new THREE.InstancedMesh(geo, mat, CONFETTI_COUNT);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      color.setHSL(Math.random(), 0.95, 0.6);
      this.confetti.setColorAt(i, color);
    }
    this.confetti.visible = false;
    this.scene.add(this.confetti);
    this.confettiState = new Array(CONFETTI_COUNT).fill(null).map(() => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rot: new THREE.Euler(),
      spin: new THREE.Vector3(),
      life: 0
    }));
    this.confettiActive = false;
  }

  burstConfetti() {
    for (const p of this.confettiState) {
      p.pos.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
      const angle = Math.random() * Math.PI * 2;
      const power = 4 + Math.random() * 8;
      p.vel.set(Math.cos(angle) * power, 4 + Math.random() * 8, Math.sin(angle) * power * 0.4);
      p.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      p.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      p.life = 2.2 + Math.random() * 1.2;
    }
    this.confetti.visible = true;
    this.confettiActive = true;
  }

  _updateConfetti(dt) {
    if (!this.confettiActive) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let anyAlive = false;
    this.confettiState.forEach((p, i) => {
      if (p.life > 0) {
        anyAlive = true;
        p.life -= dt;
        p.vel.y -= 9 * dt;
        p.vel.multiplyScalar(1 - 0.6 * dt);
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
      }
      const scale = Math.max(0, Math.min(1, p.life));
      q.setFromEuler(p.rot);
      s.setScalar(scale);
      m.compose(p.pos, q, s);
      this.confetti.setMatrixAt(i, m);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    if (!anyAlive) {
      this.confettiActive = false;
      this.confetti.visible = false;
    }
  }

  // --- target letter ---------------------------------------------------------

  _showLetter(letter) {
    if (this.letterMesh) {
      this.letterGroup.remove(this.letterMesh);
      this.letterMesh.material.dispose();
      this.letterMesh = null;
    }
    const hue = Math.random();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.9, 0.55),
      emissive: new THREE.Color().setHSL(hue, 0.9, 0.18),
      roughness: 0.25,
      metalness: 0.2
    });
    this.letterMesh = new THREE.Mesh(this._charGeometry(letter), mat);
    this.letterMesh.scale.setScalar(0.01);
    this.letterGroup.add(this.letterMesh);
    this.letterBorn = this.clock.elapsedTime;
    this.celebrating = false;
  }

  _promptLetter({ newWord = true } = {}) {
    if (newWord || !this.currentWord) this.currentWord = randomWordFor(this.target);
    speak(`${this.target}! ... ${this.target} is for ${this.currentWord}!`);
    this.lastPromptAt = performance.now();
  }

  nextLetter() {
    this.sequenceIndex = (this.sequenceIndex + 1) % this.sequence.length;
    if (this.sequenceIndex === 0) {
      this.sequence.sort(() => Math.random() - 0.5);
    }
    this.target = this.sequence[this.sequenceIndex];
    this._nextTheme();
    this._showLetter(this.target);
    this._promptLetter();
    this.onProgress({ letter: this.target, stars: this.stars });
  }

  _celebrate() {
    this.celebrating = true;
    this.stars = addScore('letters');
    playSuccess();
    this.burstConfetti();
    const word = this.currentWord;
    speak(`Yay! ${this.target}! ${this.target} is for ${word}! Great job!`, { pitch: 1.4, rate: 0.95 });
    setTimeout(() => {
      playWhoosh();
      this.nextLetter();
    }, 2300);
  }

  // --- input -----------------------------------------------------------------

  _trackMash() {
    const now = performance.now();
    this.pressTimes.push(now);
    this.pressTimes = this.pressTimes.filter((t) => now - t < MASH_WINDOW_MS);
    return this.pressTimes.length >= MASH_THRESHOLD;
  }

  // Keys pressed outside the letter game still shower the screen festively
  // (and still earn the sad noise for mashing), they just don't play the game.
  handleAmbientKey(char) {
    if (this.paused) return;
    const mashing = this._trackMash();
    this.spawnKeyLetter(char);
    playPop();
    if (mashing) playSad();
  }

  _encourage() {
    const now = performance.now();
    if (now - (this.lastEncourageAt || 0) < ENCOURAGE_INTERVAL_MS) {
      playSad();
      return;
    }
    this.lastEncourageAt = now;
    const phrase = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
    speak(phrase.replaceAll('{L}', this.target), { pitch: 1.3 });
  }

  handleKey(char) {
    if (!this.running || this.celebrating || this.paused) return;
    const mashing = this._trackMash();

    // every press rains down in festive colors
    this.spawnKeyLetter(char);
    playPop();

    // Easy mode: hitting the right letter always counts, even mid-mash.
    // Hard mode: mashing never progresses, but he gets coached through it.
    if (mashing && getDifficulty() === 'hard') {
      this._encourage();
      return;
    }

    if (mashing && char !== this.target) {
      playSad();
      return;
    }

    if (char === this.target) {
      this.wrongSinceHint = 0;
      this._celebrate();
    } else {
      this.wrongSinceHint += 1;
      const now = performance.now();
      if (this.wrongSinceHint >= 4 && now - this.lastPromptAt > 6000) {
        this.wrongSinceHint = 0;
        this._promptLetter({ newWord: true });
      }
    }
  }

  // --- lifecycle ---------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    if (!this.letterMesh) {
      this._showLetter(this.target);
    }
    this._promptLetter();
    this.onProgress({ letter: this.target, stars: this.stars });
  }

  stop() {
    this.running = false;
  }

  setPaused(paused) {
    this.paused = paused;
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    const dt = this.paused ? 0 : Math.min(this.clock.getDelta(), 0.05);
    if (this.paused) {
      this.clock.getDelta();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const t = this.clock.elapsedTime;

    this.lightA.position.set(Math.sin(t * 0.7) * 7, Math.cos(t * 0.9) * 4, 4);
    this.lightB.position.set(Math.cos(t * 0.5) * -7, Math.sin(t * 0.8) * 4, 4);

    this._updateParticles(dt, t);

    if (this.letterMesh) {
      const age = t - this.letterBorn;
      const spring = Math.min(1, age * 2.2);
      const overshoot = 1 + Math.sin(Math.min(age * 2.2, 1) * Math.PI) * 0.25;
      const base = 3.2 * spring * overshoot;
      if (this.celebrating) {
        this.letterMesh.rotation.y += dt * 9;
        this.letterMesh.scale.multiplyScalar(1 + dt * 1.2);
      } else {
        this.letterMesh.scale.setScalar(base);
        this.letterMesh.rotation.y = Math.sin(t * 0.9) * 0.4;
        this.letterMesh.rotation.x = Math.sin(t * 0.6) * 0.12;
        this.letterMesh.rotation.z = 0;
        this.letterMesh.position.y = Math.sin(t * 1.3) * 0.35;
        this._applyReaction(t);
      }
    }

    // gentle re-prompt when he wanders off
    if (this.running && !this.celebrating && performance.now() - this.lastPromptAt > IDLE_REPROMPT_MS) {
      this._promptLetter({ newWord: true });
    }

    this._updateShower(dt);
    this._updateConfetti(dt);
    this._updateSparkles(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
