// WebAudio sound effects and a gentle generative background tune.
// Everything is synthesized so the app ships zero audio assets.

let ctx = null;
let master = null;
let musicGain = null;
let musicPlaying = false;
let musicTimer = null;
let lastSadAt = 0;

export function unlockAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.16;
    musicGain.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq = 440, time = 0, dur = 0.2, type = 'sine', vol = 0.3, dest = master, glideTo = null }) {
  const t0 = ctx.currentTime + time;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ time = 0, dur = 0.15, vol = 0.2, filterFreq = 3000 }) {
  const t0 = ctx.currentTime + time;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
}

// --- sound effects -------------------------------------------------------

const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

export function playPop() {
  if (!ctx) return;
  const f = 300 + Math.random() * 900;
  tone({ freq: f, dur: 0.12, type: 'square', vol: 0.18, glideTo: f * 1.8 });
  noise({ dur: 0.06, vol: 0.08, filterFreq: 2500 + Math.random() * 3000 });
}

const JINGLES = [
  [0, 2, 4, 7],
  [4, 2, 4, 5, 7],
  [0, 4, 7, 4, 7],
  [7, 5, 4, 5, 7, 7],
  [0, 2, 4, 5, 6, 7]
];

export function playSuccess() {
  if (!ctx) return;
  const jingle = JINGLES[Math.floor(Math.random() * JINGLES.length)];
  const types = ['triangle', 'square', 'sawtooth'];
  const type = types[Math.floor(Math.random() * types.length)];
  jingle.forEach((step, i) => {
    const freq = PENTA[step % PENTA.length] * (step >= PENTA.length ? 2 : 1);
    tone({ freq, time: i * 0.11, dur: 0.22, type, vol: 0.26 });
    tone({ freq: freq * 2, time: i * 0.11, dur: 0.18, type: 'sine', vol: 0.1 });
  });
  // sparkle tail
  for (let i = 0; i < 6; i++) {
    tone({
      freq: 1200 + Math.random() * 1600,
      time: jingle.length * 0.11 + i * 0.05,
      dur: 0.1,
      type: 'sine',
      vol: 0.07
    });
  }
}

export function playSad() {
  if (!ctx) return;
  // throttle: mashing shouldn't machine-gun the sad trombone
  const now = ctx.currentTime;
  if (now - lastSadAt < 1.8) return false;
  lastSadAt = now;
  tone({ freq: 340, dur: 0.35, type: 'sawtooth', vol: 0.16, glideTo: 300 });
  tone({ freq: 300, time: 0.35, dur: 0.55, type: 'sawtooth', vol: 0.16, glideTo: 230 });
  return true;
}

export function playWhoosh() {
  if (!ctx) return;
  noise({ dur: 0.4, vol: 0.18, filterFreq: 900 });
  tone({ freq: 200, dur: 0.4, type: 'sine', vol: 0.12, glideTo: 900 });
}

export function playShutter() {
  if (!ctx) return;
  noise({ dur: 0.05, vol: 0.3, filterFreq: 5000 });
  noise({ time: 0.08, dur: 0.05, vol: 0.2, filterFreq: 3500 });
  tone({ freq: 1500, time: 0.02, dur: 0.05, type: 'square', vol: 0.08 });
}

export function playBoing(mult = 1) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(420 * mult, t0);
  osc.frequency.exponentialRampToValueAtTime(110 * mult, t0 + 0.16);
  osc.frequency.exponentialRampToValueAtTime(280 * mult, t0 + 0.34);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.45);
}

export function playSlideWhistle(up = true) {
  if (!ctx) return;
  const from = up ? 320 : 950;
  const to = up ? 950 : 320;
  tone({ freq: from, dur: 0.35, type: 'sine', vol: 0.2, glideTo: to });
  tone({ freq: from * 2, dur: 0.35, type: 'sine', vol: 0.06, glideTo: to * 2 });
}

export function playHonk() {
  if (!ctx) return;
  tone({ freq: 196, dur: 0.18, type: 'square', vol: 0.16 });
  tone({ freq: 294, dur: 0.18, type: 'square', vol: 0.1 });
}

export function playChime() {
  if (!ctx) return;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    tone({ freq: f, time: i * 0.12, dur: 0.5, type: 'sine', vol: 0.14 });
  });
}

// --- background music -----------------------------------------------------

// A soft, ever-shifting pentatonic lullaby-meets-chiptune loop.
const BASS_STEPS = [0, 0, 3, 5];
let barIndex = 0;

function scheduleBar() {
  if (!musicPlaying || !ctx) return;
  const beat = 0.32;
  const barDur = beat * 8;

  const bassStep = BASS_STEPS[barIndex % BASS_STEPS.length];
  const bassFreq = PENTA[bassStep] / 2;
  for (let b = 0; b < 4; b++) {
    tone({ freq: bassFreq, time: b * beat * 2, dur: beat * 1.6, type: 'triangle', vol: 0.5, dest: musicGain });
  }

  for (let b = 0; b < 8; b++) {
    if (Math.random() < 0.62) {
      const idx = Math.floor(Math.random() * PENTA.length);
      tone({
        freq: PENTA[idx] * (Math.random() < 0.2 ? 2 : 1),
        time: b * beat,
        dur: beat * (Math.random() < 0.3 ? 1.8 : 0.9),
        type: Math.random() < 0.5 ? 'triangle' : 'sine',
        vol: 0.4,
        dest: musicGain
      });
    }
  }

  // occasional twinkle
  if (Math.random() < 0.4) {
    tone({ freq: 1567.98, time: Math.random() * barDur, dur: 0.3, type: 'sine', vol: 0.12, dest: musicGain });
  }

  barIndex++;
  musicTimer = setTimeout(scheduleBar, barDur * 1000 - 40);
}

export function startMusic() {
  if (!ctx || musicPlaying) return;
  musicPlaying = true;
  scheduleBar();
}

export function stopMusic() {
  musicPlaying = false;
  if (musicTimer) clearTimeout(musicTimer);
  musicTimer = null;
}

export function toggleMusic() {
  if (musicPlaying) {
    stopMusic();
    return false;
  }
  startMusic();
  return true;
}

export function isMusicPlaying() {
  return musicPlaying;
}
