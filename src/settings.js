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
