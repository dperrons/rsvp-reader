import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orpIndex, splitAtOrp } from '../src/text/orp.js';
import { tokenizeChapter, wordFactor, splitWords, countWords, FACTORS } from '../src/text/tokenize.js';
import { ReaderEngine, rampFactor, wordDuration, clampWpm } from '../src/reader/engine.js';
import { realWpm, summarize, formatDuration, wordsBefore, estimateMs } from '../src/stats.js';
import { mergeLibrary, isAhead } from '../src/storage/merge.js';
import { parsePlainText, splitParagraphs, decodeText, isHeading, titleFromText } from '../src/import/text.js';

test('lettera di fissazione', () => {
  assert.equal(orpIndex('a'), 0);
  assert.equal(orpIndex('casa'), 1);
  assert.equal(orpIndex('lettura'), 2);
  assert.equal(orpIndex('velocemente'), 3);
  assert.equal(orpIndex('precipitevolissimevolmente'), 4);
  // la punteggiatura iniziale non conta
  assert.equal(orpIndex('«casa»'), 2);
  assert.deepEqual(splitAtOrp('«casa»,'), ['«c', 'a', 'sa»,']);
  assert.deepEqual(splitAtOrp('—'), ['', '—', '']);
});

test('fattori di durata', () => {
  assert.equal(wordFactor('casa'), 1);
  assert.equal(wordFactor('casa.'), FACTORS.sentence);
  assert.equal(wordFactor('casa?»'), FACTORS.sentence);
  assert.equal(wordFactor('casa,'), FACTORS.pause);
  assert.equal(wordFactor('(casa)'), FACTORS.pause);
  assert.equal(wordFactor('lettura'), 1);
  assert.equal(wordFactor('letterario'), FACTORS.long);
  assert.equal(wordFactor('straordinariamente'), FACTORS.veryLong);
  assert.equal(wordFactor('1969'), FACTORS.special);
  assert.equal(wordFactor('iPhone'), FACTORS.special);
  assert.ok(Math.abs(wordFactor('straordinariamente.') - FACTORS.sentence * FACTORS.veryLong) < 1e-9);
});

test('divisione in parole', () => {
  assert.deepEqual(splitWords('  uno   due\ntre '), ['uno', 'due', 'tre']);
  assert.deepEqual(splitWords('lui—disse'), ['lui—', 'disse']);
  assert.deepEqual(splitWords('socio-economico-culturale'), ['socio-', 'economico-', 'culturale']);
  assert.deepEqual(splitWords('ben-essere'), ['ben-essere']);
  assert.deepEqual(splitWords('pa­rola'), ['parola']);
});

test('tokenizzazione del capitolo', () => {
  const words = tokenizeChapter(['Ciao a tutti. Come va?', 'Bene.']);
  assert.deepEqual(
    words.map((w) => w.text),
    ['Ciao', 'a', 'tutti.', 'Come', 'va?', 'Bene.'],
  );
  assert.deepEqual(
    words.map((w) => w.sentenceStart),
    [true, false, false, true, false, true],
  );
  assert.deepEqual(
    words.map((w) => w.para),
    [0, 0, 0, 0, 0, 1],
  );
  assert.equal(words[0].gap, 0, 'nessun vuoto prima della prima parola');
  assert.equal(words[5].gap, FACTORS.paragraphGap);
  assert.equal(countWords(['Ciao a tutti. Come va?', 'Bene.']), 6);
});

test('accelerazione e durata', () => {
  assert.equal(rampFactor(0), 0.6);
  assert.equal(rampFactor(1500), 0.8);
  assert.equal(rampFactor(10000), 1);
  assert.equal(rampFactor(0, false), 1);
  assert.equal(wordDuration(1, 300), 200);
  assert.equal(wordDuration(2, 300), 400);
  assert.equal(clampWpm(5), 100);
  assert.equal(clampWpm(5000), 1200);
});

/** Orologio finto: il tempo avanza solo quando eseguiamo i timer. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, at: t + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** Esegue il prossimo timer e restituisce quanti ms sono passati. */
    tick() {
      const [id, next] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!next) return null;
      timers.delete(id);
      const dt = next.at - t;
      t = next.at;
      next.fn();
      return dt;
    },
  };
}

test('il motore mostra le parole con i tempi giusti, il vuoto di paragrafo e la fine', () => {
  const clock = fakeClock();
  const shown = [];
  const sessions = [];
  let ended = false;
  const engine = new ReaderEngine({
    wpm: 600, // 100 ms per parola
    ramp: false,
    clock,
    onWord: (w) => shown.push(w ? w.text : '∅'),
    onSession: (s) => sessions.push(s),
    onEnd: () => (ended = true),
  });
  engine.load(tokenizeChapter(['Uno due.', 'Tre']));
  shown.length = 0;
  engine.play();
  const durations = [];
  let dt;
  while ((dt = clock.tick()) !== null) durations.push(dt);
  assert.deepEqual(shown, ['Uno', 'due.', '∅', 'Tre', 'Tre']); // l'ultima viene ridisegnata alla pausa
  assert.deepEqual(durations, [100, 200, 200, 100]);
  assert.ok(ended);
  assert.equal(engine.playing, false);
  assert.deepEqual(sessions, [{ words: 3, ms: 600 }]);
});

