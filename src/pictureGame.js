import { BUILTIN_CARDS } from './words.js';
import { listCustomCards } from './customCards.js';
import { playSuccess, playChime, playBoing } from './audio.js';
import { speak, createListener, isSpeechActive, onSpeechActivity } from './speech.js';
import { addScore } from './scoreboard.js';

const CARD_TIMEOUT_MS = 30000;
const POST_SPEECH_GRACE_MS = 1200;

// Background variety for the card stage — one per card, cycled randomly.
const STAGE_BACKGROUNDS = [
  'radial-gradient(circle at 50% 35%, #311b92, #12062b 80%)',
  'radial-gradient(circle at 50% 35%, #01579b, #041226 80%)',
  'radial-gradient(circle at 50% 35%, #880e4f, #21041a 80%)',
  'radial-gradient(circle at 50% 35%, #1b5e20, #05130a 80%)',
  'radial-gradient(circle at 50% 35%, #bf360c, #260a03 80%)',
  'radial-gradient(circle at 50% 35%, #4a148c, #0d0326 80%)'
];

function normalize(text) {
  return ` ${text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

export class PictureGame {
  constructor({ overlayEl, pictureEl, wordEl, micEl, timerFillEl, onProgress, onCelebrate }) {
    this.overlayEl = overlayEl;
    this.pictureEl = pictureEl;
    this.wordEl = wordEl;
    this.micEl = micEl;
    this.timerFillEl = timerFillEl;
    this.onProgress = onProgress || (() => {});
    this.onCelebrate = onCelebrate || (() => {});
    this.running = false;
    this.paused = false;
    this.deck = [];
    this.deckIndex = 0;
    this.card = null;
    this.cardShownAt = 0;
    this.advanceTimer = null;
    this.tickTimer = null;
    this.locked = false;
    this.pendingNext = false;
    this.pausedRemaining = null;
    this.objectUrls = [];

    this.listener = createListener({
      onResult: (heard) => this._onHeard(heard),
      onStateChange: (listening) => {
        this.micEl.classList.toggle('listening', listening);
      }
    });

    // Mute the mic while the app itself is talking, so speech recognition
    // can't hear the prompt say the answer and auto-advance the card.
    onSpeechActivity((event) => {
      if (!this.running || this.paused) return;
      if (event === 'start') {
        this.listener.stop();
      } else if (event === 'end') {
        setTimeout(() => {
          if (this.running && !this.paused) this.listener.start();
        }, 300);
      }
    });

    this.pictureEl.addEventListener('pointerdown', () => {
      if (!this.running || this.paused || !this.card) return;
      playBoing(1.2);
      this._sayCard();
      // hop the picture on every poke (class stays on until the next card,
      // so the pop-in animation doesn't replay when the hop ends)
      this.pictureEl.classList.remove('hop');
      void this.pictureEl.offsetWidth;
      this.pictureEl.classList.add('hop');
    });
  }

  async refreshDeck() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];

    const deck = BUILTIN_CARDS.map((c) => ({ ...c }));

    try {
      const res = await fetch('./cards.json', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        for (const c of json.cards || []) {
          if (c && c.word) deck.push({ word: c.word, image: c.image, alt: c.alt || [] });
        }
      }
    } catch (_) {
      // optional file
    }

    try {
      const custom = await listCustomCards();
      for (const c of custom) {
        const url = URL.createObjectURL(c.blob);
        this.objectUrls.push(url);
        deck.push({ word: c.word, image: url, alt: [] });
      }
    } catch (err) {
      console.warn('custom cards unavailable', err);
    }

    this.deck = deck.sort(() => Math.random() - 0.5);
    this.deckIndex = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    await this.refreshDeck();
    if (!this.listener.supported) {
      console.warn('SpeechRecognition unavailable; cards will auto-advance.');
    }
    this.listener.start();
    this._showCard(this.deck[0]);
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.listener.stop();
    clearTimeout(this.advanceTimer);
    clearInterval(this.tickTimer);
    this.wordEl.classList.remove('celebrate');
  }

  setPaused(paused) {
    if (!this.running || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.listener.stop();
      clearTimeout(this.advanceTimer);
      clearInterval(this.tickTimer);
      if (this.locked) {
        this.pendingNext = true;
        this.pausedRemaining = null;
      } else {
        this.pausedRemaining = Math.max(1000, CARD_TIMEOUT_MS - (performance.now() - this.cardShownAt));
      }
    } else {
      this.listener.start();
      if (this.pendingNext) {
        this.pendingNext = false;
        this._next();
      } else if (this.card) {
        const remaining = this.pausedRemaining ?? CARD_TIMEOUT_MS;
        this.pausedRemaining = null;
        this.cardShownAt = performance.now() - (CARD_TIMEOUT_MS - remaining);
        this._armTimers();
      }
    }
  }

  _armTimers() {
    clearTimeout(this.advanceTimer);
    clearInterval(this.tickTimer);
    const remaining = Math.max(0, CARD_TIMEOUT_MS - (performance.now() - this.cardShownAt));
    this.advanceTimer = setTimeout(() => this._timeUp(), remaining);
    this.tickTimer = setInterval(() => {
      const left = Math.max(0, 1 - (performance.now() - this.cardShownAt) / CARD_TIMEOUT_MS);
      this.timerFillEl.style.width = `${left * 100}%`;
    }, 250);
  }

  _showCard(card) {
    if (!this.running) return;
    this.card = card;
    this.locked = false;
    this.cardShownAt = performance.now();
    this.wordEl.classList.remove('celebrate');
    this.wordEl.textContent = card.word;
    this.overlayEl.style.background =
      STAGE_BACKGROUNDS[Math.floor(Math.random() * STAGE_BACKGROUNDS.length)];

    this.pictureEl.innerHTML = '';
    if (card.image) {
      const img = document.createElement('img');
      img.src = card.image;
      img.alt = card.word;
      this.pictureEl.appendChild(img);
    } else {
      this.pictureEl.textContent = card.emoji;
    }
    // retrigger the pop-in animation
    this.pictureEl.classList.remove('hop');
    this.pictureEl.style.animation = 'none';
    void this.pictureEl.offsetWidth;
    this.pictureEl.style.animation = '';

    speak(`What is this? Can you say ${card.word}?`);
    this.onProgress({ card: card.word });
    this._armTimers();
  }

  _sayCard() {
    speak(`${this.card.word}!`);
  }

  _matches(heard) {
    const text = normalize(heard);
    const targets = [this.card.word, ...(this.card.alt || [])];
    return targets.some((t) => text.includes(` ${normalize(t).trim()} `));
  }

  _onHeard(heard) {
    if (!this.running || this.paused || this.locked || !this.card) return;
    // Ignore anything heard while (or just after) the app itself was
    // speaking — that's our own voice bouncing back through the mic.
    if (isSpeechActive(POST_SPEECH_GRACE_MS)) return;
    if (!this._matches(heard)) return;
    this.locked = true;
    clearTimeout(this.advanceTimer);
    clearInterval(this.tickTimer);
    this.wordEl.classList.add('celebrate');
    addScore('pictures');
    playSuccess();
    this.onCelebrate();
    speak(`Yes! ${this.card.word}! You said ${this.card.word}! Yay!`, { pitch: 1.4 });
    this.advanceTimer = setTimeout(() => this._next(), 3000);
  }

  _timeUp() {
    if (!this.running || this.paused || this.locked) return;
    this.locked = true;
    playChime();
    speak(`This is a ${this.card.word}. ${this.card.word}!`);
    this.advanceTimer = setTimeout(() => this._next(), 3200);
  }

  _next() {
    if (!this.running) return;
    if (this.paused) {
      this.pendingNext = true;
      return;
    }
    this.deckIndex = (this.deckIndex + 1) % this.deck.length;
    if (this.deckIndex === 0) this.deck.sort(() => Math.random() - 0.5);
    this._showCard(this.deck[this.deckIndex]);
  }
}
