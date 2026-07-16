import './style.css';
import { unlockAudio, startMusic, toggleMusic, isMusicPlaying, playPop } from './audio.js';
import { LetterGame } from './letterGame.js';
import { PictureGame } from './pictureGame.js';
import { Mirror } from './mirror.js';
import { initParentPanel } from './parentPanel.js';
import { initNet, publishStatus } from './net.js';

// ---- PWA service worker (production builds only, so dev stays uncached) ----
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('sw failed', err));
  });
}

// ---- pieces ----------------------------------------------------------------
const letterGame = new LetterGame(document.getElementById('scene'), {
  onProgress: ({ letter, stars }) => publishStatus({ mode: currentMode, letter, stars })
});

const pictureGame = new PictureGame({
  pictureEl: document.getElementById('card-picture'),
  wordEl: document.getElementById('card-word'),
  micEl: document.getElementById('mic-status'),
  timerFillEl: document.getElementById('card-timer-fill'),
  onProgress: ({ card }) => publishStatus({ mode: currentMode, card })
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

function setMode(mode) {
  if (mode === currentMode && started) return;
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

  if (mode === 'letters') {
    letterGame.start();
  } else if (mode === 'pictures') {
    overlays.pictures.classList.remove('hidden');
    pictureGame.start();
  } else if (mode === 'mirror') {
    overlays.mirror.classList.remove('hidden');
    mirror.start();
  }
  publishStatus({ mode });
}

modeButtons.letters.addEventListener('click', () => setMode('letters'));
modeButtons.pictures.addEventListener('click', () => setMode('pictures'));
modeButtons.mirror.addEventListener('click', () => setMode('mirror'));

const musicBtn = document.getElementById('music-toggle');
function updateMusicButton(playing) {
  musicBtn.classList.toggle('muted', !playing);
}
musicBtn.addEventListener('click', () => updateMusicButton(toggleMusic()));

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

function goFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  }
}

document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- keyboard routing -----------------------------------------------------------
window.addEventListener('keydown', (e) => {
  // let the grown-ups panel use the keyboard normally
  if (parentPanel.isOpen()) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  e.preventDefault();

  if (!started) return;
  const char = e.key.length === 1 ? e.key.toUpperCase() : '';
  if (!/^[A-Z0-9]$/.test(char)) return;

  if (currentMode === 'letters') {
    letterGame.handleKey(char);
  } else {
    // keys are still fun outside the letter game
    letterGame.spawnKeyLetter(char);
    playPop();
  }
});

// ---- boot ------------------------------------------------------------------------
// small debug handle for smoke tests / parent tinkering
window.__hb = { letterGame, pictureGame, setMode: (m) => setMode(m) };

const startOverlay = document.getElementById('start-overlay');
document.getElementById('start-button').addEventListener('click', () => {
  unlockAudio();
  startMusic();
  updateMusicButton(isMusicPlaying());
  goFullscreen();
  acquireWakeLock();
  startOverlay.classList.add('hidden');
  document.body.classList.add('playing');
  started = true;
  letterGame.start();
  initNet({
    onStatus: (text) => {
      const el = document.getElementById('net-status');
      if (el) el.textContent = text;
    }
  });
});
