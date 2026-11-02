// Salvataggio sul dispositivo con IndexedDB.
//   books    { id, title, author, format, cover, chapterTitles, wordCounts, totalWords, fingerprint, addedAt, openedAt }
//   texts    { id, chapters: [{ title, paragraphs }] }       (caricato solo quando apri il libro)
//   progress { bookId, chapter, word, updatedAt }
//   sessions { id, bookId, start, ms, words }
//   settings { key, value }

const DB_NAME = 'rsvp-reader';
const VERSION = 1;
let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('texts', { keyPath: 'id' });
        db.createObjectStore('progress', { keyPath: 'bookId' });
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('bookId', 'bookId');
        db.createObjectStore('settings', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transazione annullata'));
  });
  const result = await fn(...(Array.isArray(stores) ? stores : [stores]).map((s) => t.objectStore(s)));
  await done;
  return result;
}

const getAll = (store) => tx(store, 'readonly', (s) => req(s.getAll()));
const get = (store, key) => tx(store, 'readonly', (s) => req(s.get(key)));
const put = (store, value) => tx(store, 'readwrite', (s) => req(s.put(value)));

export const db = {
  books: () => getAll('books'),
  book: (id) => get('books', id),
  text: (id) => get('texts', id),
  saveBook: (book) => put('books', book),

  async addBook(meta, chapters) {
    const id = crypto.randomUUID();
    const book = { ...meta, id, addedAt: Date.now(), openedAt: Date.now() };
    await tx(['books', 'texts'], 'readwrite', (b, t) => {
      b.put(book);
      t.put({ id, chapters });
    });
    return book;
  },

  async findByFingerprint(fingerprint) {
    return (await getAll('books')).find((b) => b.fingerprint === fingerprint) ?? null;
  },

  async deleteBook(id) {
    const sessions = (await getAll('sessions')).filter((s) => s.bookId === id);
    await tx(['books', 'texts', 'progress', 'sessions'], 'readwrite', (b, t, p, s) => {
      b.delete(id);
      t.delete(id);
      p.delete(id);
      for (const x of sessions) s.delete(x.id);
    });
  },

  allProgress: () => getAll('progress'),
  progress: (bookId) => get('progress', bookId),
  saveProgress: (bookId, chapter, word) => put('progress', { bookId, chapter, word, updatedAt: Date.now() }),

  sessions: () => getAll('sessions'),
  addSession: (s) => put('sessions', { id: crypto.randomUUID(), ...s }),

  async getSetting(key, fallback) {
    const row = await get('settings', key);
    return row ? row.value : fallback;
  },
  setSetting: (key, value) => put('settings', { key, value }),

  async dump() {
    return tx(['books', 'texts', 'progress', 'sessions'], 'readonly', async (b, t, p, s) => ({
      books: await req(b.getAll()),
      texts: await req(t.getAll()),
      progress: await req(p.getAll()),
      sessions: await req(s.getAll()),
    }));
  },

  async writeMany({ books = [], texts = [], progress = [], sessions = [] }) {
    await tx(['books', 'texts', 'progress', 'sessions'], 'readwrite', (b, t, p, s) => {
      books.forEach((x) => b.put(x));
      texts.forEach((x) => t.put(x));
      progress.forEach((x) => p.put(x));
      sessions.forEach((x) => s.put(x));
    });
  },

  async clearAll() {
    await tx(['books', 'texts', 'progress', 'sessions', 'settings'], 'readwrite', (...stores) => {
      stores.forEach((s) => s.clear());
    });
  },
};

/** Chiede al browser di non cancellare i dati in automatico (su iOS aiuta, ma non è garantito). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
