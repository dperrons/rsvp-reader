// Avvio dell'app: libreria, impostazioni, fogli, importazione e passaggio tra le schermate.

import { db, requestPersistence } from './storage/db.js';
import { exportLibrary, importLibrary, saveFile, BACKUP_REMINDER_DAYS } from './storage/backup.js';
import { importFile, importPastedText } from './import/index.js';
import { ReaderView } from './reader/view.js';
import { summarize, formatDuration, wordsBefore } from './stats.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = { wpm: 350, ramp: true, fontSize: 40, theme: 'auto' };

let settings = { ...DEFAULTS };
let reader;
let sheetBook = null;

// ---------- utilità ----------

let toastTimer;
function toast(message, ms = 3500) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function busy(text) {
  $('busy-text').textContent = text ?? '';
  $('busy').hidden = text == null;
}

function openSheet(id) {
  document.querySelectorAll('.sheet').forEach((s) => (s.hidden = s.id !== id));
  $('sheet-backdrop').hidden = false;
}

function closeSheets() {
  document.querySelectorAll('.sheet').forEach((s) => (s.hidden = true));
  $('sheet-backdrop').hidden = true;
}

function showView(id) {
  for (const v of ['library', 'reader', 'settings']) $(v).hidden = v !== id;
  window.scrollTo(0, 0);
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  root.style.setProperty('--word-size', `${settings.fontSize}px`);
}

async function saveSettings() {
  await db.setSetting('settings', settings);
}

// ---------- navigazione ----------

async function openBook(book) {
  busy('Apro il libro…');
  try {
    await reader.open(book);
    showView('reader');
    history.pushState({ view: 'reader' }, '');
  } catch (e) {
    toast(e.message);
  } finally {
    busy(null);
  }
}

async function goLibrary() {
  if (reader.isOpen) await reader.close();
  showView('library');
  renderLibrary();
}

window.addEventListener('popstate', () => {
  if (!$('library').hidden) return;
  goLibrary();
});

// ---------- libreria ----------

const COVER_COLORS = ['#c0392b', '#2e86ab', '#7d5ba6', '#3b8a5a', '#c27c0e', '#a23b72', '#4a6fa5', '#8c5e3c'];

