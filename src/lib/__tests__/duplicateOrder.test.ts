import { describe, it, expect } from "vitest";
import { orderLinesSignature, orderDuplicateKey, findRefDuplicates, DupOrderLine } from "../duplicateOrder";

describe("orderLinesSignature", () => {
  it("is order-independent", () => {
    const a: DupOrderLine[] = [
      { skuCode: "N10O", packQty: 180 },
      { skuCode: "N10B", packQty: 180 },
    ];
    const b: DupOrderLine[] = [
      { skuCode: "N10B", packQty: 180 },
      { skuCode: "N10O", packQty: 180 },
    ];
    expect(orderLinesSignature(a)).toBe(orderLinesSignature(b));
  });

  it("treats missing fields as empty/zero (JSON drops undefined)", () => {
    const withUndefined: DupOrderLine[] = [{ skuCode: "N10O", packQty: 180, eggProduct: undefined, looseQty: undefined }];
    const dropped: DupOrderLine[] = [{ skuCode: "N10O", packQty: 180 }];
    expect(orderLinesSignature(withUndefined)).toBe(orderLinesSignature(dropped));
  });

  it("distinguishes different quantities", () => {
    expect(orderLinesSignature([{ skuCode: "N10O", packQty: 180 }]))
      .not.toBe(orderLinesSignature([{ skuCode: "N10O", packQty: 90 }]));
  });

  it("distinguishes loose vs pack lines", () => {
    expect(orderLinesSignature([{ eggProduct: "NEGERI BIASA", looseQty: 50 }]))
      .not.toBe(orderLinesSignature([{ skuCode: "N10B", packQty: 50 }]));
  });

  it("handles null/empty line arrays", () => {
    expect(orderLinesSignature(null)).toBe("");
    expect(orderLinesSignature([])).toBe("");
  });
});

describe("orderDuplicateKey", () => {
  const lines: DupOrderLine[] = [{ skuCode: "N10O", packQty: 180 }];

  it("matches same buyer + date + lines", () => {
    expect(orderDuplicateKey("Osave", "2026-09-12", lines))
      .toBe(orderDuplicateKey("Osave", "2026-09-12", [...lines]));
  });

  it("differs on buyer", () => {
    expect(orderDuplicateKey("Osave", "2026-09-12", lines))
      .not.toBe(orderDuplicateKey("Segari", "2026-09-12", lines));
  });

  it("differs on delivery date", () => {
    expect(orderDuplicateKey("Osave", "2026-09-12", lines))
      .not.toBe(orderDuplicateKey("Osave", "2026-09-13", lines));
  });
});

describe("orderDuplicateKey with DCs", () => {
  const lines: DupOrderLine[] = [{ skuCode: "OSVN10O", packQty: 5 }];
  it("does not flag the same lines to another DC as a duplicate", () => {
    expect(orderDuplicateKey("OSAVE", "2026-10-21", lines, "dc-bks")).not.toBe(
      orderDuplicateKey("OSAVE", "2026-10-21", lines, "dc-tgr")
    );
  });
  it("keeps the old key when there is no DC", () => {
    expect(orderDuplicateKey("OSAVE", "2026-10-21", lines, null)).toBe(orderDuplicateKey("OSAVE", "2026-10-21", lines));
  });
});

describe("findRefDuplicates (shared No. Faktur)", () => {
  it("a ref already on a live PO of another date -> named with that PO's buyer and date", () => {
    const m = findRefDuplicates(
      [{ invoiceRef: " 2610319 ", buyerName: "Osave", outflowDate: "2026-11-02" }],
      [{ invoiceRef: "2610319", buyerName: "Segari", outflowDate: "2026-10-19" }]
    );
    expect(m).toEqual([{ ref: "2610319", buyerName: "Segari", outflowDate: "2026-10-19" }]);
  });
  it("no ref, or an unused ref -> nothing (near-duplicates stay the other check's job)", () => {
    expect(findRefDuplicates([{ invoiceRef: "", buyerName: "Osave", outflowDate: "2026-11-02" }], [{ invoiceRef: "", buyerName: "X", outflowDate: "x" }])).toEqual([]);
    expect(findRefDuplicates([{ invoiceRef: "A1", buyerName: "Osave", outflowDate: "2026-11-02" }], [])).toEqual([]);
  });
  it("two queued orders of one batch sharing a ref -> flagged once", () => {
    const m = findRefDuplicates(
      [
        { invoiceRef: "a1", buyerName: "Osave", outflowDate: "2026-11-02" },
        { invoiceRef: "A1", buyerName: "Astro", outflowDate: "2026-11-02" },
      ],
      []
    );
    expect(m).toHaveLength(1);
    expect(m[0].buyerName).toBe("Astro");
  });
});
