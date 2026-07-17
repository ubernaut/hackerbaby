// The picture game, console style: an ASCII-art card and the word below it.
// The terminal has no microphone, so instead of SAYING the word he TYPES it
// (any of the accepted variants counts, matched from the rolling keystroke
// buffer). After 30 seconds the card says its own name and moves on —
// exactly like the web game's timer.

import { crayon } from "crayon";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
import { BUILTIN_CARDS, shuffle } from "../src/words.js";
import { cardArt } from "./art.ts";
import type { Ctx, GameMode } from "./context.ts";

const CARD_TIMEOUT_MS = 30000;
const NEXT_DELAY_MS = 3000;
const TIMER_WIDTH = 24;

const ART_COLORS = [
  crayon.bgBlack.lightGreen,
  crayon.bgBlack.lightCyan,
  crayon.bgBlack.lightYellow,
  crayon.bgBlack.lightMagenta,
  crayon.bgBlack.lightRed,
  crayon.bgBlack.lightBlue,
];

interface Card {
  word: string;
  alt: string[];
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function createPictureMode(ctx: Ctx): GameMode {
  let running = false;
  let deck: Card[] = [];
  let deckIndex = 0;
  let card: Card | null = null;
  let cardShownAt = 0;
  let locked = false;
  let nextAt = 0;
  let colorIndex = 0;
  let typed = "";
  let artComponents: Text[] = [];

  const timerText = new Signal("");
  const typedText = new Signal("");
  let timerComponent: Text | null = null;
  let typedComponent: Text | null = null;

  function buildHud() {
    timerComponent = new Text({
      parent: ctx.tui,
      text: timerText,
      theme: { base: crayon.bgBlack.cyan },
      rectangle: new Computed(() => ({
        column: Math.max(2, Math.floor((ctx.center().width - TIMER_WIDTH) / 2)),
        row: Math.min(ctx.center().height - 2, Math.floor(ctx.center().height / 2) + 8),
      })),
      zIndex: 5,
    });
    typedComponent = new Text({
      parent: ctx.tui,
      text: typedText,
      theme: { base: crayon.bgBlack.lightBlack },
      rectangle: new Computed(() => ({
        column: Math.max(2, Math.floor((ctx.center().width - typedText.value.length) / 2)),
        row: Math.min(ctx.center().height - 1, Math.floor(ctx.center().height / 2) + 9),
      })),
      zIndex: 5,
    });
  }

  function buildDeck() {
    deck = shuffle(
      (BUILTIN_CARDS as Array<{ word: string; alt?: string[] }>).map((c) => ({
        word: c.word,
        alt: c.alt ?? [],
      })),
    );
    deckIndex = 0;
  }

  function clearArt() {
    for (const component of artComponents) component.destroy();
    artComponents = [];
  }

  function showCard(next: Card) {
    card = next;
    locked = false;
    typed = "";
    typedText.value = "";
    cardShownAt = Date.now();
    ctx.cheerLine.value = "";
    ctx.warnLine.value = "";
    ctx.wordLine.value = next.word.toUpperCase();

    clearArt();
    const rows = cardArt(next.word);
    const color = ART_COLORS[colorIndex++ % ART_COLORS.length];
    const artWidth = rows[0]?.length ?? 0;
    rows.forEach((rowText, i) => {
      artComponents.push(
        new Text({
          parent: ctx.tui,
          text: rowText,
          theme: { base: color },
          rectangle: new Computed(() => ({
            column: Math.max(1, Math.floor((ctx.center().width - artWidth) / 2)),
            row: Math.max(2, Math.floor((ctx.center().height - rows.length) / 2) - 2 + i),
          })),
          zIndex: 3,
        }),
      );
    });

    ctx.speaker.speak(`What is this? Can you say ${next.word}? Type it!`);
  }

  function nextCard() {
    deckIndex = (deckIndex + 1) % deck.length;
    if (deckIndex === 0) shuffle(deck);
    showCard(deck[deckIndex]);
  }

  function normalize(text: string): string {
    return text.toUpperCase().replace(/[^A-Z]/g, "");
  }

  function matches(): boolean {
    if (!card) return false;
    const buffer = typed;
    return [card.word, ...card.alt].some((candidate) => {
      const normalized = normalize(candidate);
      return normalized.length > 0 && buffer.endsWith(normalized);
    });
  }

  function success() {
    if (!card) return;
    locked = true;
    nextAt = Date.now() + NEXT_DELAY_MS;
    ctx.scoreSignals.pictures.value = ++ctx.state.scores.pictures;
    ctx.saveState();
    ctx.burstConfetti();
    ctx.cheerLine.value = `YES! ${card.word.toUpperCase()}! GREAT JOB!`;
    ctx.speaker.speak(`Yes! ${card.word}! You spelled ${card.word}! Yay!`);
  }

  function timeUp() {
    if (!card) return;
    locked = true;
    nextAt = Date.now() + NEXT_DELAY_MS;
    ctx.warnLine.value = `This is ${article(card.word)} ${card.word.toUpperCase()}!`;
    ctx.speaker.speak(`This is ${article(card.word)} ${card.word}. ${card.word}!`);
  }

  return {
    name: "pictures",

    start() {
      running = true;
      buildHud();
      if (!deck.length) buildDeck();
      showCard(deck[deckIndex]);
    },

    stop() {
      running = false;
      card = null;
      clearArt();
      timerComponent?.destroy();
      typedComponent?.destroy();
      timerComponent = null;
      typedComponent = null;
    },

    handleKey(char: string) {
      if (!running || locked || !card) return;
      typed = (typed + char).slice(-32);
      typedText.value = `> ${typed.slice(-12)}`;
      if (matches()) success();
    },

    tick(_dt: number, _t: number) {
      if (!running || !card) return;

      if (locked) {
        if (Date.now() >= nextAt) nextCard();
        return;
      }

      const elapsed = Date.now() - cardShownAt;
      const left = Math.max(0, 1 - elapsed / CARD_TIMEOUT_MS);
      const filled = Math.round(left * TIMER_WIDTH);
      timerText.value = "#".repeat(filled) + "-".repeat(TIMER_WIDTH - filled);

      if (elapsed >= CARD_TIMEOUT_MS) timeUp();
    },
  };
}
