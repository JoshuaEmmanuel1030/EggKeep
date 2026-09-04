// Pure helpers behind the Activities feed. Extracted so the grouping /
// edit-window / return-clamp rules can be unit-tested without a DOM.
import { differenceInHours, parseISO } from "date-fns";

export interface OrderLike {
  buyerName?: string;
  orderLines?: unknown;
  outflowDate?: string | null;
  recordedAt: string; // ISO
}

// Buyer-order grouping key. Rows from the same order share buyer + order
// content + outflow date + a 30-second time bucket; orders placed minutes apart
// fall into different buckets and stay separate. Mirrors GroupedActivityLog.
export function orderBucketKey(o: OrderLike): string {
  const bucket = Math.floor(new Date(o.recordedAt).getTime() / 30000);
  return `${o.buyerName ?? ""}_${JSON.stringify(o.orderLines ?? [])}_${o.outflowDate ?? "null"}_${bucket}`;
}

// True when two order-line rows collapse into one displayed buyer order.
export function sameOrder(a: OrderLike, b: OrderLike): boolean {
  return orderBucketKey(a) === orderBucketKey(b);
}

// Edit/void window: admins always; owners within 48h of creation.
export function canEditEntry(params: {
  createdAt: string;
  entryUserId?: string;
  currentUserId?: string;
  isAdmin: boolean;
  now?: Date;
}): boolean {
  const { createdAt, entryUserId, currentUserId, isAdmin, now = new Date() } = params;
  if (isAdmin) return true;
  if (entryUserId && currentUserId !== entryUserId) return false;
  return differenceInHours(now, parseISO(createdAt)) <= 48;
}

export function editWindowHoursRemaining(createdAt: string, now: Date = new Date()): number {
  return Math.max(0, 48 - differenceInHours(now, parseISO(createdAt)));
}

// The submit-time clamp used by the return dialog: never return more than the
// line sold. Accepts comma decimals; non-numeric / negative -> 0.
export function clampReturnQty(raw: string | number, max: number): number {
  const num = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
  if (isNaN(num) || num <= 0) return 0;
  return Math.min(num, max);
}
