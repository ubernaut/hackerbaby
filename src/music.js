// Background music router: plays a parent-provided YouTube playlist when one
// is configured, otherwise the built-in generative synth loop. Falls back to
// the synth loop whenever YouTube can't load (offline kiosk, blocked, etc.).

import { startMusic as startSynth, stopMusic as stopSynth } from './audio.js';
import { setMusicEnabled } from './settings.js';

const PLAYLIST_KEY = 'hackerbaby-playlist';

let playlistId = '';
try {
  playlistId = localStorage.getItem(PLAYLIST_KEY) || '';
} catch (_) {
  // storage unavailable
}

let playing = null; // null | 'synth' | 'yt'
let player = null;
let playerReadyPromise = null;
let apiPromise = null;
let ytStateHandler = null;
let ytWatchdog = null;

export function getPlaylistId() {
  return playlistId;
}

// Accepts a playlist URL (anything with ?list=...) or a bare playlist ID.
// Returns the parsed ID, or null if the input wasn't recognizable.
export function parsePlaylistInput(input) {
  const text = (input || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const list = url.searchParams.get('list');
    if (list) return list;
  } catch (_) {
    // not a URL — maybe a bare ID
  }
  if (/^[A-Za-z0-9_-]{12,}$/.test(text)) return text;
  return null;
}

export function setPlaylistId(id) {
  playlistId = id || '';
  try {
    if (playlistId) localStorage.setItem(PLAYLIST_KEY, playlistId);
    else localStorage.removeItem(PLAYLIST_KEY);
  } catch (_) {
    // non-persistent is fine
  }
  // live-switch if music is currently on
  if (playing) {
    stopBgMusic();
    startBgMusic();
  }
}

function loadYtApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('YouTube API load timeout')), 8000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('YouTube API failed to load'));
    };
    document.head.appendChild(tag);
  }).catch((err) => {
    apiPromise = null; // allow retry later
    throw err;
  });
  return apiPromise;
}

function ensurePlayer() {
  if (playerReadyPromise) return playerReadyPromise;
  playerReadyPromise = loadYtApi().then(
    () =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('YouTube player ready timeout')), 8000);
        player = new window.YT.Player('yt-holder', {
          width: '1',
          height: '1',
          playerVars: { controls: 0, disablekb: 1, playsinline: 1 },
          events: {
            onReady: () => {
              clearTimeout(timeout);
              resolve(player);
            },
            onStateChange: (e) => {
              ytStateHandler?.(e);
            },
            onError: () => {
              // per-video errors (deleted/blocked) — the playlist skips onward
            }
          }
        });
      })
  );
  playerReadyPromise.catch(() => {
    playerReadyPromise = null;
    player = null;
  });
  return playerReadyPromise;
}

export function startBgMusic() {
  if (playing) return;
  if (!playlistId) {
    playing = 'synth';
    startSynth();
    return;
  }
  playing = 'yt';
  ensurePlayer()
    .then((p) => {
      if (playing !== 'yt') return; // stopped while loading
      p.setVolume(35);
      p.loadPlaylist({ list: playlistId, listType: 'playlist' });
      p.setLoop(true);
      p.setShuffle(true);
      armYtWatchdog();
    })
    .catch((err) => {
      console.warn('YouTube music unavailable, using built-in tunes:', err);
      if (playing !== 'yt') return;
      playing = 'synth';
      startSynth();
    });
}

// A playlist that never reaches the PLAYING state (bad ID, empty, every video
// embed-blocked) would otherwise mean silence — fall back to the synth tunes.
function armYtWatchdog() {
  clearTimeout(ytWatchdog);
  ytStateHandler = (e) => {
    if (e.data === window.YT?.PlayerState?.PLAYING) {
      clearTimeout(ytWatchdog);
      ytWatchdog = null;
    }
  };
  ytWatchdog = setTimeout(() => {
    ytWatchdog = null;
    if (playing !== 'yt') return;
    console.warn('YouTube playlist never started playing; using built-in tunes');
    try {
      player?.stopVideo?.();
    } catch (_) {
      // player mid-initialization
    }
    playing = 'synth';
    startSynth();
  }, 12000);
}

export function stopBgMusic() {
  stopSynth();
  clearTimeout(ytWatchdog);
  ytWatchdog = null;
  try {
    player?.pauseVideo?.();
  } catch (_) {
    // player mid-initialization
  }
  playing = null;
}

// Explicit user toggles persist the preference; pause/resume and source
// switches go through start/stop directly and leave it untouched.
export function toggleBgMusic() {
  if (playing) {
    stopBgMusic();
    setMusicEnabled(false);
    return false;
  }
  startBgMusic();
  setMusicEnabled(true);
  return true;
}

export function isBgMusicPlaying() {
  return !!playing;
}
