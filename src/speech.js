// Text-to-speech prompts and speech recognition for the picture game.
// Voices are the device/browser's built-in speechSynthesis voices; the
// grown-ups panel can pin a specific one (persisted via settings).

import { getVoiceURI, getSpeechRate } from './settings.js';

let voice = null;

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const pinnedUri = getVoiceURI();
  if (pinnedUri) {
    const pinned = voices.find((v) => v.voiceURI === pinnedUri);
    if (pinned) {
      voice = pinned;
      return;
    }
  }
  const preferred =
    voices.find((v) => /en/i.test(v.lang) && /female|zira|samantha|google us english/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0];
  voice = preferred || null;
}

if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}

// English voices first (the words are English), then everything else.
export function listVoices() {
  const voices = [...(window.speechSynthesis?.getVoices?.() || [])];
  return voices.sort((a, b) => {
    const aEn = /^en/i.test(a.lang) ? 0 : 1;
    const bEn = /^en/i.test(b.lang) ? 0 : 1;
    return aEn - bEn || a.name.localeCompare(b.name);
  });
}

// Re-run selection after the pinned voice changes.
export function refreshVoice() {
  pickVoice();
}

export function currentVoiceName() {
  return voice ? `${voice.name} (${voice.lang})` : 'browser default';
}

// --- speaking-state tracking ------------------------------------------------
// The picture game must not "hear" the app's own voice through the mic, so we
// track exactly when synthesis is active and let listeners subscribe.

const speechHandlers = new Set();
const pendingUtterances = new Set();
let lastSpeechEndAt = 0;

export function onSpeechActivity(handler) {
  speechHandlers.add(handler);
  return () => speechHandlers.delete(handler);
}

function emit(event) {
  for (const handler of speechHandlers) {
    try {
      handler(event);
    } catch (_) {
      // listener errors shouldn't break speech
    }
  }
}

function settleUtterance(utter) {
  if (!pendingUtterances.has(utter)) return;
  pendingUtterances.delete(utter);
  if (utter._safetyTimer) clearTimeout(utter._safetyTimer);
  if (pendingUtterances.size === 0) {
    lastSpeechEndAt = performance.now();
    emit('end');
  }
}

export function isSpeechActive(graceMs = 1200) {
  if (pendingUtterances.size > 0) return true;
  if (window.speechSynthesis?.speaking) return true;
  return performance.now() - lastSpeechEndAt < graceMs;
}

export function speak(text, { rate = 0.85, pitch = 1.25, interrupt = true } = {}) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (interrupt) synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  if (voice) utter.voice = voice;
  // per-prompt base rate scaled by the grown-ups speed setting
  utter.rate = Math.min(2, Math.max(0.1, rate * getSpeechRate()));
  utter.pitch = pitch;
  utter.volume = 1;

  if (pendingUtterances.size === 0) emit('start');
  pendingUtterances.add(utter);
  utter.onend = () => settleUtterance(utter);
  utter.onerror = () => settleUtterance(utter);
  // Safety net: in environments where onend never fires (no voices, muted
  // synth), clear after roughly how long the phrase could take to say.
  utter._safetyTimer = setTimeout(() => settleUtterance(utter), 1500 + text.length * 90);

  synth.speak(utter);
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
  for (const utter of [...pendingUtterances]) settleUtterance(utter);
}

// --- recognition ----------------------------------------------------------

export function createListener({ onResult, onStateChange }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    return {
      supported: false,
      start() {},
      stop() {}
    };
  }

  let active = false;
  let wantActive = false;
  const rec = new Recognition();
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 4;

  rec.onstart = () => {
    active = true;
    onStateChange?.(true);
  };
  rec.onend = () => {
    active = false;
    onStateChange?.(false);
    if (wantActive) {
      // Chrome stops recognition periodically; keep it alive while wanted.
      setTimeout(() => {
        if (wantActive && !active) {
          try {
            rec.start();
          } catch (_) {
            /* already starting */
          }
        }
      }, 250);
    }
  };
  rec.onerror = () => {
    // onend fires after errors and handles the restart
  };
  rec.onresult = (event) => {
    const heard = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      for (let j = 0; j < result.length; j++) {
        heard.push(result[j].transcript);
      }
    }
    if (heard.length) onResult?.(heard.join(' ').toLowerCase());
  };

  return {
    supported: true,
    start() {
      wantActive = true;
      if (active) return;
      try {
        rec.start();
      } catch (_) {
        /* already starting */
      }
    },
    stop() {
      wantActive = false;
      try {
        rec.stop();
      } catch (_) {
        /* not running */
      }
    }
  };
}
