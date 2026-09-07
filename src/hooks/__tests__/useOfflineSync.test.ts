// @vitest-environment jsdom
// (importing useOfflineSync loads the supabase client, which reads localStorage
// at module init — jsdom provides it.)
import { describe, it, expect } from "vitest";
import { isPendingLogResolved } from "@/hooks/useOfflineSync";

describe("isPendingLogResolved", () => {
  it("treats a clean insert (no error) as resolved", () => {
    expect(isPendingLogResolved(null)).toBe(true);
    expect(isPendingLogResolved(undefined)).toBe(true);
  });

  it("treats a 23505 duplicate-key violation as resolved (row already saved)", () => {
    // Original insert committed but its response was lost, so the same log id
    // is retried and collides on the activity_logs primary key. Dropping it
    // stops the 'phantom pending' from getting stuck forever.
    expect(isPendingLogResolved({ code: "23505" })).toBe(true);
  });

  it("keeps other errors queued for retry (transient / not a duplicate)", () => {
    expect(isPendingLogResolved({ code: "23503" })).toBe(false); // FK violation
    expect(isPendingLogResolved({ code: "42501" })).toBe(false); // RLS / insufficient privilege
    expect(isPendingLogResolved({ code: "PGRST301" })).toBe(false); // auth expired
    expect(isPendingLogResolved({})).toBe(false); // network-ish, no code
  });
});
