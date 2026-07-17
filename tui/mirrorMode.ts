// Mirror mode: a live webcam feed in the terminal. Camera discovery probes
// every /dev/video* node with a real capture (see cameras.ts). Frames come
// from ffmpeg as raw RGBA over a pipe (selfie-flipped, row-order corrected).
//
// Presentation, best first:
//  1. WebGPU: frames stream into a three.js DataTexture on a gently swaying
//     plane, rendered through the ASCII 3D pipeline (color + depth shading).
//  2. No GPU: classic luminance-ramp ASCII rows.
//  3. No camera at all: a big silly face that reacts to keys.
//
// Any key takes a photo: white flash, "CHEESE!", frozen frame — web parity.

import { crayon } from "crayon";
import { Text } from "tui/src/components/text.ts";
import { Computed, Signal } from "tui/src/signals/mod.ts";
import {
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { findCamera } from "./cameras.ts";
import type { Ctx, GameMode } from "./context.ts";

const RAMP = " .:-=+*#%@";
const FLASH_RAMP = "@%#*+=-:. ";
const SNAP_MS = 2500;
const FLASH_MS = 300;

// camera capture resolution fed into the texture (independent of terminal size)
const CAM_W = 192;
const CAM_H = 144;

const FACES = [
  ["   .-----.   ", "  ( o   o )  ", "  (    >  )  ", "   ( `-´ )   ", "    `---´    "],
  ["   .-----.   ", "  ( ^   ^ )  ", "  (    >  )  ", "   ( ___ )   ", "    `---´    "],
  ["   .-----.   ", "  ( O   O )  ", "  (    >  )  ", "   (  o  )   ", "    `---´    "],
  ["   .-----.   ", "  ( -   - )  ", "  (    >  )  ", "   ( www )   ", "    `---´    "],
];

export function createMirrorMode(ctx: Ctx): GameMode {
  const use3d = Boolean(ctx.stage);

  let running = false;
  let child: Deno.ChildProcess | null = null;
  let reading = false;
  let frozen = false;
  let frozenUntil = 0;
  let flashUntil = 0;
  let faceIndex = 0;
  let cameraActive = false;

  // ---- 3D presentation: webcam texture on a plane -------------------------

  const group = new Group();
  const textureData = new Uint8Array(CAM_W * CAM_H * 4);
  const texture = new DataTexture(textureData, CAM_W, CAM_H, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  const screenMaterial = new MeshBasicMaterial({ map: texture });
  const screen = new Mesh(new PlaneGeometry(9.6, 7.2), screenMaterial);
  group.add(screen);
  const flashPlane = new Mesh(
    new PlaneGeometry(11, 8.5),
    new MeshBasicMaterial({ color: new Color("#ffffff") }),
  );
  flashPlane.position.z = 0.5;
  flashPlane.visible = false;
  group.add(flashPlane);

  function frame3d(_dt: number, t: number) {
    screen.rotation.y = Math.sin(t * 0.5) * 0.12;
    screen.rotation.x = Math.sin(t * 0.35) * 0.05;
    flashPlane.visible = Date.now() < flashUntil;
  }

  // ---- 2D fallback presentation: luminance ramp rows ----------------------

  let cols = 0;
  let rows = 0;
  let rowSignals: Signal<string>[] = [];
  let rowComponents: Text[] = [];
  let statusComponent: Text | null = null;
  const statusText = new Signal("");

  function buildSurface2d() {
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
  }

  function buildStatusLine() {
    statusComponent = new Text({
      parent: ctx.tui,
      text: statusText,
      theme: { base: crayon.bgBlack.lightYellow.bold },
      rectangle: new Computed(() => ({
        column: Math.max(2, Math.floor((ctx.center().width - statusText.value.length) / 2)),
        row: 2,
      })),
      zIndex: 5,
    });
  }

  function teardown2d() {
    for (const component of rowComponents) component.destroy();
    rowComponents = [];
    rowSignals = [];
  }

  function renderRamp(frame: Uint8Array, ramp: string) {
    // gray frame at cols×rows
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < cols; x++) {
        const lum = frame[y * cols + x] ?? 0;
        line += ramp[Math.min(ramp.length - 1, Math.floor((lum / 256) * ramp.length))];
      }
      rowSignals[y].value = line;
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

  // ---- capture ---------------------------------------------------------------

  function ffmpegArgs(device: string, use3dPath: boolean): string[] {
    const size = use3dPath ? `${CAM_W}:${CAM_H}` : `${cols}:${rows}`;
    // hflip = selfie mirror; vflip only for the texture path (three.js UVs
    // sample bottom-up, the 2D path reads rows top-down)
    const flips = use3dPath ? "hflip,vflip" : "hflip";
    const input = device === "testsrc"
      ? ["-f", "lavfi", "-i", "testsrc=size=640x480:rate=15"]
      : ["-f", "v4l2", "-framerate", "15", "-video_size", "640x480", "-i", device];
    return [
      "-hide_banner",
      "-loglevel", "error",
      ...input,
      "-vf", `${flips},scale=${size}`,
      "-pix_fmt", use3dPath ? "rgba" : "gray",
      "-f", "rawvideo",
      "pipe:1",
    ];
  }

  async function startCamera(device: string) {
    const frameSize = use3d ? CAM_W * CAM_H * 4 : cols * rows;
    try {
      const command = new Deno.Command("ffmpeg", {
        args: ffmpegArgs(device, use3d),
        stdout: "piped",
        stderr: "null",
        stdin: "null",
      });
      child = command.spawn();
    } catch (_) {
      cameraActive = false;
      statusText.value = "mirror: camera failed to open — here's a friend instead!";
      if (!use3d) drawFace();
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
          if (frozen || !running) continue;
          if (use3d) {
            textureData.set(frame);
            texture.needsUpdate = true;
          } else {
            renderRamp(frame, Date.now() < flashUntil ? FLASH_RAMP : RAMP);
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

  function stopCamera() {
    reading = false;
    // SIGTERM lets ffmpeg close the v4l2 stream cleanly — hard kills can
    // wedge UVC camera firmware until the device is replugged
    const current = child;
    child = null;
    if (!current) return;
    try {
      current.kill("SIGTERM");
    } catch (_) {
      return; // already gone
    }
    setTimeout(() => {
      try {
        current.kill("SIGKILL");
      } catch (_) { /* exited cleanly */ }
    }, 1500);
  }

  return {
    name: "mirror",

    start() {
      running = true;
      frozen = false;
      buildStatusLine();
      if (use3d && ctx.stage) {
        ctx.stage.attach(group);
        ctx.stage.setFrameHandler(frame3d);
      } else {
        buildSurface2d();
      }
      statusText.value = "mirror: looking for a camera…";
      findCamera().then((probe) => {
        if (!running) return;
        if (probe.device) {
          startCamera(probe.device);
        } else {
          cameraActive = false;
          statusText.value = `mirror: ${probe.reason} — here's a friend instead!`;
          ctx.speaker.speak("Hello! Look at this silly face!");
          if (use3d && ctx.stage) {
            // no camera: drop to the 2D face even in GPU mode
            ctx.stage.setFrameHandler(null);
            ctx.stage.detach(group);
            buildSurface2d();
          }
          drawFace();
        }
      });
    },

    stop() {
      running = false;
      stopCamera();
      teardown2d();
      statusComponent?.destroy();
      statusComponent = null;
      if (use3d && ctx.stage) {
        ctx.stage.setFrameHandler(null);
        ctx.stage.detach(group);
      }
    },

    handleKey(_char: string) {
      if (!running) return;
      if (cameraActive) {
        if (frozen) return;
        // photo: flash first, then hold the frozen frame
        flashUntil = Date.now() + FLASH_MS;
        setTimeout(() => {
          frozen = true;
          frozenUntil = Date.now() + SNAP_MS;
        }, FLASH_MS);
        statusText.value = "CHEESE! *click*";
        ctx.speaker.speak("Cheese!");
      } else {
        faceIndex++;
        if (rowSignals.length) drawFace();
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
