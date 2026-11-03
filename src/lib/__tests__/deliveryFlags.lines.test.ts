import { describe, it, expect } from "vitest";
import { buildDeliveryItems, filterDeliveryItems, rowSummaryText, NO_PHYSICAL_RETURN } from "@/lib/deliveryFlags";
import { summarizeReturns } from "@/lib/returnsSummary";
import { delivery, po, line, ret, KG } from "./deliveryLines.fixtures";

const OSAVE_REF = { osave: true, "family mart": true };
const one = (...args: Parameters<typeof buildDeliveryItems>) => buildDeliveryItems(...args).items[0];

describe("Phase 2 line flags (sheet rows, Oct 2026)", () => {
  it("2610319: two Osave lines with a ref and matching returns -> no orange, no red", () => {
    const item = one(
      [po()],
      [delivery()],
      [line({ skuCode: "OSVN10B" }), line({ skuCode: "OSVN10O", quantity: 3 })],
      [ret(), ret({ disposition: "retakan", quantity: 11.1 }), ret({ outflow_id: "of-no", product: "NEGERI OMEGA", sku_code: "OSVN10O", quantity: 30 })],
      OSAVE_REF,
      KG
    );
    expect(item.flags.awaitingWarehouse).toBe(false);
    expect(item.flags.needsClaimRef).toBe(false);
    const nb = item.lines.find((l) => l.skuCode === "OSVN10B")!;
    expect(nb.returns).toMatchObject({ okPieces: 1088, pecahPieces: 172, firstReturnDate: "2026-10-20", lastUserEmail: "dila@js.id" });
    expect(nb.mismatch).toBe(false);
  });

  it("2610382: P25 pecah + P25 kurang, buyer without the flag -> orange on pecah only, no red", () => {
    const item = one(
      [po({ invoiceRef: "2610382", buyerName: "Sayurbox", orderLines: [{ skuCode: "P25", packQty: 40 }], eggTotals: [{ product: "PUYUH", quantity: 1000, outflowId: "of-p" }] })],
      [delivery({ invoiceRef: "2610382", invoiceRefNorm: "2610382", buyerName: "Sayurbox" })],
      [line({ skuCode: "P25", unitLabel: "pak", piecesPerUnit: 25, quantity: 1, reason: "pecah", claimRef: null }), line({ skuCode: "P25", unitLabel: "pak", piecesPerUnit: 25, quantity: 2, reason: "kurang", claimRef: null })],
      [],
      OSAVE_REF,
      {}
    );
    expect(item.flags.awaitingWarehouse).toBe(true);
    expect(item.lineSummary.awaitingCount).toBe(1);
    expect(item.flags.needsClaimRef).toBe(false);
    expect(item.lines.find((l) => l.reason === "kurang")!.physical).toBe(false);
  });

  it("returns attach to the physical-return line only, never to a Kurang line of the same SKU", () => {
    const item = one(
      [po()],
      [delivery()],
      [line({ reason: "pecah" }), line({ reason: "kurang", quantity: 2 })],
      [ret()],
      OSAVE_REF,
      KG
    );
    expect(item.lines.find((l) => l.reason === "pecah")!.returns).not.toBeNull();
    expect(item.lines.find((l) => l.reason === "kurang")!.returns).toBeNull();
  });

  it("2610421: one merged tukar_guling line, 36 boxes, ref, no returns -> orange, not red", () => {
    const item = one([po()], [delivery()], [line({ skuCode: "N30B", unitLabel: "box", piecesPerUnit: 150, quantity: 36, reason: "tukar_guling" })], [], OSAVE_REF, KG);
    expect(item.flags.awaitingWarehouse).toBe(true);
    expect(item.flags.needsClaimRef).toBe(false);
  });

  it("2610448: N30 kurang without a ref is not red; NO10 tukar_guling in pak -> 550 pieces", () => {
    const item = one(
      [po()],
      [delivery()],
      [
        line({ skuCode: "N30B", unitLabel: "box", piecesPerUnit: 150, quantity: 2, reason: "kurang", claimRef: null, claimRefNorm: null }),
        line({ skuCode: "OSVN10O", unitLabel: "pak", piecesPerUnit: 10, quantity: 55, reason: "tukar_guling" }),
      ],
      [],
      OSAVE_REF,
      KG
    );
    expect(item.flags.needsClaimRef).toBe(false);
    expect(item.lines.find((l) => l.skuCode === "OSVN10O")!.piecesTotal).toBe(550);
  });

  it("2610574: AMTG kurang 123 -> no orange, kurangPieces 492", () => {
    const item = one(
      [po({ buyerName: "Astro", orderLines: [{ skuCode: "BK4AMTG", packQty: 910 }] })],
      [delivery({ buyerName: "Astro" })],
      [line({ skuCode: "BK4AMTG", unitLabel: "pak", piecesPerUnit: 4, quantity: 123, reason: "kurang", claimRef: null })],
      [],
      OSAVE_REF,
      {}
    );
    expect(item.flags.awaitingWarehouse).toBe(false);
    expect(item.lineSummary.kurangPieces).toBe(492);
    expect(item.lines[0].poQty).toBe(910);
  });

  it("2610598: KpO6 revisi_po -> no orange; full false (a line has a quantity)", () => {
    const item = one([po()], [delivery()], [line({ skuCode: "OSVKP6O", reason: "revisi_po", quantity: 2 })], [], OSAVE_REF, {});
    expect(item.flags.awaitingWarehouse).toBe(false);
    expect(item.lineSummary.full).toBe(false);
  });

  it("lebih -> no orange; masih_ditanyakan -> unresolved", () => {
    const a = one([po()], [delivery()], [line({ reason: "lebih" })], [], OSAVE_REF, {});
    expect(a.flags.awaitingWarehouse).toBe(false);
    const b = one([po()], [delivery()], [line({ reason: "masih_ditanyakan", quantity: 0 })], [], OSAVE_REF, {});
    expect(b.flags.unresolved).toBe(true);
    expect(b.lineSummary.unresolvedCount).toBe(1);
  });

  it("a voided PO (no live PO) keeps every flag false", () => {
    const item = one([], [delivery()], [line({ claimRef: null, claimRefNorm: null })], [], OSAVE_REF, {});
    expect(item.poMissing).toBe(true);
    expect(Object.values(item.flags).every((f) => f === false)).toBe(true);
    expect(item.lines).toHaveLength(1);
  });

  it("a return with null sku_code does not clear orange", () => {
    const item = one([po()], [delivery()], [line()], [ret({ sku_code: null })], OSAVE_REF, KG);
    expect(item.flags.awaitingWarehouse).toBe(true);
  });

  it("voided returns do not count", () => {
    const item = one([po()], [delivery()], [line()], [ret({ voided_at: "2026-10-21T00:00:00Z" })], OSAVE_REF, KG);
    expect(item.flags.awaitingWarehouse).toBe(true);
  });

  it("returned pieces != quantity x pieces_per_unit -> mismatch", () => {
    const item = one([po()], [delivery()], [line()], [ret({ quantity: 50 })], OSAVE_REF, KG);
    expect(item.lines[0].mismatch).toBe(true);
  });

  it("red total counts retakan + writeoff pieces on flagged lines without a ref only", () => {
    const item = one(
      [po()],
      [delivery()],
      [line({ skuCode: "OSVN10B", claimRef: null, claimRefNorm: null }), line({ skuCode: "OSVN10O" })],
      [
        ret({ disposition: "retakan", quantity: 11.1 }),
        ret({ disposition: "writeoff", quantity: 1 }),
        ret({ outflow_id: "of-no", product: "NEGERI OMEGA", sku_code: "OSVN10O", disposition: "retakan", quantity: 5 }),
      ],
      OSAVE_REF,
      KG
    );
    expect(item.flags.needsClaimRef).toBe(true);
    expect(item.lineSummary.needsRefCount).toBe(1);
    expect(item.lineSummary.pecahWithoutRef).toBe(172 + 16);
    expect(item.lineSummary.claimRowCount).toBe(2);
  });

  it("buyer flag matches case-insensitively, never by prefix", () => {
    const flagged = one([po({ buyerName: "OSAVE" })], [delivery()], [line({ claimRef: null })], [], OSAVE_REF, {});
    expect(flagged.requiresClaimRef).toBe(true);
    const other = one([po({ buyerName: "OSV Depok" })], [delivery()], [line({ claimRef: null })], [], OSAVE_REF, {});
    expect(other.requiresClaimRef).toBe(false);
  });

  it("Terkirim with no line of quantity > 0 is Diterima penuh", () => {
    const item = one([po()], [delivery()], [], [], OSAVE_REF, {});
    expect(item.lineSummary.full).toBe(true);
  });

  it("filters OR the new chips with the Phase 1 ones", () => {
    const { items } = buildDeliveryItems(
      [po({ invoiceRef: "A" }), po({ invoiceRef: "B" })],
      [delivery({ id: "da", invoiceRef: "A", invoiceRefNorm: "A" }), delivery({ id: "db", invoiceRef: "B", invoiceRefNorm: "B" })],
      [line({ deliveryId: "da" }), line({ deliveryId: "db", reason: "kurang" })],
      [],
      OSAVE_REF,
      {}
    );
    const refs = (f: Parameters<typeof filterDeliveryItems>[1]) => filterDeliveryItems(items, f).map((i) => i.invoiceRef).sort();
    expect(refs({ awaitingWarehouse: true })).toEqual(["A"]);
    expect(refs({ kurang: true })).toEqual(["B"]);
    expect(refs({ claim: true })).toEqual(["A"]);
    expect(refs({ kurang: true, awaitingWarehouse: true })).toEqual(["A", "B"]);
  });

  it("row summary text", () => {
    const labels = { full: "Diterima penuh", items: "{n} item retur", awaiting: "gudang belum", needsRef: "{n} tanpa No. Retur", unresolved: "Masih ditanyakan" };
    const item = one([po()], [delivery()], [line({ claimRef: null, claimRefNorm: null }), line({ skuCode: "OSVN10O" })], [], OSAVE_REF, {});
    expect(rowSummaryText(item.lineSummary, labels)).toBe("2 item retur · gudang belum · 1 tanpa No. Retur");
    expect(rowSummaryText(one([po()], [delivery()], [], [], {}, {}).lineSummary, labels)).toBe("Diterima penuh");
  });

  it("NO_PHYSICAL_RETURN is the five non-physical reasons", () => {
    expect([...NO_PHYSICAL_RETURN].sort()).toEqual(["cancel", "kurang", "lebih", "masih_ditanyakan", "revisi_po"]);
  });
});

describe("summarizeReturns", () => {
  it("reproduces the per-SKU sums and skips voided rows", () => {
    const m = summarizeReturns([
      ret({ quantity: 10 }),
      ret({ quantity: 2, disposition: "retakan" }),
      ret({ quantity: 3, sku_code: null }),
      ret({ quantity: 5, voided_at: "2026-10-21T00:00:00Z" }),
    ]);
    expect(m["of-nb"]).toMatchObject({ restock: 13, retakan: 2, total: 15, anyReturns: true });
    expect(m["of-nb"].bySku.OSVN10B).toEqual({ restock: 10, retakan: 2, writeoff: 0, total: 12 });
    expect(m["of-nb"].bySku[""].total).toBe(3);
  });
  it("sets anyReturns when the only row is voided", () => {
    const m = summarizeReturns([ret({ voided_at: "2026-10-21T00:00:00Z" })]);
    expect(m["of-nb"]).toMatchObject({ total: 0, anyReturns: true });
  });
});
