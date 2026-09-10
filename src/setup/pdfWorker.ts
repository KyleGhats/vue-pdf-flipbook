import * as pdfjsLib from "pdfjs-dist";

let configured = false;

/** Bundled worker copied to dist/ on package build. Vite/Nuxt apps should pass an explicit URL instead. */
export function setupPdfWorker(workerUrl?: string) {
  if (workerUrl) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    configured = true;
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "./pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  configured = true;
}

export function ensurePdfWorker() {
  if (!configured) setupPdfWorker();
}

export { pdfjsLib };
