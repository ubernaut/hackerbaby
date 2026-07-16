import { addCustomCard, listCustomCards, deleteCustomCard } from './customCards.js';
import { toggleMusic } from './audio.js';

const LONG_PRESS_MS = 1200;

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

  let pressTimer = null;

  const open = () => {
    panel.classList.remove('hidden');
    renderList();
  };
  const close = () => panel.classList.add('hidden');

  hotspot.addEventListener('pointerdown', () => {
    pressTimer = setTimeout(open, LONG_PRESS_MS);
  });
  for (const evt of ['pointerup', 'pointerleave', 'pointercancel']) {
    hotspot.addEventListener(evt, () => clearTimeout(pressTimer));
  }

  closeBtn.addEventListener('click', close);

  fullscreenBtn.addEventListener('click', () => {
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  });

  musicBtn.addEventListener('click', () => {
    onMusicToggled?.(toggleMusic());
  });

  voiceBtn.addEventListener('click', () => onRepeatPrompt?.());

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
    open,
    close
  };
}
