// The letter game: the web app's 3D letter, in a terminal. With WebGPU the
// target letter is real extruded three.js TextGeometry (same font asset and
// same animation curves as the web game) rendered to ASCII; without it, a
// chunky 5×7 block-font fallback. Game rules are identical either way.

import { crayon } from "crayon";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
import { Color, Group, Mesh, MeshPhongMaterial } from "three";
import { FontLoader } from "npm:three@0.183.2/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "npm:three@0.183.2/examples/jsm/geometries/TextGeometry.js";
import { LETTERS, randomWordFor, shuffle } from "../src/words.js";
import { GLYPH_HEIGHT, GLYPH_WIDTH, renderGlyph } from "./font.ts";
import type { Ctx, GameMode } from "./context.ts";

const MASH_WINDOW_MS = 1500;
const MASH_THRESHOLD = 5;
const IDLE_REPROMPT_MS = 15000;
const CELEBRATE_MS = 2600;
const ENCOURAGE_INTERVAL_MS = 6000;

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

export function createLetterMode(ctx: Ctx): GameMode {
  let running = false;
  let letterColorIndex = 0;

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

  // ---- 3D presentation (WebGPU → ASCII, mirrors the web's letterGame) ----

  const use3d = Boolean(ctx.stage && ctx.font);
  const font = use3d ? new FontLoader().parse(ctx.font) : null;
  const group = new Group();
  const geometryCache = new Map<string, TextGeometry>();
  const material = new MeshPhongMaterial({
    color: new Color("#ffffff"),
    emissive: new Color("#000000"),
    shininess: 70,
    specular: new Color("#aaaaff"),
  });
  let letterMesh: Mesh | null = null;
  let letterBorn = 0;
  let stageTime = 0;

  function charGeometry(char: string): TextGeometry {
    let geometry = geometryCache.get(char);
    if (!geometry) {
      geometry = new TextGeometry(char, {
        font: font!,
        size: 3,
        depth: 1.05,
        curveSegments: 8,
        bevelEnabled: true,
        bevelThickness: 0.12,
        bevelSize: 0.09,
        bevelSegments: 2,
      });
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      geometry.translate(
        -(bb.max.x + bb.min.x) / 2,
        -(bb.max.y + bb.min.y) / 2,
        -(bb.max.z + bb.min.z) / 2,
      );
      geometryCache.set(char, geometry);
    }
    return geometry;
  }

  function present3dLetter(letter: string) {
    if (letterMesh) group.remove(letterMesh);
    const hue = Math.random();
    material.color.setHSL(hue, 0.9, 0.55);
    material.emissive.setHSL(hue, 0.9, 0.16);
    letterMesh = new Mesh(charGeometry(letter), material);
    letterMesh.scale.setScalar(0.01);
    group.add(letterMesh);
    letterBorn = stageTime;
  }

  // same curves as the web game's _tick
  function frame3d(dt: number, t: number) {
    stageTime = t;
    if (!letterMesh) return;
    const age = t - letterBorn;
    const spring = Math.min(1, age * 2.2);
    const overshoot = 1 + Math.sin(Math.min(age * 2.2, 1) * Math.PI) * 0.25;
    if (celebrating) {
      letterMesh.rotation.y += dt * 9;
      letterMesh.scale.multiplyScalar(1 + dt * 1.2);
    } else {
      letterMesh.scale.setScalar(spring * overshoot);
      letterMesh.rotation.y = Math.sin(t * 0.9) * 0.4;
      letterMesh.rotation.x = Math.sin(t * 0.6) * 0.12;
      letterMesh.rotation.z = 0;
      letterMesh.position.y = Math.sin(t * 1.3) * 0.35;
    }
  }

  // ---- block-font fallback presentation ----------------------------------

  const bob = new Signal(0);
  let letterComponents: Text[] = [];

  function presentBlockLetter(letter: string) {
    for (const component of letterComponents) component.destroy();
    letterComponents = [];
    const rows = renderGlyph(letter);
    const color = LETTER_COLORS[letterColorIndex % LETTER_COLORS.length];
    rows.forEach((rowText, i) => {
      letterComponents.push(
        new Text({
          parent: ctx.tui,
          text: rowText,
          theme: { base: color },
          rectangle: new Computed(() => ({
            column: Math.max(1, Math.floor((ctx.center().width - GLYPH_WIDTH) / 2)),
            row: Math.max(2, Math.floor((ctx.center().height - GLYPH_HEIGHT) / 2) + i + bob.value),
          })),
          zIndex: 3,
        }),
      );
    });
  }

  function presentLetter(letter: string) {
    if (use3d) present3dLetter(letter);
    else presentBlockLetter(letter);
  }

  // ---- game logic (identical to the web) ----------------------------------

  function promptLetter(newWord = true) {
    if (newWord || !currentWord) currentWord = randomWordFor(target);
    ctx.wordLine.value = `${target} is for ${currentWord.toUpperCase()}!`;
    ctx.speaker.speak(`${target}! ${target} is for ${currentWord}!`);
    lastPromptAt = Date.now();
  }

  function advanceTarget() {
    sequenceIndex = (sequenceIndex + 1) % sequence.length;
    if (sequenceIndex === 0) shuffle(sequence);
    target = sequence[sequenceIndex];
  }

  function nextLetter() {
    advanceTarget();
    letterColorIndex++;
    celebrating = false;
    ctx.cheerLine.value = "";
    ctx.warnLine.value = "";
    presentLetter(target);
    promptLetter();
  }

  function celebrate() {
    celebrating = true;
    celebrateUntil = Date.now() + CELEBRATE_MS;
    ctx.scoreSignals.letters.value = ++ctx.state.scores.letters;
    ctx.saveState();
    ctx.burstConfetti();
    ctx.cheerLine.value = `YAY! ${target} is for ${currentWord.toUpperCase()}! GREAT JOB!`;
    ctx.warnLine.value = "";
    ctx.speaker.speak(`Yay! ${target}! ${target} is for ${currentWord}! Great job!`);
  }

  function encourage() {
    const now = Date.now();
    if (now - lastEncourageAt < ENCOURAGE_INTERVAL_MS) {
      ctx.warnLine.value = `just press ${target}!`;
      return;
    }
    lastEncourageAt = now;
    const phrase = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]
      .replaceAll("{L}", target);
    ctx.warnLine.value = phrase.toUpperCase();
    ctx.speaker.speak(phrase);
  }

  function trackMash(): boolean {
    const now = Date.now();
    pressTimes.push(now);
    while (pressTimes.length && now - pressTimes[0] > MASH_WINDOW_MS) pressTimes.shift();
    return pressTimes.length >= MASH_THRESHOLD;
  }

  return {
    name: "letters",

    start() {
      running = true;
      if (use3d && ctx.stage) {
        ctx.stage.attach(group);
        ctx.stage.setFrameHandler(frame3d);
      }
      presentLetter(target);
      promptLetter();
    },

    stop() {
      running = false;
      celebrating = false;
      if (use3d && ctx.stage) {
        ctx.stage.setFrameHandler(null);
        ctx.stage.detach(group);
      }
      for (const component of letterComponents) component.destroy();
      letterComponents = [];
    },

    handleKey(char: string) {
      if (!running) return;
      if (celebrating) return; // shower still rains via main's routing

      const mashing = trackMash();

      if (mashing && ctx.state.difficulty === "hard") {
        encourage();
        return;
      }
      if (mashing && char !== target) {
        ctx.warnLine.value = "wah wah... one key at a time!";
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
    },

    tick(_dt: number, t: number) {
      if (!running) return;
      if (!use3d) bob.value = Math.round(Math.sin(t * 2.2));

      if (celebrating && Date.now() >= celebrateUntil) {
        nextLetter();
      }
      if (!celebrating && Date.now() - lastPromptAt > IDLE_REPROMPT_MS) {
        promptLetter(true);
      }
      if (ctx.warnLine.value && !celebrating) {
        const stale = pressTimes.length === 0 ||
          Date.now() - pressTimes[pressTimes.length - 1] > 2500;
        if (stale) ctx.warnLine.value = "";
      }
    },
  };
}
