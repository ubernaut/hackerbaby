import { playShutter, playChime } from './audio.js';
import { speak } from './speech.js';

export class Mirror {
  constructor({ videoEl, snapEl, flashEl, frameEl }) {
    this.videoEl = videoEl;
    this.snapEl = snapEl;
    this.flashEl = flashEl;
    this.stream = null;
    this.frozen = false;

    frameEl.addEventListener('pointerdown', () => this._snap());
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });
      this.videoEl.srcObject = this.stream;
      playChime();
      speak('Look! Who is that? Is that you?', { pitch: 1.3 });
    } catch (err) {
      console.warn('camera unavailable', err);
      speak('Uh oh, I cannot find the camera.');
    }
  }

  setPaused(paused) {
    if (!this.videoEl.srcObject) return;
    if (paused) this.videoEl.pause();
    else this.videoEl.play().catch(() => {});
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.videoEl.srcObject = null;
    this._unfreeze();
  }

  _snap() {
    if (!this.stream) return;
    if (this.frozen) {
      this._unfreeze();
      return;
    }
    const w = this.videoEl.videoWidth;
    const h = this.videoEl.videoHeight;
    if (!w || !h) return;
    this.snapEl.width = w;
    this.snapEl.height = h;
    this.snapEl.getContext('2d').drawImage(this.videoEl, 0, 0, w, h);
    this.snapEl.classList.remove('hidden');
    this.frozen = true;
    playShutter();
    this.flashEl.classList.remove('flashing');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('flashing');
    speak('Cheese!', { pitch: 1.5 });
    setTimeout(() => this._unfreeze(), 2500);
  }

  _unfreeze() {
    this.frozen = false;
    this.snapEl.classList.add('hidden');
  }
}
