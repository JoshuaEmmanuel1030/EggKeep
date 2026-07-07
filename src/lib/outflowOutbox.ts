import { OutflowEntry, InventoryCategory } from "@/types/inventory";
import { ActivityLogMetadata } from "@/types/activityLog";

/**
 * Offline outbox for outflow orders.
 *
 * When record_order_outflows can't reach the server (offline / fetch failure),
 * the whole order — entries plus the activity-log payloads that would have been
 * written after success — is queued here and replayed strictly FIFO once the
 * connection returns. Server-side rejections (INSUFFICIENT_STOCK, validation,
 * auth) are NEVER queued on first submit: the server saw the request and said no.
 *
 * Replay is safe against "the server committed but we never saw the response"
 * because the RPC (migration 20260707000000) skips any entry whose id already
 * exists in outflows — including its FIFO deduction.
 *
 * Pure module: storage is injectable so it can be unit-tested without a DOM.
 */

export const OUTFLOW_OUTBOX_KEY = "eggkeep_outflow_outbox";

/** Activity-log payload captured at queue time, written only after the RPC succeeds. */
export interface OutboxLogPayload {
  action_type: "outflow";
  product: string;
  quantity_butir: number;
  recorded_at: string;
  category: InventoryCategory;
  invoice_supplier?: string;
  user_email?: string;
  metadata?: ActivityLogMetadata;
}

export interface QueuedOutflowOrder {
  id: string;
  queuedAt: string;
  entries: OutflowEntry[];
  logs: OutboxLogPayload[];
  status: "pending" | "failed";
  failReason?: string;
}

// Single interface (not a discriminated union): this repo compiles with
// strict:false, where union narrowing on `result.ok` doesn't kick in.
export interface OutflowSubmitResult {
  ok: boolean;
  /** Set when ok is false. */
  kind?: "network" | "server";
  /** Set when ok is false. */
  message?: string;
}

// Messages produced by fetch/undici/browsers when the request never got a
// response. PostgREST errors always carry a server-generated message instead.
const NETWORK_ERROR_RE =
  /failed to fetch|networkerror|network error|network request failed|load failed|fetch failed|err_internet_disconnected|err_network|err_connection|econnrefused|econnreset|socket hang up|timed out|timeout/i;

/**
 * Classify an error from the record_order_outflows RPC.
 *
 * "network"  → the request (probably) never reached the server: safe to queue.
 * "server"   → the server saw the request and rejected it (INSUFFICIENT_STOCK,
 *              validation, auth, RLS...): must NOT be queued on first submit.
 *
 * Rules, in order:
 *  1. INSUFFICIENT_STOCK anywhere in the message → server (even if we went
 *     offline right after — the server definitively rejected the order).
 *  2. A non-empty PostgrestError `code` (e.g. P0001, PGRST...) → server, the
 *     response came back from PostgREST/Postgres.
 *  3. navigator.onLine === false → network.
 *  4. Message matches known fetch-failure strings → network.
 *  5. Anything else → server (fail safe: never queue an unknown error).
 */
export function classifyOutflowError(error: unknown, online: boolean): "network" | "server" {
  const message = (error as { message?: string })?.message ?? String(error);
  if (message.includes("INSUFFICIENT_STOCK")) return "server";

  const code = (error as { code?: string })?.code;
  if (typeof code === "string" && code.trim() !== "" && !/^ERR_/i.test(code)) {
    return "server";
  }

  if (!online) return "network";
  if (NETWORK_ERROR_RE.test(message)) return "network";
  return "server";
}

function defaultStorage(): Storage {
  return localStorage;
}

export function loadOutbox(storage: Storage = defaultStorage()): QueuedOutflowOrder[] {
  try {
    const raw = storage.getItem(OUTFLOW_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedOutflowOrder[]) : [];
  } catch (e) {
    console.error("Error loading outflow outbox:", e);
    return [];
  }
}

export function saveOutbox(orders: QueuedOutflowOrder[], storage: Storage = defaultStorage()): void {
  storage.setItem(OUTFLOW_OUTBOX_KEY, JSON.stringify(orders));
}

export function enqueueOutflowOrder(
  order: { entries: OutflowEntry[]; logs: OutboxLogPayload[] },
  storage: Storage = defaultStorage()
): QueuedOutflowOrder {
  const queued: QueuedOutflowOrder = {
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    entries: order.entries,
    logs: order.logs,
    status: "pending",
  };
  saveOutbox([...loadOutbox(storage), queued], storage);
  return queued;
}

export function removeOutboxOrder(id: string, storage: Storage = defaultStorage()): void {
  saveOutbox(loadOutbox(storage).filter((o) => o.id !== id), storage);
}

export function markOutboxOrderFailed(
  id: string,
  reason: string,
  storage: Storage = defaultStorage()
): void {
  saveOutbox(
    loadOutbox(storage).map((o) =>
      o.id === id ? { ...o, status: "failed" as const, failReason: reason } : o
    ),
    storage
  );
}

/** Clear the failed flag so the next replay attempts this order again. */
export function retryOutboxOrder(id: string, storage: Storage = defaultStorage()): void {
  saveOutbox(
    loadOutbox(storage).map((o) =>
      o.id === id ? { ...o, status: "pending" as const, failReason: undefined } : o
    ),
    storage
  );
}

export interface ReplayResult {
  /** Orders successfully recorded (and removed from the queue) this run. */
  syncedCount: number;
  /** The order now flagged failed and blocking the head of the queue, if any. */
  failedOrder: QueuedOutflowOrder | null;
  /** Why replay stopped before draining the queue (null = queue drained). */
  stopped: "failed-head" | "network" | null;
}

/**
 * Replay queued orders strictly in FIFO order.
 *
 * - Success        → remove from queue, then hand the order to onOrderSynced
 *                    (activity-log writing) and continue with the next one.
 * - Network error  → stop quietly; everything stays queued for the next attempt.
 * - Server error   → flag the order `failed`, STOP. A failed head blocks the
 *                    queue (later orders may depend on the same stock) until the
 *                    user retries or discards it from the UI.
 */
export async function replayOutbox(deps: {
  submit: (entries: OutflowEntry[]) => Promise<OutflowSubmitResult>;
  onOrderSynced: (order: QueuedOutflowOrder) => Promise<void>;
  storage?: Storage;
}): Promise<ReplayResult> {
  const storage = deps.storage ?? defaultStorage();
  let syncedCount = 0;

  for (;;) {
    const queue = loadOutbox(storage);
    const head = queue[0];
    if (!head) break;

    if (head.status === "failed") {
      return { syncedCount, failedOrder: head, stopped: "failed-head" };
    }

    const result = await deps.submit(head.entries);

    if (result.ok) {
      // Remove BEFORE writing logs: the RPC committed, so the order must never
      // be submitted again (log writing has its own offline fallback).
      removeOutboxOrder(head.id, storage);
      try {
        await deps.onOrderSynced(head);
      } catch (e) {
        console.error("Error writing activity logs for synced outbox order:", e);
      }
      syncedCount++;
      continue;
    }

    if (result.kind === "network") {
      return { syncedCount, failedOrder: null, stopped: "network" };
    }

    markOutboxOrderFailed(head.id, result.message ?? "unknown error", storage);
    const failed = loadOutbox(storage).find((o) => o.id === head.id) ?? null;
    return { syncedCount, failedOrder: failed, stopped: "failed-head" };
  }

  return { syncedCount, failedOrder: null, stopped: null };
}
