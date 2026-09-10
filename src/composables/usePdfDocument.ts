import { ref } from "vue";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ensurePdfWorker, pdfjsLib } from "../setup/pdfWorker";

const MIN_RENDER_WIDTH = 1200;
const MAX_RENDER_WIDTH = 4096;

export const usePdfDocument = () => {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const numPages = ref(0);

  let doc: PDFDocumentProxy | null = null;
  const cache = new Map<number, HTMLCanvasElement>();
  let renderTargetWidth = MIN_RENDER_WIDTH;
  let renderScale = 1;

  const configureRenderSize = async (cssWidth: number, dpr = 1) => {
    const next = Math.min(
      MAX_RENDER_WIDTH,
      Math.max(
        MIN_RENDER_WIDTH,
        Math.ceil(cssWidth * 0.72 * dpr * 2),
      ),
    );

    if (next === renderTargetWidth) return false;
    renderTargetWidth = next;
    cache.clear();
    if (doc) await updateRenderScale();
    return true;
  };

  const updateRenderScale = async () => {
    if (!doc) return;
    const firstPage = await doc.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    renderScale = renderTargetWidth / viewport.width;
  };

  const loadPdf = async (url: string) => {
    ensurePdfWorker();
    loading.value = true;
    error.value = null;
    cache.clear();
    doc?.destroy();
    doc = null;
    numPages.value = 0;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF (${response.status})`);
      }
      const buffer = await response.arrayBuffer();
      const task = pdfjsLib.getDocument({ data: buffer });
      doc = await task.promise;
      numPages.value = doc.numPages;
      await updateRenderScale();

      return doc.numPages;
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : "Failed to load PDF document";
      throw cause;
    } finally {
      loading.value = false;
    }
  };

  const renderPage = async (pageNum: number) => {
    if (!doc || pageNum < 1 || pageNum > doc.numPages) {
      throw new Error(`Invalid page number: ${pageNum}`);
    }

    const cached = cache.get(pageNum);
    if (cached) return cached;

    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");

    await page.render({ canvasContext: context, viewport, canvas }).promise;
    cache.set(pageNum, canvas);
    return canvas;
  };

  const clearCache = () => {
    cache.clear();
  };

  const dispose = () => {
    doc?.destroy();
    doc = null;
    cache.clear();
    numPages.value = 0;
    error.value = null;
    renderTargetWidth = MIN_RENDER_WIDTH;
    renderScale = 1;
  };

  return {
    loading,
    error,
    numPages,
    configureRenderSize,
    loadPdf,
    renderPage,
    clearCache,
    dispose,
  };
};

export type PdfDocumentApi = ReturnType<typeof usePdfDocument>;
