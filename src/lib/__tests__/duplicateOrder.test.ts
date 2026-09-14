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
