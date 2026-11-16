import { describe, it, expect } from "vitest";
import {
  formsFor, findForm, entryUnit, toNative, formUnitWord,
  TONASE_MIN_KG, TONASE_MAX_KG, TONASE_STEP_KG, type EggForm,
} from "@/lib/eggForms";
import type { ItemType } from "@/types/inventory";

const IKET15: EggForm = { id: "iket15kg", name: "Iket 15 kg", size: 15, unit: "kg", unitWord: "iket" };
const TRAY30: EggForm = { id: "tray30", name: "Tray 30", size: 30, unit: "butir", unitWord: "tray" };
const CURAH: EggForm = { id: "curah", name: "Curah", size: 1, unit: "native" };
const TONASE: EggForm = { id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" };

const ITEM_TYPES: ItemType[] = [
  { id: "1", category: "egg", name: "NEGERI BIASA", unit: "kg", eggsPerUnit: 15.5, forms: [IKET15, TRAY30, CURAH, TONASE] },
  { id: "2", category: "egg", name: "KAMPUNG BIASA", unit: "btr", eggsPerUnit: 1, forms: [TRAY30, CURAH] },
  { id: "3", category: "egg", name: "NEGERI BARU", unit: "kg", eggsPerUnit: 15.5 },
  { id: "4", category: "packaging", name: "NEGERI ISI 10" },
];

describe("formsFor", () => {
  it("returns the product's forms in catalogue order", () => {
    expect(formsFor("NEGERI BIASA", ITEM_TYPES).map((f) => f.id)).toEqual(["iket15kg", "tray30", "curah", "tonase"]);
  });

  it("returns [] for a product with no forms configured", () => {
    expect(formsFor("NEGERI BARU", ITEM_TYPES)).toEqual([]);
  });

  it("returns [] for an unknown product and for a non-egg item", () => {
    expect(formsFor("NOPE", ITEM_TYPES)).toEqual([]);
    expect(formsFor("NEGERI ISI 10", ITEM_TYPES)).toEqual([]);
  });

  it("returns [] when the catalogue has not loaded", () => {
    expect(formsFor("NEGERI BIASA", [])).toEqual([]);
  });

  // There is no Catalog editor for this column, so hand-written SQL is the only way
  // to maintain it and a wrong JSONB shape is the expected failure. It must never
  // reach the picker's forms.map, which would take the whole app down.
  it("returns [] when forms is not an array", () => {
    const malformed = [
      { id: "5", category: "egg", name: "BAD OBJECT", forms: { iket15kg: IKET15 } },
      { id: "6", category: "egg", name: "BAD STRING", forms: "iket15kg" },
      { id: "7", category: "egg", name: "BAD NULL", forms: null },
      { id: "8", category: "egg", name: "BAD NUMBER", forms: 15 },
    ] as unknown as ItemType[];
    expect(formsFor("BAD OBJECT", malformed)).toEqual([]);
    expect(formsFor("BAD STRING", malformed)).toEqual([]);
    expect(formsFor("BAD NULL", malformed)).toEqual([]);
    expect(formsFor("BAD NUMBER", malformed)).toEqual([]);
  });
});

describe("findForm", () => {
  const forms = formsFor("NEGERI BIASA", ITEM_TYPES);

  it("finds a form by id", () => {
    expect(findForm(forms, "tray30")).toEqual(TRAY30);
  });

  it("treats null, undefined and empty as Langsung", () => {
    expect(findForm(forms, null)).toBeNull();
    expect(findForm(forms, undefined)).toBeNull();
    expect(findForm(forms, "")).toBeNull();
  });

  it("returns null for an id that is no longer in the catalogue", () => {
    expect(findForm(forms, "removed")).toBeNull();
  });
});

describe("entryUnit", () => {
  it("is the native unit for Langsung", () => {
    expect(entryUnit(null, "kg")).toBe("kg");
    expect(entryUnit(null, "butir")).toBe("butir");
  });

  it("is the native unit for Curah", () => {
    expect(entryUnit(CURAH, "kg")).toBe("kg");
  });

  it("is a whole count for every bundled form, whatever the product", () => {
    expect(entryUnit(IKET15, "kg")).toBe("butir");
    expect(entryUnit(TRAY30, "kg")).toBe("butir");
    expect(entryUnit(TONASE, "kg")).toBe("butir");
  });
});

describe("toNative", () => {
  const kg = { nativeUnit: "kg" as const, eggsPerUnit: 15.5 };
  const btr = { nativeUnit: "butir" as const, eggsPerUnit: 1 };

  it("multiplies a kg form by its size", () => {
    expect(toNative({ form: IKET15, count: 79, ...kg })).toBe(1185);
  });

  it("divides a butir form by eggs per kg on a kg product", () => {
    expect(toNative({ form: TRAY30, count: 20, ...kg })).toBe(38.71);
  });

  it("multiplies a butir form by its size on a butir product", () => {
    expect(toNative({ form: TRAY30, count: 5, ...btr })).toBe(150);
  });

  it("uses the line's weight for a weighed form", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 16.8, ...kg })).toBe(168);
  });

  it("returns null for a weighed form with no weight yet", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: null, ...kg })).toBeNull();
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 0, ...kg })).toBeNull();
  });

  // The stepper and the blur restore keep the field inside the range, but a paste
  // never blurs, so the quantity itself has to refuse a weight outside it.
  it("returns null for a weight below the floor or above the ceiling", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 1.6, ...kg })).toBeNull();
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 168, ...kg })).toBeNull();
  });

  it("accepts the bounds themselves", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: TONASE_MIN_KG, ...kg })).toBe(50);
    expect(toNative({ form: TONASE, count: 10, tonaseKg: TONASE_MAX_KG, ...kg })).toBe(300);
  });

  it("refuses a weighed form on a butir product: Tonase is kg-only", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 16.8, ...btr })).toBeNull();
  });

  it("refuses a kg-sized form on a butir product: a weight per bundle is kg-only", () => {
    expect(toNative({ form: IKET15, count: 79, ...btr })).toBeNull();
  });

  it("passes Curah and Langsung through as typed", () => {
    expect(toNative({ form: CURAH, count: 24, ...kg })).toBe(24);
    expect(toNative({ form: null, count: 52.89, ...kg })).toBe(52.89);
  });

  it("returns null for a missing, zero or negative count", () => {
    expect(toNative({ form: IKET15, count: null, ...kg })).toBeNull();
    expect(toNative({ form: IKET15, count: 0, ...kg })).toBeNull();
    expect(toNative({ form: IKET15, count: -3, ...kg })).toBeNull();
  });

  it("returns null when a kg product has no conversion configured", () => {
    expect(toNative({ form: TRAY30, count: 20, nativeUnit: "kg", eggsPerUnit: undefined })).toBeNull();
  });

  it("rounds to 2 dp, like the rest of the app", () => {
    expect(toNative({ form: TRAY30, count: 7, ...kg })).toBe(13.55);
  });
});

describe("formUnitWord", () => {
  it("uses the catalogue word when there is one", () => {
    expect(formUnitWord(IKET15, "kg")).toBe("iket");
    expect(formUnitWord(TONASE, "kg")).toBe("satuan");
  });

  it("falls back to the native unit for Curah and Langsung", () => {
    expect(formUnitWord(CURAH, "kg")).toBe("kg");
    expect(formUnitWord(null, "butir")).toBe("butir");
  });
});

describe("Tonase bounds", () => {
  // A wide sanity range, not a tight band: the spec fixes all three numbers.
  it("are the values the spec states", () => {
    expect(TONASE_MIN_KG).toBe(5);
    expect(TONASE_MAX_KG).toBe(30);
    expect(TONASE_STEP_KG).toBe(0.1);
  });
});
