// The edge runtime clock is UTC; the assistant's "today" and batch ages must use
// the WIB (UTC+7) business day, or it answers for yesterday before 07:00 WIB.
import { describe, it, expect } from "vitest";
import { wibDay, ageInDays } from "../../../supabase/functions/inventory-assistant/tools";

describe("assistant WIB dates", () => {
  it("rolls to the next day at 00:00 WIB (17:00 UTC)", () => {
    expect(wibDay("2026-10-28T16:59:59Z")).toBe("2026-10-28");
    expect(wibDay("2026-10-28T17:00:00Z")).toBe("2026-10-29");
  });

  it("counts batch age in whole business days", () => {
    expect(ageInDays("2026-10-24", "2026-10-29")).toBe(5);
    expect(ageInDays("2026-10-29", "2026-10-29")).toBe(0);
  });
});
