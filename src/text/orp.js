// Lettera di fissazione (Optimal Recognition Point): dove l'occhio cade naturalmente su una parola.

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Posizione della lettera di fissazione nella parte "vera" della parola (senza punteggiatura). */
export function orpOffset(length) {
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

/**
 * Indice, nella stringa completa, del carattere da evidenziare.
 * Salta la punteggiatura iniziale (« " ( …) e conta solo lettere e cifre per la lunghezza.
 */
export function orpIndex(word) {
  const chars = Array.from(word);
  let start = 0;
  while (start < chars.length && !WORD_CHAR.test(chars[start])) start++;
  if (start === chars.length) return Math.floor((chars.length - 1) / 2);
  let end = chars.length;
  while (end > start && !WORD_CHAR.test(chars[end - 1])) end--;
  const target = start + orpOffset(end - start);
  // Indice in unità UTF-16, per poter fare slice sulla stringa originale.
  return chars.slice(0, target).join('').length;
}

/** Divide la parola in [prima, lettera di fissazione, dopo]. */
export function splitAtOrp(word) {
  const i = orpIndex(word);
  const cp = word.codePointAt(i);
  const len = cp > 0xffff ? 2 : 1;
  return [word.slice(0, i), word.slice(i, i + len), word.slice(i + len)];
}
