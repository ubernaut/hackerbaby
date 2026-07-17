# Hacker Baby — terminal edition 👶⌨️🖥️

A console port of the Hacker Baby web app, built on the sibling
[deno_tui fork](../../deno_tui) (expected at `../../deno_tui` relative to
this folder). All three game modes made the jump:

| Key | Mode | Console adaptation |
| --- | --- | --- |
| **F1** | 🔤 Letter game | Big bobbing 5×7 block-font letter, same rules as the web |
| **F2** | 🖼️ Picture game | ASCII-art cards; no microphone in a tty, so he **types** the word instead of saying it |
| **F3** | 🪞 Mirror | Live ASCII webcam via ffmpeg — or a silly reactive face when there's no camera |

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
deno task play                       # easy mode
deno task play:hard                  # hard mode: mashing never advances
deno task play:quiet                 # no text-to-speech
deno task play -- --mode=pictures    # boot straight into a mode
```

F1/F2/F3 switch modes. Ctrl+C or Ctrl+Q quits.

## The games

### 🔤 Letter game (F1)

A big colorful block letter (all of A–Z and 0–9) bobs in the center while
the prompt shows "B is for BUBBLE!" — words come from the same toddler
vocabulary as the web game (imported straight from `../src/words.js`, so
the two stay in sync). Pressing the right letter → ASCII confetti
explosion, "GREAT JOB!", a persistent score tick, the next letter in a new
color. Mash detection (5+ keys in 1.5s) works exactly like the web:
**easy** mode still counts the right letter mid-mash, **hard** mode blocks
and coaches — "SO CLOSE! ONE FINGER... PRESS B!". Idle re-prompts pick a
fresh word every 15 seconds.

### 🖼️ Picture game (F2)

Hand-drawn ASCII-art cards for the whole built-in deck (dog, cat, ball,
banana… all 22), with the word shown below. Since a terminal has no
microphone, saying the word becomes **typing** the word — the rolling
keystroke buffer matches the word or any of its variants ("kitty" works
for cat), so mashing toward the answer still gets there. Success → confetti
+ "YES! DOG!" + a picture-game score tick. After 30 seconds (draining
timer bar) the card announces itself — "This is a DOG!" — and moves on.

### 🪞 Mirror (F3)

With a webcam and `ffmpeg` installed, the terminal becomes a live ASCII
mirror (15fps, luminance-ramp rendering, selfie-flipped). Any key takes a
photo: flash (inverted ramp), "CHEESE! *click*", and a frozen frame for a
couple of seconds. No camera? A big friendly face appears instead and
pulls a new expression on every keypress.

## Everywhere

- Every key pressed rains down the screen as a colored falling character,
  in every mode — same as the web app's key shower.
- Confetti bursts render over whichever mode is active.
- Voice goes through the first TTS engine found on the PATH: `espeak-ng`,
  `espeak`, `spd-say`, or macOS `say`; each phrase interrupts the last.
  Nothing installed? Silent, with `voice: off` in the HUD.
  (`sudo apt install espeak-ng` for the full effect.)
- Scores for both games and the difficulty persist to `.state.json` in
  this folder (gitignored). `--hard` / `--easy` flags switch and remember.

## How it's wired

- `main.ts` — tui boot, HUD, shared particle pools, mode switching (F1–F3),
  key routing, 20Hz game loop.
- `context.ts` — the shared plumbing interface every mode receives.
- `letterMode.ts` / `pictureMode.ts` / `mirrorMode.ts` — the three games.
- `font.ts` — 5×7 glyph table rendered double-wide; `art.ts` — the ASCII
  card drawings; `speech.ts` — TTS detection and speaking.
- `deno.json` — maps `tui/` to the sibling `../../deno_tui` checkout and
  pins `crayon`; tasks carry minimal permissions (`--allow-run` for the
  TTS binaries + ffmpeg, read, and write for `.state.json`).
