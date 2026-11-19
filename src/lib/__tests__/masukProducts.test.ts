import { describe, expect, it } from "vitest";
import { masukEggProducts } from "@/lib/masukProducts";

const itemTypes = [
  { name: "KAMPUNG BIASA", isRetakan: false },
  { name: "NEGERI BIASA", isRetakan: false },
  { name: "NEGERI BIASA (RETAKAN)", isRetakan: true },
  { name: "PUYUH", isRetakan: false },
  { name: "PUYUH (RETAKAN)", isRetakan: true },
];

describe("masukEggProducts", () => {
  it("drops the (RETAKAN) children and keeps every other egg, in order", () => {
    const names = itemTypes.map((t) => t.name);
    expect(masukEggProducts(names, itemTypes)).toEqual(["KAMPUNG BIASA", "NEGERI BIASA", "PUYUH"]);
  });

  it("goes by the is_retakan flag, not the name", () => {
    // A name that merely contains RETAKAN but isn't flagged stays offered.
    expect(masukEggProducts(["X (RETAKAN)"], [{ name: "X (RETAKAN)", isRetakan: false }])).toEqual(["X (RETAKAN)"]);
  });

  it("keeps the offline fallback names when the catalog hasn't loaded", () => {
    expect(masukEggProducts(["NEGERI BIASA", "PUYUH"], [])).toEqual(["NEGERI BIASA", "PUYUH"]);
  });
});
