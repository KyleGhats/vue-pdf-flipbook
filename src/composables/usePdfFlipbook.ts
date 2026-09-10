import { ref } from "vue";
import * as THREE from "three";
import { Book3D } from "turngl";
import { usePdfDocument } from "./usePdfDocument";
import { INITIAL_WARM_COUNT, usePageAtlas } from "./usePageAtlas";
import {
  flipPageNumbersForView,
  maxBookViewIndex,
  viewPageNumbers,
} from "../utils/bookViews";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** turngl Book3D defaults: PerspectiveCamera fov 26°, base distance 6 */
const BOOK_VFOV = (26 * Math.PI) / 180;
const BOOK_BASE_CAM_Z = 6;
const BOOK_FIT_PADDING = 0.97;

const fitBookToStage = (target: Book3D, width: number, height: number) => {
  if (!width || !height) return;

  const aspect = width / height;
  const tanHalf = Math.tan(BOOK_VFOV / 2);
  const spreadWidth = target.PW * 2;
  const pageHeight = target.PH;

  const zForHeight = pageHeight / (2 * tanHalf * BOOK_FIT_PADDING);
  const zForWidth = spreadWidth / (2 * tanHalf * aspect * BOOK_FIT_PADDING);
  const camZ = clamp(Math.max(zForHeight, zForWidth), 3, 10);

  target.setZoom(BOOK_BASE_CAM_Z / camZ);
};

/** Keep the curling page above static sheets so it never z-fights while settling */
const FLIP_LIFT = 0.02;
const SPINE_WIDTH = 0.008;
const SPINE_DEPTH = 0.008;
/** Hide flip back until the curl exposes the static page underneath, not the even-page back face */
const FLIP_BACK_REVEAL = 0.28;

type PageMaterial = THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;

const toUnlitPageMaterial = (material: PageMaterial) => {
  if (material instanceof THREE.MeshBasicMaterial) return material;

  const map = material.map;
  if (map) map.colorSpace = THREE.SRGBColorSpace;

  const unlit = new THREE.MeshBasicMaterial({
    map,
    side: material.side,
  });
  material.dispose();
  return unlit;
};

type InternalBook3D = Book3D & {
  _mFF: PageMaterial;
  _mFB: PageMaterial;
};

type BlankBook3D = Book3D & {
  _blankCanvas: () => HTMLCanvasElement;
};

/** turngl defaults to Lambert shading which dims page textures; pages should read flat/unlit */
const useUnlitPages = (book: Book3D) => {
  const internal = book as InternalBook3D;

  book.renderer.outputColorSpace = THREE.SRGBColorSpace;
  book.renderer.toneMapping = THREE.NoToneMapping;
  book.renderer.shadowMap.enabled = false;
  book.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));

  internal._mFF = toUnlitPageMaterial(internal._mFF);
  internal._mFB = toUnlitPageMaterial(internal._mFB);
  book.flipF.material = internal._mFF;
  book.flipB.material = internal._mFB;
  book.meshL.material = toUnlitPageMaterial(book.meshL.material as PageMaterial);
  book.meshR.material = toUnlitPageMaterial(book.meshR.material as PageMaterial);

  for (const mesh of [book.meshL, book.meshR, book.flipF, book.flipB]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
};

const tightenSpine = (book: Book3D) => {
  book.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geometry = obj.geometry;
    if (!(geometry instanceof THREE.BoxGeometry)) return;
    if (geometry.parameters.width !== 0.04) return;

    geometry.dispose();
    obj.geometry = new THREE.BoxGeometry(
      SPINE_WIDTH,
      book.PH + 0.02,
      SPINE_DEPTH,
    );
  });
};

const applySpreadLayout = (book: Book3D) => {
  const inset = SPINE_WIDTH / 2;
  book.meshL.visible = true;
  book.meshR.visible = true;
  book.meshL.position.x = -book.PW / 2 + inset;
  book.meshR.position.x = book.PW / 2 - inset;
};

