// Statistiche di lettura: logica pura sulle sessioni salvate.
// Una sessione: { id, bookId, start (ms epoch), ms (tempo effettivo di riproduzione), words }

const MIN_MS_FOR_WPM = 10000;
const DAY = 86400000;

export function realWpm(sessions) {
  let ms = 0;
  let words = 0;
  for (const s of sessions) {
    ms += s.ms;
    words += s.words;
  }
  if (ms < MIN_MS_FOR_WPM || words === 0) return null;
  return Math.round((words / ms) * 60000);
}

function sum(sessions) {
  return sessions.reduce((a, s) => ({ ms: a.ms + s.ms, words: a.words + s.words }), { ms: 0, words: 0 });
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function summarize(sessions, now = Date.now()) {
  const today = startOfDay(now);
  const week = today - 6 * DAY;
  return {
    today: sum(sessions.filter((s) => s.start >= today)),
    week: sum(sessions.filter((s) => s.start >= week)),
    total: sum(sessions),
    wpm: realWpm(sessions),
  };
}

export function bookStats(sessions, bookId) {
  const mine = sessions.filter((s) => s.bookId === bookId);
  return { ...sum(mine), wpm: realWpm(mine) };
}

/**
 * Velocità usata per stimare il tempo rimanente: quella reale se c'è abbastanza storico,
 * altrimenti quella impostata ridotta del peso medio delle pause (~1,25).
 */
export function effectiveWpm(realWpmValue, settingWpm) {
  return realWpmValue ?? settingWpm / 1.25;
}

export function estimateMs(words, wpm) {
  if (!wpm || words <= 0) return 0;
  return (words / wpm) * 60000;
}

export function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  if (ms > 0 && min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

/** Parole lette prima di (chapter, word), dati i conteggi per capitolo. */
export function wordsBefore(wordCounts, chapter, word) {
  let n = 0;
  for (let i = 0; i < chapter && i < wordCounts.length; i++) n += wordCounts[i];
  return n + word;
}
