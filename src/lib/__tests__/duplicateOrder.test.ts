import { describe, it, expect } from "vitest";
import { orderLinesSignature, orderDuplicateKey, DupOrderLine } from "../duplicateOrder";

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
