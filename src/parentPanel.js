import { addCustomCard, listCustomCards, deleteCustomCard } from './customCards.js';
import { toggleBgMusic, getPlaylistId, setPlaylistId, parsePlaylistInput } from './music.js';
import { getDifficulty, setDifficulty } from './settings.js';
import { unlockAudio } from './audio.js';

const LONG_PRESS_MS = 1200;
const GATE_CODE = 'config';

export function initParentPanel({ onCardsChanged, onRepeatPrompt, onMusicToggled }) {
  const hotspot = document.getElementById('parent-hotspot');
  const panel = document.getElementById('parent-panel');
  const closeBtn = document.getElementById('parent-close');
  const fullscreenBtn = document.getElementById('parent-fullscreen');
  const musicBtn = document.getElementById('parent-music');
  const voiceBtn = document.getElementById('parent-voice');
  const form = document.getElementById('card-form');
  const wordInput = document.getElementById('card-form-word');
  const fileInput = document.getElementById('card-form-file');
  const list = document.getElementById('custom-card-list');

  const gate = document.getElementById('config-gate');
  const gateInput = document.getElementById('config-gate-input');
  const gateClose = document.getElementById('config-gate-close');
  const configButton = document.getElementById('config-button');

  let pressTimer = null;

  const syncHash = (open) => {
    try {
      if (open) {
        history.replaceState(null, '', '#config');
      } else if (location.hash === '#config') {
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (_) {
      // history unavailable
    }
  };

  const open = () => {
    closeGate();
    panel.classList.remove('hidden');
    syncHash(true);
    renderList();
  };
  const close = () => {
    panel.classList.add('hidden');
    syncHash(false);
  };

  // --- "type config" gate: also summons the on-screen keyboard on mobile ---
  const openGate = () => {
    gate.classList.remove('hidden');
    gateInput.value = '';
    gateInput.focus();
  };
  const closeGate = () => {
    gate.classList.add('hidden');
    gateInput.blur();
  };

  configButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    openGate();
  });
  // focus again on click for browsers that only show the keyboard on a
  // "real" activation event
  configButton.addEventListener('click', () => gateInput.focus());
  gateClose.addEventListener('click', closeGate);
  gate.addEventListener('pointerdown', (e) => {
    if (e.target === gate) closeGate();
  });
  gateInput.addEventListener('input', () => {
    if (gateInput.value.trim().toLowerCase() === GATE_CODE) open();
  });
  gateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGate();
  });

  // --- #config deep link ---
  const applyHash = () => {
    if (location.hash === '#config') open();
  };
  window.addEventListener('hashchange', applyHash);
  applyHash();

  hotspot.addEventListener('pointerdown', () => {
    pressTimer = setTimeout(open, LONG_PRESS_MS);
  });
  for (const evt of ['pointerup', 'pointerleave', 'pointercancel']) {
    hotspot.addEventListener(evt, () => clearTimeout(pressTimer));
  }

  closeBtn.addEventListener('click', close);
  panel.addEventListener('pointerdown', (e) => {
    if (e.target === panel) close();
  });

  fullscreenBtn.addEventListener('click', () => {
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  });

  musicBtn.addEventListener('click', () => {
    unlockAudio();
    onMusicToggled?.(toggleBgMusic());
  });

  voiceBtn.addEventListener('click', () => onRepeatPrompt?.());

  // --- difficulty ---
  const easyBtn = document.getElementById('difficulty-easy');
  const hardBtn = document.getElementById('difficulty-hard');

  function renderDifficulty() {
    const mode = getDifficulty();
    easyBtn.classList.toggle('selected', mode === 'easy');
    hardBtn.classList.toggle('selected', mode === 'hard');
  }
  easyBtn.addEventListener('click', () => {
    setDifficulty('easy');
    renderDifficulty();
  });
  hardBtn.addEventListener('click', () => {
    setDifficulty('hard');
    renderDifficulty();
  });
  renderDifficulty();

  // --- youtube playlist ---
  const playlistForm = document.getElementById('playlist-form');
  const playlistInput = document.getElementById('playlist-input');
  const playlistClear = document.getElementById('playlist-clear');
  const playlistStatus = document.getElementById('playlist-status');

  function renderPlaylistStatus() {
    const id = getPlaylistId();
    playlistStatus.textContent = id
      ? `Using YouTube playlist: ${id}`
      : 'Using built-in tunes.';
  }

  playlistForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parsePlaylistInput(playlistInput.value);
    if (!id) {
      playlistStatus.textContent = 'Could not find a playlist ID in that — paste a link containing "list=".';
      return;
    }
    setPlaylistId(id);
    playlistInput.value = '';
    renderPlaylistStatus();
  });

  playlistClear.addEventListener('click', () => {
    setPlaylistId('');
    renderPlaylistStatus();
  });

  renderPlaylistStatus();

  async function renderList() {
    let cards = [];
    try {
      cards = await listCustomCards();
    } catch (_) {
      list.innerHTML = '<li>Custom card storage unavailable.</li>';
      return;
    }
    list.innerHTML = '';
    for (const card of cards) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = URL.createObjectURL(card.blob);
      img.onload = () => URL.revokeObjectURL(img.src);
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = card.word;
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        await deleteCustomCard(card.id);
        renderList();
        onCardsChanged?.();
      });
      li.append(img, span, del);
      list.appendChild(li);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = wordInput.value.trim();
    const file = fileInput.files?.[0];
    if (!word || !file) return;
    await addCustomCard({ word, blob: file });
    form.reset();
    renderList();
    onCardsChanged?.();
  });

  return {
    isOpen: () => !panel.classList.contains('hidden'),
    isGateOpen: () => !gate.classList.contains('hidden'),
    open,
    close
  };
}
