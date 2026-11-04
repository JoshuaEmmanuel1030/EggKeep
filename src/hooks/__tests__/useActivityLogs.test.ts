// @vitest-environment jsdom
// (importing the hook loads modules that read localStorage at init — jsdom provides it.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { toast } from "@/hooks/use-toast";

const MAX_ROWS = 1000; // PostgREST's per-response cap on the live project

type Row = Record<string, unknown>;
let table: Row[];
let ranges: [number, number][];
let requests: number;
let failFrom: number | null;
let afterFirstRequest: (() => void) | null;

// A tiny PostgREST: honours order/range and caps every response at MAX_ROWS.
// Postgres doesn't promise an order for ties, so ties flip on alternate requests:
// paging without a unique tiebreak then skips and repeats rows, as it can for real.
function query() {
  const orders: { col: string; asc: boolean }[] = [];
  let [from, to] = [0, MAX_ROWS - 1];
  const run = () => {
    requests += 1;
    if (failFrom === from) return { data: null, error: { message: "network down" } };
    const base = requests % 2 ? table : [...table].reverse();
    const sorted = [...base].sort((a, b) => {
      for (const { col, asc } of orders) {
        const cmp = String(a[col]).localeCompare(String(b[col]));
        if (cmp !== 0) return asc ? cmp : -cmp;
      }
      return 0;
    });
    const page = sorted.slice(from, Math.min(to + 1, from + MAX_ROWS));
    afterFirstRequest?.();
    afterFirstRequest = null;
    return { data: page, error: null };
  };
  const q = {
    select: () => q,
    order: (col: string, opts?: { ascending?: boolean }) => {
      orders.push({ col, asc: opts?.ascending !== false });
      return q;
    },
    range: (a: number, b: number) => {
      [from, to] = [a, b];
      ranges.push([a, b]);
      return q;
    },
    then: (resolve: (r: ReturnType<typeof run>) => unknown) => resolve(run()),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: () => query(), channel: () => channel, removeChannel: () => {} } };
});
const user = { id: "u1", email: "staff@js.test" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/hooks/useOfflineSync", () => ({
  useOfflineSync: () => ({ pendingLogs: [], pendingCount: 0, isOnline: true }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

// Index 0 is the newest row, as the feed reads them.
const makeRows = (n: number, prefix = "log", overrides: () => Row = () => ({})): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(5, "0")}`,
    action_type: "outflow",
    product: "NEGERI BIASA",
    quantity_butir: 1,
    category: "egg",
    recorded_at: new Date(Date.UTC(2026, 9, 31) - i * 60_000).toISOString(),
    ...overrides(),
  }));

async function load(rows: Row[]) {
  table = rows;
  const hook = renderHook(() => useActivityLogs());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook.result;
}

beforeEach(() => {
  ranges = [];
  requests = 0;
  failFrom = null;
  afterFirstRequest = null;
  vi.mocked(toast).mockClear();
});

describe("useActivityLogs paging", () => {
  it("returns the oldest logs past the 1000-row cap, newest first", async () => {
    // The shape measured on the live project on 2026-11-04.
    const result = await load(makeRows(1739));

    expect(result.current.logs).toHaveLength(1739);
    expect(result.current.logs[0].id).toBe("log-00000");
    expect(result.current.logs[1738].id).toBe("log-01738");
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it("neither skips nor repeats rows that share a recorded_at across a page boundary", async () => {
    // One order's rows are written with the same timestamp.
    const sameInstant = () => ({ recorded_at: "2026-10-31T00:00:00.000Z" });
    const result = await load(makeRows(1500, "log", sameInstant));

    expect(new Set(result.current.logs.map((l) => l.id)).size).toBe(1500);
  });

  it("doesn't repeat rows when an order is saved while the pages load", async () => {
    // Newest first: the new rows push older ones onto the next page.
    afterFirstRequest = () => {
      const newOrder = makeRows(10, "new").map((r, i) => ({
        ...r,
        recorded_at: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
      }));
      table = [...newOrder, ...table];
    };
    const result = await load(makeRows(1200));

    const ids = result.current.logs.map((l) => l.id);
    expect(ids).toHaveLength(1200);
    expect(new Set(ids).size).toBe(1200);
  });

  it("keeps the last good logs and shows the error when a later page fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await load(makeRows(1739));

    failFrom = 1000;
    await act(() => result.current.refetch());

    expect(result.current.logs).toHaveLength(1739);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    errorLog.mockRestore();
  });
});
