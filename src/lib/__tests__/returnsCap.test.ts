import { describe, it, expect } from "vitest";
import { remainingReturnable } from "../returnsCap";

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
