// Test end-to-end: apre l'app in Chromium con l'aspetto di un iPhone e prova i percorsi principali.
// Uso: npm run test:e2e   (serve Playwright: npm i -D playwright && npx playwright install chromium)

const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8000 + Math.floor(Math.random() * 1000);
const URL_ = `http://localhost:${PORT}/`;

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 4).join('\n     ')}`);
  }
}

function serve() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  return new Promise((resolve) => setTimeout(() => resolve(p), 800));
}

// ---------- file di prova, creati nel browser con JSZip ----------

async function makeEpub(page, { drm = false } = {}) {
  return page.evaluate(async (drm) => {
    await import('./src/import/vendor.js').then((m) => m.getJSZip());
    const zip = new window.JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    if (drm) {
      zip.file(
        'META-INF/encryption.xml',
        `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/c1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`,
      );
    }
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Il libro di prova</dc:title><dc:creator>Ada Autrice</dc:creator><meta name="cover" content="cov"/></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cov" href="img/cover.svg" media-type="image/svg+xml" properties="cover-image"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/><item id="c1b" href="text/c1b.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c1b"/><itemref idref="c2"/></spine></package>`,
    );
    zip.file(
      'OEBPS/nav.xhtml',
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/c1.xhtml">Uno: la partenza</a></li><li><a href="text/c2.xhtml#top">Due: il ritorno</a></li></ol></nav></body></html>`,
    );
    zip.file('OEBPS/img/cover.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="60" height="90" fill="teal"/></svg>`);
    const words = (n, seed) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');
    zip.file(
      'OEBPS/text/c1.xhtml',
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title><style>p{}</style></head><body><h1>Capitolo uno</h1><p>Era una notte <em>buia</em> e tempestosa.<a epub:type="noteref" href="#n1">1</a> Il vento soffiava.</p><p>${words(300, 'a')}.</p></body></html>`,
    );
    zip.file(
      'OEBPS/text/c1b.xhtml',
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Seguito del primo capitolo.</p></body></html>`,
    );
    zip.file(
      'OEBPS/text/c2.xhtml',
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h2 id="top">Due</h2><p>Il ritorno fu lungo, molto lungo.</p><p>Fine.</p></body></html>`,
    );
    const blob = await zip.generateAsync({ type: 'uint8array' });
    return Array.from(blob);
  }, drm);
}

async function makeDocx(page) {
  return page.evaluate(async () => {
    const zip = new window.JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    );
    zip.file(
      '_rels/.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    );
    zip.file(
      'word/styles.xml',
      `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    );
    const p = (t, style) =>
      `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    zip.file(
      'word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('Introduzione', 'Heading1')}${p('Questo è un documento Word.')}${p('Metodo', 'Heading1')}${p('Secondo capitolo del documento.')}</w:body></w:document>`,
    );
    return Array.from(await zip.generateAsync({ type: 'uint8array' }));
  });
}

async function makePdf(browser) {
  const page = await browser.newPage();
  const para = (seed) =>
    Array.from({ length: 120 }, (_, i) => `parola${seed}${i}`).join(' ') + '.';
  await page.setContent(`<html><body style="font: 14px serif; margin: 40px">
    <h1>Primo capitolo</h1><p>${para('a')}</p><p>Secondo para-</p>
    <h1 style="page-break-before: always">Secondo capitolo</h1><p>${para('b')}</p></body></html>`);
  const buf = await page.pdf({ format: 'A5', outline: true, tagged: true });
  await page.close();
  return buf;
}

// ---------- aiuti ----------

async function upload(page, name, buffer, mimeType = 'application/octet-stream') {
  await page.locator('#file-input').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
}

async function readerState(page) {
  return page.evaluate(() => {
    const w = document.getElementById('word').textContent;
    return {
      word: w,
      book: document.getElementById('reader-book').textContent,
      chapter: document.getElementById('reader-chapter').textContent,
      context: document.getElementById('context').innerText,
      readerVisible: !document.getElementById('reader').hidden,
      toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
    };
  });
}

async function backToLibrary(page) {
  await page.click('#back-btn');
  await page.waitForSelector('#library:not([hidden])');
}

