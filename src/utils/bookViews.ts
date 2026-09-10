export const maxBookViewIndex = (total: number) =>
  total <= 1 ? 0 : Math.ceil((total - 1) / 2);

export type BookViewMode = "cover" | "spread" | "end";

export type BookView = {
  left: number;
  right: number;
  mode: BookViewMode;
};

export const viewPageNumbers = (viewIndex: number, total: number): BookView => {
  if (total <= 0) return { left: 0, right: 0, mode: "cover" };
  if (viewIndex <= 0) return { left: 0, right: 1, mode: "cover" };

  const left = viewIndex * 2;
  const right = left + 1;

  if (left > total) return { left: 0, right: 0, mode: "end" };
  if (right > total) return { left, right: 0, mode: "end" };

  return { left, right, mode: "spread" };
};

export const flipPageNumbersForView = (
  viewIndex: number,
  dir: "fwd" | "bwd",
  total: number,
) => {
  const toPage = (page: number) => (page >= 1 && page <= total ? page : 0);

  if (viewIndex <= 0 && dir === "fwd") {
    return { front: toPage(1), back: toPage(2) };
  }

  const left = viewIndex * 2;
  const right = left + 1;

  if (dir === "fwd") {
    return { front: toPage(right), back: toPage(left + 2) };
  }
  return { front: toPage(left), back: toPage(left - 1) };
};

export const pagesForView = (viewIndex: number, total: number) => {
  const pages = new Set<number>();
  const view = viewPageNumbers(viewIndex, total);

  if (view.right) pages.add(view.right);
  if (view.left) pages.add(view.left);

  for (const dir of ["fwd", "bwd"] as const) {
    const { front, back } = flipPageNumbersForView(viewIndex, dir, total);
    if (front) pages.add(front);
    if (back) pages.add(back);
  }

  return [...pages];
};
