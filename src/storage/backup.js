// Export/import della libreria in un unico file .rsvp (JSON compresso con gzip).

import { db } from './db.js';
import { mergeLibrary } from './merge.js';

const FORMAT = 'rsvp-reader-backup';
export const BACKUP_REMINDER_DAYS = 14;

async function gzip(text) {
  if (!('CompressionStream' in window)) return new Blob([text], { type: 'application/json' });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

async function gunzip(file) {
  const bytes = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return file.text();
}

export async function exportLibrary() {
  const data = await db.dump();
  const payload = JSON.stringify({ format: FORMAT, version: 1, exportedAt: Date.now(), ...data });
  const blob = await gzip(payload);
  const date = new Date().toISOString().slice(0, 10);
  const name = `libreria-rsvp-${date}.rsvp`;
  return { blob, name, books: data.books.length };
}

/** @returns {{ added: number, progress: number }} */
export async function importLibrary(file) {
  let data;
  try {
    data = JSON.parse(await gunzip(file));
  } catch {
    throw new Error('Questo file non è un backup della libreria.');
  }
  if (data?.format !== FORMAT) throw new Error('Questo file non è un backup della libreria.');
  const current = await db.dump();
  const changes = mergeLibrary(current, {
    books: data.books ?? [],
    texts: data.texts ?? [],
    progress: data.progress ?? [],
    sessions: data.sessions ?? [],
  });
  await db.writeMany(changes);
  return { added: changes.books.length, progress: changes.progress.length };
}

/** Salva il file: su iPhone apre il foglio di condivisione ("Salva su File"), altrimenti scarica. */
export async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
