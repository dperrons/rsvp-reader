// Errori di importazione con un messaggio da mostrare così com'è.

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

export const MESSAGES = {
  drm: 'Questo libro è protetto da DRM e non può essere letto. Servono libri in EPUB senza DRM.',
  kindle:
    'Questo è un file Kindle (AZW, KFX, MOBI). I libri Kindle sono protetti da DRM e non si possono aprire qui: usa libri in EPUB senza DRM, PDF, DOCX o TXT.',
  pdfNoText:
    'Questo PDF non contiene testo (probabilmente è una scansione di immagini), quindi non può essere letto.',
  empty: 'Non ho trovato testo da leggere in questo file.',
  unknown: 'Formato non riconosciuto. Puoi caricare EPUB, PDF, DOCX e TXT.',
  broken: 'Il file sembra danneggiato e non sono riuscito ad aprirlo.',
};
