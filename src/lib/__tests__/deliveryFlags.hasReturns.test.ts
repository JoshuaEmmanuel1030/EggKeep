import { describe, expect, it } from "vitest";
import { buildDeliveryItems, filterDeliveryItems } from "@/lib/deliveryFlags";
import type { ReturnRow } from "@/lib/returnsSummary";

// Insight's "Lihat di Pengiriman": /deliveries?buyer=<name>&returns=1
describe("has-returns filter", () => {
  const po = (invoiceRef: string, outflowId: string) => ({
    invoiceRef,
    buyerName: "Segari",
    dcName: null,
    outflowDate: "2026-11-01",
    recordedAt: "2026-11-01T02:00:00Z",
    orderLines: [],
    eggTotals: [{ product: "P", quantity: 1, outflowId }],
  });
  const returnRow = (outflow_id: string, voided_at: string | null = null) => ({ outflow_id, voided_at }) as ReturnRow;

  it("keeps only fakturs with a live warehouse return, and combines with the buyer search", () => {
    const { items } = buildDeliveryItems([po("A", "a"), po("B", "b"), po("C", "c")], [], [], [returnRow("a"), returnRow("c", "2026-11-02")]);
    expect(filterDeliveryItems(items, { search: "segari", hasReturns: true }).map((i) => i.invoiceRef)).toEqual(["A"]);
    expect(filterDeliveryItems(items, { search: "astro", hasReturns: true })).toEqual([]);
  });

  it("leaves the list alone when the chip is off", () => {
    const { items } = buildDeliveryItems([po("A", "a"), po("B", "b")], [], [], []);
    expect(filterDeliveryItems(items, {})).toHaveLength(2);
  });
});
