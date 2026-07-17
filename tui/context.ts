// Shared plumbing every game mode gets: the tui, the speaker, the particle
// effects, the shared message lines, and persistent state.

import type { Tui } from "tui/src/tui.ts";
import type { Signal } from "tui/src/signals/mod.ts";

export interface SavedState {
  scores: { letters: number; pictures: number };
  difficulty: "easy" | "hard";
}

export interface Speaker {
  available: boolean;
  engine: string | null;
  speak(text: string): void;
}

export interface Ctx {
  tui: Tui;
  center(): { column: number; row: number; width: number; height: number };
  speaker: Speaker;
  spawnShowerKey(char: string): void;
  burstConfetti(): void;
  /** shared center-screen message lines (prompt / cheer / warning) */
  wordLine: Signal<string>;
  cheerLine: Signal<string>;
  warnLine: Signal<string>;
  state: SavedState;
  saveState(): void;
  scoreSignals: { letters: Signal<number>; pictures: Signal<number> };
}

export interface GameMode {
  name: string;
  start(): void;
  stop(): void;
  tick(dt: number, t: number): void;
  handleKey(char: string): void;
}