function coverEl(book) {
  if (book.cover) {
    const img = document.createElement('img');
    img.className = 'cover';
    img.src = book.cover;
    img.alt = '';
    return img;
  }
  const div = document.createElement('div');
  div.className = 'cover';
  let h = 0;
  for (const c of book.title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  div.style.background = COVER_COLORS[h % COVER_COLORS.length];
  div.textContent = book.title.trim().charAt(0).toUpperCase();
  return div;
}

function bookProgress(book, progress) {
  const p = progress.get(book.id);
  const read = p ? wordsBefore(book.wordCounts, p.chapter, p.word) : 0;
  const left = book.totalWords - read;
  const ms = (left * (book.avgFactor ?? 1.25) * 60000) / settings.wpm;
  return { pct: Math.min(100, Math.round((read / book.totalWords) * 100)), ms, started: !!p };
}

async function renderLibrary() {
  const [books, progressList, lastBackup] = await Promise.all([
    db.books(),
    db.allProgress(),
    db.getSetting('lastBackup', 0),
  ]);
  const progress = new Map(progressList.map((p) => [p.bookId, p]));
  books.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  const list = $('book-list');
  list.textContent = '';
  $('empty-library').hidden = books.length > 0;

  const stale = Date.now() - lastBackup > BACKUP_REMINDER_DAYS * 86400000;
  const oldEnough = books.some((b) => Date.now() - b.addedAt > 2 * 86400000);
  $('backup-reminder').hidden = !(books.length && stale && oldEnough);

  for (const book of books) {
    const { pct, ms, started } = bookProgress(book, progress);
    const li = document.createElement('li');
    li.className = 'book';
    const open = document.createElement('button');
    open.className = 'book-open';
    open.addEventListener('click', () => openBook(book));
    const text = document.createElement('div');
    text.className = 'book-text';
    const title = document.createElement('div');
    title.className = 'book-title';
    title.textContent = book.title;
    const author = document.createElement('div');
    author.className = 'book-author small muted ellipsis';
    author.textContent = book.author || book.format.toUpperCase();
    const bar = document.createElement('div');
    bar.className = 'book-progress';
    const fill = document.createElement('div');
    fill.style.width = `${pct}%`;
    bar.append(fill);
    const meta = document.createElement('div');
    meta.className = 'book-meta small muted';
    meta.textContent =
      pct >= 100 ? 'Finito' : `${started ? `${pct}% · ` : ''}${formatDuration(ms)} ${started ? 'rimanenti' : 'di lettura'}`;
    text.append(title, author, bar, meta);
    open.append(coverEl(book), text);

    const more = document.createElement('button');
    more.className = 'icon-btn more-btn';
    more.setAttribute('aria-label', `Opzioni per ${book.title}`);
    more.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
    more.addEventListener('click', () => {
      sheetBook = book;
      $('book-sheet-info').innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = book.title;
      const sub = document.createElement('div');
      sub.className = 'small muted';
      sub.textContent = `${book.totalWords.toLocaleString('it-IT')} parole · ${book.chapterTitles.length} capitoli`;
      $('book-sheet-info').append(strong, sub);
      openSheet('book-sheet');
    });
    li.append(open, more);
    list.append(li);
  }
}

async function addParsed({ meta, chapters }) {
  const existing = await db.findByFingerprint(meta.fingerprint);
  if (existing) {
    toast('Questo libro è già nella libreria.');
    return existing;
  }
  return db.addBook(meta, chapters);
}

async function handleFile(file) {
  if (!file) return;
  busy(`Importo “${file.name}”…`);
  try {
    const book = await addParsed(await importFile(file));
    busy(null);
    await renderLibrary();
    await openBook(book);
  } catch (e) {
    if (e.name !== 'ImportError') console.warn(e);
    busy(null);
    toast(e.name === 'ImportError' ? e.message : `Non sono riuscito a importare il file. (${e.message})`, 6000);
  }
}

// ---------- impostazioni ----------

function renderSettingsForm() {
  $('wpm-input').value = settings.wpm;
  $('wpm-out').textContent = settings.wpm;
  $('ramp-input').checked = settings.ramp;
  $('font-input').value = settings.fontSize;
  $('font-out').textContent = `${settings.fontSize} px`;
  $('theme-input').value = settings.theme;
}

async function renderStats() {
  const s = summarize(await db.sessions());
  const items = [
    [formatDuration(s.today.ms), 'letto oggi'],
    [formatDuration(s.week.ms), 'ultimi 7 giorni'],
    [formatDuration(s.total.ms), 'in totale'],
    [s.wpm ? `${s.wpm}` : '—', 'parole/min reali'],
    [s.today.words.toLocaleString('it-IT'), 'parole oggi'],
    [s.total.words.toLocaleString('it-IT'), 'parole in totale'],
  ];
  const box = $('stats');
  box.textContent = '';
  for (const [value, label] of items) {
    const d = document.createElement('div');
    const v = document.createElement('div');
    v.className = 'stat-value';
    v.textContent = value;
    const l = document.createElement('div');
    l.className = 'stat-label';
    l.textContent = label;
    d.append(v, l);
    box.append(d);
  }
  const last = await db.getSetting('lastBackup', 0);
  $('last-backup').textContent = last
    ? `Ultimo backup: ${new Date(last).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Nessun backup ancora.';
}

async function openSettings() {
  renderSettingsForm();
  await renderStats();
  showView('settings');
  history.pushState({ view: 'settings' }, '');
}

async function doExport() {
  busy('Preparo il backup…');
  try {
    const { blob, name, books } = await exportLibrary();
    busy(null);
    await saveFile(blob, name);
    await db.setSetting('lastBackup', Date.now());
    toast(`Backup creato: ${books} ${books === 1 ? 'libro' : 'libri'}.`);
    renderStats();
  } catch (e) {
    busy(null);
    if (e?.name !== 'AbortError') toast(`Backup non riuscito: ${e.message}`);
  }
}

// ---------- collegamenti ----------

function bind() {
  $('add-btn').addEventListener('click', () => openSheet('add-sheet'));
  $('sheet-backdrop').addEventListener('click', closeSheets);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));

  $('pick-file').addEventListener('click', () => {
    closeSheets();
    $('file-input').value = '';
    $('file-input').click();
  });
  $('file-input').addEventListener('change', (e) => handleFile(e.target.files[0]));

  $('paste-text').addEventListener('click', async () => {
    $('paste-title').value = '';
    $('paste-area').value = '';
    openSheet('paste-sheet');
    $('paste-area').focus();
  });
  $('paste-save').addEventListener('click', async () => {
    const text = $('paste-area').value;
    if (!text.trim()) return toast('Incolla prima del testo.');
    closeSheets();
    try {
      const book = await addParsed(await importPastedText(text, $('paste-title').value));
      await renderLibrary();
      await openBook(book);
    } catch (e) {
      toast(e.message);
    }
  });

  $('book-restart').addEventListener('click', async () => {
    closeSheets();
    await db.saveProgress(sheetBook.id, 0, 0);
    renderLibrary();
  });
  $('book-delete').addEventListener('click', async () => {
    const book = sheetBook;
    closeSheets();
    if (!confirm(`Eliminare “${book.title}” dalla libreria? Anche progressi e statistiche del libro verranno cancellati.`)) return;
    await db.deleteBook(book.id);
    toast('Libro eliminato.');
    renderLibrary();
  });

  $('toc-btn').addEventListener('click', () => {
    reader.engine.pause();
    reader.renderToc();
    openSheet('toc-sheet');
  });
  reader.onTocChosen = closeSheets;

  $('open-settings').addEventListener('click', openSettings);
  $('settings-back').addEventListener('click', () => history.back());
  $('reminder-backup').addEventListener('click', doExport);

  $('wpm-input').addEventListener('input', (e) => {
    settings.wpm = Number(e.target.value);
    $('wpm-out').textContent = settings.wpm;
    saveSettings();
  });
  $('ramp-input').addEventListener('change', (e) => {
    settings.ramp = e.target.checked;
    saveSettings();
  });
  $('font-input').addEventListener('input', (e) => {
    settings.fontSize = Number(e.target.value);
    $('font-out').textContent = `${settings.fontSize} px`;
    applyTheme();
    saveSettings();
  });
  $('theme-input').addEventListener('change', (e) => {
    settings.theme = e.target.value;
    applyTheme();
    saveSettings();
  });

  $('export-btn').addEventListener('click', doExport);
  $('import-btn').addEventListener('click', () => {
    $('backup-input').value = '';
    $('backup-input').click();
  });
  $('backup-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    busy('Importo il backup…');
    try {
      const { added, progress } = await importLibrary(file);
      toast(`Backup importato: ${added} ${added === 1 ? 'libro nuovo' : 'libri nuovi'}, ${progress} progressi aggiornati.`);
      renderStats();
    } catch (err) {
      toast(err.message);
    } finally {
      busy(null);
    }
  });
  $('clear-btn').addEventListener('click', async () => {
    if (!confirm('Cancellare tutti i libri, i progressi e le statistiche da questo dispositivo? Non si può annullare.')) return;
    await db.clearAll();
    settings = { ...DEFAULTS };
    applyTheme();
    renderSettingsForm();
    renderStats();
    toast('Dati cancellati.');
  });
}

// ---------- avvio ----------

async function start() {
  settings = { ...DEFAULTS, ...(await db.getSetting('settings', {})) };
  applyTheme();
  reader = new ReaderView({
    settings,
    saveSettings: () => saveSettings(),
    onExit: () => history.back(),
    toast,
  });
  bind();
  // Quando si torna dalle impostazioni, il lettore usa i valori nuovi.
  window.addEventListener('popstate', () => reader.applySettings(settings));
  history.replaceState({ view: 'library' }, '');
  await renderLibrary();
  requestPersistence();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
  }
}

start().catch((e) => {
  console.error(e);
  toast(`Errore all'avvio: ${e.message}`, 10000);
});
