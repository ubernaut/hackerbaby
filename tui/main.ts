// Hacker Baby — terminal edition. A console port of the web letter game,
// built on the sibling deno_tui fork (../../deno_tui). The big 3D letter
// becomes a chunky block-font glyph, the key shower and confetti become
// falling colored characters, and speech goes through espeak/spd-say.
//
//   deno task play           # easy mode (right letter always counts)
//   deno task play:hard      # mashing never advances, coaches instead
//   deno task play:quiet     # no text-to-speech
//
// Ctrl+C or Ctrl+Q quits. Scores persist to .state.json next to this file.

import { crayon } from "crayon";
import { Tui } from "tui/src/tui.ts";
import { handleInput } from "tui/src/input.ts";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
import { LETTERS, randomWordFor, shuffle } from "../src/words.js";
import { GLYPH_HEIGHT, GLYPH_WIDTH, renderGlyph } from "./font.ts";
import { createSpeaker } from "./speech.ts";

// ---------- settings & persistence ------------------------------------------

const STATE_FILE = new URL("./.state.json", import.meta.url);

interface SavedState {
  stars: number;
  difficulty: "easy" | "hard";
}

function loadState(): SavedState {
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(STATE_FILE));
    return {
      stars: Number.isFinite(parsed.stars) ? parsed.stars : 0,
      difficulty: parsed.difficulty === "hard" ? "hard" : "easy",
    };
  } catch (_) {
    return { stars: 0, difficulty: "easy" };
  }
}

