// Shared plumbing every game mode gets: the tui, the speaker, the particle
// effects, the shared message lines, persistent state — and, when Deno's
// WebGPU is available, a shared three.js scene rendered to ASCII.

import type { Tui } from "tui/src/tui.ts";
import type { Signal } from "tui/src/signals/mod.ts";
import type { Object3D, PerspectiveCamera, Scene } from "three";

export interface SavedState {
  scores: { letters: number; pictures: number };
  difficulty: "easy" | "hard";
}

export interface Speaker {
  available: boolean;
  engine: string | null;
  speak(text: string): void;
  /** true while TTS audio is (probably) still coming out of the speakers */
  isSpeechActive(graceMs?: number): boolean;
}

/**
 * One WebGPU-backed three.js scene shared by all modes (creating a renderer
 * per mode would re-initialize the GPU on every switch). Modes attach their
 * own Object3D group on start, detach on stop, and drive animation through
 * the frame handler.
 */
export interface Stage3D {
  scene: Scene;
  camera: PerspectiveCamera;
  attach(root: Object3D): void;
  detach(root: Object3D): void;
  setFrameHandler(handler: ((dt: number, t: number) => void) | null): void;
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
  /** WebGPU three.js → ASCII stage, or null when no adapter is available */
  stage: Stage3D | null;
  /** parsed three.js typeface JSON shared with the web app, or null */
  font: unknown | null;
}

export interface GameMode {
  name: string;
  start(): void;
  stop(): void;
  tick(dt: number, t: number): void;
  handleKey(char: string): void;
}
