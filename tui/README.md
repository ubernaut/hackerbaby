# Hacker Baby — terminal edition 👶⌨️🖥️

A console port of the Hacker Baby letter game, built on the sibling
[deno_tui fork](../../deno_tui) (expected at `../../deno_tui` relative to
this folder). The 3D letter becomes a chunky block-font glyph, the key
shower and confetti become falling colored characters, and the voice speaks
through whatever TTS binary the system has.

```
  H A C K E R  B A B Y                        SCORE 1
                                   YAY! W is for WAVE! GREAT JOB!
                                      #o     ██      +█             W
                               x             ██      ██  #     o.
                                             ██x     ██
                                            x██  ██  ██
                                             ██  ██+ ██
                           x         * #    +████  ████  +
                        *          #+        ██      x█ #     #
                                   #  .   o
                       x       . .         W is for WAVE! .*
```

## Run it

Requires [Deno](https://deno.com) 2.x.

```bash
cd tui
deno task play         # easy mode: the right letter always counts
deno task play:hard    # hard mode: mashing never advances, coaches instead
deno task play:quiet   # no text-to-speech
```

Ctrl+C or Ctrl+Q quits.

## What it does

- A big colorful block letter (5×7 dot-matrix font, all of A–Z and 0–9)
  bobs in the center while the prompt shows "B is for BUBBLE!" — words come
  from the same toddler vocabulary as the web game (imported straight from
  `../src/words.js`, so the two stay in sync).
- Every key pressed rains down the screen as a colored falling character.
- Pressing the right letter → an ASCII confetti explosion, "GREAT JOB!",
  a persistent score tick, and the next letter in a new color.
- Mash detection (5+ keys in 1.5s): in **easy** mode the right letter still
  counts; in **hard** mode mashing never advances and he gets coached —
  "SO CLOSE! ONE FINGER... PRESS B!".
- Idle re-prompts with a fresh word every 15 seconds.

## Voice

The game speaks the prompts and celebrations through the first TTS engine it
finds on the PATH: `espeak-ng`, `espeak`, `spd-say`, or macOS `say`. Each
phrase interrupts the previous one, web-app style. No engine? It plays
silently (the HUD shows `voice: off`). On Debian/Ubuntu:

```bash
sudo apt install espeak-ng
```

## State

Score and difficulty persist to `.state.json` in this folder (gitignored).
`--hard` / `--easy` flags switch difficulty and remember it.

## How it's wired

- `main.ts` — game loop (20 ticks/s), Tui components driven by Signals:
  letter rows, HUD, word/cheer/warn lines, and two particle pools (shower +
  confetti) of single-char `Text` components.
- `font.ts` — the 5×7 glyph table rendered double-wide.
- `speech.ts` — TTS engine detection and fire-and-forget speaking.
- `deno.json` — maps `tui/` to the sibling `../../deno_tui` checkout and
  `crayon` to its pinned version; tasks carry the minimal permissions
  (`--allow-run` for the TTS binaries, read, and write for `.state.json`).