const applyCoverLayout = (book: Book3D) => {
  applySpreadLayout(book);
  book.meshL.visible = false;
  book.meshR.visible = true;
};

const applyEndLayout = (book: Book3D) => {
  applySpreadLayout(book);
  book.meshL.visible = true;
  book.meshR.visible = false;
};

const applyViewLayout = (book: Book3D, index: number, total: number) => {
  const view = viewPageNumbers(index, total);
  if (view.mode === "cover") applyCoverLayout(book);
  else if (view.mode === "end" || !view.right) applyEndLayout(book);
  else applySpreadLayout(book);
};

const hideFlipMeshes = (book: Book3D, dir?: "fwd" | "bwd") => {
  book.flipF.visible = false;
  book.flipB.visible = false;
  book.flipF.position.z = 0;
  book.flipB.position.z = 0;
  book.flipF.renderOrder = 0;
  book.flipB.renderOrder = 0;
  if (dir) book.curl(0, dir);
};

const liftFlipMeshes = (book: Book3D) => {
  book.flipF.position.z = FLIP_LIFT;
  book.flipB.position.z = FLIP_LIFT;
  book.flipF.renderOrder = 2;
  book.flipB.renderOrder = 2;
  book.meshL.renderOrder = 0;
  book.meshR.renderOrder = 0;
};

