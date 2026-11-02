// Punto d'ingresso dell'importazione: riconosce il formato e restituisce un libro pronto da salvare.

import { decodeText, parsePlainText, titleFromText } from './text.js';
import { ImportError, MESSAGES } from './errors.js';
import { tokenizeChapter } from '../text/tokenize.js';

const KINDLE_EXT = /\.(azw\d?|kfx|mobi|prc|tpz)$/i;

function startsWith(bytes, text, offset = 0) {
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function detectFormat(name, bytes) {
  if (KINDLE_EXT.test(name) || startsWith(bytes, 'BOOKMOBI', 60) || startsWith(bytes, 'TPZ')) return 'kindle';
  if (startsWith(bytes, '%PDF')) return 'pdf';
  if (startsWith(bytes, 'PK')) {
    if (/\.docx$/i.test(name)) return 'docx';
    if (/\.epub$/i.test(name)) return 'epub';
    // zip senza estensione chiara: l'EPUB inizia con il file "mimetype"
    const head = new TextDecoder().decode(bytes.slice(0, 120));
    if (head.includes('application/epub+zip')) return 'epub';
    if (head.includes('[Content_Types].xml') || head.includes('word/')) return 'docx';
    return 'unknown';
  }
  if (/\.(txt|text|md|markdown)$/i.test(name)) return 'txt';
  // testo senza estensione: niente byte nulli nelle prime righe
  if (bytes.length && !bytes.slice(0, 4096).includes(0)) return 'txt';
  return 'unknown';
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Senza titolo';
}

/** Copertina ridotta a miniatura JPEG (data URL), per non occupare spazio. Funziona anche con SVG. */
async function thumbnail(blob) {
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 240;
    const h = img.naturalHeight || 360;
    const scale = Math.min(1, 240 / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function finish(parsed, format) {
  const chapters = parsed.chapters
    .map((c) => ({ title: c.title.slice(0, 200), paragraphs: c.paragraphs.filter((p) => p.trim()) }))
    .filter((c) => c.paragraphs.length);
  let weight = 0;
  const wordCounts = chapters.map((c) => {
    const words = tokenizeChapter(c.paragraphs);
    for (const w of words) weight += w.factor + w.gap;
    return words.length;
  });
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  if (totalWords === 0) throw new ImportError(MESSAGES.empty);
  const title = parsed.title.trim() || 'Senza titolo';
  const author = parsed.author?.trim() ?? '';
  return {
    meta: {
      title,
      author,
      format,
      cover: await thumbnail(parsed.coverBlob),
      chapterTitles: chapters.map((c) => c.title),
      wordCounts,
      totalWords,
      avgFactor: totalWords ? weight / totalWords : 1.25, // durata media di una parola, pause comprese
      fingerprint: `${title.toLowerCase()}|${author.toLowerCase()}|${totalWords}`,
    },
    chapters,
  };
}

/** @param {File} file */
export async function importFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const format = detectFormat(file.name, bytes);
  const fallback = baseName(file.name);
  switch (format) {
    case 'kindle':
      throw new ImportError(MESSAGES.kindle);
    case 'epub': {
      const { parseEpub } = await import('./epub.js');
      return finish(await parseEpub(buffer, fallback), format);
    }
    case 'pdf': {
      const { parsePdf } = await import('./pdf.js');
      return finish(await parsePdf(buffer, fallback), format);
    }
    case 'docx': {
      const { parseDocx } = await import('./docx.js');
      return finish(await parseDocx(buffer, fallback), format);
    }
    case 'txt':
      return finish(parsePlainText(decodeText(buffer), fallback), format);
    default:
      throw new ImportError(MESSAGES.unknown);
  }
}

export async function importPastedText(text, title) {
  const t = title?.trim() || titleFromText(text);
  return finish(parsePlainText(text, t), 'testo');
}