// ---------- test ----------

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-e2e-'));
  const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  try {
    await page.goto(URL_);

    await step('libreria vuota all\'avvio', async () => {
      await page.waitForSelector('#empty-library:not([hidden])');
    });

    await step('import EPUB: titolo, capitoli dall\'indice, niente titoli o note lette', async () => {
      await upload(page, 'prova.epub', await makeEpub(page), 'application/epub+zip');
      await page.waitForSelector('#reader:not([hidden])');
      const s = await readerState(page);
      assert.equal(s.book, 'Il libro di prova');
      assert.ok(await page.evaluate(async () => {
        const { db } = await import('./src/storage/db.js');
        return (await db.books())[0].cover?.startsWith('data:image/jpeg');
      }), 'copertina salvata');
      assert.equal(s.chapter, 'Uno: la partenza');
      assert.equal(s.word, 'Era');
      assert.match(s.context, /Era una notte buia e tempestosa\. Il vento soffiava\./);
      assert.doesNotMatch(s.context, /Capitolo uno/);
    });

    await step('lettura: play, avanza, pausa, sessione salvata', async () => {
      await page.click('#play-btn');
      await page.waitForTimeout(1500);
      assert.ok(await page.evaluate(() => document.getElementById('reader').classList.contains('reader-playing')));
      assert.equal(await page.isHidden('#context'), true);
      await page.click('#play-btn');
      const s = await readerState(page);
      assert.notEqual(s.word, 'Era', 'deve essere andato avanti');
      assert.match(s.context, /\S/);
      const sessions = await page.evaluate(async () => (await import('./src/storage/db.js')).db.sessions());
      assert.equal(sessions.length, 1);
      assert.ok(sessions[0].words > 2, `parole lette: ${sessions[0].words}`);
    });

    await step('tocco su una parola del contesto per ripartire da lì', async () => {
      await page.locator('#context span', { hasText: /^soffiava\.$/ }).click();
      assert.equal((await readerState(page)).word, 'soffiava.');
    });

    await step('gesti: scorri su = più veloce, tocco = play/pausa', async () => {
      const before = await page.evaluate(() => document.getElementById('wpm-label').textContent);
      const box = await page.locator('#stage').boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy + 40);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 40, { steps: 5 });
      await page.mouse.up();
      const after = await page.evaluate(() => document.getElementById('wpm-label').textContent);
      assert.equal(parseInt(after), parseInt(before) + 10);
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.getElementById('reader').classList.contains('reader-playing')));
      await page.mouse.click(cx, cy);
      assert.ok(await page.evaluate(() => document.getElementById('reader').classList.contains('reader-paused')));
    });

    await step('il capitolo diviso in due file resta unito', async () => {
      const text = await page.evaluate(async () => {
        const { db } = await import('./src/storage/db.js');
        const [book] = await db.books();
        return (await db.text(book.id)).chapters.map((c) => [c.title, c.paragraphs.length]);
      });
      assert.deepEqual(text, [
        ['Uno: la partenza', 3],
        ['Due: il ritorno', 2],
      ]);
    });

    await step('indice dei capitoli', async () => {
      await page.click('#toc-btn');
      await page.click('#toc-list button[data-chapter="1"]');
      const s = await readerState(page);
      assert.equal(s.chapter, 'Due: il ritorno');
      assert.equal(s.word, 'Il');
      assert.ok(await page.isHidden('#toc-sheet'));
      await page.click('#toc-btn');
      await page.click('#toc-list button[data-chapter="0"]');
      await page.locator('#context span', { hasText: /^soffiava\.$/ }).click();
    });

    await step('ripresa dopo la ricarica della pagina', async () => {
      await page.waitForTimeout(300); // lascia finire il salvataggio
      await page.reload();
      await page.waitForSelector('.book');
      const meta = await page.locator('.book-meta').first().textContent();
      assert.match(meta, /%/);
      await page.click('.book-open');
      await page.waitForSelector('#reader:not([hidden])');
      assert.equal((await readerState(page)).word, 'soffiava.');
      await backToLibrary(page);
    });

    await step('stesso libro due volte: niente doppione', async () => {
      await upload(page, 'prova.epub', await makeEpub(page));
      await page.waitForSelector('#reader:not([hidden])');
      await backToLibrary(page);
      assert.equal(await page.locator('.book').count(), 1);
    });

    await step('EPUB con DRM: messaggio chiaro', async () => {
      await upload(page, 'drm.epub', await makeEpub(page, { drm: true }));
      await page.waitForSelector('#toast:not([hidden])');
      assert.match((await readerState(page)).toast, /DRM/);
      assert.equal(await page.isVisible('#library'), true);
    });

    await step('file Kindle: messaggio chiaro', async () => {
      await upload(page, 'libro.azw3', Buffer.from('qualcosa'));
      await page.waitForFunction(() => /Kindle/.test(document.getElementById('toast').textContent));
    });

    await step('TXT in codifica Windows con capitoli', async () => {
      const latin1 = Buffer.from('CAPITOLO I\r\n\r\nPerch\xe9 no?\r\n\r\nCAPITOLO II\r\n\r\nCos\xec sia.', 'latin1');
      await upload(page, 'vecchio_testo.txt', latin1, 'text/plain');
      await page.waitForSelector('#reader:not([hidden])');
      const s = await readerState(page);
      assert.equal(s.book, 'vecchio testo');
      assert.equal(s.chapter, 'CAPITOLO I');
      assert.match(s.context, /Perché no\?/);
      await backToLibrary(page);
    });

    await step('DOCX con titoli come capitoli', async () => {
      await upload(page, 'relazione.docx', await makeDocx(page));
      await page.waitForSelector('#reader:not([hidden])');
      const s = await readerState(page);
      assert.equal(s.chapter, 'Introduzione');
      assert.match(s.context, /Questo è un documento Word\./);
      await backToLibrary(page);
    });

    await step('PDF: testo, segnalibri come capitoli, parole spezzate', async () => {
      await upload(page, 'documento.pdf', await makePdf(browser), 'application/pdf');
      await page.waitForSelector('#reader:not([hidden])', { timeout: 20000 });
      const s = await readerState(page);
      assert.equal(s.chapter, 'Primo capitolo');
      assert.match(s.context, /parolaa0 parolaa1/);
      const chapters = await page.evaluate(async () => {
        const { db } = await import('./src/storage/db.js');
        const book = (await db.books()).find((b) => b.format === 'pdf');
        return (await db.text(book.id)).chapters;
      });
      assert.deepEqual(chapters.map((c) => c.title), ['Primo capitolo', 'Secondo capitolo']);
      await backToLibrary(page);
    });

    await step('testo incollato', async () => {
      await page.click('#add-btn');
      await page.click('#paste-text');
      await page.fill('#paste-area', 'Un articolo incollato al volo. Seconda frase qui.');
      await page.click('#paste-save');
      await page.waitForSelector('#reader:not([hidden])');
      const s = await readerState(page);
      assert.equal(s.book, 'Un articolo incollato al volo. Seconda frase…');
      assert.equal(s.word, 'Un');
      await backToLibrary(page);
      assert.equal(await page.locator('.book').count(), 5);
    });

    await step('statistiche nelle impostazioni', async () => {
      await page.click('#open-settings');
      await page.waitForSelector('#settings:not([hidden])');
      const stats = await page.locator('#stats').innerText();
      assert.match(stats, /letto oggi/);
      assert.match(stats, /parole oggi/);
    });

    await step('backup: esporta, cancella tutto, reimporta', async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
      const file = path.join(downloads, download.suggestedFilename());
      await download.saveAs(file);
      assert.match(download.suggestedFilename(), /^libreria-rsvp-\d{4}-\d{2}-\d{2}\.rsvp$/);
      page.once('dialog', (d) => d.accept());
      await page.click('#clear-btn');
      await page.waitForFunction(() => /cancellati/.test(document.getElementById('toast').textContent));
      await page.locator('#backup-input').setInputFiles(file);
      await page.waitForFunction(() => /Backup importato: 5 libri nuovi/.test(document.getElementById('toast').textContent));
      await page.click('#settings-back');
      await page.waitForSelector('#library:not([hidden])');
      assert.equal(await page.locator('.book').count(), 5);
      const epub = page.locator('.book', { hasText: 'Il libro di prova' });
      await epub.locator('.book-open').click();
      await page.waitForSelector('#reader:not([hidden])');
      assert.equal((await readerState(page)).word, 'soffiava.', 'progresso ripristinato');
      await backToLibrary(page);
    });

    await step('funziona offline dopo la prima visita', async () => {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload(); // ora la pagina è controllata dal service worker
      await page.waitForSelector('.book');
      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector('.book');
      await page.locator('.book', { hasText: 'documento' }).locator('.book-open').click();
      await page.waitForSelector('#reader:not([hidden])');
      await backToLibrary(page);
      // anche le librerie caricate su richiesta sono in cache
      const ok = await page.evaluate(async () => {
        const m = await import('./src/import/vendor.js');
        await m.getPdfjs();
        await m.getMammoth();
        return true;
      });
      assert.ok(ok);
      await context.setOffline(false);
    });

    await step('elimina un libro', async () => {
      page.once('dialog', (d) => d.accept());
      await page.locator('.book', { hasText: 'Un articolo' }).locator('.more-btn').click();
      await page.click('#book-delete');
      await page.waitForFunction(() => document.querySelectorAll('.book').length === 4);
    });

    await step('screenshot', async () => {
      await page.screenshot({ path: path.join(downloads, 'library.png') });
      await page.locator('.book', { hasText: 'Il libro di prova' }).locator('.book-open').click();
      await page.waitForSelector('#reader:not([hidden])');
      await page.screenshot({ path: path.join(downloads, 'reader-paused.png') });
      await page.click('#play-btn');
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(downloads, 'reader-playing.png') });
      await page.click('#play-btn');
      console.log(`     screenshot in ${downloads}`);
    });

    await step('nessun errore in console', async () => {
      assert.deepEqual(errors, [], errors.join('\n'));
    });
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} test falliti` : '\nTutti i test end-to-end sono passati');
  process.exit(failures ? 1 : 0);
})();
