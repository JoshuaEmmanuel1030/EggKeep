import { describe, it, expect, vi } from "vitest";
import {
  OUTFLOW_OUTBOX_KEY,
  classifyOutflowError,
  loadOutbox,
  saveOutbox,
  enqueueOutflowOrder,
  removeOutboxOrder,
  markOutboxOrderFailed,
  retryOutboxOrder,
  replayOutbox,
  QueuedOutflowOrder,
  OutflowSubmitResult,
} from "@/lib/outflowOutbox";
import { OutflowEntry } from "@/types/inventory";

// Minimal in-memory Storage — tests run in node, no DOM localStorage.
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function makeEntry(product: string, qty: number): OutflowEntry {
  return {
    id: crypto.randomUUID(),
    date: "2026-07-06",
    product,
    quantityInButir: qty, // native stock unit (kg / butir / pcs) — no conversion
    createdAt: new Date().toISOString(),
    category: "egg",
    invoiceSupplier: "Toko Maju",
  };
}

function enqueue(storage: Storage, product = "NEGERI BIASA", qty = 12) {
  return enqueueOutflowOrder(
    {
      entries: [makeEntry(product, qty)],
      logs: [
        {
          action_type: "outflow",
          product,
          quantity_butir: qty,
          recorded_at: new Date().toISOString(),
          category: "egg",
          user_email: "staff@jsonline.com",
        },
      ],
    },
    storage
  );
}

describe("classifyOutflowError", () => {
  it("classifies INSUFFICIENT_STOCK as server even when offline", () => {
    const err = { message: "INSUFFICIENT_STOCK: NEGERI BIASA (egg) is short 5 butir/pcs", code: "P0001" };
    expect(classifyOutflowError(err, false)).toBe("server");
    expect(classifyOutflowError(err, true)).toBe("server");
  });

  it("classifies any error with a PostgrestError code as server", () => {
    expect(classifyOutflowError({ message: "something odd", code: "P0001" }, true)).toBe("server");
    expect(classifyOutflowError({ message: "permission denied", code: "42501" }, false)).toBe("server");
    expect(classifyOutflowError({ message: "not found", code: "PGRST202" }, true)).toBe("server");
  });

  it("classifies fetch failures as network", () => {
    expect(classifyOutflowError(new TypeError("Failed to fetch"), true)).toBe("network");
    expect(classifyOutflowError({ message: "TypeError: Failed to fetch", code: "" }, true)).toBe("network");
    expect(classifyOutflowError({ message: "NetworkError when attempting to fetch resource." }, true)).toBe("network");
    expect(classifyOutflowError({ message: "Load failed" }, true)).toBe("network"); // Safari
    expect(classifyOutflowError({ message: "fetch failed", code: "ERR_NETWORK" }, true)).toBe("network");
  });

  it("classifies anything as network while the browser reports offline (unless the server clearly answered)", () => {
    expect(classifyOutflowError(new Error("some wrapped abort"), false)).toBe("network");
  });

  it("defaults unknown errors to server while online (never queue blindly)", () => {
    expect(classifyOutflowError(new Error("JWT expired"), true)).toBe("server");
    expect(classifyOutflowError({ message: "AUTH_REQUIRED: must be signed in to record outflows" }, true)).toBe("server");
  });
});

