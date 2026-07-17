import { addCustomCard, listCustomCards, deleteCustomCard } from './customCards.js';
import { toggleBgMusic, getPlaylistId, setPlaylistId, parsePlaylistInput } from './music.js';
import { getDifficulty, setDifficulty, getVoiceURI, setVoiceURI, getSpeechRate, setSpeechRate } from './settings.js';
import { listVoices, refreshVoice, speak } from './speech.js';
import { unlockAudio } from './audio.js';

const VOICE_SAMPLES = ['B! B is for bubble!', 'Yay! Great job!', 'Can you say dog?', 'D is for dada!'];

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
    renderVoices();
  };
  const close = () => {
    panel.classList.add('hidden');
    syncHash(false);
    stopCapture();
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

  // --- voice picker + speed ---
  const voiceSelect = document.getElementById('voice-select');
  const voicePreview = document.getElementById('voice-preview');
  const rateSlider = document.getElementById('speech-rate');
  const rateValue = document.getElementById('speech-rate-value');

  const sampleSpeak = () => {
    unlockAudio();
    speak(VOICE_SAMPLES[Math.floor(Math.random() * VOICE_SAMPLES.length)]);
  };

  function renderVoices() {
    const voices = listVoices();
    const current = getVoiceURI();
    voiceSelect.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Auto (best English voice)';
    voiceSelect.appendChild(auto);
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    }
    voiceSelect.value = current && voices.some((v) => v.voiceURI === current) ? current : '';

    const rate = getSpeechRate();
    rateSlider.value = String(rate);
    rateValue.textContent = `×${rate.toFixed(2)}`;
  }

  voiceSelect.addEventListener('change', () => {
    setVoiceURI(voiceSelect.value);
    refreshVoice();
    sampleSpeak();
  });

  rateSlider.addEventListener('input', () => {
    rateValue.textContent = `×${parseFloat(rateSlider.value).toFixed(2)}`;
  });
  rateSlider.addEventListener('change', () => {
    setSpeechRate(parseFloat(rateSlider.value));
    sampleSpeak();
  });

  voicePreview.addEventListener('click', sampleSpeak);

  // voices often arrive asynchronously — refresh the list when they land
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
    if (!panel.classList.contains('hidden')) renderVoices();
  });

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
      span.textContent = card.alt?.length ? `${card.word} (+${card.alt.length})` : card.word;
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

  // --- camera capture for new cards ---
  const cameraBtn = document.getElementById('card-camera');
  const captureBox = document.getElementById('camera-capture');
  const captureVideo = document.getElementById('capture-video');
  const snapBtn = document.getElementById('capture-snap');
  const flipBtn = document.getElementById('capture-flip');
  const captureCancel = document.getElementById('capture-cancel');
  const previewBox = document.getElementById('capture-preview');
  const previewImg = document.getElementById('capture-preview-img');
  const retakeBtn = document.getElementById('capture-retake');
  const formStatus = document.getElementById('card-form-status');

  let captureStream = null;
  let capturedBlob = null;
  let facing = 'user';

  async function startCapture() {
    stopCapture();
    clearCaptured();
    try {
      captureStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false
      });
    } catch (err) {
      formStatus.textContent = 'Camera unavailable — you can still choose a photo file.';
      return;
    }
    captureVideo.srcObject = captureStream;
    captureVideo.classList.toggle('mirrored', facing === 'user');
    captureBox.classList.remove('hidden');
    formStatus.textContent = '';
  }

  function stopCapture() {
    if (captureStream) {
      for (const track of captureStream.getTracks()) track.stop();
      captureStream = null;
    }
    captureVideo.srcObject = null;
    captureBox.classList.add('hidden');
  }

  function clearCaptured() {
    capturedBlob = null;
    if (previewImg.src) URL.revokeObjectURL(previewImg.src);
    previewImg.removeAttribute('src');
    previewBox.classList.add('hidden');
  }

  cameraBtn.addEventListener('click', startCapture);
  captureCancel.addEventListener('click', stopCapture);

  flipBtn.addEventListener('click', () => {
    facing = facing === 'user' ? 'environment' : 'user';
    startCapture();
  });

  snapBtn.addEventListener('click', () => {
    const w = captureVideo.videoWidth;
    const h = captureVideo.videoHeight;
    if (!w || !h) return;
    // cap the stored size so IndexedDB stays lean
    const scale = Math.min(1, 1024 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const g = canvas.getContext('2d');
    if (facing === 'user') {
      // save what the mirror preview showed
      g.translate(canvas.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(captureVideo, 0, 0, canvas.width, canvas.height);
    // synchronous encode: the photo must exist the instant Snap is pressed,
    // so a quick Snap → Add card can't race an async toBlob callback
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const bytes = atob(dataUrl.split(',')[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    capturedBlob = new Blob([arr], { type: 'image/jpeg' });
    previewImg.src = URL.createObjectURL(capturedBlob);
    previewBox.classList.remove('hidden');
    fileInput.value = '';
    stopCapture();
  });

  retakeBtn.addEventListener('click', startCapture);

  // picking a file discards any captured photo
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) clearCaptured();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // first word is displayed; any comma-separated extras also count as
    // correct answers ("dada, daddy, papa")
    const parts = wordInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    const word = parts[0] || '';
    const alt = parts.slice(1);
    const blob = capturedBlob || fileInput.files?.[0];
    if (!word) return;
    if (!blob) {
      formStatus.textContent = 'Choose a photo file or take one with the camera.';
      return;
    }
    await addCustomCard({ word, blob, alt });
    form.reset();
    clearCaptured();
    stopCapture();
    formStatus.textContent = `Added “${word}”!`;
    renderList();
    onCardsChanged?.();
  });

  // --- #config deep link ---
  // Runs last: open() touches elements declared throughout this function.
  const applyHash = () => {
    if (location.hash === '#config') open();
  };
  window.addEventListener('hashchange', applyHash);
  applyHash();

  return {
    isOpen: () => !panel.classList.contains('hidden'),
    isGateOpen: () => !gate.classList.contains('hidden'),
    open,
    close
  };
}
