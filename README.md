# RSVP Reader

Lettore veloce per iPhone (e per qualsiasi browser): mostra **una parola alla volta** in un punto fisso, con la
lettera di fissazione in rosso, così l'occhio non deve mai spostarsi.

- Carica **EPUB, PDF, DOCX e TXT**, oppure **incolla del testo**.
- **Velocità** da 100 a 1200 parole al minuto, con pause più lunghe su punteggiatura, parole lunghe e cambi di paragrafo.
- **Accelerazione graduale**: parte al 60 % e arriva alla velocità scelta in 3 secondi.
- **Contesto in pausa**: vedi il paragrafo intorno e tocchi una parola per ripartire da lì.
- **Libreria** con copertine, progressi e tempo rimanente; **indice dei capitoli**.
- **Statistiche**: tempo letto oggi, negli ultimi 7 giorni e in totale, parole al minuto reali.
- **Funziona offline** e **i libri non lasciano mai il telefono**: niente server, niente account.
- **Backup** della libreria in un file da salvare su File o iCloud Drive.

## Comandi

| Gesto | Azione |
|---|---|
| Tocco sulla parola | Leggi / pausa |
| Scorri in su / in giù | Velocità +25 / −25 parole al minuto |
| Scorri a sinistra / a destra | Frase precedente / successiva |
| Tocco su una parola del contesto (in pausa) | Riparti da quella parola |

Sul computer: spazio = leggi/pausa, ←/→ = frasi, ↑/↓ = velocità, Esc = torna alla libreria.

## Kindle e DRM

I libri comprati su Kindle sono protetti da DRM e Amazon non offre un modo per collegarli ad app esterne, quindi qui
non si possono aprire (i file .azw, .azw3, .kfx e .mobi vengono riconosciuti e rifiutati con un messaggio chiaro).
Funzionano tutti i libri **senza DRM**, per esempio da
[Liber Liber](https://www.liberliber.it), [Project Gutenberg](https://www.gutenberg.org),
[Standard Ebooks](https://standardebooks.org) o dagli editori che vendono EPUB senza DRM.

## Pubblicare su GitHub Pages

1. Su GitHub apri il repository → **Settings** → **Pages**.
2. In **Build and deployment** scegli **Source: Deploy from a branch**, branch **main**, cartella **/ (root)**, e salva.
3. Dopo un minuto l'app è su `https://<tuo-utente>.github.io/rsvp-reader/`.

## Installare sull'iPhone

1. Apri l'indirizzo in **Safari**.
2. Tocca **Condividi** → **Aggiungi alla schermata Home**.
3. Apri l'app dall'icona: va a schermo intero e funziona anche offline.

I dati stanno nella memoria di Safari per quell'app. iOS può cancellarli se non apri l'app per settimane: ogni
tanto usa **Impostazioni → Esporta libreria** (l'app te lo ricorda dopo 14 giorni senza backup).

## Sviluppo

Niente build: sono moduli JavaScript serviti così come sono.

```sh
npm run serve        # http://localhost:8080
npm test             # test della logica (node --test)
npm run test:e2e     # test end-to-end in Chromium con un iPhone emulato (richiede Playwright)
```

Struttura:

```
index.html, styles.css    interfaccia (Libreria, Lettore, Impostazioni)
sw.js                     service worker per l'uso offline
src/app.js                avvio, libreria, impostazioni, importazione
src/reader/               engine.js (tempi e posizione), view.js (schermo e gesti)
src/text/                 tokenize.js (parole e pause), orp.js (lettera di fissazione)
src/import/               un modulo per formato: epub, pdf, docx, text
src/storage/              db.js (IndexedDB), backup.js, merge.js
src/stats.js              statistiche
vendor/                   JSZip, pdf.js, mammoth (copiati qui per l'uso offline)
docs/                     documento di design
```

**Quando cambi un file**, aumenta `VERSION` in `sw.js`: altrimenti i telefoni continuano a usare la versione in
cache. Se aggiungi un file, aggiungilo anche alla lista `FILES` (un test controlla che non manchi niente).

## Licenze delle librerie incluse

JSZip (MIT/GPLv3), pdf.js (Apache 2.0), mammoth (BSD-2): vedi i file `vendor/LICENSE-*`.
