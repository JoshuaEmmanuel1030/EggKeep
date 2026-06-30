import { describe, it, expect } from "vitest";
import {
  BOX_CAPACITIES,
  buildBoxCapacityMap,
  calculateBoxes,
} from "@/lib/outflowCalculator";
import { ItemType } from "@/types/inventory";

const boxItem = (name: string, boxCapacities?: Record<string, number>): ItemType => ({
  id: name,
  category: "box",
  name,
  boxCapacities,
});

describe("buildBoxCapacityMap", () => {
  it("returns the hardcoded baseline when no catalog rows are configured", () => {
    const map = buildBoxCapacityMap([]);
    expect(map).toEqual(BOX_CAPACITIES);
  });

  it("does not mutate the BOX_CAPACITIES baseline", () => {
    const before = JSON.stringify(BOX_CAPACITIES);
    const map = buildBoxCapacityMap([boxItem("box kecil", { N15B: 99 })]);
    map["box kecil"].N15B = 1; // mutate the result
    expect(JSON.stringify(BOX_CAPACITIES)).toBe(before);
  });

  it("overrides a baseline capacity for a configured box+SKU", () => {
    const map = buildBoxCapacityMap([boxItem("box kecil", { N15B: 6 })]);
    expect(map["box kecil"].N15B).toBe(6);
  });

  it("keeps other baseline SKUs for a partially-configured box", () => {
    const map = buildBoxCapacityMap([boxItem("box kecil", { N15B: 6 })]);
    // N6B was not in the override, so it stays at the baseline value.
    expect(map["box kecil"].N6B).toBe(BOX_CAPACITIES["box kecil"].N6B);
  });

  it("extends a box with a new SKU not present in the baseline", () => {
    const map = buildBoxCapacityMap([boxItem("box kecil", { NEWSKU: 12 })]);
    expect(map["box kecil"].NEWSKU).toBe(12);
  });

  it("skips unconfigured (no boxCapacities) catalog box rows", () => {
    const map = buildBoxCapacityMap([boxItem("box kecil")]);
    expect(map["box kecil"]).toEqual(BOX_CAPACITIES["box kecil"]);
  });

  it("ignores non-box item types", () => {
    const eggRow: ItemType = { id: "e", category: "egg", name: "NEGERI BIASA" };
    const map = buildBoxCapacityMap([eggRow]);
    expect(map).toEqual(BOX_CAPACITIES);
  });
});

describe("calculateBoxes with a capacity map", () => {
  it("uses the supplied map and rounds up partial boxes", () => {
    const map = buildBoxCapacityMap([boxItem("box kecil", { N15B: 6 })]);
    const { boxes, remainder, capacity } = calculateBoxes("N15B", 20, "box kecil", map);
    expect(capacity).toBe(6);
    expect(boxes).toBe(4); // ceil(20/6)
    expect(remainder).toBe(20 % 6); // 2 packs in the last box
  });

  it("falls back to the baseline when no map is passed", () => {
    const { boxes, capacity } = calculateBoxes("N15B", 16, "box kecil");
    expect(capacity).toBe(BOX_CAPACITIES["box kecil"].N15B); // 8
    expect(boxes).toBe(2);
  });

  it("signals an unconfigured combo with capacity:null (not a silent real 0)", () => {
    const { boxes, remainder, capacity } = calculateBoxes("UNKNOWN", 10, "box kecil");
    expect(capacity).toBeNull();
    expect(boxes).toBe(0);
    expect(remainder).toBe(10); // packs preserved so the UI can warn
  });

  it("returns no boxes for logistics-only modes", () => {
    const { boxes, capacity } = calculateBoxes("N15B", 10, "keranjang");
    expect(boxes).toBe(0);
    expect(capacity).toBeNull();
  });
});
