import { describe, it, expect } from "vitest";
import { normalizeDriverName, driverNameKey, isValidDriverName, isDuplicateDriverError, sortDrivers } from "@/lib/drivers";

describe("driver name normalization", () => {
  it("trims and collapses inner whitespace, keeps the typed case", () => {
    expect(normalizeDriverName("  Hendi  ")).toBe("Hendi");
    expect(normalizeDriverName("Dede   Supriyadi")).toBe("Dede Supriyadi");
    expect(normalizeDriverName("\tRiyan\n")).toBe("Riyan");
  });
  it("dedupes on the same key as drivers_name_key: upper(trim(name))", () => {
    expect(driverNameKey(" hendi ")).toBe("HENDI");
    expect(driverNameKey("HENDI")).toBe(driverNameKey("Hendi"));
    expect(driverNameKey("Dede  S")).toBe("DEDE S");
  });
  it("rejects blank names", () => {
    expect(isValidDriverName("   ")).toBe(false);
    expect(isValidDriverName("Ayub")).toBe(true);
  });
  it("recognises the unique_violation the index raises", () => {
    expect(isDuplicateDriverError({ code: "23505" })).toBe(true);
    expect(isDuplicateDriverError({ code: "42P01" })).toBe(false);
    expect(isDuplicateDriverError(null)).toBe(false);
  });
});

describe("sortDrivers", () => {
  it("lists active drivers first, each group A-Z ignoring case", () => {
    const sorted = sortDrivers([
      { name: "bolu", isActive: true },
      { name: "Ayub", isActive: false },
      { name: "Hendi", isActive: true },
      { name: "Dika", isActive: false },
    ]);
    expect(sorted.map((d) => d.name)).toEqual(["bolu", "Hendi", "Ayub", "Dika"]);
  });
});
