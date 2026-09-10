# vue-pdf-flipbook

Headless Vue 3 composables for a WebGL PDF flipbook powered by [turngl](https://github.com/ogi/turngl) and [pdf.js](https://mozilla.github.io/pdf.js/).

Bring your own UI — wire a canvas, overlay chrome, and navigation buttons however you like.

## Install

From npm (after publishing):

```bash
npm install vue-pdf-flipbook
```

From GitHub:

```bash
npm install github:YOUR_GITHUB_USERNAME/vue-pdf-flipbook
```

Peer dependency: Vue 3.5+.

## Publish to GitHub

GitHub CLI is the fastest path. From this directory:

```bash
gh auth login
gh repo create vue-pdf-flipbook --public --source=. --remote=origin --push
```

Then update `repository`, `homepage`, and `bugs` in `package.json` with your GitHub username.

To publish on npm later:

```bash
npm publish
```

## Quick start

```vue
<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { usePdfFlipbook } from "vue-pdf-flipbook";

const props = defineProps<{ open: boolean; pdfUrl?: string }>();

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

const boot = async () => {
  if (!props.pdfUrl || !canvasRef.value || !stageRef.value) return;
  const { width, height } = stageRef.value.getBoundingClientRect();
  init(canvasRef.value, width, height);
  await load(props.pdfUrl);
};

useResizeObserver(stageRef, (entries) => {
  const { width, height } = entries[0]?.contentRect ?? {};
  if (width && height) resize(width, height);
});

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
  <div v-if="open" class="flipbook-overlay">
    <header>
      <p v-if="pageLabel">{{ pageLabel }}</p>
      <p v-if="!loading && !error">Drag a page corner to flip</p>
    </header>

    <div ref="stageRef" class="flipbook-stage">
      <canvas
        ref="canvasRef"
        class="flipbook-canvas"
        :class="{ 'is-flipping': isFlipping }"
      />
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

## Nuxt / Vite notes

Add to `nuxt.config.ts` (or Vite `optimizeDeps.include`):

```ts
vite: {
  optimizeDeps: {
    include: ["vue-pdf-flipbook", "pdfjs-dist", "turngl"],
  },
},
```

PDFs must be fetchable from the browser (CORS). Pass a direct URL to `load()`.

For full-viewport canvas with header/footer overlay during flips, size the canvas to the overlay and pass the stage dimensions as `fitWidth` / `fitHeight` to `init` and `resize`. Raise canvas `z-index` while `isFlipping` is true.

## License

MIT
