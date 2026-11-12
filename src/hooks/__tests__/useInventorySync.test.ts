// @vitest-environment jsdom
// (importing the hook loads modules that read localStorage at init — jsdom provides it.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useInventorySync } from "@/hooks/useInventorySync";
import { toast } from "@/hooks/use-toast";

const MAX_ROWS = 1000; // PostgREST's per-response cap on the live project

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let ranges: Record<string, [number, number][]>;
let requestsByTable: Record<string, number>;
let failPage: { table: string; from: number } | null;

// A tiny PostgREST: honours is/order/range and caps every response at MAX_ROWS.
// Postgres doesn't promise an order for ties, so ties flip on alternate requests:
// paging without a unique tiebreak then skips and repeats rows, as it can for real.
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let [from, to] = [0, MAX_ROWS - 1];
  const run = () => {
    requestsByTable[table] = (requestsByTable[table] ?? 0) + 1;
    if (failPage?.table === table && failPage.from === from) {
      return { data: null, error: { message: "network down" } };
    }
    const matching = tables[table].filter((r) => filters.every((f) => f(r)));
    const base = requestsByTable[table] % 2 ? matching : [...matching].reverse();
    const sorted = [...base].sort((a, b) => {
      for (const { col, asc } of orders) {
        const cmp = String(a[col]).localeCompare(String(b[col]));
        if (cmp !== 0) return asc ? cmp : -cmp;
      }
      return 0;
    });
    return { data: sorted.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null };
  };
  const q = {
    select: () => q,
    is: (col: string, value: unknown) => {
      filters.push((r) => r[col] === value);
      return q;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      orders.push({ col, asc: opts?.ascending !== false });
      return q;
    },
    range: (a: number, b: number) => {
      [from, to] = [a, b];
      ranges[table].push([a, b]);
      return q;
    },
    then: (resolve: (r: ReturnType<typeof run>) => unknown) => resolve(run()),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => query(table) },
}));
const user = { id: "u1", email: "staff@js.test" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user }) }));
// Stable identity: fetchData depends on t, a fresh object would refetch forever.
const language = { t: { common: {}, inflow: {}, outflow: {} } };
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => language }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureError: vi.fn() }));

const makeRows = (n: number, prefix: string, overrides: (i: number) => Row = () => ({})): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(5, "0")}`,
    date: "2026-10-01",
    product: "NEGERI BIASA",
    quantity_original: 1,
    quantity_butir: 1,
    remaining_butir: 1,
    category: "egg",
    invoice_supplier: null,
    voided_at: null,
    created_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
    ...overrides(i),
  }));

async function load(inflows: Row[], outflows: Row[]) {
  tables = { inflows, outflows };
  const hook = renderHook(() => useInventorySync());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook.result;
}

beforeEach(() => {
  ranges = { inflows: [], outflows: [] };
  requestsByTable = {};
  failPage = null;
  vi.mocked(toast).mockClear();
});

describe("useInventorySync fetchData paging", () => {
  it("returns the newest outflows past the 1000-row cap, oldest first", async () => {
    // The shape measured on the live project on 2026-11-04.
    const result = await load(makeRows(387, "in"), makeRows(1325, "out"));

    expect(result.current.outflows).toHaveLength(1325);
    expect(result.current.outflows[0].id).toBe("out-00000");
    expect(result.current.outflows[1324].id).toBe("out-01324");
    expect(ranges.outflows).toEqual([[0, 999], [1000, 1999]]);
    expect(result.current.inflows).toHaveLength(387);
    expect(ranges.inflows).toEqual([[0, 999]]);
  });

  it("returns every inflow past the cap, since stock totals sum them", async () => {
    const result = await load(makeRows(2500, "in"), []);

    expect(result.current.inflows).toHaveLength(2500);
    expect(result.current.inflows.reduce((sum, i) => sum + i.remainingButir, 0)).toBe(2500);
    expect(ranges.inflows).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops cleanly when the row count is an exact multiple of the page size", async () => {
    const result = await load([], makeRows(2000, "out"));

    expect(result.current.outflows).toHaveLength(2000);
    expect(ranges.outflows).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("keeps voided rows out across pages", async () => {
    const voidEvery10th = (i: number) => ({ voided_at: i % 10 === 0 ? "2026-10-02T00:00:00Z" : null });
    const result = await load([], makeRows(1200, "out", voidEvery10th));

    expect(result.current.outflows).toHaveLength(1080);
    expect(result.current.outflows.some((o) => Number(o.id.slice(-5)) % 10 === 0)).toBe(false);
  });

  it("neither skips nor repeats rows that share a created_at across a page boundary", async () => {
    // One order's rows are written in one transaction, so they share a timestamp.
    const sameInstant = () => ({ created_at: "2026-10-01T00:00:00.000Z" });
    const result = await load([], makeRows(1500, "out", sameInstant));

    expect(new Set(result.current.outflows.map((o) => o.id)).size).toBe(1500);
  });

  it("keeps the last good data and shows the error when a later page fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await load(makeRows(1, "in"), makeRows(1325, "out"));

    failPage = { table: "outflows", from: 1000 };
    await act(() => result.current.refetch());

    expect(result.current.outflows).toHaveLength(1325);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    errorLog.mockRestore();
  });
});
