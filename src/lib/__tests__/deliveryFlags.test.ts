import { describe, it, expect } from "vitest";
import {
  normalizeInvoiceRef,
  hasInvoiceRef,
  customerLabel,
  invoiceNotBack,
  notLogged,
  deliveryFlags,
  buildDeliveryItems,
  filterDeliveryItems,
  countInvoiceNotBack,
  STATUS_NEEDS_NOTE,
} from "@/lib/deliveryFlags";
import type { Delivery, DeliveryPo } from "@/types/deliveries";

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: "d1",
  invoiceRef: "2610383",
  invoiceRefNorm: "2610383",
  buyerName: "OSAVE",
  dcName: "BKS",
  deliveryDate: "2026-10-26",
  driverId: null,
  driverName: "Hendi",
  status: "belum_terkirim",
  invoiceReturnedAt: null,
  invoiceCheckedBy: null,
  pic: "yani@js.id",
  notes: null,
  createdAt: "2026-10-26T01:00:00.000Z",
  updatedAt: "2026-10-26T01:00:00.000Z",
  ...over,
});

const po = (over: Partial<DeliveryPo> = {}): DeliveryPo => ({
  invoiceRef: "2610383",
  buyerName: "OSAVE",
  dcName: "BKS",
  outflowDate: "2026-10-26",
  recordedAt: "2026-10-26T01:00:00.000Z",
  orderLines: [{ skuCode: "N10O", packQty: 20 }],
  ...over,
});

describe("normalizeInvoiceRef", () => {
  it("mirrors deliveries.invoice_ref_norm: upper(trim())", () => {
    expect(normalizeInvoiceRef("  inv-2610383 ")).toBe("INV-2610383");
    expect(normalizeInvoiceRef(null)).toBe("");
    expect(hasInvoiceRef("   ")).toBe(false);
    expect(hasInvoiceRef("2610383")).toBe(true);
  });
  it("customer is '<buyer> <dc>' or just the buyer", () => {
    expect(customerLabel("OSAVE", "Depok")).toBe("OSAVE Depok");
    expect(customerLabel("Segari", null)).toBe("Segari");
  });
});

describe("invoice_not_back", () => {
  it("sheet row 2610383 (second row): Belum Terkirim, no faktur balik -> not open", () => {
    const d = delivery({ status: "belum_terkirim", invoiceReturnedAt: null });
    expect(invoiceNotBack(d)).toBe(false);
    expect(deliveryFlags("2610383", d)).toEqual({ notLogged: false, invoiceNotBack: false });
  });
  it("delivered and the signed faktur has not come back -> open", () => {
    expect(invoiceNotBack(delivery({ status: "terkirim" }))).toBe(true);
  });
  it("clears once invoice_returned_at is set", () => {
    expect(invoiceNotBack(delivery({ status: "terkirim", invoiceReturnedAt: "2026-10-28" }))).toBe(false);
  });
  it("rejected / cancelled deliveries never wait for a faktur", () => {
    expect(invoiceNotBack(delivery({ status: "ditolak" }))).toBe(false);
    expect(invoiceNotBack(delivery({ status: "batal" }))).toBe(false);
    expect(invoiceNotBack(null)).toBe(false);
  });
});

describe("not_logged", () => {
  it("a PO with an invoice_ref and no deliveries row is open", () => {
    expect(notLogged("2610383", null)).toBe(true);
    expect(deliveryFlags("2610383", null)).toEqual({ notLogged: true, invoiceNotBack: false });
  });
  it("a PO without an invoice_ref cannot be logged, so it is not open", () => {
    expect(notLogged("", null)).toBe(false);
    expect(notLogged(undefined, null)).toBe(false);
  });
  it("clears once the delivery row exists", () => {
    expect(notLogged("2610383", delivery())).toBe(false);
  });
});

