# Hacker Baby — terminal edition 👶⌨️🖥️

A console port of the Hacker Baby web app, built on the sibling
[deno_tui fork](../../deno_tui) (expected at `../../deno_tui` relative to
this folder) — and leaning hard on what Deno's V8 runtime can do in a
terminal:

- **WebGPU**: the letter game renders the web app's actual extruded
  three.js `TextGeometry` (same font asset, same animation curves) through
  the fork's ASCII 3D renderer. The mirror streams the webcam onto a
  swaying 3D plane in the same pipeline.
- **Real speech recognition**: the picture game listens through the mic
  and transcribes with OpenAI Whisper running in-process (transformers.js
  + onnxruntime in a Web Worker) — say "dog" at the terminal and it counts.
- Graceful degradation at every layer: no GPU → block-font letters and
  luminance-ramp mirror; no camera → a reactive silly face; no mic or
  model → type the word instead.

| Key | Mode | What it does |
| --- | --- | --- |
| **F1** | 🔤 Letter game | 3D letter (WebGPU→ASCII), same rules as the web |
| **F2** | 🖼️ Picture game | ASCII-art cards; **say** the word (Whisper) or type it |
| **F3** | 🪞 Mirror | live webcam on a 3D plane → ASCII; any key takes a photo |

## Run it

Requires [Deno](https://deno.com) 2.x.

```bash
cd tui
deno task play                       # easy mode
deno task play:hard                  # hard mode: mashing never advances
deno task play:quiet                 # no text-to-speech output
deno task play -- --mode=pictures    # boot straight into a mode
```

F1/F2/F3 switch modes. Ctrl+C or Ctrl+Q quits.

Useful flags: `--no-3d` (force the block-font/ramp fallbacks),
`--no-voice-input` (skip the mic), `--camera=/dev/videoN` (pin a device),
`--camera=testsrc` (synthetic test pattern — demo the 3D mirror pipeline
with no hardware), `--stt-cmd="whisper-cli -f {wav}"` (swap in any external
speech engine that prints a transcript).

## The games

### 🔤 Letter game (F1)

A big colorful 3D letter — real extruded `TextGeometry` built from the
same `helvetiker_bold` typeface file the web app uses (read straight out
of `../node_modules/three`), with the web's exact idle bob, spring-in, and
celebration spin — rendered to ASCII through WebGPU. Prompts speak "B is
for BUBBLE!" with words imported from `../src/words.js`, so both frontends
share one vocabulary. Same rules as the web: confetti + score on the right
key, mash detection (5+ keys/1.5s), easy/hard difficulty with coaching.
Without a GPU adapter it falls back to the chunky 5×7 block font.

### 🖼️ Picture game (F2)

Hand-drawn ASCII-art cards for the built-in deck, with the word shown
below and a 30-second draining timer. Two ways to win:

- **Say it** — the mic records short chunks (arecord/pw-record/ffmpeg),
  silence is skipped, and speech is transcribed by **Whisper tiny.en**
  running inside a Deno Web Worker via `@huggingface/transformers`
  (onnxruntime, ~40MB model auto-downloaded to `.cache/` on first use,
  offline afterwards). Transcripts match the word or its variants
  ("kitty" counts for cat), and the app ignores anything heard while its
  own TTS is talking — the same self-hear guard the web app needed.
- **Type it** — the rolling keystroke buffer matches the word or variants.

Timeout announces "This is a DOG!" and moves on; success = confetti and a
picture-game score tick.

### 🪞 Mirror (F3)

Camera discovery probes `/dev/video0…7` with real one-frame ffmpeg
captures (Deno guards `/dev` enumeration behind `--allow-all`, and probing
also proves a node can actually deliver frames — kernels expose metadata
nodes too). The stream arrives as raw RGBA over a pipe and lands in a
three.js `DataTexture` on a gently swaying plane, rendered through the
ASCII 3D pipeline. Any key takes a photo: white flash plane, "CHEESE!
*click*", frozen frame. Camera handling is deliberately gentle (SIGTERM
before SIGKILL, one probe per session, settle delays) because hard-killed
UVC streams can wedge camera firmware until replug. No GPU → classic
luminance-ramp rows; no camera → a big silly face that pulls a new
expression per keypress.

## Everywhere

- Every key pressed rains down as a colored falling character, and
  confetti bursts render over whichever mode is active — the 2D particle
  layer composites above the 3D viewport, like the web's effects layer.
- Voice output (prompts, cheers) uses the first TTS binary found:
  `espeak-ng`, `espeak`, `spd-say`, or macOS `say` — `sudo apt install
  espeak-ng` for the full effect.
- Scores for both games and the difficulty persist to `.state.json`
  (gitignored). `--hard` / `--easy` switch and remember.

## How it's wired

- `main.ts` — boot (WebGPU probe, shared 3D stage + lights), HUD, shared
  particle pools, mode switching, key routing, 20Hz loop.
- `context.ts` — the plumbing interface modes receive, including the
  shared `Stage3D`.
- `letterMode.ts` / `pictureMode.ts` / `mirrorMode.ts` — the three games.
- `cameras.ts` — ffmpeg-probe camera discovery; `stt.ts` +
  `stt_worker.ts` — mic capture, silence gating, Whisper worker;
  `speech.ts` — TTS out (with speaking-state tracking for the self-hear
  guard); `font.ts` / `art.ts` — the 2D fallback assets.
- `deno.json` — maps `tui/` to the sibling `../../deno_tui` checkout,
  pins `crayon` and `three`; tasks grant run access to the media binaries,
  net for the one-time model download, and ffi/sys for onnxruntime.
