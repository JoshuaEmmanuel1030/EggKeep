// Drift guard: the Edge Function's order-grouping key MUST match the app's.
// If orderBucketKey diverges between src/lib/activityGrouping.ts and
// supabase/functions/inventory-assistant/orders.ts, the assistant would count
// "orders" differently than the Activity page shows. This test fails on drift.
import { describe, it, expect } from "vitest";
import { orderBucketKey as appKey } from "../activityGrouping";
import { orderBucketKey as edgeKey } from "../../../supabase/functions/inventory-assistant/orders";

const cases = [
  { buyerName: "OSAVE", orderLines: [{ skuCode: "N15B", packQty: 8 }], outflowDate: "2026-09-05", recordedAt: "2026-09-05T02:30:15.000Z" },
  { buyerName: "SBOX", orderLines: [], outflowDate: null, recordedAt: "2026-09-05T09:00:00.000Z" },
  { recordedAt: "2026-09-06T23:59:59.999Z" },
];

describe("order grouping stays in sync (app vs edge function)", () => {
  it("produces identical bucket keys for identical rows", () => {
    for (const c of cases) {
      // OrderLike (app) uses the same field names as OrderRow (edge).
      expect(edgeKey(c)).toBe(appKey(c));
    }
  });

  it("separates orders placed >30s apart, groups those within the bucket", () => {
    const base = { buyerName: "SEGARI", orderLines: [{ skuCode: "N6B", packQty: 20 }], outflowDate: "2026-09-05" };
    const t0 = edgeKey({ ...base, recordedAt: "2026-09-05T02:00:00.000Z" });
    const t15 = edgeKey({ ...base, recordedAt: "2026-09-05T02:00:15.000Z" }); // same 30s bucket
    const t45 = edgeKey({ ...base, recordedAt: "2026-09-05T02:00:45.000Z" }); // next bucket
    expect(t0).toBe(t15);
    expect(t0).not.toBe(t45);
  });
});