describe("buildDeliveryItems (purchase_orders LEFT JOIN deliveries)", () => {
  it("joins on the normalised invoice_ref and keeps un-logged POs as belum dicatat", () => {
    const { items, hiddenNoInvoice } = buildDeliveryItems(
      [po({ invoiceRef: " 2610383 " }), po({ invoiceRef: "2610384", outflowDate: "2026-10-27", recordedAt: "2026-10-27T01:00:00.000Z" })],
      [delivery({ status: "terkirim" })]
    );
    expect(hiddenNoInvoice).toBe(0);
    expect(items.map((i) => i.invoiceRefNorm)).toEqual(["2610384", "2610383"]); // newest first
    expect(items[1].delivery?.id).toBe("d1");
    expect(items[1].flags).toEqual({ notLogged: false, invoiceNotBack: true });
    expect(items[0].delivery).toBeNull();
    expect(items[0].flags).toEqual({ notLogged: true, invoiceNotBack: false });
  });

  it("hides POs without an invoice_ref and counts them", () => {
    const { items, hiddenNoInvoice } = buildDeliveryItems([po({ invoiceRef: "" }), po({ invoiceRef: "A1" })], []);
    expect(items).toHaveLength(1);
    expect(hiddenNoInvoice).toBe(1);
  });

  it("a delivery whose PO is gone stays as history with flags suppressed", () => {
    const { items } = buildDeliveryItems([], [delivery({ status: "terkirim" })]);
    expect(items).toHaveLength(1);
    expect(items[0].poMissing).toBe(true);
    expect(items[0].po).toBeNull();
    expect(items[0].flags).toEqual({ notLogged: false, invoiceNotBack: false });
  });

  it("a second PO reusing an invoice_ref is marked, not merged", () => {
    const first = po({ recordedAt: "2026-10-26T01:00:00.000Z" });
    const second = po({ buyerName: "SEGARI", recordedAt: "2026-10-26T02:00:00.000Z" });
    const { items } = buildDeliveryItems([second, first], [delivery()]);
    expect(items).toHaveLength(2);
    const dup = items.find((i) => i.duplicateInvoice)!;
    expect(dup.buyerName).toBe("SEGARI"); // the later-recorded one
    expect(dup.delivery).toBeNull();
    expect(dup.flags).toEqual({ notLogged: false, invoiceNotBack: false });
    const primary = items.find((i) => !i.duplicateInvoice)!;
    expect(primary.delivery?.id).toBe("d1");
  });
});

describe("filterDeliveryItems", () => {
  const { items } = buildDeliveryItems(
    [
      po({ invoiceRef: "A1" }), // not logged
      po({ invoiceRef: "A2", buyerName: "SEGARI", dcName: null }), // belum terkirim
      po({ invoiceRef: "A3" }), // terkirim, faktur belum balik
      po({ invoiceRef: "A4" }), // terkirim, faktur balik
    ],
    [
      delivery({ id: "x2", invoiceRef: "A2", invoiceRefNorm: "A2", status: "belum_terkirim" }),
      delivery({ id: "x3", invoiceRef: "A3", invoiceRefNorm: "A3", status: "terkirim" }),
      delivery({ id: "x4", invoiceRef: "A4", invoiceRefNorm: "A4", status: "terkirim", invoiceReturnedAt: "2026-10-28" }),
    ]
  );
  const refs = (xs: typeof items) => xs.map((i) => i.invoiceRef).sort();

  it("no chips -> everything", () => {
    expect(refs(filterDeliveryItems(items, {}))).toEqual(["A1", "A2", "A3", "A4"]);
  });
  it("chips OR together", () => {
    expect(refs(filterDeliveryItems(items, { notLogged: true }))).toEqual(["A1"]);
    expect(refs(filterDeliveryItems(items, { notDelivered: true }))).toEqual(["A2"]);
    expect(refs(filterDeliveryItems(items, { invoiceNotBack: true }))).toEqual(["A3"]);
    expect(refs(filterDeliveryItems(items, { notLogged: true, invoiceNotBack: true }))).toEqual(["A1", "A3"]);
  });
  it("search matches invoice_ref or customer, case-insensitively", () => {
    expect(refs(filterDeliveryItems(items, { search: "a3" }))).toEqual(["A3"]);
    expect(refs(filterDeliveryItems(items, { search: "segari" }))).toEqual(["A2"]);
    expect(refs(filterDeliveryItems(items, { search: "osave bks" }))).toEqual(["A1", "A3", "A4"]);
  });
  it("badge counts distinct fakturs waiting for their invoice", () => {
    expect(countInvoiceNotBack(items)).toBe(1);
  });
});

describe("STATUS_NEEDS_NOTE", () => {
  it("asks for a note on ditolak and batal only", () => {
    expect(STATUS_NEEDS_NOTE.has("ditolak")).toBe(true);
    expect(STATUS_NEEDS_NOTE.has("batal")).toBe(true);
    expect(STATUS_NEEDS_NOTE.has("terkirim")).toBe(false);
    expect(STATUS_NEEDS_NOTE.has("belum_terkirim")).toBe(false);
  });
});
