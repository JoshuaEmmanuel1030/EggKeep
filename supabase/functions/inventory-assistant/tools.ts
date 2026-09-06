// Read-only, parameterized query tools for the inventory assistant.
//
// Every tool clamps its inputs (row limits, date ranges) and only reads. The model
// can trigger these but never issues raw SQL or writes. Quantities stay in each
// product's NATIVE unit (kg for weight-sold eggs, butir for count eggs, pcs else).

import { countOrders, OrderRow } from "./orders.ts";

// The Supabase JS client's query builder is structurally huge; we only use the
// chainable subset. Model it loosely — this file is Deno-only glue, not app code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_RANGE_DAYS = 92;

type UnitFn = (product: string, category: string) => "kg" | "butir" | "pcs";

// ---- shared param helpers -------------------------------------------------

function clampLimit(limit: unknown): number {
  const n = typeof limit === "number" ? Math.floor(limit) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Resolve {date} | {date_from,date_to} into an inclusive [from,to] day range,
// clamped to MAX_RANGE_DAYS. Returns an error string if the inputs are malformed.
export function resolveRange(args: {
  date?: string;
  date_from?: string;
  date_to?: string;
}): { from: string; to: string } | { error: string } {
  let from = args.date_from ?? args.date;
  let to = args.date_to ?? args.date;
  if (!from || !to) return { error: "Provide `date` or `date_from`+`date_to` as YYYY-MM-DD." };
  if (!DAY.test(from) || !DAY.test(to)) return { error: "Dates must be YYYY-MM-DD." };
  if (from > to) [from, to] = [to, from];
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    return { error: `Range too large (${days} days). Max ${MAX_RANGE_DAYS} days per query.` };
  }
  return { from, to };
}

// ---- tool schemas (sent to the model) -------------------------------------

export const toolDefinitions = [
  {
    name: "count_orders",
    description:
      "Count distinct customer ORDERS (grouped exactly like the Activities page: same buyer + order content + 30-second window) in a date range. Use for questions like 'how many orders on Sep 5'. Returns total plus per-buyer and per-day breakdowns.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Single day YYYY-MM-DD" },
        date_from: { type: "string", description: "Range start YYYY-MM-DD" },
        date_to: { type: "string", description: "Range end YYYY-MM-DD" },
        buyer: { type: "string", description: "Optional buyer name filter" },
      },
    },
  },
  {
    name: "list_transactions",
    description:
      "List individual inflow/outflow transaction rows in a date range. Use for 'which outbound movements happened on Sep 5'. Not the same as orders (one order has many rows).",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string" },
        date_from: { type: "string" },
        date_to: { type: "string" },
        action_type: { type: "string", enum: ["inflow", "outflow"] },
        product: { type: "string" },
        category: { type: "string", enum: ["egg", "box", "label", "packaging"] },
        limit: { type: "number", description: "Max rows (<=200, default 50)" },
      },
    },
  },
  {
    name: "sum_movements",
    description:
      "Sum inflow or outflow quantities in a date range, grouped by day, product, or buyer. Use for 'how much NEGERI went out last week'. Quantities are in each product's native unit.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string" },
        date_from: { type: "string" },
        date_to: { type: "string" },
        action_type: { type: "string", enum: ["inflow", "outflow"] },
        product: { type: "string" },
        group_by: { type: "string", enum: ["day", "product", "buyer"] },
      },
      required: ["action_type", "group_by"],
    },
  },
  {
    name: "get_returns",
    description:
      "List customer returns (retur) in a date range, with totals by disposition (restock vs writeoff). Use for 'any returns yesterday'.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string" },
        date_from: { type: "string" },
        date_to: { type: "string" },
        product: { type: "string" },
        disposition: { type: "string", enum: ["restock", "writeoff"] },
      },
    },
  },
  {
    name: "get_stock",
    description:
      "Current stock on hand for one product or all products, with at-risk quantity (older than freshness window) and oldest batches. Use for 'current stock of NEGERI OMEGA'.",
    input_schema: {
      type: "object",
      properties: {
        product: { type: "string", description: "Optional product name; omit for all" },
      },
    },
  },
] as const;

