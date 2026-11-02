// Estrazione dei paragrafi da un documento HTML/XHTML (capitoli EPUB, DOCX convertito).

const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'blockquote', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th',
  'figure', 'figcaption', 'hr', 'body', 'center', 'address', 'nav', 'caption',
]);
const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math', 'img', 'audio', 'video', 'rt', 'rp']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isNoteRef(el) {
  const type = el.getAttribute('epub:type') || el.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '';
  const role = el.getAttribute('role') || '';
  if (/noteref/.test(type) || /doc-noteref/.test(role)) return true;
  // apici con un link: quasi sempre richiami di nota ("parola¹")
  return el.localName === 'sup' && el.querySelector('a') !== null && el.textContent.trim().length <= 4;
}

// Intestazione e licenza di Project Gutenberg dentro gli EPUB.
function isBoilerplate(el) {
  const id = el.getAttribute('id') || '';
  return id === 'pg-header' || id === 'pg-footer' || /\bpg-boilerplate\b/.test(el.getAttribute('class') || '');
}

/**
 * @param anchors  id degli elementi in cui inizia un capitolo (dall'indice EPUB): diventano marcatori { anchor }
 * @returns {({ text: string, tag: string } | { anchor: string })[]} blocchi in ordine; tag = blocco che li contiene
 */
export function extractBlocks(root, anchors = new Set()) {
  const blocks = [];
  let buf = '';
  let tag = 'p';
  const flush = () => {
    const text = buf.replace(/[\s ]+/g, ' ').trim();
    if (text) blocks.push({ text, tag });
    buf = '';
  };
  const walk = (node, blockTag) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (!buf.trim()) tag = blockTag;
        buf += n.data;
      } else if (n.nodeType === 1) {
        const name = n.localName.toLowerCase();
        if (SKIP.has(name) || isNoteRef(n) || isBoilerplate(n)) continue;
        if (anchors.size) {
          const id = n.getAttribute('id') || (name === 'a' && n.getAttribute('name'));
          if (id && anchors.has(id)) {
            flush();
            blocks.push({ anchor: id });
          }
        }
        if (name === 'br') {
          buf += ' ';
        } else if (BLOCK.has(name)) {
          flush();
          walk(n, name);
          flush();
        } else {
          walk(n, blockTag);
        }
      }
    }
  };
  walk(root, 'p');
  flush();
  return blocks;
}

export function isHeadingTag(tag) {
  return HEADINGS.has(tag);
}

/** Primo titolo del documento, se c'è. */
export function firstHeading(blocks) {
  return blocks.find((b) => isHeadingTag(b.tag))?.text ?? null;
}

/**
 * Divide i blocchi in capitoli a ogni titolo del livello più alto presente (h1, altrimenti h2).
 * I titoli non diventano paragrafi da leggere: vanno nel nome del capitolo.
 */
export function chaptersFromBlocks(blocks, fallbackTitle) {
  const level = ['h1', 'h2'].find((h) => blocks.some((b) => b.tag === h));
  const chapters = [];
  let current = null;
  for (const b of blocks) {
    if (level && b.tag === level) {
      current = { title: b.text, paragraphs: [] };
      chapters.push(current);
      continue;
    }
    if (!current) {
      current = { title: fallbackTitle, paragraphs: [] };
      chapters.push(current);
    }
    current.paragraphs.push(b.text);
  }
  return chapters.filter((c) => c.paragraphs.length > 0);
}