function saveState(state: SavedState) {
  try {
    Deno.writeTextFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (_) {
    // read-only filesystem — scores just won't persist
  }
}

const state = loadState();
if (Deno.args.includes("--hard")) state.difficulty = "hard";
if (Deno.args.includes("--easy")) state.difficulty = "easy";
saveState(state);

const voiceEnabled = !Deno.args.includes("--no-voice");
const speaker = await createSpeaker(voiceEnabled);

// ---------- game constants ----------------------------------------------------

const MASH_WINDOW_MS = 1500;
const MASH_THRESHOLD = 5;
const IDLE_REPROMPT_MS = 15000;
const CELEBRATE_MS = 2600;
const ENCOURAGE_INTERVAL_MS = 6000;
const TICK_MS = 50;

const ENCOURAGEMENTS = [
  "Almost! Just press {L}!",
  "You can do it! Just press {L}!",
  "So close! One finger... press {L}!",
  "Slow down, buddy! Just press {L}!",
];

const LETTER_COLORS = [
  crayon.bgBlack.lightRed.bold,
  crayon.bgBlack.lightYellow.bold,
  crayon.bgBlack.lightGreen.bold,
  crayon.bgBlack.lightCyan.bold,
  crayon.bgBlack.lightBlue.bold,
  crayon.bgBlack.lightMagenta.bold,
];

const RAIN_COLORS = [
  crayon.bgBlack.lightRed,
  crayon.bgBlack.lightYellow,
  crayon.bgBlack.lightGreen,
  crayon.bgBlack.lightCyan,
  crayon.bgBlack.lightMagenta,
  crayon.bgBlack.lightBlue,
  crayon.bgBlack.magenta,
  crayon.bgBlack.cyan,
];

const CONFETTI_CHARS = ["*", "o", "+", ".", "x", "#"];

// ---------- tui setup -----------------------------------------------------------

const tui = new Tui({
  style: crayon.bgBlack,
  refreshRate: 1000 / 30,
});
handleInput(tui);
tui.dispatch();
tui.run();

const center = () => tui.rectangle.value;

// title + hud
new Text({
  parent: tui,
  text: "H A C K E R  B A B Y",
  theme: { base: crayon.bgBlack.lightMagenta.bold },
  rectangle: { column: 2, row: 1 },
  zIndex: 5,
});

const stars = new Signal(state.stars);
new Text({
  parent: tui,
  text: new Computed(() => ` SCORE ${stars.value} `),
  theme: { base: crayon.bgBlack.lightYellow.bold },
  rectangle: new Computed(() => ({
    column: Math.max(2, Math.floor(center().width / 2) - 5),
    row: 1,
  })),
  zIndex: 5,
});

new Text({
  parent: tui,
  text: new Computed(() =>
    `mode: ${state.difficulty}  ·  voice: ${speaker.available ? speaker.engine : "off"}  ·  ctrl+c quits`
  ),
  theme: { base: crayon.bgBlack.lightBlack },
  rectangle: new Computed(() => ({
    column: 2,
    row: Math.max(2, center().height - 1),
  })),
  zIndex: 5,
});

// prompt + transient message lines
const wordLine = new Signal("");
new Text({
  parent: tui,
  text: wordLine,
  theme: { base: crayon.bgBlack.lightYellow.bold },
  rectangle: new Computed(() => ({
    column: Math.max(2, Math.floor((center().width - wordLine.value.length) / 2)),
    row: Math.min(center().height - 3, Math.floor(center().height / 2) + GLYPH_HEIGHT - 1),
  })),
  zIndex: 5,
});

const cheerLine = new Signal("");
new Text({
  parent: tui,
  text: cheerLine,
  theme: { base: crayon.bgBlack.lightGreen.bold },
  rectangle: new Computed(() => ({
    column: Math.max(2, Math.floor((center().width - cheerLine.value.length) / 2)),
    row: Math.max(2, Math.floor(center().height / 2) - GLYPH_HEIGHT),
  })),
  zIndex: 5,
});

const warnLine = new Signal("");
new Text({
  parent: tui,
  text: warnLine,
  theme: { base: crayon.bgBlack.lightRed.bold },
  rectangle: new Computed(() => ({
    column: Math.max(2, Math.floor((center().width - warnLine.value.length) / 2)),
    row: Math.min(center().height - 2, Math.floor(center().height / 2) + GLYPH_HEIGHT + 1),
  })),
  zIndex: 5,
});

// ---------- the big letter -------------------------------------------------------

const bob = new Signal(0);
let letterColorIndex = 0;
let letterComponents: Text[] = [];

function buildLetter(letter: string) {
  for (const component of letterComponents) component.destroy();
  letterComponents = [];
  const rows = renderGlyph(letter);
  const color = LETTER_COLORS[letterColorIndex % LETTER_COLORS.length];
  rows.forEach((rowText, i) => {
    letterComponents.push(
      new Text({
        parent: tui,
        text: rowText,
        theme: { base: color },
        rectangle: new Computed(() => ({
          column: Math.max(1, Math.floor((center().width - GLYPH_WIDTH) / 2)),
          row: Math.max(2, Math.floor((center().height - GLYPH_HEIGHT) / 2) + i + bob.value),
        })),
        zIndex: 3,
      }),
    );
  });
}

// ---------- falling key shower + confetti ------------------------------------------

interface Particle {
  alive: boolean;
  column: number;
  row: number;
  vx: number;
  vy: number;
  life: number;
  text: Signal<string>;
  rect: Signal<{ column: number; row: number }>;
}

function makeParticlePool(size: number, zIndex: number): Particle[] {
  return Array.from({ length: size }, (_, i) => {
    const text = new Signal("");
    const rect = new Signal({ column: 1, row: 1 });
    new Text({
      parent: tui,
      text,
      theme: { base: RAIN_COLORS[i % RAIN_COLORS.length] },
      rectangle: rect,
      zIndex,
    });
    return { alive: false, column: 1, row: 1, vx: 0, vy: 0, life: 0, text, rect };
  });
}

const shower = makeParticlePool(48, 2);
let showerCursor = 0;

function spawnShowerKey(char: string) {
  const p = shower[showerCursor];
  showerCursor = (showerCursor + 1) % shower.length;
  p.alive = true;
  p.column = 2 + Math.random() * Math.max(4, center().width - 4);
  p.row = 2;
  p.vx = (Math.random() - 0.5) * 6;
  p.vy = 4 + Math.random() * 10;
  p.life = 99;
  p.text.value = char;
}

const confetti = makeParticlePool(64, 4);

function burstConfetti() {
  const midCol = center().width / 2;
  const midRow = center().height / 2;
  for (const p of confetti) {
    p.alive = true;
    p.column = midCol + (Math.random() - 0.5) * 6;
    p.row = midRow + (Math.random() - 0.5) * 3;
    const angle = Math.random() * Math.PI * 2;
    const power = 6 + Math.random() * 18;
    p.vx = Math.cos(angle) * power * 1.6;
    p.vy = Math.sin(angle) * power * 0.6 - 6;
    p.life = 1.4 + Math.random() * 1.2;
    p.text.value = CONFETTI_CHARS[Math.floor(Math.random() * CONFETTI_CHARS.length)];
  }
}

function updateParticles(pool: Particle[], dt: number, gravity: number) {
  const { width, height } = center();
  for (const p of pool) {
    if (!p.alive) continue;
    p.life -= dt;
    p.vy += gravity * dt;
    p.column += p.vx * dt;
    p.row += p.vy * dt;
    if (p.life <= 0 || p.row >= height - 1 || p.column < 1 || p.column >= width - 1) {
      p.alive = false;
      p.text.value = "";
      continue;
    }
    p.rect.value = { column: Math.round(p.column), row: Math.round(p.row) };
  }
}

// ---------- game state ------------------------------------------------------------

const sequence = shuffle([...LETTERS]);
let sequenceIndex = 0;
let target = sequence[0];
let currentWord = "";
let celebrating = false;
let celebrateUntil = 0;
let lastPromptAt = 0;
let lastEncourageAt = 0;
let wrongSinceHint = 0;
const pressTimes: number[] = [];

function promptLetter(newWord = true) {
  if (newWord || !currentWord) currentWord = randomWordFor(target);
  wordLine.value = `${target} is for ${currentWord.toUpperCase()}!`;
  speaker.speak(`${target}! ${target} is for ${currentWord}!`);
  lastPromptAt = Date.now();
}

function nextLetter() {
  sequenceIndex = (sequenceIndex + 1) % sequence.length;
  if (sequenceIndex === 0) shuffle(sequence);
  target = sequence[sequenceIndex];
  letterColorIndex++;
  celebrating = false;
  cheerLine.value = "";
  warnLine.value = "";
  buildLetter(target);
  promptLetter();
}

function celebrate() {
  celebrating = true;
  celebrateUntil = Date.now() + CELEBRATE_MS;
  stars.value = ++state.stars;
  saveState(state);
  burstConfetti();
  cheerLine.value = `YAY! ${target} is for ${currentWord.toUpperCase()}! GREAT JOB!`;
  warnLine.value = "";
  speaker.speak(`Yay! ${target}! ${target} is for ${currentWord}! Great job!`);
}

function encourage() {
  const now = Date.now();
  if (now - lastEncourageAt < ENCOURAGE_INTERVAL_MS) {
    warnLine.value = `just press ${target}!`;
    return;
  }
  lastEncourageAt = now;
  const phrase = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]
    .replaceAll("{L}", target);
  warnLine.value = phrase.toUpperCase();
  speaker.speak(phrase);
}