export const usePdfFlipbook = () => {
  const pdf = usePdfDocument();
  const atlas = usePageAtlas(pdf);
  const loading = ref(false);
  const preparingPage = ref(false);
  const isFlipping = ref(false);
  const error = ref<string | null>(null);
  const pageLabel = ref("");
  const canGoNext = ref(false);
  const canGoPrev = ref(false);

  let book: Book3D | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let blankMaterial: THREE.MeshBasicMaterial | null = null;
  let blankBackMaterial: THREE.MeshBasicMaterial | null = null;
  let stageWidth = 0;
  let viewIndex = 0;
  let animating = false;
  let dragging = false;
  let drag: { dir: "fwd" | "bwd"; sx: number; prog: number; vel: number } | null = null;
  let activeFlipDir: "fwd" | "bwd" | null = null;

  let onDown: ((event: PointerEvent) => void) | null = null;
  let onMove: ((event: PointerEvent) => void) | null = null;
  let onUp: (() => void) | null = null;

  const maxAnisotropy = () =>
    book?.renderer.capabilities.getMaxAnisotropy() ?? 1;

  const maxViewIndex = () => maxBookViewIndex(pdf.numPages.value);

  const updateNav = () => {
    const total = pdf.numPages.value;
    if (!total) {
      pageLabel.value = "";
      canGoNext.value = false;
      canGoPrev.value = false;
      return;
    }

    const view = viewPageNumbers(viewIndex, total);
    if (view.mode === "cover") {
      pageLabel.value = `Page 1 of ${total}`;
    } else if (view.mode === "end" || !view.right) {
      pageLabel.value = `Page ${view.left} of ${total}`;
    } else {
      pageLabel.value = `Pages ${view.left}–${view.right} of ${total}`;
    }

    canGoNext.value = viewIndex < maxViewIndex();
    canGoPrev.value = viewIndex > 0;
  };

  const getBlankMaterial = () => {
    if (!book || !blankMaterial) return null;
    return blankMaterial;
  };

  const materialForPage = (pageNum: number, back = false) => {
    if (pageNum < 1) return getBlankMaterial();
    const material = back
      ? atlas.getBackMaterial(pageNum)
      : atlas.getFrontMaterial(pageNum);
    return material ?? getBlankMaterial();
  };

  const bindSpread = (index: number) => {
    if (!book) return;

    const view = viewPageNumbers(index, pdf.numPages.value);
    const blank = getBlankMaterial();

    if (view.mode === "cover") {
      book.meshR.material = materialForPage(1) ?? blank;
      return;
    }

    if (view.mode === "end" || !view.right) {
      book.meshL.material = materialForPage(view.left) ?? blank;
      return;
    }

    book.meshL.material = materialForPage(view.left) ?? blank;
    book.meshR.material = materialForPage(view.right) ?? blank;
  };

  /** Mirror of forward flip: reveal dest page under curl; keep the other side on the current page until settle */
  const bindSpreadDuringFlip = (dir: "fwd" | "bwd") => {
    if (!book) return;

    const total = pdf.numPages.value;
    const current = viewPageNumbers(viewIndex, total);
    const destIndex = dir === "fwd" ? viewIndex + 1 : viewIndex - 1;
    const dest = viewPageNumbers(destIndex, total);
    const blank = getBlankMaterial();

    if (dir === "fwd") {
      if (current.mode === "cover") {
        book.meshL.visible = false;
      } else if (current.left) {
        book.meshL.material = materialForPage(current.left) ?? blank;
        book.meshL.visible = true;
      } else {
        book.meshL.visible = false;
      }

      if (dest.mode === "end" || !dest.right) {
        book.meshR.visible = false;
      } else {
        book.meshR.material = materialForPage(dest.right) ?? blank;
        book.meshR.visible = true;
      }
      return;
    }

    if (dest.mode === "cover") {
      book.meshL.visible = false;
      if (current.right) {
        book.meshR.material = materialForPage(current.right) ?? blank;
        book.meshR.visible = true;
      } else {
        book.meshR.visible = false;
      }
      return;
    }

    if (dest.left) {
      book.meshL.material = materialForPage(dest.left) ?? blank;
      book.meshL.visible = true;
    } else {
      book.meshL.visible = false;
    }

    if (current.mode === "end" || !current.right) {
      book.meshR.visible = false;
    } else {
      book.meshR.material = materialForPage(current.right) ?? blank;
      book.meshR.visible = true;
    }
  };

  const syncFlipBackVisibility = (progress: number) => {
    if (!book) return;
    book.flipB.visible = progress > FLIP_BACK_REVEAL;
  };

  const prepFlip = (dir: "fwd" | "bwd", frontPage: number, backPage: number) => {
    if (!book) return;

    activeFlipDir = dir;
    isFlipping.value = true;
    const internal = book as InternalBook3D;
    internal._mFF = materialForPage(frontPage) ?? getBlankMaterial()!;
    internal._mFB = backPage
      ? materialForPage(backPage, true) ?? blankBackMaterial!
      : blankBackMaterial!;
    book.flipF.material = internal._mFF;
    book.flipB.material = internal._mFB;

    bindSpreadDuringFlip(dir);

    book.curl(0, dir);
    liftFlipMeshes(book);
    book.flipF.visible = true;
    book.flipB.visible = false;
  };

  const ensureFlipPages = async (dir: "fwd" | "bwd") => {
    const total = pdf.numPages.value;
    const { front, back } = flipPageNumbersForView(viewIndex, dir, total);
    const destIndex = dir === "fwd" ? viewIndex + 1 : viewIndex - 1;
    const dest = viewPageNumbers(destIndex, total);

    const current = viewPageNumbers(viewIndex, total);
    const pages = new Set<number>();
    if (front) pages.add(front);
    if (back) pages.add(back);

    if (dir === "fwd") {
      if (current.left) pages.add(current.left);
      if (dest.right) pages.add(dest.right);
    } else {
      if (dest.left) pages.add(dest.left);
      if (current.right) pages.add(current.right);
      if (dest.mode === "cover") pages.add(1);
    }

    preparingPage.value = true;
    try {
      await atlas.ensurePages([...pages]);
    } finally {
      preparingPage.value = false;
    }

    return { front, back };
  };

  const showView = async () => {
    if (!book) return;

    await atlas.ensureView(viewIndex);
    bindSpread(viewIndex);
    applyViewLayout(book, viewIndex, pdf.numPages.value);
    hideFlipMeshes(book);
    updateNav();
  };

  const completeFlip = (nextIndex: number, dir: "fwd" | "bwd") => {
    if (!book) return;

    hideFlipMeshes(book, dir);
    viewIndex = nextIndex;
    bindSpread(viewIndex);
    applyViewLayout(book, viewIndex, pdf.numPages.value);
    updateNav();
    activeFlipDir = null;
    animating = false;
    isFlipping.value = false;
  };

  const cancelFlip = () => {
    if (!book || !activeFlipDir) return;
    hideFlipMeshes(book, activeFlipDir);
    bindSpread(viewIndex);
    applyViewLayout(book, viewIndex, pdf.numPages.value);
    activeFlipDir = null;
    isFlipping.value = false;
  };

  const flip = async (dir: "fwd" | "bwd") => {
    if (!book || animating) return;
    if (dir === "fwd" && viewIndex >= maxViewIndex()) return;
    if (dir === "bwd" && viewIndex <= 0) return;

    animating = true;
    const nextIndex = viewIndex + (dir === "fwd" ? 1 : -1);
    const { front, back } = await ensureFlipPages(dir);
    prepFlip(dir, front, back);
    book.animate(
      0,
      1,
      780,
      (progress) => {
        book?.curl(progress, dir);
        syncFlipBackVisibility(progress);
      },
      () => {
        completeFlip(nextIndex, dir);
      },
    );
  };

  const normalized = (event: PointerEvent) => {
    const rect = canvas?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return { x: 0, y: 0 };
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const clientY = event.touches?.[0]?.clientY ?? event.clientY;
    return {
      x: (clientX - rect.left) / rect.width - 0.5,
      y: (clientY - rect.top) / rect.height - 0.5,
    };
  };

  const bindDrag = () => {
    if (!canvas || !book) return;

    onDown = async (event: PointerEvent) => {
      if (animating || !pdf.numPages.value || !book) return;

      const { x } = normalized(event);
      const dir = x > 0 ? "fwd" : "bwd";
      if (dir === "fwd" && viewIndex >= maxViewIndex()) return;
      if (dir === "bwd" && viewIndex <= 0) return;

      event.preventDefault();
      canvas?.setPointerCapture(event.pointerId);

      const { front, back } = await ensureFlipPages(dir);
      if (!book || animating) return;

      dragging = true;
      drag = { dir, sx: x, prog: 0, vel: 0 };
      prepFlip(dir, front, back);
      canvas?.classList.add("grabbing");
    };

    onMove = (event: PointerEvent) => {
      if (!book) return;
      const { x, y } = normalized(event);

      if (!dragging || !drag) {
        book.mouseLook(x, y);
        return;
      }

      const raw = drag.dir === "fwd" ? (drag.sx - x) * 2.2 : (x - drag.sx) * 2.2;
      const progress = clamp(raw, 0, 1);
      drag.vel = progress - drag.prog;
      drag.prog = progress;
      book.curl(progress, drag.dir);
      syncFlipBackVisibility(progress);
    };

    onUp = () => {
      if (!book || !dragging || !drag) return;
      dragging = false;
      canvas?.classList.remove("grabbing");

      const active = drag;
      drag = null;
      const threshold = active.vel > 0.018 ? 0.12 : 0.38;

      if (active.prog > threshold) {
        animating = true;
        const nextIndex = viewIndex + (active.dir === "fwd" ? 1 : -1);
        book.animate(
          active.prog,
          1,
          Math.max(100, (1 - active.prog) * 550),
          (progress) => {
            book?.curl(progress, active.dir);
            syncFlipBackVisibility(progress);
          },
          () => {
            completeFlip(nextIndex, active.dir);
          },
        );
        return;
      }

      book.animate(
        active.prog,
        0,
        active.prog * 400 + 80,
        (progress) => {
          book?.curl(progress, active.dir);
          syncFlipBackVisibility(progress);
        },
        () => cancelFlip(),
      );
    };

    canvas.addEventListener("pointerdown", onDown, { passive: false });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const unbindDrag = () => {
    if (canvas && onDown) canvas.removeEventListener("pointerdown", onDown);
    if (onMove) window.removeEventListener("pointermove", onMove);
    if (onUp) {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    onDown = null;
    onMove = null;
    onUp = null;
  };

  const syncRenderSize = async (width: number) => {
    stageWidth = width;
    const scaleChanged = await pdf.configureRenderSize(
      width,
      window.devicePixelRatio || 1,
    );
    if (scaleChanged && pdf.numPages.value && !animating && !dragging) {
      await atlas.rebuild();
      await showView();
    }
  };

  const init = (
    targetCanvas: HTMLCanvasElement,
    width: number,
    height: number,
    fitWidth = width,
    fitHeight = height,
  ) => {
    canvas = targetCanvas;
    stageWidth = width;
    book = new Book3D(canvas, { theme: "light", segments: 32 });
    useUnlitPages(book);
    tightenSpine(book);
    atlas.setAnisotropy(maxAnisotropy());

    const blankCanvas = (book as BlankBook3D)._blankCanvas();
    const blankTexture = new THREE.CanvasTexture(blankCanvas);
    blankMaterial = new THREE.MeshBasicMaterial({
      map: blankTexture,
      side: THREE.FrontSide,
    });
    const blankBackTexture = new THREE.CanvasTexture(blankCanvas);
    blankBackTexture.wrapS = THREE.RepeatWrapping;
    blankBackTexture.repeat.x = -1;
    blankBackTexture.offset.x = 1;
    blankBackMaterial = new THREE.MeshBasicMaterial({
      map: blankBackTexture,
      side: THREE.BackSide,
    });

    book.resize(width, height);
    fitBookToStage(book, fitWidth, fitHeight);
    bindDrag();
  };

  const resize = (
    width: number,
    height: number,
    fitWidth = width,
    fitHeight = height,
  ) => {
    stageWidth = width;
    book?.resize(width, height);
    if (book) fitBookToStage(book, fitWidth, fitHeight);
    void syncRenderSize(width);
  };

  const load = async (url: string) => {
    loading.value = true;
    error.value = null;
    viewIndex = 0;

    try {
      await pdf.configureRenderSize(stageWidth || 1200, window.devicePixelRatio || 1);
      await pdf.loadPdf(url);
      atlas.setAnisotropy(maxAnisotropy());
      await atlas.warmInitialPages(INITIAL_WARM_COUNT);
      atlas.warmRemaining();
      await showView();
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : "Failed to load PDF document";
      throw cause;
    } finally {
      loading.value = false;
    }
  };

  const next = () => void flip("fwd");
  const prev = () => void flip("bwd");

  const dispose = () => {
    unbindDrag();
    book?.dispose();
    atlas.dispose();
    pdf.dispose();
    blankMaterial?.map?.dispose();
    blankMaterial?.dispose();
    blankBackMaterial?.map?.dispose();
    blankBackMaterial?.dispose();
    blankMaterial = null;
    blankBackMaterial = null;
    book = null;
    canvas = null;
    stageWidth = 0;
    viewIndex = 0;
    animating = false;
    dragging = false;
    drag = null;
    activeFlipDir = null;
    isFlipping.value = false;
    loading.value = false;
    preparingPage.value = false;
    error.value = null;
    pageLabel.value = "";
    canGoNext.value = false;
    canGoPrev.value = false;
  };

  return {
    loading,
    preparingPage,
    isFlipping,
    warmProgress: atlas.progress,
    error,
    pageLabel,
    canGoNext,
    canGoPrev,
    init,
    resize,
    load,
    next,
    prev,
    dispose,
  };
};

export type PdfFlipbookApi = ReturnType<typeof usePdfFlipbook>;
