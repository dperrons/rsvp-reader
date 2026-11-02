// Schermata di lettura: collega il motore al DOM, ai gesti e al salvataggio.

import { ReaderEngine, clampWpm } from './engine.js';
import { tokenizeChapter } from '../text/tokenize.js';
import { splitAtOrp } from '../text/orp.js';
import { db } from '../storage/db.js';
import { formatDuration, wordsBefore } from '../stats.js';

const $ = (id) => document.getElementById(id);
const SAVE_EVERY_MS = 5000;
const WPM_STEP = 10;

/** Tempo medio di una parola, in unità di parola, compresi pause e vuoti di paragrafo. */
export function averageFactor(words) {
  if (!words.length) return 1.25;
  let sum = 0;
  for (const w of words) sum += w.factor + w.gap;
  return sum / words.length;
}

export class ReaderView {
  constructor({ settings, saveSettings, onExit, toast }) {
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.onExit = onExit;
    this.toast = toast;
    this.root = $('reader');
    this.el = {
      word: $('word'),
      left: document.querySelector('#word .w-left'),
      orp: document.querySelector('#word .w-orp'),
      right: document.querySelector('#word .w-right'),
      stage: $('stage'),
      hint: $('hint'),
      flash: $('speed-flash'),
      context: $('context'),
      fill: $('progress-fill'),
      statusLeft: $('status-left'),
      statusRight: $('status-right'),
      wpm: $('wpm-label'),
      book: $('reader-book'),
      chapter: $('reader-chapter'),
      toc: $('toc-list'),
    };
    this.engine = new ReaderEngine({
      wpm: settings.wpm,
      ramp: settings.ramp,
      onWord: (w, i) => this.#renderWord(w, i),
      onState: (playing) => this.#onState(playing),
      onEnd: () => this.#onChapterEnd(),
      onSession: (s) => this.#onSession(s),
    });
    this.lastStatus = 0;
    this.saveTimer = null;
    this.wakeLock = null;
    this.#bind();
  }

  get isOpen() {
    return !!this.book;
  }

  async open(book) {
    const text = await db.text(book.id);
    if (!text) throw new Error('Testo del libro non trovato.');
    this.book = book;
    this.chapters = text.chapters;
    const p = await db.progress(book.id);
    const chapter = Math.min(p?.chapter ?? 0, this.chapters.length - 1);
    this.el.book.textContent = book.title;
    this.engine.setWpm(this.settings.wpm);
    this.engine.ramp = this.settings.ramp;
    this.#loadChapter(chapter, p?.word ?? 0);
    book.openedAt = Date.now();
    db.saveBook(book);
    this.#onState(false);
  }

  async close() {
    this.engine.pause();
    await this.#saveProgress();
    this.book = null;
    this.words = [];
  }

  applySettings(settings) {
    this.settings = settings;
    this.engine.setWpm(settings.wpm);
    this.engine.ramp = settings.ramp;
    this.#updateStatus(true);
  }

  // ---------- capitoli ----------

