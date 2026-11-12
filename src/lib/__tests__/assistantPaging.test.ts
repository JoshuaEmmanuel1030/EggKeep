// The assistant's reads must see every row: PostgREST caps each response at 1000
// rows whatever .limit() asks, and voided rows are not stock or sales. The fake
// client below enforces that cap and the filters, so a read that forgets to page
// (or to skip voided rows) undercounts here exactly as it does live.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { fetchAll, runTool, spanDays } from "../../../supabase/functions/inventory-assistant/tools";

type Row = Record<string, any>;

function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let from = 0;
      let to = Infinity;
      let wantCount = false;
      const get = (r: Row, col: string) => {
        const [c, k] = col.split("->>");
        return k ? r[c]?.[k] : r[c];
      };
      const where = (keep: (r: Row) => boolean) => ((rows = rows.filter(keep)), b);
      const b: any = {
        select: (_cols: string, opts?: { count?: string }) => ((wantCount = !!opts?.count), b),
        eq: (c: string, v: unknown) => where((r) => get(r, c) === v),
        is: (c: string, v: unknown) => where((r) => (get(r, c) ?? null) === v),
        gt: (c: string, v: any) => where((r) => get(r, c) > v),
        gte: (c: string, v: any) => where((r) => get(r, c) >= v),
        lte: (c: string, v: any) => where((r) => get(r, c) <= v),
        order: () => b, // insertion order stands in for (created_at, id)
        limit: (n: number) => ((to = n - 1), b),
        range: (f: number, t: number) => ((from = f), (to = t), b),
        then: (ok: any, ko: any) =>
          Promise.resolve({
            data: rows.slice(from, Math.min(to + 1, from + 1000)), // the server cap
            count: wantCount ? rows.length : null,
            error: null,
          }).then(ok, ko),
      };
      return b;
    },
  };
}

const run = (name: string, args: Row, tables: Record<string, Row[]>) =>
  runTool(name, args, { supabase: fakeSupabase(tables), unit: () => "kg", freshnessDays: 5 }) as Promise<any>;

const times = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe("assistant reads past the 1000-row cap", () => {
  it("fetchAll keeps paging until a short page, and surfaces errors", async () => {
    const rows = times(2500, (i) => ({ i }));
    const got = await fetchAll((f, t) => fakeSupabase({ x: rows }).from("x").select("*").range(f, t));
    expect(got).toHaveLength(2500);
    await expect(fetchAll(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });

  it("sum_movements totals every outflow row and skips voided ones", async () => {
    const outflows = [
      ...times(2500, () => ({ date: "2026-10-15", product: "NEGERI BIASA", quantity_butir: 2, category: "egg", voided_at: null })),
      { date: "2026-10-15", product: "NEGERI BIASA", quantity_butir: 999, category: "egg", voided_at: "2026-10-16" },
    ];
    const res = await run("sum_movements", { action_type: "outflow", group_by: "product", date: "2026-10-15" }, { outflows });
    expect(res.groups).toEqual([{ key: "NEGERI BIASA", total: 5000, unit: "kg" }]);
  });

  it("sum_movements by buyer totals every activity row", async () => {
    const activity_logs = times(1500, () => ({
      action_type: "outflow", product: "PUYUH", quantity_butir: 1, voided_at: null,
      recorded_at: "2026-10-15T03:00:00+07:00", metadata: { buyerName: "OSAVE" },
    }));
    const res = await run("sum_movements", { action_type: "outflow", group_by: "buyer", date: "2026-10-15" }, { activity_logs });
    expect(res.groups).toEqual([{ key: "OSAVE", total: 1500 }]);
  });

  it("count_orders counts every order in the range", async () => {
    const activity_logs = times(1500, (i) => ({
      action_type: "outflow", voided_at: null, recorded_at: "2026-10-15T03:00:00+07:00",
      metadata: { orderType: "quick_outflow", buyerName: "OSAVE", orderLines: [{ skuCode: `N${i}` }], outflowDate: "2026-10-15" },
    }));
    const res = await run("count_orders", { date: "2026-10-15" }, { activity_logs });
    expect(res.total).toBe(1500);
  });

  it("get_returns totals every return but lists at most 200", async () => {
    const returns = times(300, (i) => ({
      return_date: i < 150 ? "2026-10-14" : "2026-10-15", product: "PUYUH", category: "egg",
      quantity: 1, disposition: "writeoff", voided_at: null,
    }));
    const res = await run("get_returns", { date_from: "2026-10-14", date_to: "2026-10-15" }, { returns });
    expect(res.count).toBe(300);
    expect(res.totalsByDisposition.writeoff).toBe(300);
    expect(res.rows).toHaveLength(200);
    expect(res.rows[0].date).toBe("2026-10-15"); // newest first
  });

  it("list_transactions reports the matching total, not the capped row count", async () => {
    const outflows = times(120, () => ({ date: "2026-10-15", product: "PUYUH", quantity_butir: 1, category: "egg", voided_at: null }));
    const res = await run("list_transactions", { date: "2026-10-15", limit: 50 }, { outflows });
    expect(res).toMatchObject({ total: 120, shown: 50 });
  });

  it("get_stock sums every active, non-voided batch", async () => {
    const inflows = [
      ...times(1200, () => ({ product: "PUYUH", remaining_butir: 1, date: "2026-11-08", category: "egg", voided_at: null })),
      { product: "PUYUH", remaining_butir: 500, date: "2026-11-08", category: "egg", voided_at: "2026-11-08" },
    ];
    const res = await run("get_stock", {}, { inflows });
    expect(res.products[0].total).toBe(1200);
  });
});

describe("spanDays", () => {
  it("counts from the earliest row through today, inclusive", () => {
    expect(spanDays(["2026-10-01", "2026-09-30", "2026-11-01"], "2026-11-09")).toBe(41);
    expect(spanDays([], "2026-11-09")).toBe(1);
  });
});
