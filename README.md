# Hacker Baby 👶⌨️

A fullscreen PWA kiosk playground for a 17-month-old, built with three.js and
[PeerCompute](../peercompute). Runs in Chrome, served by Vite over HTTPS in
dev, and deploys to GitHub Pages from the `docs/` folder.

## The games

- **🔤 Letter game (main)** — a big colorful 3D letter floats on screen while a
  voice says its name and a word he knows ("B! B is for bubble!" — several
  words per letter, picked at random). Pressing the right key earns a confetti
  celebration and the next letter. Every key he presses rains down the screen
  as a bright 3D letter; keyboard mashing showers the screen festively and
  plays a gentle sad noise, but never advances the game.
- **🖼️ Picture game** — shows a picture (emoji-seeded from the same baby
  vocabulary) and listens with speech recognition for him to say the word.
  A match celebrates; after 30 seconds it says the word and moves on.
- **🪞 Mirror** — front camera so he can look at himself; tapping takes a
  freeze-frame "photo" with a flash and shutter sound.

Background music is a soft generative pentatonic loop (🎵 button toggles it),
or a YouTube playlist if one is configured in the grown-ups panel. All other
sounds are synthesized with WebAudio — no audio assets.

The letter game has two difficulties (grown-ups panel):

- **Easy** (default) — pressing the right letter always advances, even
  mid-mash.
- **Hard** — mashing never advances; instead he's coached with encouragement
  like "Almost! Just press B!".

## Running it

```bash
npm install
npm run dev        # HTTPS dev server on https://localhost:5199 (LAN too)
npm run build      # builds into docs/ for GitHub Pages
npm run preview    # serve the built docs locally
npm run icons      # regenerate PWA icons (pure-node PNG generator)
```

The dev cert is self-signed (generated into `certs/`, gitignored) — accept the
browser warning once. Camera and microphone need HTTPS, which is why dev is
HTTPS-only.

### Kiosk mode

Best experience is Chrome's real kiosk mode:

```bash
google-chrome --kiosk --autoplay-policy=no-user-gesture-required https://<host>/
```

The app also requests fullscreen + a screen wake lock on the ▶ PLAY tap, hides
the cursor, and swallows keyboard input so the baby can't navigate away
(Chrome-level keys like Ctrl+W need `--kiosk` to be blocked).

## Grown-ups panel

Long-press the **top-left corner** for ~1.2 seconds. From there you can:

- add **custom picture cards** — a photo plus the word he should say
  ("dada", "mama", …). Stored in the browser's IndexedDB.
- switch the letter game between **Easy and Hard** difficulty.
- set a **YouTube playlist** as background music (paste any link containing
  `list=`; falls back to the built-in tunes offline or when cleared).
- toggle music, re-request fullscreen, repeat the current voice prompt.
- see PeerCompute connection status.

Custom cards can also be committed to the repo: drop images in
`public/cards/` and list them in `public/cards.json`:

```json
{ "cards": [{ "word": "dada", "image": "./cards/dada.jpg", "alt": ["daddy", "papa"] }] }
```

## GitHub Pages

`npm run build` outputs a fully relative-path site into `docs/`. In the GitHub
repo settings, set Pages to serve from the `main` branch `/docs` folder.
The service worker caches the app shell for offline use after the first visit
(it only registers on production builds).

## PeerCompute

The app boots a `NodeKernel` (`gameId: hackerbaby`, `roomId: nursery`) and
publishes live game status (mode, current letter, stars, current card) through
the shared `StateManager`, so another device on the same relay — or NetViz —
can watch him play. It loads lazily as a separate chunk and degrades silently
when no relay is reachable; the games never depend on it.

Relay bootstrap follows the same convention as the peercompute demos: drop a
`relay-config.json` next to `index.html` (or pass `?relayConfigUrl=...`).
The `@peercompute` import is a Vite alias into the sibling
`../peercompute` repo, bundled at build time.

## Speech

- Prompts use SpeechSynthesis (built into Chrome).
- The picture game uses Chrome's SpeechRecognition, which needs network
  access. Without it (or without a mic) cards simply auto-advance on the
  30-second timer.