test('il motore accelera gradualmente', () => {
  const clock = fakeClock();
  const engine = new ReaderEngine({ wpm: 600, ramp: true, clock });
  engine.load(tokenizeChapter(['a b c d e f g h i l m n o p q r s t u v z a b c d e f g h i l m n o p q']));
  engine.play();
  const first = clock.tick();
  assert.ok(Math.abs(first - 100 / 0.6) < 1e-6, `prima parola più lenta: ${first}`);
  let last;
  for (let i = 0; i < 30; i++) last = clock.tick();
  assert.equal(last, 100);
});

test('frase precedente e successiva', () => {
  const engine = new ReaderEngine({ clock: fakeClock() });
  engine.load(tokenizeChapter(['Uno due tre. Quattro cinque sei. Sette otto.']));
  engine.seek(4); // "cinque"
  engine.prevSentence();
  assert.equal(engine.index, 3); // "Quattro"
  engine.prevSentence();
  assert.equal(engine.index, 0); // già all'inizio: torna alla frase prima
  engine.nextSentence();
  assert.equal(engine.index, 3);
  engine.nextSentence();
  assert.equal(engine.index, 6);
  engine.nextSentence();
  assert.equal(engine.index, 7); // ultima parola
});

test('il cambio di posizione durante la lettura continua a leggere', () => {
  const clock = fakeClock();
  const engine = new ReaderEngine({ clock, ramp: false });
  engine.load(tokenizeChapter(['Uno due tre quattro cinque']));
  engine.play();
  engine.seek(3);
  assert.equal(engine.playing, true);
  assert.equal(engine.current.text, 'quattro');
});

test('statistiche', () => {
  assert.equal(realWpm([{ ms: 5000, words: 50 }]), null, 'troppo poco tempo');
  assert.equal(realWpm([{ ms: 60000, words: 300 }, { ms: 60000, words: 500 }]), 400);
  const now = new Date(2026, 10, 2, 15, 0).getTime();
  const s = summarize(
    [
      { start: now - 3600000, ms: 60000, words: 300 },
      { start: now - 3 * 86400000, ms: 120000, words: 600 },
      { start: now - 30 * 86400000, ms: 60000, words: 100 },
    ],
    now,
  );
  assert.deepEqual(s.today, { ms: 60000, words: 300 });
  assert.deepEqual(s.week, { ms: 180000, words: 900 });
  assert.deepEqual(s.total, { ms: 240000, words: 1000 });
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(20000), '< 1 min');
  assert.equal(formatDuration(12 * 60000), '12 min');
  assert.equal(formatDuration(65 * 60000), '1 h 05 min');
  assert.equal(formatDuration(120 * 60000), '2 h');
  assert.equal(wordsBefore([10, 20, 30], 2, 5), 35);
  assert.equal(estimateMs(300, 300), 60000);
});

test('unione dei backup', () => {
  assert.ok(isAhead({ chapter: 2, word: 0 }, { chapter: 1, word: 99 }));
  assert.ok(!isAhead({ chapter: 1, word: 5 }, { chapter: 1, word: 9 }));
  const current = {
    books: [{ id: 'a', fingerprint: 'A' }, { id: 'b', fingerprint: 'B' }],
    progress: [{ bookId: 'a', chapter: 3, word: 0 }, { bookId: 'b', chapter: 0, word: 10 }],
    sessions: [{ id: 's1', bookId: 'a' }],
  };
  const incoming = {
    books: [{ id: 'a', fingerprint: 'A' }, { id: 'b2', fingerprint: 'B' }, { id: 'c', fingerprint: 'C' }],
    texts: [{ id: 'a' }, { id: 'b2' }, { id: 'c' }],
    progress: [
      { bookId: 'a', chapter: 1, word: 0 },
      { bookId: 'b2', chapter: 2, word: 0 },
      { bookId: 'c', chapter: 0, word: 4 },
    ],
    sessions: [{ id: 's1', bookId: 'a' }, { id: 's2', bookId: 'b2' }],
  };
  const out = mergeLibrary(current, incoming);
  assert.deepEqual(out.books.map((b) => b.id), ['c']);
  assert.deepEqual(out.texts.map((t) => t.id), ['c']);
  assert.deepEqual(out.progress, [
    { bookId: 'b', chapter: 2, word: 0 },
    { bookId: 'c', chapter: 0, word: 4 },
  ]);
  assert.deepEqual(out.sessions, [{ id: 's2', bookId: 'b' }]);
});

