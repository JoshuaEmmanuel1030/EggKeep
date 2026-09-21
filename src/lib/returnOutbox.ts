import { RecordReturnInput } from "@/types/returns";
import { ReturnSubmitResult } from "@/lib/returnRpc";

/**
 * Offline outbox for returns (retur).
 *
 * When record_return can't reach the server (offline / fetch failure), the whole
 * return is queued here and replayed once the connection returns. Server-side
 * rejections (RETURN_EXCEEDS_OUTFLOW, OUTFLOW_VOIDED, ...) are NEVER queued on
 * first submit — the server saw the request and said no.
 *
 * Replay is safe against "the server committed but we never saw the response"
 * because record_return skips any return line whose id already exists (idempotent
 * per client line id — see migration 20260914000000_retakan_tag.sql).
 *
 * Unlike the outflow outbox, a server-rejected return does NOT block the queue:
 * returns are independent, so a bad one is flagged `failed` and skipped while the
 * rest still replay. Pure module: storage is injectable for unit tests.
 */

export const RETURN_OUTBOX_KEY = "eggkeep_return_outbox";

export interface QueuedReturn {
  id: string; // outbox id (distinct from the return line ids inside input)
  queuedAt: string;
  input: RecordReturnInput;
  status: "pending" | "failed";
  failReason?: string;
}

function defaultStorage(): Storage {
  return localStorage;
}

export function loadReturnOutbox(storage: Storage = defaultStorage()): QueuedReturn[] {
  try {
    const raw = storage.getItem(RETURN_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedReturn[]) : [];
  } catch (e) {
    console.error("Error loading return outbox:", e);
    return [];
  }
}

export function saveReturnOutbox(items: QueuedReturn[], storage: Storage = defaultStorage()): void {
  storage.setItem(RETURN_OUTBOX_KEY, JSON.stringify(items));
}

export function enqueueReturn(
  input: RecordReturnInput,
  storage: Storage = defaultStorage()
): QueuedReturn {
  const queued: QueuedReturn = {
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    input,
    status: "pending",
  };
  saveReturnOutbox([...loadReturnOutbox(storage), queued], storage);
  return queued;
}

export function removeReturnOutboxItem(id: string, storage: Storage = defaultStorage()): void {
  saveReturnOutbox(loadReturnOutbox(storage).filter((o) => o.id !== id), storage);
}

export function markReturnFailed(
  id: string,
  reason: string,
  storage: Storage = defaultStorage()
): void {
  saveReturnOutbox(
    loadReturnOutbox(storage).map((o) =>
      o.id === id ? { ...o, status: "failed" as const, failReason: reason } : o
    ),
    storage
  );
}

/** Clear the failed flag so the next replay attempts this return again. */
export function retryReturn(id: string, storage: Storage = defaultStorage()): void {
  saveReturnOutbox(
    loadReturnOutbox(storage).map((o) =>
      o.id === id ? { ...o, status: "pending" as const, failReason: undefined } : o
    ),
    storage
  );
}

export interface ReturnReplayResult {
  /** Returns successfully recorded (and removed) this run. */
  syncedCount: number;
  /** Returns newly flagged failed this run (pre-existing failures are skipped, not recounted). */
  newlyFailedCount: number;
  /** Why replay stopped early (null = reached the end of the queue). */
  stopped: "network" | null;
}

/**
 * Replay queued returns in FIFO order.
 * - Success       → remove from queue, continue.
 * - Network error → stop; everything stays queued for the next attempt.
 * - Server error  → flag `failed`, SKIP, continue (returns are independent).
 */
export async function replayReturnOutbox(deps: {
  submit: (input: RecordReturnInput) => Promise<ReturnSubmitResult>;
  storage?: Storage;
}): Promise<ReturnReplayResult> {
  const storage = deps.storage ?? defaultStorage();
  let syncedCount = 0;
  let newlyFailedCount = 0;

  // Snapshot the pending items up front; failed items are skipped silently.
  for (const item of loadReturnOutbox(storage)) {
    if (item.status === "failed") continue;

    const result = await deps.submit(item.input);
    if (result.ok) {
      removeReturnOutboxItem(item.id, storage);
      syncedCount++;
      continue;
    }
    if (result.kind === "network") {
      return { syncedCount, newlyFailedCount, stopped: "network" };
    }
    markReturnFailed(item.id, result.message ?? "unknown error", storage);
    newlyFailedCount++;
  }

  return { syncedCount, newlyFailedCount, stopped: null };
}
