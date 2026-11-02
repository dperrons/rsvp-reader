// Caricamento su richiesta delle librerie in vendor/ (così l'avvio dell'app resta leggero).

const loaded = new Map();

function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Impossibile caricare ${src}`));
        document.head.append(s);
      }),
    );
  }
  return loaded.get(src);
}

const base = new URL('../../vendor/', import.meta.url);

export async function getJSZip() {
  await loadScript(new URL('jszip.min.js', base).href);
  return window.JSZip;
}

export async function getMammoth() {
  await loadScript(new URL('mammoth.browser.min.js', base).href);
  return window.mammoth;
}

export async function getPdfjs() {
  const pdfjs = await import(new URL('pdf.min.mjs', base).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
  return pdfjs;
}
