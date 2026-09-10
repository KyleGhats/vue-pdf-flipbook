import { ref } from "vue";
import * as THREE from "three";
import type { PdfDocumentApi } from "./usePdfDocument";
import { pagesForView } from "../utils/bookViews";

export const INITIAL_WARM_COUNT = 6;

const cloneCanvas = (source: HTMLCanvasElement) => {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(source, 0, 0);
  return copy;
};

const createPageTexture = (
  canvas: HTMLCanvasElement,
  backSide: boolean,
  anisotropy: number,
) => {
  const texture = new THREE.CanvasTexture(canvas);
  if (backSide) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = anisotropy;
  return texture;
};

type PageEntry = {
  canvas: HTMLCanvasElement;
  front: THREE.MeshBasicMaterial;
  back: THREE.MeshBasicMaterial;
};

export const usePageAtlas = (pdf: PdfDocumentApi) => {
  const progress = ref({ ready: 0, total: 0, initialTarget: 0 });
  const warming = ref(false);

  const entries = new Map<number, PageEntry>();
  let anisotropy = 1;
  let warmingRemaining = false;

  const syncProgress = () => {
    progress.value = {
      ready: entries.size,
      total: pdf.numPages.value,
      initialTarget: Math.min(INITIAL_WARM_COUNT, pdf.numPages.value),
    };
  };

  const disposeEntry = (entry: PageEntry) => {
    entry.front.map?.dispose();
    entry.back.map?.dispose();
    entry.front.dispose();
    entry.back.dispose();
  };

  const disposeAll = () => {
    for (const entry of entries.values()) disposeEntry(entry);
    entries.clear();
    syncProgress();
  };

  const buildPage = async (pageNum: number) => {
    if (entries.has(pageNum)) return;

    const source = await pdf.renderPage(pageNum);
    const canvas = cloneCanvas(source);
    const frontTexture = createPageTexture(canvas, false, anisotropy);
    const backTexture = createPageTexture(canvas, true, anisotropy);

    entries.set(pageNum, {
      canvas,
      front: new THREE.MeshBasicMaterial({
        map: frontTexture,
        side: THREE.FrontSide,
      }),
      back: new THREE.MeshBasicMaterial({
        map: backTexture,
        side: THREE.BackSide,
      }),
    });
    syncProgress();
  };

  const setAnisotropy = (value: number) => {
    anisotropy = value;
  };

  const ensurePage = async (pageNum: number) => {
    if (pageNum < 1 || pageNum > pdf.numPages.value) return;
    if (entries.has(pageNum)) return;
    await buildPage(pageNum);
  };

  const ensurePages = async (pageNums: number[]) => {
    const pending = pageNums.filter(
      (page) => page > 0 && page <= pdf.numPages.value && !entries.has(page),
    );
    if (!pending.length) return;
    warming.value = true;
    try {
      await Promise.all(pending.map((page) => buildPage(page)));
    } finally {
      warming.value = false;
    }
  };

  const ensureView = async (viewIndex: number) => {
    await ensurePages(pagesForView(viewIndex, pdf.numPages.value));
  };

  const warmInitialPages = async (count = INITIAL_WARM_COUNT) => {
    const total = pdf.numPages.value;
    if (!total) return;

    warming.value = true;
    try {
      const target = Math.min(count, total);
      for (let page = 1; page <= target; page++) {
        await buildPage(page);
      }
    } finally {
      warming.value = false;
    }
  };

  const warmRemaining = () => {
    if (warmingRemaining) return;
    warmingRemaining = true;

    void (async () => {
      const total = pdf.numPages.value;
      for (let page = INITIAL_WARM_COUNT + 1; page <= total; page++) {
        try {
          await buildPage(page);
        } catch {
          break;
        }
      }
      warmingRemaining = false;
    })();
  };

  const rebuild = async () => {
    warmingRemaining = false;
    disposeAll();
    pdf.clearCache();
    await warmInitialPages();
    warmRemaining();
  };

  const getFrontMaterial = (pageNum: number) =>
    entries.get(pageNum)?.front ?? null;

  const getBackMaterial = (pageNum: number) => entries.get(pageNum)?.back ?? null;

  const hasPage = (pageNum: number) => entries.has(pageNum);

  const dispose = () => {
    warmingRemaining = false;
    warming.value = false;
    disposeAll();
  };

  return {
    progress,
    warming,
    setAnisotropy,
    ensurePage,
    ensurePages,
    ensureView,
    warmInitialPages,
    warmRemaining,
    rebuild,
    getFrontMaterial,
    getBackMaterial,
    hasPage,
    dispose,
  };
};

export type PageAtlasApi = ReturnType<typeof usePageAtlas>;
