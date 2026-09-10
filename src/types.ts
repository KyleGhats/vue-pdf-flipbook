export type { PdfDocumentApi } from "./composables/usePdfDocument";
export type { PageAtlasApi } from "./composables/usePageAtlas";
export type { PdfFlipbookApi } from "./composables/usePdfFlipbook";
export type { BookView, BookViewMode } from "./utils/bookViews";

export type WarmProgress = {
  ready: number;
  total: number;
  initialTarget: number;
};
