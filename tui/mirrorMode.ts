// Mirror mode in a terminal: a live ASCII webcam. Frames come from ffmpeg
// (v4l2, grayscale rawvideo over a pipe) and are mapped onto a luminance
// ramp; any key takes a freeze-frame "photo" with a flash, CHEESE! and a
// shutter pause, just like the web mirror. Without a camera or ffmpeg it
// falls back to a big friendly face that reacts to keys instead.

import { crayon } from "crayon";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
import type { Ctx, GameMode } from "./context.ts";

const RAMP = " .:-=+*#%@";
const FLASH_RAMP = "@%#*+=-:. ";
const SNAP_MS = 2500;
const FLASH_MS = 350;

const FACES = [
  ["   .-----.   ", "  ( o   o )  ", "  (    >  )  ", "   ( `-´ )   ", "    `---´    "],
  ["   .-----.   ", "  ( ^   ^ )  ", "  (    >  )  ", "   ( ___ )   ", "    `---´    "],
  ["   .-----.   ", "  ( O   O )  ", "  (    >  )  ", "   (  o  )   ", "    `---´    "],
  ["   .-----.   ", "  ( -   - )  ", "  (    >  )  ", "   ( www )   ", "    `---´    "],
];

export function createMirrorMode(ctx: Ctx): GameMode {
  let running = false;
  let child: Deno.ChildProcess | null = null;
  let reading = false;
  let frozen = false;
  let frozenUntil = 0;
  let flashUntil = 0;
  let faceIndex = 0;
  let cameraActive = false;

  let cols = 0;
  let rows = 0;
  let rowSignals: Signal<string>[] = [];
  let rowComponents: Text[] = [];
  let statusComponent: Text | null = null;
  const statusText = new Signal("");

  function buildSurface() {
    const { width, height } = ctx.center();
    cols = Math.max(20, Math.min(width - 6, 96));
    rows = Math.max(10, Math.min(height - 8, 40));
    rowSignals = [];
    rowComponents = [];
    for (let i = 0; i < rows; i++) {
      const signal = new Signal("");
      rowSignals.push(signal);
      rowComponents.push(
        new Text({
          parent: ctx.tui,
          text: signal,
          theme: { base: crayon.bgBlack.lightCyan },
          rectangle: new Computed(() => ({
            column: Math.max(1, Math.floor((ctx.center().width - cols) / 2)),
            row: Math.max(2, Math.floor((ctx.center().height - rows) / 2) + i),
          })),
          zIndex: 3,
        }),
      );
    }
    statusComponent = new Text({
      parent: ctx.tui,
      text: statusText,
      theme: { base: crayon.bgBlack.lightYellow.bold },
      rectangle: new Computed(() => ({
        column: Math.max(2, Math.floor((ctx.center().width - statusText.value.length) / 2)),
        row: Math.max(1, Math.floor((ctx.center().height - rows) / 2) - 1),
      })),
      zIndex: 5,
    });
  }

  function teardownSurface() {
    for (const component of rowComponents) component.destroy();
    rowComponents = [];
    rowSignals = [];
    statusComponent?.destroy();
    statusComponent = null;
  }

  async function hasCamera(): Promise<boolean> {
    try {
      await Deno.stat("/dev/video0");
    } catch (_) {
      return false;
    }
    try {
      const which = new Deno.Command("which", { args: ["ffmpeg"], stdout: "null", stderr: "null" });
      return (await which.output()).success;
    } catch (_) {
      return false;
    }
  }

  function renderFrame(frame: Uint8Array, ramp: string) {
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < cols; x++) {
        const lum = frame[y * cols + x] ?? 0;
        line += ramp[Math.min(ramp.length - 1, Math.floor((lum / 256) * ramp.length))];
      }
      rowSignals[y].value = line;
    }
  }

  async function startCamera() {
    const frameSize = cols * rows;
    try {
      const command = new Deno.Command("ffmpeg", {
        args: [
          "-hide_banner",
          "-loglevel", "error",
          "-f", "v4l2",
          "-framerate", "15",
          "-video_size", "320x240",
          "-i", "/dev/video0",
          "-vf", `hflip,scale=${cols}:${rows}`,
          "-pix_fmt", "gray",
          "-f", "rawvideo",
          "pipe:1",
        ],
        stdout: "piped",
        stderr: "null",
        stdin: "null",
      });
      child = command.spawn();
    } catch (_) {
      cameraActive = false;
      statusText.value = "mirror: no camera — here's a friend instead!";
      drawFace();
      return;
    }

    cameraActive = true;
    statusText.value = "LOOK! WHO IS THAT? (any key takes a photo)";
    ctx.speaker.speak("Look! Who is that? Is that you?");

    reading = true;
    const reader = child.stdout.getReader();
    let buffer = new Uint8Array(0);
    try {
      while (reading) {
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer);
        merged.set(value, buffer.length);
        buffer = merged;
        while (buffer.length >= frameSize) {
          const frame = buffer.slice(0, frameSize);
          buffer = buffer.slice(frameSize);
          if (!frozen && running) {
            renderFrame(frame, Date.now() < flashUntil ? FLASH_RAMP : RAMP);
          }
        }
      }
    } catch (_) {
      // stream closed
    } finally {
      try {
        reader.releaseLock();
      } catch (_) { /* already released */ }
    }
  }

  function drawFace() {
    const face = FACES[faceIndex % FACES.length];
    const top = Math.floor((rows - face.length) / 2);
    for (let y = 0; y < rows; y++) {
      const faceRow = face[y - top];
      if (faceRow) {
        const pad = Math.max(0, Math.floor((cols - faceRow.length) / 2));
        rowSignals[y].value = " ".repeat(pad) + faceRow;
      } else {
        rowSignals[y].value = "";
      }
    }
  }

  function stopCamera() {
    reading = false;
    try {
      child?.kill("SIGKILL");
    } catch (_) {
      // already gone
    }
    child = null;
  }

  return {
    name: "mirror",

    start() {
      running = true;
      frozen = false;
      buildSurface();
      hasCamera().then((ok) => {
        if (!running) return;
        if (ok) {
          startCamera();
        } else {
          cameraActive = false;
          statusText.value = "mirror: no camera found — here's a friend instead!";
          ctx.speaker.speak("Hello! Look at this silly face!");
          drawFace();
        }
      });
    },

    stop() {
      running = false;
      stopCamera();
      teardownSurface();
    },

    handleKey(_char: string) {
      if (!running) return;
      if (cameraActive) {
        if (frozen) return;
        // freeze-frame photo with a flash
        flashUntil = Date.now() + FLASH_MS;
        frozen = false; // let the flash frame render first
        setTimeout(() => {
          frozen = true;
          frozenUntil = Date.now() + SNAP_MS;
        }, FLASH_MS);
        statusText.value = "CHEESE! *click*";
        ctx.speaker.speak("Cheese!");
      } else {
        faceIndex++;
        drawFace();
        ctx.speaker.speak(["Peekaboo!", "Hello you!", "Boop!", "So silly!"][faceIndex % 4]);
      }
    },

    tick(_dt: number, _t: number) {
      if (!running) return;
      if (frozen && Date.now() >= frozenUntil) {
        frozen = false;
        if (cameraActive) statusText.value = "LOOK! WHO IS THAT? (any key takes a photo)";
      }
    },
  };
}
