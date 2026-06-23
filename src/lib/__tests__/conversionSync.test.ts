import { describe, it, expect } from "vitest";
import { CONVERSION_DICT as APP_DICT } from "@/types/inventory";
import {
  CONVERSION_DICT as FN_DICT,
  EGGS_PER_TRAY,
} from "../../../supabase/functions/inventory-assistant/conversions";

// Drift guard: the inventory assistant Edge Function deploys separately from the app
// and keeps its own copy of the conversion table. These must never disagree, or the
// assistant will quote different kg<->butir factors than the app calculates with.
// If this test fails, you changed a conversion in one place but not the other.
describe("conversion table sync (app <-> edge function)", () => {
  it("the edge function dict matches the app dict exactly", () => {
    expect(FN_DICT).toEqual(APP_DICT);
  });

  it("covers the same set of products in both copies", () => {
    expect(Object.keys(FN_DICT).sort()).toEqual(Object.keys(APP_DICT).sort());
  });

  it("pins the known-correct factors that caused the original bug", () => {
    // The reported bug: assistant guessed ~20 butir/kg. Real factor is 15.5.
    expect(APP_DICT["NEGERI BIASA"]).toEqual({ unit: "kg", eggs_per_unit: 15.5 });
    expect(APP_DICT["NEGERI OMEGA"]).toEqual({ unit: "kg", eggs_per_unit: 15.5 });
    expect(EGGS_PER_TRAY).toBe(30);
  });
});
