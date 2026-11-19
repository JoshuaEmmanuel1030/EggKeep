// Counting stock in bundles: which bundles are countable, what they sum to, and
// that the item_types write payload carries them.

import { describe, it, expect } from "vitest";
import { countFormsFor, formsFor, sumCountedBundles, type EggForm } from "@/lib/eggForms";
import { itemTypeColumns } from "@/lib/itemTypeColumns";
import type { ItemType } from "@/types/inventory";

const IKET15: EggForm = { id: "iket15kg", name: "Iket 15 kg", unit: "kg", size: 15, unitWord: "iket" };
const TRAY30: EggForm = { id: "tray30", name: "Tray 30", unit: "butir", size: 30, unitWord: "tray" };
const CURAH: EggForm = { id: "curah", name: "Curah", unit: "native", size: 1 };
const TONASE: EggForm = { id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" };
const OSAVE: EggForm = { id: "iketanosave", name: "Iketan Osave", unit: "butir", size: 150, unitWord: "iket" };
const KARTON: EggForm = { id: "kartonosave", name: "Karton Osave", unit: "butir", size: 180, unitWord: "karton" };

const negeri = (over: Partial<ItemType> = {}): ItemType[] => [
  {
    id: "1", name: "NEGERI BIASA", category: "egg", unit: "kg", eggsPerUnit: 15.5,
    forms: [IKET15, TRAY30, CURAH, TONASE],
    countForms: [OSAVE, KARTON],
    ...over,
  } as ItemType,
];

describe("countFormsFor", () => {
  it("counts the arrival forms plus the count-only ones", () => {
    expect(countFormsFor("NEGERI BIASA", negeri()).map((f) => f.id))
      .toEqual(["iket15kg", "tray30", "curah", "tonase", "iketanosave", "kartonosave"]);
  });

  // The whole point of the split: Masuk must not offer a receipt that never happens.
  it("leaves the count-only forms out of Masuk", () => {
    expect(formsFor("NEGERI BIASA", negeri()).map((f) => f.id))
      .toEqual(["iket15kg", "tray30", "curah", "tonase"]);
  });

  it("lets an arrival form shadow a count form of the same id", () => {
    const types = negeri({ countForms: [{ ...TRAY30, name: "Tray 30 LEFTOVER", size: 999 }] });
    const out = countFormsFor("NEGERI BIASA", types);
    expect(out.filter((f) => f.id === "tray30")).toHaveLength(1);
    expect(out.find((f) => f.id === "tray30")!.size).toBe(30);
  });

  it("drops malformed rows from either list", () => {
    const types = negeri({
      forms: [IKET15, null, {}] as unknown as EggForm[],
      countForms: ["x", OSAVE, { id: "", name: "bad", unit: "butir", size: 1 }] as unknown as EggForm[],
    });
    expect(countFormsFor("NEGERI BIASA", types).map((f) => f.id)).toEqual(["iket15kg", "iketanosave"]);
  });

  it("returns nothing for an unknown product", () => {
    expect(countFormsFor("NOT A PRODUCT", negeri())).toEqual([]);
    expect(countFormsFor("NEGERI BIASA", [])).toEqual([]);
  });
});

describe("sumCountedBundles", () => {
  const forms = [IKET15, TRAY30, CURAH, TONASE, OSAVE];
  const sum = (counts: Record<string, number | null>) =>
    sumCountedBundles({ forms, counts, nativeUnit: "kg", eggsPerUnit: 15.5 });

  it("adds a kg bundle exactly and a butir bundle through the rate", () => {
    // 3 x 15 kg = 45; 5 x 150 butir / 15,5 = 48,39
    expect(sum({ iket15kg: 3, iketanosave: 5 })).toEqual({ total: 93.39, lines: 2 });
  });

  it("takes a native form as the amount itself", () => {
    expect(sum({ curah: 12.5 })).toEqual({ total: 12.5, lines: 1 });
  });

  // A weighed form's size is one delivery's scale reading, not a shelf property, so
  // toNative has no size to use and returns null. Contract, not a special case.
  it("never counts a weighed form, even with a count against it", () => {
    expect(sum({ tonase: 4 })).toEqual({ total: 0, lines: 0 });
    expect(sum({ iket15kg: 1, tonase: 4 })).toEqual({ total: 15, lines: 1 });
  });

  it("ignores blank, zero and negative counts", () => {
    expect(sum({ iket15kg: null, tray30: 0, curah: -5 })).toEqual({ total: 0, lines: 0 });
  });

  it("rounds the total to 2 dp", () => {
    // 1 x 150 / 15,5 = 9,677419...
    expect(sum({ iketanosave: 1 }).total).toBe(9.68);
  });

  it("contributes nothing when a kg product has no rate", () => {
    const noRate = sumCountedBundles({ forms, counts: { iketanosave: 5 }, nativeUnit: "kg" });
    expect(noRate).toEqual({ total: 0, lines: 0 });
  });

  it("counts butir bundles in butir on a count-sold product", () => {
    const out = sumCountedBundles({
      forms: [TRAY30], counts: { tray30: 7 }, nativeUnit: "butir",
    });
    expect(out).toEqual({ total: 210, lines: 1 });
  });
});

// The regression: `forms` was wired into the insert payload and forgotten in the
// update, so editing a product dropped them silently. One builder, one test.
describe("itemTypeColumns", () => {
  it("carries both jsonb columns when given", () => {
    const out = itemTypeColumns({ name: "NEGERI BIASA", forms: [IKET15], countForms: [OSAVE] });
    expect(out).toMatchObject({ forms: [IKET15], count_forms: [OSAVE] });
  });

  it("omits the keys entirely when not given, so a non-egg save leaves them alone", () => {
    const out = itemTypeColumns({ name: "box kecil" });
    expect("forms" in out).toBe(false);
    expect("count_forms" in out).toBe(false);
  });

  it("writes an empty array, which is how the last form is removed", () => {
    const out = itemTypeColumns({ name: "NEGERI BIASA", forms: [], countForms: [] });
    expect(out).toMatchObject({ forms: [], count_forms: [] });
  });

  it("still maps the ordinary columns", () => {
    expect(itemTypeColumns({ name: "N", unit: "kg", eggsPerUnit: 15.5, countTolerance: 0 }))
      .toMatchObject({ name: "N", unit: "kg", eggs_per_unit: 15.5, count_tolerance: 0 });
  });
});
