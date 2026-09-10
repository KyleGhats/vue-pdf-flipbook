# @kyle_g/vue-pdf-flipbook

Headless Vue 3 composables for a WebGL PDF flipbook powered by [turngl](https://github.com/ogi/turngl) and [pdf.js](https://mozilla.github.io/pdf.js/).

Bring your own UI — wire a canvas, overlay chrome, and navigation buttons however you like.

- **npm:** [@kyle_g/vue-pdf-flipbook](https://www.npmjs.com/package/@kyle_g/vue-pdf-flipbook)
- **GitHub:** [KyleGhats/vue-pdf-flipbook](https://github.com/KyleGhats/vue-pdf-flipbook)

## Install

```bash
npm install @kyle_g/vue-pdf-flipbook
```

Peer dependency: Vue 3.5+.

Install from GitHub (without npm):

```bash
npm install github:KyleGhats/vue-pdf-flipbook
```

## Quick start

```vue
<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { usePdfFlipbook } from "@kyle_g/vue-pdf-flipbook";

const props = defineProps<{ open: boolean; pdfUrl?: string }>();

const overlayRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);

const {
  loading,
  preparingPage,
  isFlipping,
  warmProgress,
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
} = usePdfFlipbook();

const measureSizes = () => {
  const overlay = overlayRef.value?.getBoundingClientRect();
  if (!overlay?.width || !overlay?.height) return null;
  const stage = stageRef.value?.getBoundingClientRect();
  return {
    canvasWidth: overlay.width,
    canvasHeight: overlay.height,
    fitWidth: stage?.width ?? overlay.width,
    fitHeight: stage?.height ?? overlay.height,
  };
};

const boot = async () => {
  if (!props.pdfUrl || !canvasRef.value || !overlayRef.value) return;
  const sizes = measureSizes();
  if (!sizes) return;
  init(
    canvasRef.value,
    sizes.canvasWidth,
    sizes.canvasHeight,
    sizes.fitWidth,
    sizes.fitHeight,
  );
  await load(props.pdfUrl);
};

const syncViewerSize = () => {
  const sizes = measureSizes();
  if (!sizes) return;
  resize(
    sizes.canvasWidth,
    sizes.canvasHeight,
    sizes.fitWidth,
    sizes.fitHeight,
  );
};

useResizeObserver(overlayRef, () => syncViewerSize());
useResizeObserver(stageRef, () => syncViewerSize());

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick();
      await boot();
      return;
    }
    dispose();
  },
);

onBeforeUnmount(dispose);
</script>

<template>
  <div v-if="open" ref="overlayRef" class="flipbook-overlay">
    <canvas
      ref="canvasRef"
      class="flipbook-canvas"
      :class="{ 'is-flipping': isFlipping }"
    />

    <header>
      <p v-if="pageLabel">{{ pageLabel }}</p>
      <p v-if="!loading && !error && !preparingPage">Drag a page corner to flip</p>
    </header>

    <div ref="stageRef" class="flipbook-stage">
      <p v-if="loading">Loading…</p>
      <p v-else-if="error">{{ error }}</p>
      <p v-else-if="preparingPage">Preparing page…</p>
    </div>

    <footer>
      <button :disabled="!canGoPrev || preparingPage" @click="prev()">Previous</button>
      <button :disabled="!canGoNext || preparingPage" @click="next()">Next</button>
      <p v-if="warmProgress.total > warmProgress.ready">
        Rendering pages {{ warmProgress.ready }}/{{ warmProgress.total }}
      </p>
    </footer>
  </div>
</template>
```

## API

### `usePdfFlipbook()`

Main composable. Returns reactive state and lifecycle methods:

| State | Description |
|---|---|
| `loading` | Initial PDF load |
| `preparingPage` | On-demand page render before flip |
| `isFlipping` | Drag or animated page turn in progress |
| `warmProgress` | `{ ready, total, initialTarget }` atlas warm-up |
| `error` | Load error message |
| `pageLabel` | Human-readable page label |
| `canGoNext` / `canGoPrev` | Navigation guards |

| Method | Description |
|---|---|
| `init(canvas, canvasW, canvasH, fitW?, fitH?)` | Attach WebGL renderer; optional fit size for book zoom |
| `load(url)` | Fetch and open PDF |
| `resize(canvasW, canvasH, fitW?, fitH?)` | Handle container resize |
| `next()` / `prev()` | Animated page turns |
| `dispose()` | Tear down WebGL, atlas, and PDF |

### Lower-level composables

- `usePdfDocument()` — fetch PDF, render pages to canvas
- `usePageAtlas(pdf)` — immutable Three.js materials per page
- `setupPdfWorker(workerUrl?)` — configure pdf.js worker (auto-called on import)

### View helpers

Pure functions for cover/spread/end book layout:

- `maxBookViewIndex(total)`
- `viewPageNumbers(viewIndex, total)`
- `flipPageNumbersForView(viewIndex, dir, total)`
- `pagesForView(viewIndex, total)`

## Nuxt / Vite

Add a **client plugin** so pdf.js can resolve its worker under Vite:

```ts
// app/plugins/pdf-worker.client.ts
import { setupPdfWorker } from "@kyle_g/vue-pdf-flipbook";

export default defineNuxtPlugin(() => {
  setupPdfWorker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href,
  );
});
```

Add to `nuxt.config.ts` (or Vite `optimizeDeps.include`):

```ts
vite: {
  optimizeDeps: {
    include: ["@kyle_g/vue-pdf-flipbook", "pdfjs-dist", "turngl"],
  },
},
```

PDFs must be fetchable from the browser (CORS). Pass a direct URL to `load()`.

For full-viewport canvas with header/footer overlay during flips, size the canvas to the overlay and pass the stage dimensions as `fitWidth` / `fitHeight` to `init` and `resize`. Raise canvas `z-index` while `isFlipping` is true.

## License

MIT
