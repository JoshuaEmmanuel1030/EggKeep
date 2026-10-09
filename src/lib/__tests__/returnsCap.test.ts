import { describe, it, expect } from "vitest";
import { remainingReturnable, piecesToNative, nativeToPieces, NEGERI_PIECES_PER_KG } from "../returnsCap";

describe("remainingReturnable", () => {
  it("caps at what's left to return", () => {
    expect(remainingReturnable(40, 15)).toBe(25);
  });
  it("is zero when fully returned", () => {
    expect(remainingReturnable(40, 40)).toBe(0);
  });
  it("never goes negative if prior returns somehow exceed the line", () => {
    expect(remainingReturnable(40, 50)).toBe(0);
  });
  it("returns the full quantity when nothing returned yet", () => {
    expect(remainingReturnable(9.5, 0)).toBe(9.5);
  });
});

describe("piecesToNative / nativeToPieces", () => {
  it("passes butir through unchanged", () => {
    expect(piecesToNative(200, "btr")).toBe(200);
    expect(nativeToPieces(200, "btr")).toBe(200);
  });
  it("converts kg pieces at flat 15.5, rounded to 2dp", () => {
    expect(piecesToNative(31, "kg")).toBe(2); // 31/15.5 = 2.00
    expect(piecesToNative(100, "kg")).toBe(6.45); // 6.4516.. -> 6.45
    expect(NEGERI_PIECES_PER_KG).toBe(15.5);
  });
  it("nativeToPieces inverts kg", () => {
    expect(nativeToPieces(2, "kg")).toBe(31);
  });
});