function trackMash(): boolean {
  const now = Date.now();
  pressTimes.push(now);
  while (pressTimes.length && now - pressTimes[0] > MASH_WINDOW_MS) pressTimes.shift();
  return pressTimes.length >= MASH_THRESHOLD;
}

function handleKey(char: string) {
  spawnShowerKey(char);

  if (celebrating) return;

  const mashing = trackMash();

  if (mashing && state.difficulty === "hard") {
    encourage();
    return;
  }
  if (mashing && char !== target) {
    warnLine.value = "wah wah... one key at a time!";
    return;
  }

  if (char === target) {
    wrongSinceHint = 0;
    celebrate();
  } else {
    wrongSinceHint++;
    if (wrongSinceHint >= 4 && Date.now() - lastPromptAt > 6000) {
      wrongSinceHint = 0;
      promptLetter(true);
    }
  }
}

// ---------- input -------------------------------------------------------------------

tui.on("keyPress", ({ key, ctrl, meta }) => {
  if (ctrl && (key === "q" || key === "c")) {
    saveState(state);
    tui.destroy();
    Deno.exit(0);
  }
  if (ctrl || meta) return;
  if (typeof key === "string" && /^[a-z0-9]$/i.test(key)) {
    handleKey(key.toUpperCase());
  }
});

// ---------- main loop ----------------------------------------------------------------

let t = 0;
setInterval(() => {
  const dt = TICK_MS / 1000;
  t += dt;

  bob.value = Math.round(Math.sin(t * 2.2));

  updateParticles(shower, dt, 14);
  updateParticles(confetti, dt, 26);

  if (celebrating && Date.now() >= celebrateUntil) {
    nextLetter();
  }

  if (!celebrating && Date.now() - lastPromptAt > IDLE_REPROMPT_MS) {
    promptLetter(true);
  }

  // fade the mash warning after a couple of seconds
  if (warnLine.value && Date.now() - lastEncourageAt > 2500 && !celebrating) {
    const stale = pressTimes.length === 0 || Date.now() - pressTimes[pressTimes.length - 1] > 2500;
    if (stale) warnLine.value = "";
  }
}, TICK_MS);

// ---------- go! -----------------------------------------------------------------------

buildLetter(target);
promptLetter();
