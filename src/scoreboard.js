// Persistent per-game scores (localStorage) with change notifications.

const KEY = 'hackerbaby-scores';
const handlers = new Set();

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (_) {
    return {};
  }
}

let scores = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(scores));
  } catch (_) {
    // storage full/blocked — scores just won't persist
  }
}

export function getScore(game) {
  return scores[game] || 0;
}

export function getAllScores() {
  return { ...scores };
}

export function addScore(game, amount = 1) {
  scores[game] = (scores[game] || 0) + amount;
  save();
  for (const handler of handlers) {
    try {
      handler(game, scores[game]);
    } catch (_) {
      // ignore listener errors
    }
  }
  return scores[game];
}

export function onScoreChange(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
