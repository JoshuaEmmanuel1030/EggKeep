// Order-grouping for the inventory assistant (Deno/Edge runtime).
//
// Runtime-isolated copy of the buyer-order grouping in src/lib/activityGrouping.ts.
// The Edge Function deploys separately from the Vite app and cannot import out of
// src/, so the key logic lives here too. A drift-guard test
// (src/lib/__tests__/orderGroupingSync.test.ts) asserts orderBucketKey produces
// the SAME string as the app's copy — change one, change both, or CI fails.
//
// Keep this file import-free so plain Node (the test) and Deno (the function) both load it.

export interface OrderRow {
  buyerName?: string;
  orderLines?: unknown;
  outflowDate?: string | null;
  recordedAt: string; // ISO timestamp (activity_logs.recorded_at)
}

// Rows from the same order share buyer + order content + outflow date + a
// 30-second time bucket. Mirrors src/lib/activityGrouping.ts:orderBucketKey.
export function orderBucketKey(o: OrderRow): string {
  const bucket = Math.floor(new Date(o.recordedAt).getTime() / 30000);
  return `${o.buyerName ?? ""}_${JSON.stringify(o.orderLines ?? [])}_${o.outflowDate ?? "null"}_${bucket}`;
}

export interface OrderCount {
  total: number;
  byBuyer: { buyer: string; orders: number }[];
  byDay: { date: string; orders: number }[];
}

// Count distinct buyer-orders from quick_outflow activity_logs rows. Each row
// carries a YYYY-MM-DD `day` (business/outflow date preferred, else recorded day).
export function countOrders(
  rows: (OrderRow & { day: string })[]
): OrderCount {
  const seen = new Set<string>();
  const buyerKeys = new Map<string, Set<string>>();
  const dayKeys = new Map<string, Set<string>>();

  for (const r of rows) {
    const key = orderBucketKey(r);
    seen.add(key);

    const buyer = r.buyerName ?? "(unknown)";
    if (!buyerKeys.has(buyer)) buyerKeys.set(buyer, new Set());
    buyerKeys.get(buyer)!.add(key);

    if (!dayKeys.has(r.day)) dayKeys.set(r.day, new Set());
    dayKeys.get(r.day)!.add(key);
  }

  return {
    total: seen.size,
    byBuyer: [...buyerKeys.entries()]
      .map(([buyer, keys]) => ({ buyer, orders: keys.size }))
      .sort((a, b) => b.orders - a.orders),
    byDay: [...dayKeys.entries()]
      .map(([date, keys]) => ({ date, orders: keys.size }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
