import { BUILTIN_CARDS } from './words.js';
import { listCustomCards } from './customCards.js';
import { playSuccess, playChime } from './audio.js';
import { speak, createListener } from './speech.js';

const CARD_TIMEOUT_MS = 30000;

function normalize(text) {
  return ` ${text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

export class PictureGame {
  constructor({ pictureEl, wordEl, micEl, timerFillEl, onProgress }) {
    this.pictureEl = pictureEl;
    this.wordEl = wordEl;
    this.micEl = micEl;
    this.timerFillEl = timerFillEl;
    this.onProgress = onProgress || (() => {});
    this.running = false;
    this.deck = [];
    this.deckIndex = 0;
    this.card = null;
    this.cardShownAt = 0;
    this.advanceTimer = null;
    this.tickTimer = null;
    this.locked = false;
    this.objectUrls = [];

    this.listener = createListener({
      onResult: (heard) => this._onHeard(heard),
      onStateChange: (listening) => {
        this.micEl.classList.toggle('listening', listening);
      }
    });

    this.pictureEl.addEventListener('pointerdown', () => {
      if (this.running && this.card) this._sayCard();
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
    await this.refreshDeck();
    if (!this.listener.supported) {
      console.warn('SpeechRecognition unavailable; cards will auto-advance.');
    }
    this.listener.start();
    this._showCard(this.deck[0]);
  }

  stop() {
    this.running = false;
    this.listener.stop();
    clearTimeout(this.advanceTimer);
    clearInterval(this.tickTimer);
    this.wordEl.classList.remove('celebrate');
  }

  _showCard(card) {
    if (!this.running) return;
    this.card = card;
    this.locked = false;
    this.cardShownAt = performance.now();
    this.wordEl.classList.remove('celebrate');
    this.wordEl.textContent = card.word;

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
    this.pictureEl.style.animation = 'none';
    void this.pictureEl.offsetWidth;
    this.pictureEl.style.animation = '';

    speak(`What is this? Can you say ${card.word}?`);
    this.onProgress({ card: card.word });

    clearTimeout(this.advanceTimer);
    clearInterval(this.tickTimer);
    this.advanceTimer = setTimeout(() => this._timeUp(), CARD_TIMEOUT_MS);
    this.tickTimer = setInterval(() => {
      const left = Math.max(0, 1 - (performance.now() - this.cardShownAt) / CARD_TIMEOUT_MS);
      this.timerFillEl.style.width = `${left * 100}%`;
    }, 250);
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
    if (!this.running || this.locked || !this.card) return;
    if (!this._matches(heard)) return;
    this.locked = true;
    clearTimeout(this.advanceTimer);
    clearInterval(this.tickTimer);
    this.wordEl.classList.add('celebrate');
    playSuccess();
    speak(`Yes! ${this.card.word}! You said ${this.card.word}! Yay!`, { pitch: 1.4 });
    this.advanceTimer = setTimeout(() => this._next(), 3000);
  }

  _timeUp() {
    if (!this.running || this.locked) return;
    this.locked = true;
    playChime();
    speak(`This is a ${this.card.word}. ${this.card.word}!`);
    this.advanceTimer = setTimeout(() => this._next(), 3200);
  }

  _next() {
    if (!this.running) return;
    this.deckIndex = (this.deckIndex + 1) % this.deck.length;
    if (this.deckIndex === 0) this.deck.sort(() => Math.random() - 0.5);
    this._showCard(this.deck[this.deckIndex]);
  }
}