  #loadChapter(index, word = 0) {
    this.chapterIndex = index;
    const ch = this.chapters[index];
    this.words = tokenizeChapter(ch.paragraphs);
    this.avgFactor = averageFactor(this.words);
    this.paraFirst = [];
    this.words.forEach((w, i) => {
      if (this.paraFirst[w.para] === undefined) this.paraFirst[w.para] = i;
    });
    this.el.chapter.textContent = ch.title;
    this.engine.load(this.words, word);
  }

  goToChapter(index) {
    if (index < 0 || index >= this.chapters.length) return;
    this.engine.pause();
    this.#loadChapter(index, 0);
    this.#onState(false);
    this.#saveProgress();
  }

  #onChapterEnd() {
    if (this.chapterIndex + 1 < this.chapters.length) {
      this.#loadChapter(this.chapterIndex + 1, 0);
      this.#saveProgress();
      setTimeout(() => this.isOpen && this.engine.play(), 600);
    } else {
      this.#saveProgress();
      this.#renderContext(true);
    }
  }

  // ---------- rendering ----------

  #renderWord(w, index) {
    if (!w) {
      this.el.left.textContent = '';
      this.el.orp.textContent = '';
      this.el.right.textContent = '';
    } else {
      const [a, b, c] = splitAtOrp(w.text);
      this.el.left.textContent = a;
      this.el.orp.textContent = b;
      this.el.right.textContent = c;
    }
    this.#updateStatus(!this.engine.playing);
    if (!this.engine.playing && this.book) this.#renderContext(false);
  }

  #updateStatus(force) {
    if (!this.book || !this.words) return;
    const now = performance.now();
    if (!force && now - this.lastStatus < 250) return;
    this.lastStatus = now;
    const i = this.engine.index;
    const n = this.words.length;
    const chapterFraction = n > 1 ? i / (n - 1) : 1;
    this.el.fill.style.width = `${(chapterFraction * 100).toFixed(2)}%`;
    const read = wordsBefore(this.book.wordCounts, this.chapterIndex, i);
    const bookPct = Math.floor((read / this.book.totalWords) * 100);
    const unitMs = 60000 / this.engine.wpm;
    const chapterLeft = (n - i) * this.avgFactor * unitMs;
    const bookLeft = (this.book.totalWords - read) * (this.book.avgFactor ?? this.avgFactor) * unitMs;
    this.el.statusLeft.textContent = `Cap. ${this.chapterIndex + 1}/${this.chapters.length} · ancora ${formatDuration(chapterLeft)}`;
    this.el.statusRight.textContent = `Libro ${bookPct}% · ancora ${formatDuration(bookLeft)}`;
    this.el.wpm.textContent = `${this.engine.wpm} parole/min`;
  }

  #renderContext(atEnd) {
    const box = this.el.context;
    box.textContent = '';
    if (atEnd) {
      const end = document.createElement('p');
      end.className = 'ctx-end';
      end.textContent = 'Hai finito il libro 🎉';
      box.append(end);
      return;
    }
    const cur = this.engine.current;
    if (!cur) return;
    const from = Math.max(0, cur.para - 2);
    const to = Math.min(this.chapters[this.chapterIndex].paragraphs.length - 1, cur.para + 2);
    if (from === 0) {
      const note = document.createElement('p');
      note.className = 'ctx-note';
      note.textContent = this.chapters[this.chapterIndex].title;
      box.append(note);
    }
    let currentSpan = null;
    for (let p = from; p <= to; p++) {
      const el = document.createElement('p');
      if (p !== cur.para) el.className = 'dim';
      const start = this.paraFirst[p];
      if (start === undefined) continue;
      for (let i = start; i < this.words.length && this.words[i].para === p; i++) {
        const span = document.createElement('span');
        span.textContent = this.words[i].text;
        span.dataset.i = i;
        if (i === this.engine.index) {
          span.className = 'current';
          currentSpan = span;
        }
        el.append(span, ' ');
      }
      box.append(el);
    }
    if (to === this.chapters[this.chapterIndex].paragraphs.length - 1 && this.chapterIndex + 1 < this.chapters.length) {
      const note = document.createElement('p');
      note.className = 'ctx-note';
      note.textContent = `Poi: ${this.chapters[this.chapterIndex + 1].title}`;
      box.append(note);
    }
    currentSpan?.scrollIntoView({ block: 'center' });
  }

  renderToc() {
    const list = this.el.toc;
    list.textContent = '';
    this.chapters.forEach((ch, i) => {
      const li = document.createElement('li');
      if (i === this.chapterIndex) li.className = 'current';
      const b = document.createElement('button');
      const title = document.createElement('span');
      title.textContent = ch.title;
      const meta = document.createElement('span');
      meta.className = 'small muted';
      meta.textContent = i < this.chapterIndex ? '✓' : `${this.book.wordCounts[i].toLocaleString('it-IT')} parole`;
      if (i < this.chapterIndex) title.className = 'done';
      b.append(title, meta);
      b.dataset.chapter = i;
      li.append(b);
      list.append(li);
    });
    list.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }

  #onState(playing) {
    this.root.classList.toggle('reader-playing', playing);
    this.root.classList.toggle('reader-paused', !playing);
    this.el.context.hidden = playing;
    this.el.hint.hidden = playing;
    this.el.hint.textContent = 'Tocca per leggere · scorri ↑↓ per la velocità · ←→ per le frasi';
    $('play-btn').setAttribute('aria-label', playing ? 'Pausa' : 'Leggi');
    if (playing) {
      clearInterval(this.saveTimer);
      this.saveTimer = setInterval(() => this.#saveProgress(), SAVE_EVERY_MS);
      this.#keepAwake(true);
    } else {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
      this.#keepAwake(false);
      if (this.book) {
        this.#renderContext(false);
        this.#saveProgress();
      }
    }
    this.#updateStatus(true);
  }

  async #onSession({ words, ms }) {
    if (!this.book || words === 0) return;
    await db.addSession({ bookId: this.book.id, start: Date.now() - ms, ms: Math.round(ms), words });
  }

  async #saveProgress() {
    if (!this.book) return;
    await db.saveProgress(this.book.id, this.chapterIndex, this.engine.index);
  }

  async #keepAwake(on) {
    try {
      if (on && !this.wakeLock && navigator.wakeLock) this.wakeLock = await navigator.wakeLock.request('screen');
      if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      this.wakeLock = null;
    }
  }

  // ---------- comandi ----------

  changeWpm(delta) {
    const wpm = this.engine.setWpm(clampWpm(this.engine.wpm + delta));
    this.settings.wpm = wpm;
    this.saveSettings();
    this.el.flash.textContent = `${wpm} parole/min`;
    this.el.flash.hidden = false;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (this.el.flash.hidden = true), 900);
    this.#updateStatus(true);
  }

  #bind() {
    const stage = this.el.stage;
    let start = null;
    stage.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    stage.addEventListener('pointerup', (e) => {
      if (!start || !this.book) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return this.engine.toggle();
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 30) return this.changeWpm(dy < 0 ? WPM_STEP : -WPM_STEP);
      if (Math.abs(dx) > 40) return dx > 0 ? this.engine.nextSentence() : this.engine.prevSentence();
    });
    stage.addEventListener('pointercancel', () => (start = null));

    this.el.context.addEventListener('click', (e) => {
      const i = e.target.dataset?.i;
      if (i !== undefined) {
        this.engine.seek(Number(i));
        this.#saveProgress();
      }
    });

    $('play-btn').addEventListener('click', () => this.engine.toggle());
    $('prev-btn').addEventListener('click', () => this.engine.prevSentence());
    $('next-btn').addEventListener('click', () => this.engine.nextSentence());
    $('slower-btn').addEventListener('click', () => this.changeWpm(-WPM_STEP));
    $('faster-btn').addEventListener('click', () => this.changeWpm(WPM_STEP));
    $('back-btn').addEventListener('click', () => this.onExit());
    this.el.toc.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-chapter]');
      if (b) {
        this.goToChapter(Number(b.dataset.chapter));
        this.onTocChosen?.();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!this.book || this.root.hidden || e.target.closest?.('input, textarea, select')) return;
      if (document.querySelector('.sheet:not([hidden])')) return;
      const actions = {
        ' ': () => this.engine.toggle(),
        ArrowLeft: () => this.engine.prevSentence(),
        ArrowRight: () => this.engine.nextSentence(),
        ArrowUp: () => this.changeWpm(WPM_STEP),
        ArrowDown: () => this.changeWpm(-WPM_STEP),
        Escape: () => this.onExit(),
      };
      if (actions[e.key]) {
        e.preventDefault();
        actions[e.key]();
      }
    });

    window.addEventListener('pagehide', () => this.book && this.engine.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.book) {
        this.engine.pause();
        this.#saveProgress();
      }
    });
  }
}
