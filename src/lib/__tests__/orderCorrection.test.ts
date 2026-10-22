import { describe, it, expect } from "vitest";
import { canCorrect, correctionErrorCode, editMinutesLeft, isSuperseded, EDIT_WINDOW_MINUTES } from "../orderCorrection";
import { buildOrderEntries, buildOrderMetadata, toOutflowLogPayloads } from "../orderPayload";
import type { AggregatedMaterials } from "@/types/quickOutflow";

const t0 = "2026-10-21T09:00:00.000Z";
const at = (min: number) => new Date(new Date(t0).getTime() + min * 60_000);

describe("edit window", () => {
  it("counts down whole minutes and closes at 60", () => {
    expect(EDIT_WINDOW_MINUTES).toBe(60);
    expect(editMinutesLeft(t0, at(0))).toBe(60);
    expect(editMinutesLeft(t0, at(59.5))).toBe(1);
    expect(editMinutesLeft(t0, at(60))).toBe(0);
    expect(editMinutesLeft(t0, at(90))).toBe(0);
  });
});

describe("canCorrect", () => {
  const base = {
    createdAt: t0, entryUserId: "u1", currentUserId: "u1", isAdmin: false,
    voided: false, synced: true, hasReturns: false, now: at(10),
  };
  it("lets the person who entered it edit within the hour", () => {
    expect(canCorrect(base)).toBe(true);
    expect(canCorrect({ ...base, now: at(61) })).toBe(false);
  });
  it("blocks other users unless admin (admins still get only 1 hour)", () => {
    expect(canCorrect({ ...base, currentUserId: "u2" })).toBe(false);
    expect(canCorrect({ ...base, currentUserId: "u2", isAdmin: true })).toBe(true);
    expect(canCorrect({ ...base, isAdmin: true, now: at(61) })).toBe(false);
  });
  it("blocks voided, unsynced and returned orders", () => {
    expect(canCorrect({ ...base, voided: true })).toBe(false);
    expect(canCorrect({ ...base, synced: false })).toBe(false);
    expect(canCorrect({ ...base, hasReturns: true })).toBe(false);
  });
});

describe("isSuperseded / correctionErrorCode", () => {
  it("only voided rows linked to a correction are superseded", () => {
    expect(isSuperseded({ voided_at: t0, corrected_by_log_id: "n1" })).toBe(true);
    expect(isSuperseded({ voided_at: t0 })).toBe(false);
    expect(isSuperseded({ corrected_by_log_id: "n1" })).toBe(false);
  });
  it("maps server errors", () => {
    expect(correctionErrorCode("INSUFFICIENT_STOCK: PUYUH (egg) is short 5")).toBe("INSUFFICIENT_STOCK");
    expect(correctionErrorCode("EDIT_WINDOW_CLOSED: ...")).toBe("EDIT_WINDOW_CLOSED");
    expect(correctionErrorCode("ORDER_INCOMPLETE: edit the whole order")).toBe("ORDER_INCOMPLETE");
    expect(correctionErrorCode("TypeError: Failed to fetch")).toBe("NETWORK");
    expect(correctionErrorCode("boom")).toBe("OTHER");
  });
});

describe("orderPayload", () => {
  const aggregates: AggregatedMaterials = {
    eggsByProduct: new Map([["KAMPUNG BIASA", 240]]),
    packagingByItem: new Map([["Mika 10", 24]]),
    labelsByItem: new Map(),
    boxesByType: new Map([["box osave", 2]]),
  };
  const order = {
    buyerName: "Osave", invoiceRef: "INV-1", date: "2026-10-21", dcId: "dc-bks", dcName: "BKS",
    lines: [
      { id: "l1", lineType: "pack" as const, skuCode: "KP10B", packQty: 24 },
      { id: "l2", lineType: "loose" as const, eggProduct: "PUYUH", looseQty: 50, looseUnit: "butir" as const },
    ],
    aggregates,
  };
  it("builds one entry per material with the invoice and date", () => {
    let n = 0;
    const entries = buildOrderEntries(order, t0, () => `e${++n}`);
    expect(entries.map((e) => [e.id, e.category, e.product, e.quantityInButir])).toEqual([
      ["e1", "egg", "KAMPUNG BIASA", 240],
      ["e2", "packaging", "Mika 10", 24],
      ["e3", "box", "box osave", 2],
    ]);
    expect(entries.every((e) => e.invoiceSupplier === "INV-1" && e.date === "2026-10-21")).toBe(true);
  });
  it("keeps the loose unit on loose lines only and carries the DC", () => {
    const md = buildOrderMetadata(order);
    expect(md.orderLines).toEqual([
      { skuCode: "KP10B", packQty: 24, eggProduct: undefined, looseQty: undefined },
      { skuCode: undefined, packQty: undefined, eggProduct: "PUYUH", looseQty: 50, looseUnit: "butir" },
    ]);
    // A pack line serialises exactly as before (grouping keys stay stable).
    expect(JSON.stringify(md.orderLines?.[0])).toBe('{"skuCode":"KP10B","packQty":24}');
    expect([md.dcId, md.dcName, md.outflowDate]).toEqual(["dc-bks", "BKS", "2026-10-21"]);
  });
  it("links each log row to its entry", () => {
    const entries = buildOrderEntries(order, t0, () => "x");
    const logs = toOutflowLogPayloads(entries, "a@b.c", buildOrderMetadata(order), t0);
    expect(logs[0].metadata.relatedEntryId).toBe("x");
    expect(logs[0].recorded_at).toBe(t0);
  });
});
