// Validation and id minting behind the Catalog forms editor.
// The column is JSONB and can still be written by hand, so a wrong shape is an
// expected failure: sanitizeForms has to guard the elements, not just the array.

import { describe, it, expect } from "vitest";
import { isEggForm, sanitizeForms, formIdFromName, type EggForm } from "@/lib/eggForms";
import { rowsToForms, rowToForm, mintId, emptyRow, formToRow, type FormRow } from "@/components/catalog/FormsEditor";

const row = (over: Partial<FormRow>): FormRow => ({ ...emptyRow(), ...over });
const good: EggForm = { id: "iketanosave", name: "Iketan Osave", unit: "butir", size: 150, unitWord: "iket" };

describe("isEggForm", () => {
  it("accepts a sized bundle and the two unsized units", () => {
    expect(isEggForm(good)).toBe(true);
    expect(isEggForm({ id: "curah", name: "Curah", unit: "native" })).toBe(true);
    expect(isEggForm({ id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "iketanosave"],
    ["an array", []],
    ["an empty object", {}],
    ["a blank id", { ...good, id: " " }],
    ["a blank name", { ...good, name: "" }],
    ["an unknown unit", { ...good, unit: "ikat" }],
    ["a missing size on a butir form", { id: "x", name: "X", unit: "butir" }],
    ["a zero size", { ...good, size: 0 }],
    ["a negative size", { ...good, size: -150 }],
    ["a non-numeric size", { ...good, size: "150" }],
    ["a non-string unitWord", { ...good, unitWord: 7 }],
  ])("rejects %s", (_label, value) => {
    expect(isEggForm(value)).toBe(false);
  });
});

describe("sanitizeForms", () => {
  it("returns nothing for a non-array", () => {
    expect(sanitizeForms(null)).toEqual([]);
    expect(sanitizeForms({ id: "x" })).toEqual([]);
    expect(sanitizeForms("iketanosave")).toEqual([]);
  });

  // The case that would otherwise render a garbled option in the Masuk picker.
  it("drops malformed elements and keeps the good ones in order", () => {
    const out = sanitizeForms([{}, good, null, "x", { id: "curah", name: "Curah", unit: "native" }]);
    expect(out.map((f) => f.id)).toEqual(["iketanosave", "curah"]);
  });

  it("keeps the first of a duplicated id", () => {
    const out = sanitizeForms([good, { ...good, name: "Duplicate" }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Iketan Osave");
  });
});

describe("formIdFromName / mintId", () => {
  it("slugs a name the way the seeded ids are shaped", () => {
    expect(formIdFromName("Iket 15 kg")).toBe("iket15kg");
    expect(formIdFromName("Iketan Osave")).toBe("iketanosave");
    expect(formIdFromName("No'6")).toBe("no6");
  });

  it("never yields an empty id", () => {
    expect(formIdFromName("   ")).toBe("bentuk");
    expect(formIdFromName("!!!")).toBe("bentuk");
  });

  it("suffixes a taken id instead of colliding", () => {
    expect(mintId("Tray 30", [])).toBe("tray30");
    expect(mintId("Tray 30", ["tray30"])).toBe("tray302");
    expect(mintId("Tray 30", ["tray30", "tray302"])).toBe("tray303");
  });
});

describe("rowToForm", () => {
  it("reads a size typed with a decimal comma", () => {
    const f = rowToForm(row({ id: "io", name: "Iketan Osave", unit: "kg", size: "9,25", unitWord: "iket" }));
    expect(f).toEqual({ id: "io", name: "Iketan Osave", unit: "kg", size: 9.25, unitWord: "iket" });
  });

  it("carries no size on native or weighed, and no unitWord on native", () => {
    expect(rowToForm(row({ id: "c", name: "Curah", unit: "native", size: "99", unitWord: "x" })))
      .toEqual({ id: "c", name: "Curah", unit: "native" });
    expect(rowToForm(row({ id: "t", name: "Tonase", unit: "weighed", size: "99", unitWord: "satuan" })))
      .toEqual({ id: "t", name: "Tonase", unit: "weighed", unitWord: "satuan" });
  });

  it("refuses a nameless row or a sized row with no usable size", () => {
    expect(rowToForm(row({ name: "  ", unit: "butir", size: "150" }))).toBeNull();
    expect(rowToForm(row({ name: "X", unit: "butir", size: "" }))).toBeNull();
    expect(rowToForm(row({ name: "X", unit: "butir", size: "0" }))).toBeNull();
    expect(rowToForm(row({ name: "X", unit: "kg", size: "abc" }))).toBeNull();
  });
});

describe("rowsToForms", () => {
  it("mints ids for new rows and leaves saved ids alone", () => {
    const out = rowsToForms([
      row({ id: "iketanosave", name: "Iketan Osave RENAMED", unit: "kg", size: "9,25", unitWord: "iket" }),
      row({ name: "Tray 30", unit: "butir", size: "30", unitWord: "tray" }),
    ]);
    // A rename must NOT change the id: inflows.form points at it.
    expect(out?.[0].id).toBe("iketanosave");
    expect(out?.[0].name).toBe("Iketan Osave RENAMED");
    expect(out?.[1].id).toBe("tray30");
  });

  it("uniquifies a minted id that collides with a saved one", () => {
    const out = rowsToForms([
      row({ id: "tray30", name: "Tray 30", unit: "butir", size: "30" }),
      row({ name: "Tray 30", unit: "butir", size: "30" }),
    ]);
    expect(out?.map((f) => f.id)).toEqual(["tray30", "tray302"]);
  });

  // Blocking beats dropping: a silently discarded row plus a success toast is how the
  // Masuk form lost a chosen Bentuk before that bug was fixed.
  it("returns null when any row is unusable, rather than dropping it", () => {
    expect(rowsToForms([row({ name: "", unit: "butir", size: "30" })])).toBeNull();
    expect(rowsToForms([
      row({ id: "ok", name: "Fine", unit: "butir", size: "30" }),
      row({ name: "Broken", unit: "butir", size: "" }),
    ])).toBeNull();
  });

  it("accepts an empty list, which is how the last form is removed", () => {
    expect(rowsToForms([])).toEqual([]);
  });

  it("round-trips a saved form through the editor unchanged", () => {
    const out = rowsToForms([formToRow(good)]);
    expect(out).toEqual([good]);
  });
});
