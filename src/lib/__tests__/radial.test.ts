import { describe, it, expect } from "vitest";
import {
  BUBBLE_COLORS,
  DEAD_ZONE,
  clampCentre,
  highlightIndex,
  itemOffset,
  makeBubbles,
  pointerDotOffset,
  ringRadius,
} from "@/lib/radial";

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

describe("radial geometry", () => {
  it("uses R 112 up to 7 items, 128 beyond", () => {
    expect(ringRadius(1)).toBe(112);
    expect(ringRadius(7)).toBe(112);
    expect(ringRadius(8)).toBe(128);
  });

  it("clamps the centre so the disc (pad R + 56) fits the screen", () => {
    expect(clampCentre(500, 400, 112, 1194, 834)).toEqual({ x: 500, y: 400 });
    expect(clampCentre(10, 820, 112, 1194, 834)).toEqual({ x: 168, y: 834 - 168 });
    expect(clampCentre(1190, 5, 128, 1194, 834)).toEqual({ x: 1194 - 184, y: 184 });
    // Too small for the disc: centre it.
    expect(clampCentre(10, 10, 112, 300, 1000)).toEqual({ x: 150, y: 168 });
  });

  it("puts item 0 at the top, then clockwise", () => {
    close(itemOffset(0, 4, 112), 0, -112);
    close(itemOffset(1, 4, 112), 112, 0);
    close(itemOffset(2, 4, 112), 0, 112);
    close(itemOffset(3, 4, 112), -112, 0);
    close(itemOffset(1, 6, 100), 100 * Math.cos(-Math.PI / 6), -50);
  });

  it("highlights the item the drag points at, past the dead zone", () => {
    expect(highlightIndex(0, -60, 4)).toBe(0);
    expect(highlightIndex(60, 0, 4)).toBe(1);
    expect(highlightIndex(0, 60, 4)).toBe(2);
    expect(highlightIndex(-60, 0, 4)).toBe(3);
    // Just left of the top rounds back to item 0, not n.
    expect(highlightIndex(-10, -60, 4)).toBe(0);
    expect(highlightIndex(0, -60, 1)).toBe(0);
    expect(highlightIndex(60, 60, 1)).toBe(0);
    expect(highlightIndex(0, -60, 0)).toBe(-1);
  });

  it("cancels inside the dead zone", () => {
    expect(highlightIndex(0, 0, 6)).toBe(-1);
    expect(highlightIndex(0, -DEAD_ZONE, 6)).toBe(-1);
    expect(highlightIndex(0, -(DEAD_ZONE + 1), 6)).toBe(0);
  });

  it("measures the dead zone from the press point even when the centre is clamped", () => {
    const press = { x: 10, y: 10 };
    const centre = clampCentre(press.x, press.y, 112, 1194, 834); // (168, 168)
    const pointer = { x: 10, y: 40 }; // 30 px from the press, ~160 px from the centre
    expect(Math.hypot(pointer.x - centre.x, pointer.y - centre.y)).toBeGreaterThan(DEAD_ZONE);
    expect(highlightIndex(pointer.x - press.x, pointer.y - press.y, 6)).toBe(-1);
    // Releasing without moving never picks.
    expect(highlightIndex(0, 0, 6)).toBe(-1);
  });

  it("clamps the pointer dot to R + 40", () => {
    expect(pointerDotOffset(0, 0, 112)).toEqual({ x: 0, y: 0 });
    expect(pointerDotOffset(30, 40, 112)).toEqual({ x: 30, y: 40 });
    close(pointerDotOffset(0, -500, 112), 0, -152);
    close(pointerDotOffset(300, 400, 112), 91.2, 121.6);
  });

  it("makes 14 bubbles inside the documented ranges", () => {
    const lo = makeBubbles(112, () => 0);
    const hi = makeBubbles(112, () => 0.999999);
    expect(lo).toHaveLength(14);
    expect(lo[0].size).toBe(4);
    expect(lo[0].delay).toBe(0);
    close(lo[0], 112 * 0.75, 0);
    expect(hi[0].size).toBeCloseTo(11, 4);
    expect(hi[0].delay).toBeCloseTo(90, 3);
    expect(Math.hypot(hi[0].x, hi[0].y)).toBeCloseTo(112 * 1.5, 3);
    expect(lo.map((b) => b.color).slice(0, 6)).toEqual([...BUBBLE_COLORS, BUBBLE_COLORS[0]]);
  });
});
