// Divide i paragrafi di un capitolo in parole, con il fattore di durata di ciascuna.

const TRAILING_CLOSERS = /[»”’"')\]”’]+$/u;
const SENTENCE_END = /[.!?…]$/u;
const SHORT_PAUSE = /[,;:—–)\]]$/u;
const LETTERS = /[\p{L}\p{N}]/gu;

export const FACTORS = {
  sentence: 2,
  pause: 1.5,
  long: 1.3, // ≥ 8 lettere
  veryLong: 1.6, // ≥ 12 lettere
  special: 1.2, // numeri, maiuscole interne
  paragraphGap: 2, // vuoto prima di un nuovo paragrafo (in unità di parola): la parola dura ×3 in totale
};

/** Spezza un paragrafo in parole: spazi, trattini lunghi tra parole, parole molto lunghe con il trattino. */
export function splitWords(paragraph) {
  const out = [];
  for (const raw of paragraph.replace(/­/g, '').split(/\s+/u)) {
    if (!raw) continue;
    // "parola—parola" → "parola—", "parola"
    for (const piece of raw.split(/(?<=[\p{L}\p{N}][—–])(?=[\p{L}\p{N}«"“])/u)) {
      if (Array.from(piece).length > 13 && /\p{L}-\p{L}/u.test(piece)) {
        for (const part of piece.split(/(?<=\p{L}-)(?=\p{L})/u)) out.push(part);
      } else if (piece) {
        out.push(piece);
      }
    }
  }
  return out;
}

export function punctuationFactor(word) {
  const closers = word.match(TRAILING_CLOSERS)?.[0] ?? '';
  const core = word.slice(0, word.length - closers.length);
  if (SENTENCE_END.test(core)) return FACTORS.sentence;
  if (SHORT_PAUSE.test(core) || /[)\]]/.test(closers)) return FACTORS.pause;
  return 1;
}

export function endsSentence(word) {
  return SENTENCE_END.test(word.replace(TRAILING_CLOSERS, ''));
}

/** Fattore di durata della parola (senza il vuoto di paragrafo). */
export function wordFactor(word) {
  const letters = (word.match(LETTERS) || []).length;
  let f = punctuationFactor(word);
  if (letters >= 12) f *= FACTORS.veryLong;
  else if (letters >= 8) f *= FACTORS.long;
  if (/\p{N}/u.test(word) || /\p{Ll}\p{Lu}/u.test(word)) f *= FACTORS.special;
  return f;
}

/**
 * @param {string[]} paragraphs
 * @returns {{ text: string, para: number, factor: number, gap: number, sentenceStart: boolean }[]}
 */
export function tokenizeChapter(paragraphs) {
  const words = [];
  let prevEnded = true;
  paragraphs.forEach((p, para) => {
    const list = splitWords(p);
    list.forEach((text, k) => {
      const paraStart = k === 0;
      words.push({
        text,
        para,
        factor: wordFactor(text),
        gap: paraStart && words.length > 0 ? FACTORS.paragraphGap : 0,
        sentenceStart: paraStart || prevEnded,
      });
      prevEnded = endsSentence(text);
    });
  });
  return words;
}

export function countWords(paragraphs) {
  let n = 0;
  for (const p of paragraphs) n += splitWords(p).length;
  return n;
}
