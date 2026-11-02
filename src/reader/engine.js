// Motore RSVP: decide quale parola mostrare e per quanto tempo. Non tocca il DOM.

export const RAMP = { start: 0.6, ms: 3000 };
export const WPM_MIN = 100;
export const WPM_MAX = 1200;

export function clampWpm(wpm) {
  return Math.min(WPM_MAX, Math.max(WPM_MIN, Math.round(wpm)));
}

/** Frazione della velocità durante l'accelerazione, dopo `elapsed` ms di riproduzione. */
export function rampFactor(elapsed, enabled = true) {
  if (!enabled) return 1;
  return Math.min(1, RAMP.start + (1 - RAMP.start) * (elapsed / RAMP.ms));
}

/** Durata in ms di una parola con il suo fattore, a una certa velocità. */
export function wordDuration(factor, wpm, ramp = 1) {
  return (60000 / (wpm * ramp)) * factor;
}

const defaultClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Eventi (tutti opzionali):
 *  onWord(word, index)  — mostra una parola (word = null: vuoto prima di un paragrafo)
 *  onState(playing)
 *  onEnd()              — fine delle parole
 *  onSession({ words, ms }) — a ogni pausa: parole lette e tempo effettivo di riproduzione
 */
export class ReaderEngine {
  constructor({ wpm = 350, ramp = true, clock = defaultClock, ...handlers } = {}) {
    this.words = [];
    this.index = 0;
    this.wpm = clampWpm(wpm);
    this.ramp = ramp;
    this.clock = clock;
    this.handlers = handlers;
    this.playing = false;
    this.timer = null;
    this.playStart = 0;
    this.sessionWords = 0;
  }

  load(words, index = 0) {
    this.pause();
    this.words = words;
    this.index = Math.max(0, Math.min(index, Math.max(0, words.length - 1)));
    this.#show();
  }

  get current() {
    return this.words[this.index] ?? null;
  }

  setWpm(wpm) {
    this.wpm = clampWpm(wpm);
    return this.wpm;
  }

  play() {
    if (this.playing || this.words.length === 0) return;
    if (this.index >= this.words.length - 1 && this.atEnd) this.index = 0;
    this.atEnd = false;
    this.playing = true;
    this.playStart = this.clock.now();
    this.sessionWords = 0;
    this.handlers.onState?.(true);
    this.#step(false);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
    const ms = this.clock.now() - this.playStart;
    this.handlers.onSession?.({ words: this.sessionWords, ms });
    this.handlers.onState?.(false);
    this.#show();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(index) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.index = Math.max(0, Math.min(index, this.words.length - 1));
    this.atEnd = false;
    this.#show();
    if (wasPlaying) this.play();
  }

  /** Inizio della frase corrente o, se ci sei già, di quella prima. */
  prevSentence() {
    // Se siamo già all'inizio della frase, torna a quella precedente.
    let start = this.#sentenceStartAtOrBefore(this.index);
    if (start === this.index && start > 0) start = this.#sentenceStartAtOrBefore(start - 1);
    this.seek(start);
  }

  nextSentence() {
    for (let i = this.index + 1; i < this.words.length; i++) {
      if (this.words[i].sentenceStart) return this.seek(i);
    }
    this.seek(this.words.length - 1);
  }

  #sentenceStartAtOrBefore(i) {
    while (i > 0 && !this.words[i].sentenceStart) i--;
    return i;
  }

  #show() {
    this.handlers.onWord?.(this.current, this.index);
  }

  // Mostra la parola corrente, poi programma la successiva.
  #step(fromAdvance) {
    if (!this.playing) return;
    const w = this.current;
    const ramp = rampFactor(this.clock.now() - this.playStart, this.ramp);
    const unit = wordDuration(1, this.wpm, ramp);
    if (fromAdvance && w.gap) {
      this.handlers.onWord?.(null, this.index);
      this.timer = this.clock.setTimeout(() => this.#showWordThenAdvance(), unit * w.gap);
    } else {
      this.#showWordThenAdvance();
    }
  }

  #showWordThenAdvance() {
    if (!this.playing) return;
    const w = this.current;
    const ramp = rampFactor(this.clock.now() - this.playStart, this.ramp);
    this.handlers.onWord?.(w, this.index);
    this.timer = this.clock.setTimeout(() => {
      if (!this.playing) return;
      this.sessionWords++;
      if (this.index >= this.words.length - 1) {
        this.atEnd = true;
        this.pause();
        this.handlers.onEnd?.();
        return;
      }
      this.index++;
      this.#step(true);
    }, wordDuration(w.factor, this.wpm, ramp));
  }
}
