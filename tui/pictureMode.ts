// The picture game: an ASCII-art card, and now REAL speech recognition —
// say "dog" into the microphone (Whisper WASM in a worker, see stt.ts) or
// type the word; both count. After 30 seconds the card announces itself
// and moves on, exactly like the web game.

import { crayon } from "crayon";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
import { BUILTIN_CARDS, shuffle } from "../src/words.js";
import { cardArt } from "./art.ts";
import { createVoiceInput, type VoiceInput } from "./stt.ts";
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

// web-app style transcript matching: normalized, padded, whole-word
function normalizeSpoken(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
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
  const micText = new Signal("");
  let timerComponent: Text | null = null;
  let typedComponent: Text | null = null;
  let micComponent: Text | null = null;

  // ---- voice input ---------------------------------------------------------

  let voice: VoiceInput | null = null;
  let voiceInit: Promise<void> | null = null;

  function ensureVoice() {
    if (voiceInit) return;
    voiceInit = createVoiceInput({
      onStatus: (status) => {
        micText.value = `[mic] ${status}`;
      },
      onTranscript: (text) => {
        if (!running || locked || !card) return;
        // never "hear" the app's own voice — same guard as the web app
        if (ctx.speaker.isSpeechActive(800)) return;
        const heard = normalizeSpoken(text);
        const hit = [card.word, ...card.alt].some((candidate) => {
          const normalized = normalizeSpoken(candidate).trim();
          return normalized.length > 0 && heard.includes(` ${normalized} `);
        });
        micText.value = `[mic] heard: ${text.trim().slice(0, 40)}`;
        if (hit) success("said");
      },
    }).then((created) => {
      voice = created;
      if (!created.available) micText.value = `[mic] off — ${created.reason}. type the word!`;
      else micText.value = `[mic] ${created.reason}`;
      if (running && created.available) created.start();
    });
  }

  // ---- ui ------------------------------------------------------------------

  function buildHud() {
    timerComponent = new Text({
      parent: ctx.tui,
      text: timerText,
      theme: { base: crayon.bgBlack.cyan },
      rectangle: new Computed(() => ({
        column: Math.max(2, Math.floor((ctx.center().width - TIMER_WIDTH) / 2)),
        row: Math.max(4, ctx.center().height - 7),
      })),
      zIndex: 5,
    });
    typedComponent = new Text({
      parent: ctx.tui,
      text: typedText,
      theme: { base: crayon.bgBlack.lightBlack },
      rectangle: new Computed(() => ({
        column: Math.max(2, Math.floor((ctx.center().width - typedText.value.length) / 2)),
        row: Math.max(5, ctx.center().height - 6),
      })),
      zIndex: 5,
    });
    micComponent = new Text({
      parent: ctx.tui,
      text: micText,
      theme: { base: crayon.bgBlack.lightBlack },
      rectangle: new Computed(() => ({
        column: Math.max(2, Math.floor((ctx.center().width - micText.value.length) / 2)),
        row: 2,
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
            row: Math.max(3, Math.floor((ctx.center().height - rows.length) / 2) - 2 + i),
          })),
          zIndex: 3,
        }),
      );
    });

    ctx.speaker.speak(`What is this? Can you say ${next.word}?`);
  }

  function nextCard() {
    deckIndex = (deckIndex + 1) % deck.length;
    if (deckIndex === 0) shuffle(deck);
    showCard(deck[deckIndex]);
  }

  function normalizeTyped(text: string): string {
    return text.toUpperCase().replace(/[^A-Z]/g, "");
  }

  function typedMatches(): boolean {
    if (!card) return false;
    return [card.word, ...card.alt].some((candidate) => {
      const normalized = normalizeTyped(candidate);
      return normalized.length > 0 && typed.endsWith(normalized);
    });
  }

  function success(how: "said" | "spelled") {
    if (!card) return;
    locked = true;
    nextAt = Date.now() + NEXT_DELAY_MS;
    ctx.scoreSignals.pictures.value = ++ctx.state.scores.pictures;
    ctx.saveState();
    ctx.burstConfetti();
    ctx.cheerLine.value = `YES! ${card.word.toUpperCase()}! GREAT JOB!`;
    ctx.speaker.speak(
      how === "said"
        ? `Yes! ${card.word}! You said ${card.word}! Yay!`
        : `Yes! ${card.word}! You spelled ${card.word}! Yay!`,
    );
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
      ensureVoice();
      voice?.start();
      if (!deck.length) buildDeck();
      showCard(deck[deckIndex]);
    },

    stop() {
      running = false;
      card = null;
      voice?.stop();
      clearArt();
      timerComponent?.destroy();
      typedComponent?.destroy();
      micComponent?.destroy();
      timerComponent = null;
      typedComponent = null;
      micComponent = null;
    },

    handleKey(char: string) {
      if (!running || locked || !card) return;
      typed = (typed + char).slice(-32);
      typedText.value = `> ${typed.slice(-12)}`;
      if (typedMatches()) success("spelled");
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
