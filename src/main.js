import './style.css';
import { unlockAudio } from './audio.js';
import { startBgMusic, stopBgMusic, toggleBgMusic, isBgMusicPlaying } from './music.js';
import { stopSpeaking } from './speech.js';
import { LetterGame } from './letterGame.js';
import { PictureGame } from './pictureGame.js';
import { Mirror } from './mirror.js';
import { initParentPanel } from './parentPanel.js';
import { initNet, publishStatus } from './net.js';
import { getScore, getAllScores, onScoreChange } from './scoreboard.js';

// ---- PWA service worker (production builds only, so dev stays uncached) ----
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('sw failed', err));
  });
}

// ---- pieces ----------------------------------------------------------------
const sceneCanvas = document.getElementById('scene');

const letterGame = new LetterGame(sceneCanvas, {
  onProgress: ({ letter, stars }) => publishStatus({ mode: currentMode, letter, stars })
});

const pictureGame = new PictureGame({
  overlayEl: document.getElementById('picture-mode'),
  pictureEl: document.getElementById('card-picture'),
  wordEl: document.getElementById('card-word'),
  micEl: document.getElementById('mic-status'),
  timerFillEl: document.getElementById('card-timer-fill'),
  onProgress: ({ card }) => publishStatus({ mode: currentMode, card }),
  onCelebrate: () => letterGame.burstConfetti()
});

const mirror = new Mirror({
  videoEl: document.getElementById('mirror-video'),
  snapEl: document.getElementById('mirror-snap'),
  flashEl: document.getElementById('mirror-flash'),
  frameEl: document.getElementById('mirror-frame')
});

const parentPanel = initParentPanel({
  onCardsChanged: () => {
    if (currentMode === 'pictures') {
      pictureGame.stop();
      pictureGame.start();
    }
  },
  onRepeatPrompt: () => {
    if (currentMode === 'letters') letterGame._promptLetter({ newWord: true });
    else if (currentMode === 'pictures' && pictureGame.card) pictureGame._sayCard();
  },
  onMusicToggled: (playing) => updateMusicButton(playing)
});

// ---- score badge -------------------------------------------------------------
const scoreBadge = document.getElementById('score-badge');

function updateScoreBadge() {
  if (currentMode === 'mirror' || !started) {
    scoreBadge.classList.add('hidden');
    return;
  }
  scoreBadge.classList.remove('hidden');
  scoreBadge.textContent = `⭐ ${getScore(currentMode)}`;
}

onScoreChange((game) => {
  updateScoreBadge();
  if (game === currentMode) {
    scoreBadge.classList.remove('pop');
    void scoreBadge.offsetWidth;
    scoreBadge.classList.add('pop');
  }
  publishStatus({ scores: getAllScores() });
});

// ---- mode switching ---------------------------------------------------------
const overlays = {
  pictures: document.getElementById('picture-mode'),
  mirror: document.getElementById('mirror-mode')
};
const modeButtons = {
  letters: document.getElementById('mode-letters'),
  pictures: document.getElementById('mode-pictures'),
  mirror: document.getElementById('mode-mirror')
};

let currentMode = 'letters';
let started = false;
let paused = false;
let musicWasOn = false;

function setMode(mode) {
  if (mode === currentMode && started) return;
  if (paused) setPaused(false);
  // tear down the old mode
  letterGame.stop();
  pictureGame.stop();
  mirror.stop();
  overlays.pictures.classList.add('hidden');
  overlays.mirror.classList.add('hidden');

  currentMode = mode;
  for (const [name, btn] of Object.entries(modeButtons)) {
    btn.classList.toggle('active', name === mode);
  }

  // outside the letter game the canvas becomes a transparent effects layer
  // on top, so key showers and confetti rain over every mode
  const overlayMode = mode !== 'letters';
  letterGame.setOverlayMode(overlayMode);
  sceneCanvas.classList.toggle('fx-layer', overlayMode);

  if (mode === 'letters') {
    letterGame.start();
  } else if (mode === 'pictures') {
    overlays.pictures.classList.remove('hidden');
    pictureGame.start();
  } else if (mode === 'mirror') {
    overlays.mirror.classList.remove('hidden');
    mirror.start();
  }
  updateScoreBadge();
  publishStatus({ mode, scores: getAllScores() });
}

