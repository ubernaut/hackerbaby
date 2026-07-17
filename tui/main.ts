// Hacker Baby — terminal edition. A console port of the web app on the
// sibling deno_tui fork (../../deno_tui), with all three game modes:
//
//   F1  letter game    — big block letter, press the right key
//   F2  picture game   — ASCII-art cards; TYPE the word (no mic in a tty)
//   F3  mirror         — live ASCII webcam via ffmpeg (or a silly face)
//
//   deno task play             # easy mode
//   deno task play:hard        # mashing never advances, coaches instead
//   deno task play:quiet       # no text-to-speech
//   deno task play -- --mode=pictures   # boot straight into a mode
//
// Ctrl+C or Ctrl+Q quits. Scores persist to .state.json next to this file.

import { crayon } from "crayon";
import { Tui } from "tui/src/tui.ts";
import { handleInput } from "tui/src/input.ts";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
import { createSpeaker } from "./speech.ts";
import type { Ctx, GameMode, SavedState } from "./context.ts";
import { createLetterMode } from "./letterMode.ts";
import { createPictureMode } from "./pictureMode.ts";
import { createMirrorMode } from "./mirrorMode.ts";

// ---------- settings & persistence ------------------------------------------

const STATE_FILE = new URL("./.state.json", import.meta.url);

function loadState(): SavedState {
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(STATE_FILE));
    const scores = parsed.scores ?? {};
    return {
      scores: {
        // migrate the original single-score format ({stars: n})
        letters: Number.isFinite(scores.letters) ? scores.letters : (Number.isFinite(parsed.stars) ? parsed.stars : 0),
        pictures: Number.isFinite(scores.pictures) ? scores.pictures : 0,
      },
      difficulty: parsed.difficulty === "hard" ? "hard" : "easy",
    };
  } catch (_) {
    return { scores: { letters: 0, pictures: 0 }, difficulty: "easy" };
  }
}

const state = loadState();
if (Deno.args.includes("--hard")) state.difficulty = "hard";
if (Deno.args.includes("--easy")) state.difficulty = "easy";

function saveState() {
  try {
    Deno.writeTextFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (_) {
    // read-only filesystem — scores just won't persist
  }
}
saveState();

const voiceEnabled = !Deno.args.includes("--no-voice");
const speaker = await createSpeaker(voiceEnabled);

// ---------- tui setup -----------------------------------------------------------

const TICK_MS = 50;

const tui = new Tui({
  style: crayon.bgBlack,
  refreshRate: 1000 / 30,
});
handleInput(tui);
tui.dispatch();
tui.run();

const center = () => tui.rectangle.value;

// ---------- shared hud ------------------------------------------------------------

new Text({
  parent: tui,
  text: "H A C K E R  B A B Y",
  theme: { base: crayon.bgBlack.lightMagenta.bold },
  rectangle: { column: 2, row: 1 },
  zIndex: 5,
});

const scoreSignals = {
  letters: new Signal(state.scores.letters),
  pictures: new Signal(state.scores.pictures),
};
const activeModeName = new Signal("letters");

new Text({
  parent: tui,
  text: new Computed(() => {
    // read every signal unconditionally: Computed only tracks dependencies
    // it actually touches, and branches would drop the untouched score
    const letters = scoreSignals.letters.value;
    const pictures = scoreSignals.pictures.value;
    const name = activeModeName.value;
    if (name === "letters") return ` SCORE ${letters} `;
    if (name === "pictures") return ` SCORE ${pictures} `;
    return "";
  }),
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
    `F1 letters · F2 pictures · F3 mirror   [${activeModeName.value}]  ·  ${state.difficulty}  ·  voice: ${
      speaker.available ? speaker.engine : "off"
    }  ·  ctrl+c quits`
  ),
  theme: { base: crayon.bgBlack.lightBlack },
  rectangle: new Computed(() => ({
    column: 2,
    row: Math.max(2, center().height - 1),
  })),
  zIndex: 5,
});

// shared message lines (each mode reuses these)
const wordLine = new Signal("");
new Text({
  parent: tui,
  text: wordLine,
  theme: { base: crayon.bgBlack.lightYellow.bold },
  rectangle: new Computed(() => ({
    column: Math.max(2, Math.floor((center().width - wordLine.value.length) / 2)),
    row: Math.min(center().height - 3, Math.floor(center().height / 2) + 6),
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
    row: Math.max(2, Math.floor(center().height / 2) - 7),
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
    row: Math.min(center().height - 2, Math.floor(center().height / 2) + 8),
  })),
  zIndex: 5,
});

// ---------- particle pools (shower + confetti, shared by all modes) ----------------

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

const shower = makeParticlePool(48, 4);
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

const confetti = makeParticlePool(64, 6);

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

// ---------- modes -------------------------------------------------------------------

const ctx: Ctx = {
  tui,
  center,
  speaker,
  spawnShowerKey,
  burstConfetti,
  wordLine,
  cheerLine,
  warnLine,
  state,
  saveState,
  scoreSignals,
};

const modes: Record<string, GameMode> = {
  letters: createLetterMode(ctx),
  pictures: createPictureMode(ctx),
  mirror: createMirrorMode(ctx),
};

let active: GameMode = modes.letters;

function switchMode(name: string) {
  const next = modes[name];
  if (!next || next === active) return;
  active.stop();
  wordLine.value = "";
  cheerLine.value = "";
  warnLine.value = "";
  active = next;
  activeModeName.value = name;
  active.start();
}

// ---------- input -------------------------------------------------------------------

tui.on("keyPress", ({ key, ctrl, meta }) => {
  if (ctrl && (key === "q" || key === "c")) {
    saveState();
    tui.destroy();
    Deno.exit(0);
  }
  if (ctrl || meta) return;

  if (key === "f1") return switchMode("letters");
  if (key === "f2") return switchMode("pictures");
  if (key === "f3") return switchMode("mirror");

  if (typeof key === "string" && /^[a-z0-9]$/i.test(key)) {
    const char = key.toUpperCase();
    // keys rain festively over every mode, just like the web app
    spawnShowerKey(char);
    active.handleKey(char);
  } else if (active.name === "mirror" && key === "space") {
    active.handleKey(" ");
  }
});

// ---------- main loop ----------------------------------------------------------------

let t = 0;
setInterval(() => {
  const dt = TICK_MS / 1000;
  t += dt;
  updateParticles(shower, dt, 14);
  updateParticles(confetti, dt, 26);
  active.tick(dt, t);
}, TICK_MS);

// ---------- go! -----------------------------------------------------------------------

const bootMode = Deno.args.find((a) => a.startsWith("--mode="))?.slice(7) ?? "letters";
if (modes[bootMode] && bootMode !== "letters") {
  activeModeName.value = bootMode;
  active = modes[bootMode];
}
active.start();
