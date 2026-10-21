// Pure helpers behind the tablet Activities filters: date presets and the
// header's "today" stat pills.
import { isSameDay, parseISO, startOfDay, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import type { ActivityLog } from "@/types/activityLog";
import { entryKind, orderBucketKey, type EntryKind } from "@/lib/activityGrouping";

// Type tab: All includes voided (struck through), Voided shows only voided,
// Orders / Kastun / Inflows exclude voided. Date/buyer/supplier/search still
// apply on top on every tab, Voided included.
export function matchesType(log: ActivityLog, type: "all" | EntryKind | "voided"): boolean {
  if (type === "all") return true;
  if (type === "voided") return log.voided_at != null;
  return !log.voided_at && entryKind(log) === type;
}

export type DatePreset = "today" | "last7" | "last30" | "allTime" | "custom";
type FixedPreset = "today" | "last7" | "last30";

// Days back from today; "Last 7 days" includes today.
const PRESET_DAYS: Record<FixedPreset, number> = { today: 0, last7: 6, last30: 29 };

export function presetRange(p: FixedPreset, now: Date = new Date()): DateRange {
  return { from: startOfDay(subDays(now, PRESET_DAYS[p])), to: startOfDay(now) };
}

// Which preset chip a dateRange corresponds to (compared by calendar day).
export function presetOf(range: DateRange | undefined, now: Date = new Date()): DatePreset {
  if (!range?.from && !range?.to) return "allTime";
  const { from, to } = range;
  if (!from || !to) return "custom";
  const match = (Object.keys(PRESET_DAYS) as FixedPreset[]).find((p) => {
    const r = presetRange(p, now);
    return isSameDay(from, r.from!) && isSameDay(to, r.to!);
  });
  return match ?? "custom";
}

// Header stats for today (local day), over non-voided logs. Orders count
// distinct quick orders (same key as the feed's grouping) plus one per Kastun
// log; inflows count inflow logs.
export function todayStats(logs: ActivityLog[], now: Date = new Date()): { orders: number; inflows: number } {
  const orderKeys = new Set<string>();
  let inflows = 0;
  for (const log of logs) {
    if (log.voided_at || !isSameDay(parseISO(log.recorded_at), now)) continue;
    const kind = entryKind(log);
    if (kind === "inflow") inflows += 1;
    else if (kind === "manual") orderKeys.add(`manual_${log.id}`);
    else
      orderKeys.add(
        orderBucketKey({
          buyerName: log.metadata?.buyerName,
          orderLines: log.metadata?.orderLines || [],
          outflowDate: log.metadata?.outflowDate,
          recordedAt: log.recorded_at,
        })
      );
  }
  return { orders: orderKeys.size, inflows };
}

// Number of rows the tablet feed shows for these logs: a quick order's
// material rows collapse into one entry (same key as the feed's grouping);
// every other log is its own entry. Used for "Showing N of M" / "Show N".
export function countEntries(logs: ActivityLog[]): number {
  const orderKeys = new Set<string>();
  let others = 0;
  for (const log of logs) {
    if (entryKind(log) !== "quick") {
      others += 1;
      continue;
    }
    orderKeys.add(
      orderBucketKey({
        buyerName: log.metadata?.buyerName,
        orderLines: log.metadata?.orderLines || [],
        outflowDate: log.metadata?.outflowDate,
        recordedAt: log.recorded_at,
      })
    );
  }
  return orderKeys.size + others;
}
