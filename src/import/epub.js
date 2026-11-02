// EPUB (2 e 3) → { title, author, coverBlob, chapters }

import { getJSZip } from './vendor.js';
import { extractBlocks, firstHeading, isHeadingTag } from './html.js';
import { ImportError, MESSAGES } from './errors.js';

// Algoritmi di offuscamento dei font: non sono DRM, il testo resta leggibile.
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

function parseXml(text, type = 'application/xml') {
  const doc = new DOMParser().parseFromString(text, type);
  if (doc.getElementsByTagName('parsererror').length) return null;
  return doc;
}

function parseXhtml(text) {
  return parseXml(text, 'application/xhtml+xml') ?? new DOMParser().parseFromString(text, 'text/html');
}

/** Tutti gli elementi con un certo nome locale, ignorando i namespace (dc:title, opf:item…). */
function byName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === name);
}

function resolvePath(baseDir, href) {
  const parts = (baseDir + decodeURIComponent(href.split('#')[0])).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

function getFile(zip, path) {
  return zip.file(path) ?? zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))[0] ?? null;
}

async function checkDrm(zip) {
  if (zip.file('META-INF/rights.xml')) throw new ImportError(MESSAGES.drm);
  const enc = zip.file('META-INF/encryption.xml');
  if (!enc) return;
  const doc = parseXml(await enc.async('string'));
  if (!doc) return;
  for (const data of byName(doc, 'EncryptedData')) {
    const method = byName(data, 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? '';
    if (!FONT_OBFUSCATION.has(method)) throw new ImportError(MESSAGES.drm);
  }
}

/**
 * Voci dell'indice, in ordine: { path, fragment, title }, dall'indice EPUB 3 (nav) o EPUB 2 (NCX).
 * Molti EPUB (per esempio quelli di Project Gutenberg) hanno più capitoli nello stesso file, indicati da "#id".
 */
async function readToc(zip, manifest, opf) {
  const entries = [];
  const seen = new Set();
  const add = (baseDir, href, title) => {
    if (!href || !title?.trim()) return;
    const path = resolvePath(baseDir, href);
    const fragment = href.includes('#') ? decodeURIComponent(href.split('#')[1]) : '';
    const key = `${path}#${fragment}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ path, fragment, title: title.replace(/\s+/g, ' ').trim() });
  };

  const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.properties));
  if (navItem) {
    const file = getFile(zip, navItem.path);
    const doc = file && parseXhtml(await file.async('string'));
    if (doc) {
      const navs = byName(doc, 'nav');
      const nav =
        navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('type') || n.getAttribute('role') || '')) ??
        navs[0];
      for (const a of nav ? byName(nav, 'a') : []) add(dirOf(navItem.path), a.getAttribute('href'), a.textContent);
    }
  }
  if (entries.length) return entries;

  const spine = byName(opf, 'spine')[0];
  const ncxId = spine?.getAttribute('toc');
  const ncxItem = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((i) => i.type === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const file = getFile(zip, ncxItem.path);
    const doc = file && parseXml(await file.async('string'));
    for (const point of doc ? byName(doc, 'navPoint') : []) {
      const label = byName(point, 'text')[0]?.textContent;
      const src = byName(point, 'content')[0]?.getAttribute('src');
      add(dirOf(ncxItem.path), src, label);
    }
  }
  return entries;
}

/** Divide i blocchi di un file in pezzi, uno per ogni voce dell'indice che punta dentro il file. */
function segmentsOf(blocks, entries) {
  const byFragment = new Map(entries.filter((e) => e.fragment).map((e) => [e.fragment, e.title]));
  const whole = entries.find((e) => !e.fragment);
  const segments = [{ title: whole?.title ?? null, blocks: [] }];
  for (const b of blocks) {
    if (b.anchor) {
      const title = byFragment.get(b.anchor);
      const cur = segments[segments.length - 1];
      // un'ancora proprio all'inizio del file dà il titolo al primo pezzo
      if (!cur.blocks.length && !cur.title) cur.title = title;
      else if (cur.blocks.length) segments.push({ title, blocks: [] });
      else cur.title = title;
    } else {
      segments[segments.length - 1].blocks.push(b);
    }
  }
  return segments.filter((s) => s.blocks.length);
}

export async function parseEpub(buffer, fallbackTitle) {
  const JSZip = await getJSZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ImportError(MESSAGES.broken);
  }
  await checkDrm(zip);

  const container = parseXml(await zip.file('META-INF/container.xml')?.async('string') ?? '');
  const opfPath = container && byName(container, 'rootfile')[0]?.getAttribute('full-path');
  const opfFile = opfPath && getFile(zip, opfPath);
  if (!opfFile) throw new ImportError(MESSAGES.broken);
  const opf = parseXml(await opfFile.async('string'));
  if (!opf) throw new ImportError(MESSAGES.broken);
  const opfDir = dirOf(opfPath);

  const manifest = new Map();
  for (const item of byName(opf, 'item')) {
    manifest.set(item.getAttribute('id'), {
      path: resolvePath(opfDir, item.getAttribute('href') ?? ''),
      type: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    });
  }

  const title = byName(opf, 'title')[0]?.textContent.trim() || fallbackTitle;
  const author = byName(opf, 'creator')
    .map((c) => c.textContent.trim())
    .filter(Boolean)
    .join(', ');

  const toc = await readToc(zip, manifest, opf);

  const chapters = [];
  const spineItems = byName(opf, 'itemref')
    .map((ref) => manifest.get(ref.getAttribute('idref')))
    .filter((i) => i && /x?html/.test(i.type) && !/\bnav\b/.test(i.properties));

  for (const item of spineItems) {
    const file = getFile(zip, item.path);
    if (!file) continue;
    const doc = parseXhtml(await file.async('string'));
    const body = doc.body ?? byName(doc, 'body')[0] ?? doc.documentElement;
    const entries = toc.filter((e) => e.path === item.path);
    const blocks = extractBlocks(body, new Set(entries.map((e) => e.fragment).filter(Boolean)));

    for (const seg of segmentsOf(blocks, entries)) {
      // Il titolo del capitolo all'inizio del testo non va letto due volte.
      const lead = seg.blocks.findIndex((b) => !isHeadingTag(b.tag));
      if (lead < 0) continue;
      const paragraphs = seg.blocks.slice(lead).map((b) => b.text);
      const heading = firstHeading(seg.blocks);
      const previous = chapters[chapters.length - 1];
      if (!seg.title && previous && !heading) {
        // Un capitolo diviso in più file: si attacca al precedente.
        previous.paragraphs.push(...paragraphs);
      } else {
        chapters.push({
          title: seg.title || heading || (chapters.length ? `Sezione ${chapters.length + 1}` : 'Inizio'),
          paragraphs,
        });
      }
    }
  }

  let coverBlob = null;
  const coverItem =
    [...manifest.values()].find((i) => /\bcover-image\b/.test(i.properties)) ??
    manifest.get(byName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content'));
  if (coverItem && coverItem.type.startsWith('image/')) {
    const file = getFile(zip, coverItem.path);
    if (file) coverBlob = new Blob([await file.async('uint8array')], { type: coverItem.type });
  }

  return { title, author, coverBlob, chapters };
}
