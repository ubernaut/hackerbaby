import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontJson from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { LETTERS, randomWordFor } from './words.js';
import { playPop, playSuccess, playSad, playWhoosh } from './audio.js';
import { speak } from './speech.js';

const MASH_WINDOW_MS = 1500;
const MASH_THRESHOLD = 5;
const IDLE_REPROMPT_MS = 14000;
const SHOWER_POOL = 80;
const CONFETTI_COUNT = 220;

function makeBackgroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#31146b');
  grad.addColorStop(0.55, '#1a0b2e');
  grad.addColorStop(1, '#0b1e3d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const glow = g.createRadialGradient(256, 200, 20, 256, 200, 300);
  glow.addColorStop(0, 'rgba(124, 77, 255, 0.5)');
  glow.addColorStop(1, 'rgba(124, 77, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCircleSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class LetterGame {
  constructor(canvas, { onProgress } = {}) {
    this.canvas = canvas;
    this.onProgress = onProgress || (() => {});
    this.running = false;
    this.stars = 0;
    this.pressTimes = [];
    this.wrongSinceHint = 0;
    this.lastPromptAt = 0;
    this.celebrating = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = makeBackgroundTexture();

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

    this._initBubbles();
    this._initShower();
    this._initConfetti();

    this.letterGroup = new THREE.Group();
    this.scene.add(this.letterGroup);
    this.letterMesh = null;

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

  // --- floating background bubbles ---------------------------------------

  _initBubbles() {
    const count = 90;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 2] = -4 - Math.random() * 12;
      color.setHSL(Math.random(), 0.8, 0.7);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.7,
      map: makeCircleSprite(),
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });
    this.bubbles = new THREE.Points(geo, mat);
    this.scene.add(this.bubbles);
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
    this._showLetter(this.target);
    this._promptLetter();
    this.onProgress({ letter: this.target, stars: this.stars });
  }

  _celebrate() {
    this.celebrating = true;
    this.stars += 1;
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

  handleKey(char) {
    if (!this.running || this.celebrating) return;
    const now = performance.now();
    this.pressTimes.push(now);
    this.pressTimes = this.pressTimes.filter((t) => now - t < MASH_WINDOW_MS);
    const mashing = this.pressTimes.length >= MASH_THRESHOLD;

    // every press rains down in festive colors
    this.spawnKeyLetter(char);
    playPop();

    if (mashing) {
      playSad();
      return;
    }

    if (char === this.target) {
      this.wrongSinceHint = 0;
      this._celebrate();
    } else {
      this.wrongSinceHint += 1;
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

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    this.lightA.position.set(Math.sin(t * 0.7) * 7, Math.cos(t * 0.9) * 4, 4);
    this.lightB.position.set(Math.cos(t * 0.5) * -7, Math.sin(t * 0.8) * 4, 4);

    const pos = this.bubbles.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.2 + (i % 5) * 0.08);
      if (y > 9) y = -9;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

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
        this.letterMesh.position.y = Math.sin(t * 1.3) * 0.35;
      }
    }

    // gentle re-prompt when he wanders off
    if (this.running && !this.celebrating && performance.now() - this.lastPromptAt > IDLE_REPROMPT_MS) {
      this._promptLetter({ newWord: true });
    }

    this._updateShower(dt);
    this._updateConfetti(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