test('testo semplice: paragrafi, righe spezzate e capitoli', () => {
  assert.deepEqual(splitParagraphs('Una riga\nche continua.\n\nSecondo para-\ngrafo.'), [
    'Una riga che continua.',
    'Secondo paragrafo.',
  ]);
  assert.deepEqual(splitParagraphs('Riga uno\nRiga due'), ['Riga uno', 'Riga due']);
  assert.ok(isHeading('Capitolo 3'));
  assert.ok(isHeading('CAPITOLO III'));
  assert.ok(isHeading('Capitolo primo'));
  assert.ok(isHeading('Parte II'));
  assert.ok(isHeading('Prologo'));
  assert.ok(!isHeading('Parte della notte la passò sveglio.'));
  const book = parsePlainText('Premessa breve.\n\nCapitolo 1\n\nC’era una volta.\n\nCapitolo 2\n\nFine.', 'Fiaba');
  assert.deepEqual(
    book.chapters.map((c) => [c.title, c.paragraphs]),
    [
      ['Inizio', ['Premessa breve.']],
      ['Capitolo 1', ['C’era una volta.']],
      ['Capitolo 2', ['Fine.']],
    ],
  );
  const single = parsePlainText('Solo testo.', 'Nota');
  assert.equal(single.chapters[0].title, 'Nota');
});

test('testo semplice: Gutenberg e codifiche', () => {
  const g = parsePlainText(
    'Licenza...\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\nTesto vero.\n\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nAltro',
    'X',
  );
  assert.deepEqual(g.chapters[0].paragraphs, ['Testo vero.']);
  assert.equal(decodeText(new TextEncoder().encode('﻿perché')), 'perché');
  assert.equal(decodeText(new Uint8Array([0x70, 0x65, 0x72, 0x63, 0x68, 0xe9])), 'perché'); // windows-1252
  assert.equal(titleFromText('Uno due tre quattro cinque sei sette otto nove'), 'Uno due tre quattro cinque sei sette…');
});

// ---------- PDF (logica pura) ----------
import { buildParagraphs, splitChapters } from '../src/import/pdf.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const line = (text, y, x = 50, width = 400) => ({ text, y, x, width, height: 12 });

test('PDF: paragrafi, parole spezzate, intestazioni e numeri di pagina', () => {
  const page = (n, body) => [line('IL MIO LIBRO', 800), ...body, line(String(n), 40, 290, 10)];
  const pages = [
    page(1, [line('Prima riga del paragrafo che con-', 700), line('tinua qui e finisce.', 686, 50, 200), line('Nuovo paragrafo che va', 672)]),
    page(2, [line('a capo sulla pagina dopo', 700), line('e finisce.', 686, 50, 100)]),
    page(3, [line('Terza pagina.', 700, 50, 120)]),
    page(4, [line('Quarta pagina.', 700, 50, 120)]),
  ];
  const { paragraphs, startPage } = buildParagraphs(pages);
  assert.deepEqual(paragraphs, [
    'Prima riga del paragrafo che continua qui e finisce.',
    'Nuovo paragrafo che va a capo sulla pagina dopo e finisce.',
    'Terza pagina.',
    'Quarta pagina.',
  ]);
  assert.deepEqual(startPage, [0, 0, 2, 3]);
});

test('PDF: capitoli dai segnalibri o a blocchi di pagine', () => {
  const paragraphs = ['a', 'b', 'c', 'd'];
  const startPage = [0, 3, 25, 41];
  assert.deepEqual(
    splitChapters(paragraphs, startPage, [{ title: 'Uno', page: 0 }, { title: 'Due', page: 20 }], 50),
    [
      { title: 'Uno', paragraphs: ['a', 'b'] },
      { title: 'Due', paragraphs: ['c', 'd'] },
    ],
  );
  // più sezioni sulla stessa pagina, distinte dall'altezza
  assert.deepEqual(
    splitChapters(['x', 'y', 'z'], [0, 0, 0], [{ title: 'A', page: 0, y: 700 }, { title: 'B', page: 0, y: 400 }], 1, [690, 500, 390]),
    [
      { title: 'A', paragraphs: ['x', 'y'] },
      { title: 'B', paragraphs: ['z'] },
    ],
  );
  assert.deepEqual(
    splitChapters(paragraphs, [0, 3, 25, 41], [{ title: 'Uno', page: 1 }], 50).map((c) => c.title),
    ['Inizio', 'Uno'],
  );
  assert.deepEqual(
    splitChapters(paragraphs, startPage, null, 50).map((c) => c.title),
    ['Pagine 1–20', 'Pagine 21–40', 'Pagine 41–50'],
  );
});

test('il service worker mette in cache tutti i file dell\'app', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|mjs|css|html|svg|png|webmanifest))'/g)].map((m) => m[1]));
  const root = new URL('..', import.meta.url).pathname;
  const walk = (dir) =>
    readdirSync(root + dir).flatMap((f) => (statSync(`${root}${dir}/${f}`).isDirectory() ? walk(`${dir}/${f}`) : [`${dir}/${f}`]));
  const needed = [...walk('src'), ...walk('vendor').filter((f) => /\.m?js$/.test(f)), ...walk('icons'), 'index.html', 'styles.css', 'manifest.webmanifest'];
  for (const f of needed) assert.ok(listed.has(f), `manca in sw.js: ${f}`);
  for (const f of listed) assert.ok(needed.includes(f), `in sw.js ma non esiste: ${f}`);
});
