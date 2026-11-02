// PDF → { title, author, coverBlob, chapters }

import { getPdfjs } from './vendor.js';
import { ImportError, MESSAGES } from './errors.js';

const CHUNK_PAGES = 20;

/** Righe di una pagina: { text, y, x, height, width } dall'alto verso il basso. */
function pageLines(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    if (!cur || Math.abs(y - cur.y) > h * 0.5) {
      if (cur) lines.push(cur);
      cur = { text: '', y, x, height: h, right: x };
    }
    if (cur.text && !/\s$/.test(cur.text) && !/^\s/.test(it.str) && x - cur.right > h * 0.15) cur.text += ' ';
    cur.text += it.str;
    cur.right = Math.max(cur.right, x + (it.width || 0));
    cur.height = Math.max(cur.height, h);
    if (it.hasEOL) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim(), width: l.right - l.x }))
    .filter((l) => l.text);
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const normalizeRepeated = (t) => t.replace(/\d+/g, '#').toLowerCase();

/** Righe ripetute in cima o in fondo a molte pagine (titolo corrente, numeri di pagina). */
function findRepeated(pages) {
  if (pages.length < 4) return new Set();
  const counts = new Map();
  for (const lines of pages) {
    const edge = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => normalizeRepeated(l.text)));
    for (const t of edge) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= Math.max(3, pages.length * 0.3)).map(([t]) => t));
}

function joinLine(paragraph, line) {
  if (!paragraph) return line;
  // parola spezzata col trattino a fine riga
  if (/\p{L}-$/u.test(paragraph) && /^\p{Ll}/u.test(line)) return paragraph.slice(0, -1) + line;
  return `${paragraph} ${line}`;
}

/** Ricostruisce i paragrafi di tutte le pagine. Restituisce anche pagina e altezza d'inizio di ognuno. */
export function buildParagraphs(pages) {
  const repeated = findRepeated(pages);
  const paragraphs = [];
  const startPage = [];
  const startY = [];
  let current = '';
  let currentPage = 0;
  let currentY = 0;
  const flush = () => {
    if (current.trim()) {
      paragraphs.push(current.trim());
      startPage.push(currentPage);
      startY.push(currentY);
    }
    current = '';
  };

  pages.forEach((all, pageIndex) => {
    const lines = all.filter((l, k) => {
      const edge = k < 2 || k >= all.length - 2;
      if (edge && repeated.has(normalizeRepeated(l.text))) return false;
      if (edge && /^[-–—\s]*(\d+|[ivxlcdm]+)[-–—\s]*$/i.test(l.text)) return false; // numero di pagina
      return true;
    });
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
    const lineGap = median(gaps.filter((g) => g > 0)) || 14;
    const fullWidth = median(lines.map((l) => l.width));
    const left = median(lines.map((l) => l.x));

    lines.forEach((line, i) => {
      if (i > 0) {
        const prev = lines[i - 1];
        const gap = prev.y - line.y;
        const prevShort = prev.width < fullWidth * 0.8 && /[.!?…:»”"]$/.test(prev.text);
        const indented = line.x - left > line.height * 0.8 && Math.abs(prev.x - left) < line.height * 0.5;
        if (gap > lineGap * 1.45 || gap < 0 || prevShort || (indented && /[.!?…:»”"]$/.test(prev.text))) flush();
      } else if (current && /[.!?…»”"]$/.test(current)) {
        // a inizio pagina: continua il paragrafo solo se la frase era rimasta a metà
        flush();
      }
      if (!current) {
        currentPage = pageIndex;
        currentY = line.y;
      }
      current = joinLine(current, line.text);
    });
  });
  flush();
  return { paragraphs, startPage, startY };
}

async function outlinePages(doc) {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline || outline.length < 2) return null;
  const out = [];
  for (const item of outline) {
    try {
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
      if (!dest) continue;
      const page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
      // destinazione "XYZ": [pagina, {name}, sinistra, alto, zoom] → altezza a cui inizia la sezione
      const y = dest[1]?.name === 'XYZ' && typeof dest[3] === 'number' ? dest[3] : null;
      out.push({ title: item.title.trim() || `Pagina ${page + 1}`, page, y });
    } catch {
      /* voce dell'indice non risolvibile: la salto */
    }
  }
  out.sort((a, b) => a.page - b.page || (b.y ?? Infinity) - (a.y ?? Infinity));
  return out.length >= 2 ? out : null;
}

/** Il paragrafo i inizia dove inizia la sezione `mark`, o dopo? (Nei PDF la y cresce verso l'alto.) */
function startsAtOrAfter(i, mark, startPage, startY) {
  if (startPage[i] !== mark.page) return startPage[i] > mark.page;
  return mark.y == null || startY == null || startY[i] <= mark.y + 2;
}

export function splitChapters(paragraphs, startPage, outline, pageCount, startY = null) {
  const marks = outline ? [...outline] : [];
  if (marks.length && (marks[0].page > 0 || (marks[0].y != null && startY && startY[0] > marks[0].y + 2))) {
    marks.unshift({ title: 'Inizio', page: 0, y: null });
  }
  if (!marks.length) {
    for (let p = 0; p < pageCount; p += CHUNK_PAGES) {
      marks.push({ title: `Pagine ${p + 1}–${Math.min(pageCount, p + CHUNK_PAGES)}`, page: p });
    }
  }
  const chapters = marks.map((m) => ({ title: m.title, paragraphs: [] }));
  let c = 0;
  paragraphs.forEach((text, i) => {
    while (c + 1 < marks.length && startsAtOrAfter(i, marks[c + 1], startPage, startY)) c++;
    chapters[c].paragraphs.push(text);
  });
  return chapters.filter((ch) => ch.paragraphs.length);
}

async function renderCover(doc) {
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = 240 / viewport.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}

export async function parsePdf(buffer, fallbackTitle) {
  const pdfjs = await getPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new ImportError('Questo PDF è protetto da password.');
    throw new ImportError(MESSAGES.broken);
  }
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(pageLines(content.items));
    page.cleanup();
  }
  const { paragraphs, startPage, startY } = buildParagraphs(pages);
  const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
  if (words < 5) throw new ImportError(MESSAGES.pdfNoText);

  const meta = await doc.getMetadata().catch(() => null);
  const title = meta?.info?.Title?.trim() || fallbackTitle;
  const author = meta?.info?.Author?.trim() || '';
  const chapters = splitChapters(paragraphs, startPage, await outlinePages(doc), doc.numPages, startY);
  const coverBlob = await renderCover(doc);
  await doc.destroy();
  return { title, author, coverBlob, chapters };
}
