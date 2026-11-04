// @vitest-environment jsdom
// (importing useOfflineSync loads the supabase client, which reads localStorage
// at module init — jsdom provides it.)
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { isPendingLogResolved, useOfflineSync } from "@/hooks/useOfflineSync";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: { message: "Failed to fetch" } }) }) },
}));
const user = { id: "u1", email: "staff@js.test" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

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

describe("addActivityLog", () => {
  it("queues every row of one order, not just the last", async () => {
    // Offline: rows go straight to the queue (the online-failure path uses the
    // same append) and auto-sync stays off, so nothing drains it mid-test.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    localStorage.removeItem("pending_activity_logs");
    const { result } = renderHook(() => useOfflineSync());
    // Index awaits one closure per row in a loop; keep that closure.
    const add = result.current.addActivityLog;
    const row = (product: string) => ({
      action_type: "outflow" as const,
      product,
      quantity_butir: 1,
      recorded_at: "2026-11-03T01:00:00.000Z",
      category: "egg" as const,
    });
    await act(async () => {
      await add(row("NEGERI BIASA"));
      await add(row("PUYUH"));
    });
    const stored = JSON.parse(localStorage.getItem("pending_activity_logs") || "[]");
    expect(stored.map((l: { product: string }) => l.product)).toEqual(["NEGERI BIASA", "PUYUH"]);
    expect(result.current.pendingCount).toBe(2);
  });
});
