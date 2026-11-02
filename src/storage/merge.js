// Unione di un backup con la libreria esistente (logica pura, testabile senza IndexedDB).

export function isAhead(a, b) {
  if (!b) return true;
  if (!a) return false;
  return a.chapter > b.chapter || (a.chapter === b.chapter && a.word > b.word);
}

/**
 * @param current  { books, texts, progress, sessions } già presenti
 * @param incoming { books, texts, progress, sessions } dal file di backup
 * @returns cosa scrivere: { books, texts, progress, sessions } (solo le voci nuove o aggiornate)
 */
export function mergeLibrary(current, incoming) {
  const haveBook = new Set(current.books.map((b) => b.id));
  const haveFingerprint = new Map(current.books.map((b) => [b.fingerprint, b.id]));
  const remap = new Map(); // id nel backup → id già presente (stesso libro importato due volte)

  const books = [];
  const texts = [];
  for (const b of incoming.books) {
    const existing = haveBook.has(b.id) ? b.id : haveFingerprint.get(b.fingerprint);
    if (existing) {
      remap.set(b.id, existing);
      continue;
    }
    books.push(b);
    const t = incoming.texts.find((x) => x.id === b.id);
    if (t) texts.push(t);
  }

  const progressById = new Map(current.progress.map((p) => [p.bookId, p]));
  const progress = [];
  for (const p of incoming.progress) {
    const bookId = remap.get(p.bookId) ?? p.bookId;
    const mine = progressById.get(bookId);
    if (isAhead(p, mine)) progress.push({ ...p, bookId });
  }

  const haveSession = new Set(current.sessions.map((s) => s.id));
  const sessions = incoming.sessions
    .filter((s) => !haveSession.has(s.id))
    .map((s) => ({ ...s, bookId: remap.get(s.bookId) ?? s.bookId }));

  return { books, texts, progress, sessions };
}
