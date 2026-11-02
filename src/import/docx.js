// DOCX → { title, author, coverBlob, chapters } (via mammoth)

import { getMammoth } from './vendor.js';
import { extractBlocks, chaptersFromBlocks } from './html.js';
import { ImportError, MESSAGES } from './errors.js';

export async function parseDocx(buffer, fallbackTitle) {
  const mammoth = await getMammoth();
  let html;
  try {
    ({ value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer }, { ignoreEmptyParagraphs: true }));
  } catch {
    throw new ImportError(MESSAGES.broken);
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const chapters = chaptersFromBlocks(extractBlocks(doc.body), fallbackTitle);
  return { title: fallbackTitle, author: '', coverBlob: null, chapters };
}
