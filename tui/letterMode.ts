// The letter game: a big bobbing block letter, spoken prompts, mash
// detection with easy/hard difficulty — the console twin of the web game.

import { crayon } from "crayon";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
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
  const bob = new Signal(0);
  let running = false;
  let letterColorIndex = 0;
  let letterComponents: Text[] = [];

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

  function buildLetter(letter: string) {
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
    buildLetter(target);
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
      buildLetter(target);
      promptLetter();
    },

    stop() {
      running = false;
      celebrating = false;
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
      bob.value = Math.round(Math.sin(t * 2.2));

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
