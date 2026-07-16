// Small persistent settings (difficulty, etc.) shared across modules.

const DIFFICULTY_KEY = 'hackerbaby-difficulty';

export function getDifficulty() {
  try {
    return localStorage.getItem(DIFFICULTY_KEY) === 'hard' ? 'hard' : 'easy';
  } catch (_) {
    return 'easy';
  }
}

export function setDifficulty(mode) {
  try {
    localStorage.setItem(DIFFICULTY_KEY, mode === 'hard' ? 'hard' : 'easy');
  } catch (_) {
    // non-persistent is fine
  }
}

const VOICE_KEY = 'hackerbaby-voice';

export function getVoiceURI() {
  try {
    return localStorage.getItem(VOICE_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function setVoiceURI(uri) {
  try {
    if (uri) localStorage.setItem(VOICE_KEY, uri);
    else localStorage.removeItem(VOICE_KEY);
  } catch (_) {
    // non-persistent is fine
  }
}

const RATE_KEY = 'hackerbaby-speech-rate';

// Multiplier on top of each prompt's base rate; 1 = normal.
export function getSpeechRate() {
  try {
    const value = parseFloat(localStorage.getItem(RATE_KEY));
    return Number.isFinite(value) ? Math.min(1.6, Math.max(0.5, value)) : 1;
  } catch (_) {
    return 1;
  }
}

export function setSpeechRate(rate) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch (_) {
    // non-persistent is fine
  }
}