// ---- tool executor --------------------------------------------------------

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { supabase: SupabaseClient; unit: UnitFn; freshnessDays: number },
): Promise<unknown> {
  try {
    switch (name) {
      case "count_orders":
        return await countOrdersTool(args, ctx);
      case "list_transactions":
        return await listTransactionsTool(args, ctx);
      case "sum_movements":
        return await sumMovementsTool(args, ctx);
      case "get_returns":
        return await getReturnsTool(args, ctx);
      case "get_stock":
        return await getStockTool(args, ctx);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed" };
  }
}

async function countOrdersTool(
  args: Record<string, unknown>,
  { supabase }: { supabase: SupabaseClient },
) {
  const range = resolveRange(args);
  if ("error" in range) return range;
  const buyer = typeof args.buyer === "string" ? args.buyer : undefined;

  // Orders live in activity_logs (buyer is only in metadata). Filter to quick
  // outflows, in-range, not voided.
  const { data, error } = await supabase
    .from("activity_logs")
    .select("recorded_at, metadata, voided_at, action_type")
    .eq("action_type", "outflow")
    .gte("recorded_at", `${range.from}T00:00:00`)
    .lte("recorded_at", `${range.to}T23:59:59.999`)
    .is("voided_at", null)
    .limit(2000);
  if (error) return { error: error.message };

  const rows: (OrderRow & { day: string })[] = [];
  for (const r of data ?? []) {
    const md = r.metadata ?? {};
    if (md.orderType !== "quick_outflow") continue;
    if (buyer && md.buyerName !== buyer) continue;
    const day = md.outflowDate ?? String(r.recorded_at).slice(0, 10);
    rows.push({
      buyerName: md.buyerName,
      orderLines: md.orderLines,
      outflowDate: md.outflowDate,
      recordedAt: r.recorded_at,
      day,
    });
  }
  const result = countOrders(rows);
  return { range, ...result };
}

async function listTransactionsTool(
  args: Record<string, unknown>,
  { supabase, unit }: { supabase: SupabaseClient; unit: UnitFn },
) {
  const range = resolveRange(args);
  if ("error" in range) return range;
  const limit = clampLimit(args.limit);
  const table = args.action_type === "inflow" ? "inflows" : "outflows";

  let q = supabase
    .from(table)
    .select("date, product, quantity_butir, category, invoice_supplier, voided_at")
    .gte("date", range.from)
    .lte("date", range.to)
    .is("voided_at", null)
    .order("date", { ascending: false })
    .limit(limit);
  if (typeof args.product === "string") q = q.eq("product", args.product);
  if (typeof args.category === "string") q = q.eq("category", args.category);

  const { data, error } = await q;
  if (error) return { error: error.message };

  return {
    range,
    action_type: args.action_type === "inflow" ? "inflow" : "outflow",
    count: data?.length ?? 0,
    rows: (data ?? []).map((r: Record<string, unknown>) => ({
      date: r.date,
      product: r.product,
      quantity: Number(r.quantity_butir),
      unit: unit(r.product as string, r.category as string),
      supplier: r.invoice_supplier ?? null,
    })),
  };
}

async function sumMovementsTool(
  args: Record<string, unknown>,
  { supabase, unit }: { supabase: SupabaseClient; unit: UnitFn },
) {
  const range = resolveRange(args);
  if ("error" in range) return range;
  if (args.action_type !== "inflow" && args.action_type !== "outflow") {
    return { error: "action_type must be 'inflow' or 'outflow'." };
  }
  const groupBy = args.group_by;
  if (groupBy !== "day" && groupBy !== "product" && groupBy !== "buyer") {
    return { error: "group_by must be 'day', 'product', or 'buyer'." };
  }
  // Buyer grouping needs metadata → use activity_logs; else the raw table.
  if (groupBy === "buyer") {
    const { data, error } = await supabase
      .from("activity_logs")
      .select("product, quantity_butir, category, metadata, voided_at, action_type")
      .eq("action_type", args.action_type)
      .gte("recorded_at", `${range.from}T00:00:00`)
      .lte("recorded_at", `${range.to}T23:59:59.999`)
      .is("voided_at", null)
      .limit(5000);
    if (error) return { error: error.message };
    const acc: Record<string, number> = {};
    for (const r of data ?? []) {
      if (typeof args.product === "string" && r.product !== args.product) continue;
      const buyer = r.metadata?.buyerName ?? "(unknown)";
      acc[buyer] = (acc[buyer] ?? 0) + Number(r.quantity_butir);
    }
    return { range, group_by: "buyer", groups: toGroups(acc) };
  }

  const table = args.action_type === "inflow" ? "inflows" : "outflows";
  let q = supabase
    .from(table)
    .select("date, product, quantity_butir, category, voided_at")
    .gte("date", range.from)
    .lte("date", range.to)
    .is("voided_at", null)
    .limit(5000);
  if (typeof args.product === "string") q = q.eq("product", args.product);
  const { data, error } = await q;
  if (error) return { error: error.message };

  const acc: Record<string, number> = {};
  const unitOf: Record<string, string> = {};
  for (const r of data ?? []) {
    const key = groupBy === "day" ? String(r.date) : String(r.product);
    acc[key] = (acc[key] ?? 0) + Number(r.quantity_butir);
    if (groupBy === "product") unitOf[key] = unit(r.product, r.category);
  }
  return {
    range,
    action_type: args.action_type,
    group_by: groupBy,
    groups: toGroups(acc).map((g) =>
      groupBy === "product" ? { ...g, unit: unitOf[g.key] } : g
    ),
  };
}

async function getReturnsTool(
  args: Record<string, unknown>,
  { supabase, unit }: { supabase: SupabaseClient; unit: UnitFn },
) {
  const range = resolveRange(args);
  if ("error" in range) return range;

  let q = supabase
    .from("returns")
    .select("return_date, product, category, quantity, disposition, buyer_name, reason")
    .gte("return_date", range.from)
    .lte("return_date", range.to)
    .order("return_date", { ascending: false })
    .limit(MAX_LIMIT);
  if (typeof args.product === "string") q = q.eq("product", args.product);
  if (args.disposition === "restock" || args.disposition === "writeoff") {
    q = q.eq("disposition", args.disposition);
  }
  const { data, error } = await q;
  if (error) return { error: error.message };

  const totals: Record<string, number> = { restock: 0, writeoff: 0 };
  for (const r of data ?? []) {
    totals[r.disposition] = (totals[r.disposition] ?? 0) + Number(r.quantity);
  }
  return {
    range,
    count: data?.length ?? 0,
    totalsByDisposition: totals,
    rows: (data ?? []).map((r: Record<string, unknown>) => ({
      date: r.return_date,
      product: r.product,
      quantity: Number(r.quantity),
      unit: unit(r.product as string, r.category as string),
      disposition: r.disposition,
      buyer: r.buyer_name ?? null,
      reason: r.reason ?? null,
    })),
  };
}

async function getStockTool(
  args: Record<string, unknown>,
  { supabase, unit, freshnessDays }: { supabase: SupabaseClient; unit: UnitFn; freshnessDays: number },
) {
  let q = supabase
    .from("inflows")
    .select("product, remaining_butir, date, category, invoice_supplier")
    .gt("remaining_butir", 0)
    .is("voided_at", null)
    .order("date", { ascending: true })
    .limit(500);
  if (typeof args.product === "string") q = q.eq("product", args.product);
  const { data, error } = await q;
  if (error) return { error: error.message };

  const today = Date.now();
  const byProduct: Record<string, {
    product: string; category: string; unit: string;
    total: number; atRisk: number; batches: { date: string; qty: number; daysOld: number; atRisk: boolean; supplier: string | null }[];
  }> = {};
  for (const r of data ?? []) {
    const daysOld = Math.floor((today - Date.parse(r.date)) / 86_400_000);
    const atRisk = r.category === "egg" && daysOld > freshnessDays;
    if (!byProduct[r.product]) {
      byProduct[r.product] = {
        product: r.product, category: r.category, unit: unit(r.product, r.category),
        total: 0, atRisk: 0, batches: [],
      };
    }
    const p = byProduct[r.product];
    p.total += Number(r.remaining_butir);
    if (atRisk) p.atRisk += Number(r.remaining_butir);
    if (p.batches.length < 5) {
      p.batches.push({ date: r.date, qty: Number(r.remaining_butir), daysOld, atRisk, supplier: r.invoice_supplier ?? null });
    }
  }
  return { products: Object.values(byProduct) };
}

function toGroups(acc: Record<string, number>): { key: string; total: number }[] {
  return Object.entries(acc)
    .map(([key, total]) => ({ key, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}
