import * as pdfjsLib from "pdfjs-dist";

let configured = false;

export function setupPdfWorker(workerUrl?: string) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    workerUrl ??
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
  configured = true;
}

export function ensurePdfWorker() {
  if (!configured) setupPdfWorker();
}

export { pdfjsLib };
