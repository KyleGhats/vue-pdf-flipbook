import { describe, expect, it } from "vitest";
import {
  flipPageNumbersForView,
  maxBookViewIndex,
  viewPageNumbers,
} from "./bookViews";

describe("bookViews", () => {
  it("computes max view index", () => {
    expect(maxBookViewIndex(4)).toBe(2);
    expect(maxBookViewIndex(5)).toBe(2);
  });

  it("maps cover and spread views", () => {
    expect(viewPageNumbers(0, 5)).toEqual({
      left: 0,
      right: 1,
      mode: "cover",
    });
    expect(viewPageNumbers(1, 5)).toEqual({
      left: 2,
      right: 3,
      mode: "spread",
    });
  });

  it("maps flip page numbers from cover forward", () => {
    expect(flipPageNumbersForView(0, "fwd", 5)).toEqual({
      front: 1,
      back: 2,
    });
  });
});
