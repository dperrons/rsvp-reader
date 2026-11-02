// Service worker: tiene in cache tutta l'app per usarla offline.
// Ogni volta che cambi un file, aumenta VERSION così i telefoni scaricano la versione nuova.

const VERSION = 'v1';
const CACHE = `rsvp-reader-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/app.js',
  'src/stats.js',
  'src/text/orp.js',
  'src/text/tokenize.js',
  'src/reader/engine.js',
  'src/reader/view.js',
  'src/storage/db.js',
  'src/storage/backup.js',
  'src/storage/merge.js',
  'src/import/index.js',
  'src/import/errors.js',
  'src/import/vendor.js',
  'src/import/html.js',
  'src/import/text.js',
  'src/import/epub.js',
  'src/import/pdf.js',
  'src/import/docx.js',
  'vendor/jszip.min.js',
  'vendor/mammoth.browser.min.js',
  'vendor/pdf.min.mjs',
  'vendor/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rsvp-reader-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
