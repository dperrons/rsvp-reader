# RSVP Reader — design

Data: 2026-11-02

## Obiettivo

Un lettore RSVP (una parola alla volta in un punto fisso) da usare soprattutto su **iPhone**, installato sulla
schermata Home da Safari, ospitato su **GitHub Pages** da questo repo pubblico. Si caricano libri e documenti
(EPUB, PDF, DOCX, TXT) o si incolla del testo, e li si legge velocemente.

**Successo:** carico un EPUB dal telefono, lo leggo a 400+ parole al minuto, chiudo l'app, la riapro e riprendo
esattamente da dove ero, anche senza connessione.

### Vincoli

- Nessun backend: i libri non lasciano mai il telefono.
- Funziona offline (librerie copiate in `vendor/`, service worker).
- Kindle non è collegabile: i libri Kindle sono protetti da DRM, e Amazon non offre un'API pubblica. Si leggono
  solo libri senza DRM.
- Niente link: solo testo incollato (un servizio di estrazione esterno vedrebbe gli URL).
- Interfaccia in italiano, tema scuro e chiaro.

## 1. Struttura

JavaScript semplice con moduli ES, senza build.

```
index.html, styles.css, manifest.webmanifest, sw.js, icons/
vendor/            JSZip, pdf.js, mammoth (copiati qui per l'uso offline)
src/app.js         passaggio tra le schermate Libreria / Lettore / Impostazioni
src/import/        un modulo per formato → { title, author, cover, chapters: [{ title, paragraphs: [string] }] }
src/text/          tokenize.js (parole + pause), orp.js (lettera di fissazione)
src/reader/        engine.js (tempi, accelerazione, posizione), view.js (schermo e gesti)
src/storage/       db.js (IndexedDB), backup.js (export/import)
src/stats.js       parole al minuto reali, tempo letto, tempo rimanente
tests/             test `node --test` sulla logica pura + test end-to-end Playwright
```

Gli importatori non conoscono il lettore; il motore riceve solo una lista di parole; la memoria non sa come si
mostra il testo.

## 2. Lettura

- **Lettera di fissazione** (ORP) in rosso, sempre nello stesso punto, segnato da due tacche. Indice: 0 per 1
  lettera, 1 per 2–5, 2 per 6–9, 3 per 10–13, 4 oltre.
- **Durata** = 60000 / wpm, moltiplicata per: ×2 fine frase (. ! ? …), ×1,5 pausa breve (, ; : — parentesi),
  ×1,3 parole ≥ 8 lettere, ×1,6 ≥ 12, ×1,2 numeri e maiuscole interne, ×3 sulla prima parola di un nuovo
  paragrafo (preceduta da un vuoto). I moltiplicatori di punteggiatura e lunghezza si combinano prendendo il massimo
  della punteggiatura e moltiplicando per quello della lunghezza.
- **Accelerazione graduale**: dal 60 % al 100 % in 3 secondi, alla partenza e dopo ogni pausa (disattivabile).
- **Comandi**: tocco al centro = play/pausa; scorrimento su/giù = ±10 wpm; sinistra = frase precedente, destra =
  frase successiva. Barra di avanzamento del capitolo e tempo rimanente in basso.
- **Contesto in pausa**: paragrafo precedente, corrente e successivo con la parola corrente evidenziata; tocco su
  una parola = ripartire da lì; accesso all'indice dei capitoli.

## 3. Importazione e salvataggio

| Formato | Lettura | Capitoli |
|---|---|---|
| EPUB | container.xml → OPF → spine; paragrafi dai blocchi XHTML; titolo, autore, copertina; salta note e licenza di Gutenberg | nav / NCX, anche più capitoli nello stesso file (ancore `#id`) |
| PDF | pdf.js, testo per pagina, paragrafi dalle distanze tra righe, rimozione intestazioni/numeri ripetuti, ricongiunzione delle parole spezzate | segnalibri del PDF (pagina e altezza), altrimenti blocchi di 20 pagine |
| DOCX | mammoth → HTML | titoli |
| TXT | UTF-8, ripiego windows-1252 | righe "Capitolo N" / "CAPITOLO III" |
| Testo incollato | come TXT | nessuno |

Errori chiari per: EPUB con DRM (`META-INF/encryption.xml` con risorse cifrate che non siano solo font
offuscati), file Kindle (.azw, .azw3, .kfx, .mobi, .prc), PDF senza testo, file vuoti o non riconosciuti.

IndexedDB `rsvp-reader`, store: `books` (metadati + copertina), `texts` (capitoli, caricati solo all'apertura),
`progress` (capitolo, parola, data), `sessions` (inizio, durata attiva, parole), `settings`. Progresso salvato ogni
5 s, alla pausa e su `visibilitychange`. All'avvio `navigator.storage.persist()`.

**Backup**: "Esporta libreria" crea un file `.rsvp` (JSON compresso gzip); "Importa libreria" unisce,
tenendo per ogni libro il progresso più avanti. Promemoria in Libreria se l'ultimo backup ha più di 14 giorni
(e c'è almeno un libro).

## 4. Statistiche, impostazioni, offline, test, pubblicazione

- **Statistiche** per sessione: parole lette / tempo effettivo di riproduzione = wpm reali. Globali: oggi, ultimi
  7 giorni, totale, wpm reali. Schermata "Statistiche" nelle Impostazioni.
- **Tempo rimanente** (capitolo e libro): parole rimanenti × durata media di una parola del libro (pause comprese,
  calcolata all'importazione) alla velocità impostata. È più preciso della media storica e segue subito i cambi
  di velocità.
- **Impostazioni**: velocità predefinita (100–1200), accelerazione sì/no, dimensione carattere, tema
  (automatico/scuro/chiaro), export/import, cancellazione dei dati.
- **Offline**: `sw.js` mette in cache l'intera app alla prima visita (cache con versione), risponde cache-first,
  aggiorna alla versione nuova.
- **iOS**: meta `apple-mobile-web-app-capable`, `apple-touch-icon` 180 px, `viewport-fit=cover` con safe area,
  niente zoom accidentale sui doppi tocchi.
- **Test**: `node --test` su tokenize, ORP, motore (tempi e posizione), TXT, PDF, statistiche, unione dei backup,
  lista dei file del service worker; Playwright (Chromium con iPhone emulato) su importazione di EPUB, PDF, DOCX,
  TXT e testo incollato, DRM, lettura, gesti, capitoli, ripresa, backup, offline.
- **Pubblicazione**: GitHub Pages dal branch `main`, cartella radice (`.nojekyll`).

## Fuori dallo scopo

Sincronizzazione tra dispositivi, OCR, link agli articoli, evidenziazioni Kindle, più parole per volta.