describe("outbox queue operations", () => {
  it("starts empty and survives malformed storage", () => {
    const storage = createMemoryStorage();
    expect(loadOutbox(storage)).toEqual([]);
    storage.setItem(OUTFLOW_OUTBOX_KEY, "{not json");
    expect(loadOutbox(storage)).toEqual([]);
    storage.setItem(OUTFLOW_OUTBOX_KEY, '{"an":"object"}');
    expect(loadOutbox(storage)).toEqual([]);
  });

  it("enqueues in FIFO order under the documented key", () => {
    const storage = createMemoryStorage();
    const a = enqueue(storage, "NEGERI BIASA", 10);
    const b = enqueue(storage, "PUYUH", 30);
    expect(storage.getItem(OUTFLOW_OUTBOX_KEY)).toBeTruthy();
    const queue = loadOutbox(storage);
    expect(queue.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(queue[0].status).toBe("pending");
    expect(queue[0].entries[0].product).toBe("NEGERI BIASA");
    expect(queue[0].logs).toHaveLength(1);
  });

  it("removes, fails, and retries a specific order", () => {
    const storage = createMemoryStorage();
    const a = enqueue(storage);
    const b = enqueue(storage);

    markOutboxOrderFailed(a.id, "INSUFFICIENT_STOCK: NEGERI BIASA (egg) is short 3 butir/pcs", storage);
    let queue = loadOutbox(storage);
    expect(queue[0].status).toBe("failed");
    expect(queue[0].failReason).toContain("INSUFFICIENT_STOCK");
    expect(queue[1].status).toBe("pending");

    retryOutboxOrder(a.id, storage);
    queue = loadOutbox(storage);
    expect(queue[0].status).toBe("pending");
    expect(queue[0].failReason).toBeUndefined();

    removeOutboxOrder(a.id, storage);
    queue = loadOutbox(storage);
    expect(queue.map((o) => o.id)).toEqual([b.id]);
  });
});

describe("replayOutbox", () => {
  const ok: OutflowSubmitResult = { ok: true };
  const network: OutflowSubmitResult = { ok: false, kind: "network", message: "Failed to fetch" };
  const short: OutflowSubmitResult = {
    ok: false,
    kind: "server",
    message: "INSUFFICIENT_STOCK: PUYUH (egg) is short 20 butir/pcs",
  };

  it("drains the queue FIFO, removing each order and writing its logs on success", async () => {
    const storage = createMemoryStorage();
    const a = enqueue(storage, "NEGERI BIASA", 10);
    const b = enqueue(storage, "PUYUH", 30);

    const submitted: string[] = [];
    const synced: QueuedOutflowOrder[] = [];
    const result = await replayOutbox({
      submit: async (entries) => {
        submitted.push(entries[0].product);
        return ok;
      },
      onOrderSynced: async (order) => void synced.push(order),
      storage,
    });

    expect(submitted).toEqual(["NEGERI BIASA", "PUYUH"]); // strict FIFO
    expect(synced.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(result).toEqual({ syncedCount: 2, failedOrder: null, stopped: null });
    expect(loadOutbox(storage)).toEqual([]);
  });

  it("stops quietly on a network error and keeps everything queued as pending", async () => {
    const storage = createMemoryStorage();
    enqueue(storage);
    enqueue(storage);

    const submit = vi.fn().mockResolvedValue(network);
    const onOrderSynced = vi.fn();
    const result = await replayOutbox({ submit, onOrderSynced, storage });

    expect(submit).toHaveBeenCalledTimes(1); // did not plough through the rest
    expect(onOrderSynced).not.toHaveBeenCalled();
    expect(result).toEqual({ syncedCount: 0, failedOrder: null, stopped: "network" });
    expect(loadOutbox(storage).every((o) => o.status === "pending")).toBe(true);
  });

  it("flags the order failed on INSUFFICIENT_STOCK, stops, and blocks later orders", async () => {
    const storage = createMemoryStorage();
    const a = enqueue(storage, "PUYUH", 100);
    const b = enqueue(storage, "NEGERI BIASA", 5);

    const submit = vi.fn().mockResolvedValue(short);
    const first = await replayOutbox({ submit, onOrderSynced: vi.fn(), storage });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(first.stopped).toBe("failed-head");
    expect(first.failedOrder?.id).toBe(a.id);
    expect(first.failedOrder?.failReason).toContain("INSUFFICIENT_STOCK");
    const queue = loadOutbox(storage);
    expect(queue[0].status).toBe("failed");
    expect(queue[1].id).toBe(b.id);

    // A failed head blocks the whole queue on the next replay — no submits at all.
    const submit2 = vi.fn();
    const second = await replayOutbox({ submit: submit2, onOrderSynced: vi.fn(), storage });
    expect(submit2).not.toHaveBeenCalled();
    expect(second.stopped).toBe("failed-head");
    expect(second.failedOrder?.id).toBe(a.id);
  });

  it("resumes past a failure after the user discards the failed order", async () => {
    const storage = createMemoryStorage();
    const a = enqueue(storage, "PUYUH", 100);
    const b = enqueue(storage, "NEGERI BIASA", 5);
    markOutboxOrderFailed(a.id, "INSUFFICIENT_STOCK: PUYUH (egg) is short 20 butir/pcs", storage);

    removeOutboxOrder(a.id, storage); // user hit Discard in the UI

    const submit = vi.fn().mockResolvedValue(ok);
    const result = await replayOutbox({ submit, onOrderSynced: vi.fn(), storage });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0][0].id).toBe(b.entries[0].id);
    expect(result.syncedCount).toBe(1);
    expect(loadOutbox(storage)).toEqual([]);
  });

  it("still removes the order when log-writing throws (RPC already committed)", async () => {
    const storage = createMemoryStorage();
    enqueue(storage);

    const result = await replayOutbox({
      submit: async () => ok,
      onOrderSynced: async () => {
        throw new Error("activity_logs insert failed");
      },
      storage,
    });

    expect(result.syncedCount).toBe(1);
    expect(loadOutbox(storage)).toEqual([]); // never resubmit a committed order
  });
});
