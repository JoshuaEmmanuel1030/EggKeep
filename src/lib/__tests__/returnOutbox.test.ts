import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueReturn,
  loadReturnOutbox,
  replayReturnOutbox,
  markReturnFailed,
  retryReturn,
  QueuedReturn,
} from "@/lib/returnOutbox";
import { RecordReturnInput } from "@/types/returns";

// In-memory Storage so the pure module can be tested without a DOM.
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const input = (buyer: string): RecordReturnInput => ({
  returnDate: "2026-09-21",
  buyerName: buyer,
  lines: [
    { id: crypto.randomUUID(), outflowId: "o1", product: "NEGERI BIASA", category: "egg", quantity: 5, disposition: "restock" },
  ],
});

describe("returnOutbox", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memStorage();
  });

  it("enqueues and loads returns", () => {
    enqueueReturn(input("A"), storage);
    enqueueReturn(input("B"), storage);
    expect(loadReturnOutbox(storage).map((q) => q.input.buyerName)).toEqual(["A", "B"]);
  });

  it("removes a return on successful replay", async () => {
    enqueueReturn(input("A"), storage);
    const res = await replayReturnOutbox({ submit: async () => ({ ok: true }), storage });
    expect(res).toMatchObject({ syncedCount: 1, newlyFailedCount: 0, stopped: null });
    expect(loadReturnOutbox(storage)).toHaveLength(0);
  });

  it("stops and keeps everything on a network error", async () => {
    enqueueReturn(input("A"), storage);
    enqueueReturn(input("B"), storage);
    const res = await replayReturnOutbox({
      submit: async () => ({ ok: false, kind: "network", message: "offline" }),
      storage,
    });
    expect(res.stopped).toBe("network");
    expect(res.syncedCount).toBe(0);
    expect(loadReturnOutbox(storage)).toHaveLength(2); // nothing lost
  });

  it("flags a server-rejected return failed but keeps replaying the rest (independent)", async () => {
    enqueueReturn(input("BAD"), storage);
    enqueueReturn(input("GOOD"), storage);
    const res = await replayReturnOutbox({
      submit: async (i) =>
        i.buyerName === "BAD"
          ? { ok: false, kind: "server", message: "RETURN_EXCEEDS_OUTFLOW" }
          : { ok: true },
      storage,
    });
    expect(res.syncedCount).toBe(1);
    expect(res.newlyFailedCount).toBe(1);
    const left = loadReturnOutbox(storage);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject<Partial<QueuedReturn>>({
      status: "failed",
      failReason: "RETURN_EXCEEDS_OUTFLOW",
    });
  });

  it("skips a pre-failed return without recounting it, until retried", async () => {
    const q = enqueueReturn(input("A"), storage);
    markReturnFailed(q.id, "boom", storage);
    let calls = 0;
    const res = await replayReturnOutbox({
      submit: async () => {
        calls++;
        return { ok: true };
      },
      storage,
    });
    expect(calls).toBe(0); // failed item skipped
    expect(res.newlyFailedCount).toBe(0);

    retryReturn(q.id, storage);
    const res2 = await replayReturnOutbox({ submit: async () => ({ ok: true }), storage });
    expect(res2.syncedCount).toBe(1);
    expect(loadReturnOutbox(storage)).toHaveLength(0);
  });
});