// Instant activation for the top bar: on touch devices `click` waits for
// pointerup (and feels laggy under little mashing hands), so fire on
// pointerdown and swallow the trailing click.
function bindTap(el, handler) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handler();
  });
  el.addEventListener('click', (e) => e.preventDefault());
}

bindTap(modeButtons.letters, () => setMode('letters'));
bindTap(modeButtons.pictures, () => setMode('pictures'));
bindTap(modeButtons.mirror, () => setMode('mirror'));

const musicBtn = document.getElementById('music-toggle');
function updateMusicButton(playing) {
  musicBtn.classList.toggle('muted', !playing);
}
bindTap(musicBtn, () => updateMusicButton(toggleBgMusic()));

// ---- pause --------------------------------------------------------------------
const pauseBtn = document.getElementById('pause-toggle');
const pauseOverlay = document.getElementById('pause-overlay');

function setPaused(next) {
  if (!started || paused === next) return;
  paused = next;
  pauseOverlay.classList.toggle('hidden', !paused);
  pauseBtn.textContent = paused ? '▶️' : '⏸️';
  letterGame.setPaused(paused);
  pictureGame.setPaused(paused);
  mirror.setPaused(paused);
  if (paused) {
    stopSpeaking();
    musicWasOn = isBgMusicPlaying();
    stopBgMusic();
  } else if (musicWasOn) {
    startBgMusic();
  }
  updateMusicButton(isBgMusicPlaying());
  publishStatus({ paused });
}

bindTap(pauseBtn, () => setPaused(!paused));
bindTap(document.getElementById('resume-button'), () => setPaused(false));

// ---- fullscreen -----------------------------------------------------------------
function goFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  }
}

bindTap(document.getElementById('fullscreen-toggle'), () => {
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  } else {
    goFullscreen();
  }
});

// ---- kiosk behaviors ----------------------------------------------------------
let wakeLock = null;
async function acquireWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch (_) {
    // not fatal
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started) acquireWakeLock();
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- big friendly cursor ---------------------------------------------------------
// The cursor itself is a native CSS cursor (see style.css) so it has zero
// input lag; these listeners only swap in the "squished" variant on click.
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') document.body.classList.add('pressed');
});
window.addEventListener('pointerup', () => document.body.classList.remove('pressed'));
window.addEventListener('pointercancel', () => document.body.classList.remove('pressed'));

// ---- keyboard routing -----------------------------------------------------------
window.addEventListener('keydown', (e) => {
  // let the grown-ups panel and any focused text box use the keyboard normally
  if (parentPanel.isOpen() || parentPanel.isGateOpen()) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  e.preventDefault();

  if (!started || paused) return;
  const char = e.key.length === 1 ? e.key.toUpperCase() : '';
  if (!/^[A-Z0-9]$/.test(char)) return;

  if (currentMode === 'letters') {
    letterGame.handleKey(char);
  } else {
    // keys rain down festively over every mode (mash still gets the sad noise)
    letterGame.handleAmbientKey(char);
  }
});

// small debug handle for smoke tests / parent tinkering
window.__hb = { letterGame, pictureGame, setMode: (m) => setMode(m), setPaused: (p) => setPaused(p) };

// ---- boot ------------------------------------------------------------------------
const startOverlay = document.getElementById('start-overlay');
document.getElementById('start-button').addEventListener('click', () => {
  unlockAudio();
  startBgMusic();
  updateMusicButton(isBgMusicPlaying());
  goFullscreen();
  acquireWakeLock();
  startOverlay.classList.add('hidden');
  document.body.classList.add('playing');
  started = true;
  letterGame.start();
  updateScoreBadge();
  initNet({
    onStatus: (text) => {
      const el = document.getElementById('net-status');
      if (el) el.textContent = text;
    }
  });
});
