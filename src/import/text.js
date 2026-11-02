// Testo semplice (file .txt o testo incollato) → capitoli e paragrafi.

// "Capitolo 3", "CAPITOLO III", "Capitolo primo", "Parte II", "Prologo"...
const HEADING_PATTERNS = [
  /^(capitolo|chapter)\b/iu,
  /^(parte|part|libro|book)\s+([0-9]+|[ivxlcdm]+)\b/iu,
  /^(prologo|prologue|epilogo|epilogue|introduzione|introduction|prefazione|preface)\b[\s.:\-–—]*\S*.{0,40}$/iu,
];

export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Toglie l'intestazione e la licenza dei file di Project Gutenberg, se presenti. */
function trimGutenberg(text) {
  const start = text.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1);
  const end = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) text = text.slice(0, end);
  return text;
}

export function isHeading(paragraph) {
  const p = paragraph.trim();
  if (p.length === 0 || p.length > 80 || /[,;]$/.test(p)) return false;
  return HEADING_PATTERNS.some((re) => re.test(p));
}

export function splitParagraphs(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const hasBlankLines = /\n[ \t]*\n/.test(normalized.trim());
  const blocks = hasBlankLines ? normalized.split(/\n[ \t]*\n+/) : normalized.split('\n');
  return blocks
    .map((b) =>
      b
        .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2') // parola spezzata a fine riga
        .replace(/\s*\n\s*/g, ' ')
        .replace(/[ \t ]+/g, ' ')
        .trim(),
    )
    .filter((b) => b.length > 0);
}

/** @returns {{ title: string, author: string, chapters: { title: string, paragraphs: string[] }[] }} */
export function parsePlainText(text, title = 'Testo') {
  const paragraphs = splitParagraphs(trimGutenberg(text));
  const chapters = [];
  let current = null;
  for (const p of paragraphs) {
    if (isHeading(p)) {
      current = { title: p, paragraphs: [] };
      chapters.push(current);
      continue;
    }
    if (!current) {
      current = { title: 'Inizio', paragraphs: [] };
      chapters.push(current);
    }
    current.paragraphs.push(p);
  }
  const nonEmpty = chapters.filter((c) => c.paragraphs.length > 0);
  if (nonEmpty.length === 1 && nonEmpty[0].title === 'Inizio') nonEmpty[0].title = title;
  return { title, author: '', chapters: nonEmpty };
}

/** Titolo per il testo incollato: le prime parole. */
export function titleFromText(text) {
  const first = splitParagraphs(text)[0] ?? 'Testo incollato';
  const words = first.split(' ').slice(0, 7).join(' ');
  return words.length < first.length ? `${words}…` : words;
}
