// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { EditOrderDialog, type EditTarget } from "@/components/EditOrderDialog";
import type { BuyerOrder } from "@/components/GroupedActivityLog";
import type { ActivityLog } from "@/types/activityLog";
import type { CorrectOrderInput } from "@/hooks/useCorrectOrder";

// ── Hook mocks: no Supabase / network. ────────────────────────────────────────
const correctOrderMock = vi.fn<(input: CorrectOrderInput) => Promise<boolean>>(async () => true);
vi.mock("@/hooks/useCorrectOrder", () => ({
  useCorrectOrder: () => ({ correctOrder: correctOrderMock, saving: false }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "staff@js.test" } }),
}));
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: {
      "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
      KP6: { unit: "btr", eggs_per_unit: 1 },
    },
    boxCapacityMap: {},
    labelsPerPackMap: {},
  }),
}));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({
    skus: [{ code: "N10B", eggProduct: "NEGERI BIASA", eggsPerPack: 10, packagingItem: "PACK N10", isActive: true }],
  }),
}));
vi.mock("@/hooks/useBuyers", () => ({
  useBuyers: () => ({ buyers: [{ id: "b1", name: "OSAVE" }] }),
}));
vi.mock("@/hooks/useBuyerDcs", () => ({
  useBuyerDcs: () => ({ dcsForBuyer: () => [{ id: "dc1", buyerId: "b1", name: "BKS" }] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Cash entries read their real business date off the outflow row.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { date: "2026-10-20" }, error: null }) }) }),
    }),
  },
}));

// A Purchase Order entered 10 minutes ago: 10 packs N10B + 30 loose KP6.
const RECORDED = "2026-10-21T09:00:00.000Z";
const orderLines = [
  { skuCode: "N10B", packQty: 10 },
  { eggProduct: "KP6", looseQty: 30, looseUnit: "butir" as const },
];
const meta = {
  orderType: "quick_outflow" as const,
  buyerName: "OSAVE",
  invoiceRef: "INV-1",
  dcId: "dc1",
  dcName: "BKS",
  outflowDate: "2026-10-21",
  orderLines,
};
const row = (id: string, product: string, qty: number, category: ActivityLog["category"], extra: Partial<ActivityLog> = {}): ActivityLog => ({
  id,
  user_id: "u1",
  action_type: "outflow",
  product,
  quantity_butir: qty,
  recorded_at: RECORDED,
  created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  client_id: `c${id}`,
  category,
  invoice_supplier: "INV-1",
  metadata: { ...meta, relatedEntryId: `outflow-${id}` },
  ...extra,
});
const logs = [
  row("1", "NEGERI BIASA", 6.45, "egg"),
  row("2", "PACK N10", 10, "packaging"),
  row("3", "KP6", 30, "egg"),
  row("4", "LABEL X", 10, "label", { voided_at: "2026-10-21T09:05:00.000Z" }), // already voided
];
const order: BuyerOrder = {
  buyerName: "OSAVE",
  orderLines,
  materials: [],
  timestamp: RECORDED,
  outflowDate: "2026-10-21",
  invoiceRef: "INV-1",
  dcName: "BKS",
  isSynced: true,
  logs,
};
const target: EditTarget = { kind: "quick", order };

function renderDialog(t: EditTarget = target) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <LanguageProvider>
      <EditOrderDialog open target={t} onOpenChange={onOpenChange} onSaved={onSaved} />
    </LanguageProvider>
  );
  return { onSaved, onOpenChange };
}

const save = () => fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

describe("EditOrderDialog — Purchase Order", () => {
  beforeEach(() => correctOrderMock.mockClear());
  afterEach(() => cleanup());

  it("a new pack qty re-derives the entries and keeps the order's place", async () => {
    const { onSaved, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("Quantity N10B"), { target: { value: "20" } });
    save();

    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    const { oldLogIds, entries, logs: newLogs, reason } = correctOrderMock.mock.calls[0][0];

    expect(oldLogIds).toEqual(["1", "2", "3"]); // the voided row is not resent
    expect(reason).toBe("Edited");
    expect(entries.map((e) => [e.product, e.quantityInButir, e.category])).toEqual([
      ["NEGERI BIASA", 12.9, "egg"], // 20 packs × 10 eggs / 15.5 per kg
      ["KP6", 30, "egg"],
      ["PACK N10", 20, "packaging"],
    ]);
    expect(entries.every((e) => e.invoiceSupplier === "INV-1" && e.date === "2026-10-21")).toBe(true);

    expect(newLogs).toHaveLength(entries.length);
    newLogs.forEach((log, i) => {
      expect(log.recorded_at).toBe(RECORDED);
      expect(log.metadata.relatedEntryId).toBe(entries[i].id);
      expect(log.metadata.dcId).toBe("dc1");
      expect(log.metadata.dcName).toBe("BKS");
      expect(log.id).toBeTruthy();
      expect(log.client_id).toBeTruthy();
    });
    expect(newLogs[0].metadata.orderLines[0]).toMatchObject({ skuCode: "N10B", packQty: 20 });

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("blocks a save when nothing changed", () => {
    renderDialog();
    save();
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing changed.");
    expect(correctOrderMock).not.toHaveBeenCalled();
  });

  it("blocks a fractional pack quantity", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Quantity N10B"), { target: { value: "2.5" } });
    save();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(correctOrderMock).not.toHaveBeenCalled();
  });

  it("removing a line drops its materials; the last line can't be removed", async () => {
    renderDialog();
    fireEvent.click(screen.getAllByRole("button", { name: /remove line/i })[1]); // the KP6 line
    expect(screen.queryByRole("button", { name: /remove line/i })).not.toBeInTheDocument();
    save();

    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    const { entries, logs: newLogs } = correctOrderMock.mock.calls[0][0];
    expect(entries.map((e) => e.product)).toEqual(["NEGERI BIASA", "PACK N10"]);
    expect(newLogs[0].metadata.orderLines).toHaveLength(1);
  });

  it("an order today's rules can't reproduce: quantities locked, invoice edit resends its rows as-is", async () => {
    // e.g. entered on the old client with order-level box mode: a box row the
    // current per-line rules don't produce. Re-deriving would restore it.
    const legacy = { ...order, logs: [...logs.slice(0, 3), row("5", "BOX KECIL", 1, "box")] };
    renderDialog({ kind: "quick", order: legacy });
    expect(screen.getByLabelText("Quantity N10B")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /remove line/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Invoice/Reference"), { target: { value: "INV-2" } });
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    const { entries, logs: newLogs } = correctOrderMock.mock.calls[0][0];
    expect(entries.map((e) => [e.product, e.quantityInButir, e.category, e.invoiceSupplier])).toEqual([
      ["NEGERI BIASA", 6.45, "egg", "INV-2"],
      ["KP6", 30, "egg", "INV-2"],
      ["PACK N10", 10, "packaging", "INV-2"],
      ["BOX KECIL", 1, "box", "INV-2"],
    ]);
    expect(newLogs[0].metadata.relatedProducts).toHaveLength(4);
  });

  it("a thousands dot in a pack quantity is thousands, never 1 pack", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Quantity N10B"), { target: { value: "1.000" } });
    expect(screen.getByLabelText("Quantity N10B")).toHaveAttribute("aria-invalid", "false");
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    const { entries } = correctOrderMock.mock.calls[0][0];
    expect(entries.find((e) => e.product === "PACK N10")?.quantityInButir).toBe(1000);
  });

  it("a thousands dot in a butir loose line is thousands", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Quantity KP6"), { target: { value: "1.500" } });
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    const { entries } = correctOrderMock.mock.calls[0][0];
    expect(entries.find((e) => e.product === "KP6")?.quantityInButir).toBe(1500);
  });

  it.each([
    ["Quantity N10B", "12abc"],
    ["Quantity KP6", "12abc"],
    ["Quantity KP6", "2,5"],
    ["Quantity KP6", "-5"],
  ])("%s %j is flagged and blocks the save", (label, typed) => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(label), { target: { value: typed } });
    expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    save();
    expect(screen.getByRole("alert")).toHaveTextContent("Fix the quantities marked in red");
    expect(correctOrderMock).not.toHaveBeenCalled();
  });

  // Loose kg line: the kg typed, and the kg deducted (aggregates round to 2 dp).
  const looseKgOrder = (qty: number, deducted = qty): EditTarget => {
    const lines = [{ eggProduct: "NEGERI BIASA", looseQty: qty, looseUnit: "kg" as const }];
    return {
      kind: "quick",
      order: { ...order, orderLines: lines, logs: [row("1", "NEGERI BIASA", deducted, "egg")] },
    };
  };

  it.each(["12abc", "1,500.5", "12.34.567", "1.500,5,5"])("a loose kg line refuses %j", (typed) => {
    renderDialog(looseKgOrder(12.5));
    fireEvent.change(screen.getByLabelText("Quantity NEGERI BIASA"), { target: { value: typed } });
    expect(screen.getByLabelText("Quantity NEGERI BIASA")).toHaveAttribute("aria-invalid", "true");
    save();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(correctOrderMock).not.toHaveBeenCalled();
  });

  it.each([
    ["1500", 1500],
    ["52,89", 52.89],
    ["52.89", 52.89],
    // kg reads as the screens print it: a dot before three digits groups thousands.
    ["1.500", 1500],
    ["12.345,67", 12345.67],
    ["1.200,5", 1200.5],
  ])("a loose kg line takes %j", async (typed, want) => {
    renderDialog(looseKgOrder(12.5));
    fireEvent.change(screen.getByLabelText("Quantity NEGERI BIASA"), { target: { value: typed } });
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    expect(correctOrderMock.mock.calls[0][0].entries[0]).toMatchObject({ product: "NEGERI BIASA", quantityInButir: want });
  });

  it("a recorded 2.125 kg line opens clean: not flagged, not locked, not 'changed'", async () => {
    renderDialog(looseKgOrder(2.125, 2.13));
    const qty = screen.getByLabelText("Quantity NEGERI BIASA");
    expect(qty).toHaveValue("2,125");
    expect(qty).toHaveAttribute("aria-invalid", "false");
    expect(qty).toBeEnabled();

    save();
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing changed.");

    fireEvent.change(screen.getByLabelText("Invoice/Reference"), { target: { value: "INV-2" } });
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    expect(correctOrderMock.mock.calls[0][0].entries[0]).toMatchObject({ quantityInButir: 2.13, invoiceSupplier: "INV-2" });
  });

  it("a butir line an old bundle recorded as 1,5 opens flagged and can still be corrected", async () => {
    const lines = [{ eggProduct: "KP6", looseQty: 1.5, looseUnit: "butir" as const }];
    renderDialog({ kind: "quick", order: { ...order, orderLines: lines, logs: [row("3", "KP6", 1.5, "egg")] } });
    const qty = screen.getByLabelText("Quantity KP6");
    expect(qty).toHaveAttribute("aria-invalid", "true");
    expect(qty).toBeEnabled(); // not locked: this is exactly the row that needs fixing

    fireEvent.change(qty, { target: { value: "1.500" } });
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    expect(correctOrderMock.mock.calls[0][0].entries[0]).toMatchObject({ product: "KP6", quantityInButir: 1500 });
  });
});

describe("EditOrderDialog — Cash entry", () => {
  beforeEach(() => correctOrderMock.mockClear());
  afterEach(() => cleanup());

  const cash = (product: string, qty: number, category: ActivityLog["category"] = "egg"): EditTarget => ({
    kind: "manual",
    log: row("9", product, qty, category, { invoice_supplier: "OLD", metadata: { relatedEntryId: "outflow-9", outflowDate: "2026-10-20" } }),
  });
  const qtyField = () => screen.getByRole("textbox", { name: "Quantity" });

  it.each([
    ["KP6", "egg", "1.500", 1500],
    ["PACK N10", "packaging", "1.500", 1500],
    ["NEGERI BIASA", "egg", "1500", 1500],
    ["NEGERI BIASA", "egg", "52,89", 52.89],
    ["NEGERI BIASA", "egg", "1.500", 1500],
    ["NEGERI BIASA", "egg", "12.345", 12345],
  ] as const)("%s (%s): %j saves %d", async (product, category, typed, want) => {
    renderDialog(cash(product, 40, category));
    fireEvent.change(qtyField(), { target: { value: typed } });
    expect(qtyField()).toHaveAttribute("aria-invalid", "false");
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    expect(correctOrderMock.mock.calls[0][0].entries[0]).toMatchObject({ product, quantityInButir: want });
  });

  it.each([
    ["KP6", "egg", "2,5"], // a count is a whole number, even on a cash entry
    ["KP6", "egg", "12abc"],
    ["PACK N10", "packaging", "2,5"],
    ["NEGERI BIASA", "egg", "1,500.5"],
    ["NEGERI BIASA", "egg", "12.34.567"],
    ["NEGERI BIASA", "egg", "12abc"],
  ] as const)("%s (%s): %j is flagged and blocks the save", (product, category, typed) => {
    renderDialog(cash(product, 40, category));
    fireEvent.change(qtyField(), { target: { value: typed } });
    expect(qtyField()).toHaveAttribute("aria-invalid", "true");
    save();
    expect(screen.getByRole("alert")).toHaveTextContent("Fix the quantities marked in red");
    expect(correctOrderMock).not.toHaveBeenCalled();
  });

  it("a recorded 2.125 kg opens clean, and an invoice-only edit resends 2.125", async () => {
    renderDialog(cash("NEGERI BIASA", 2.125));
    expect(qtyField()).toHaveValue("2,125");
    expect(qtyField()).toHaveAttribute("aria-invalid", "false");

    save();
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing changed.");

    fireEvent.change(screen.getByLabelText("Invoice/Reference"), { target: { value: "NEW-7" } });
    save();
    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    expect(correctOrderMock.mock.calls[0][0].entries[0]).toMatchObject({ quantityInButir: 2.125, invoiceSupplier: "NEW-7" });
  });

  it("a new invoice replaces the one row, same product, qty and (back-dated) business date", async () => {
    const cash = row("9", "KP6", 40, "egg", { invoice_supplier: "OLD", metadata: { relatedEntryId: "outflow-9" } });
    renderDialog({ kind: "manual", log: cash });
    // Save waits for the outflow's real date (recorded 21 Oct, dated 20 Oct).
    await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Invoice/Reference"), { target: { value: "NEW-7" } });
    save();

    await waitFor(() => expect(correctOrderMock).toHaveBeenCalledTimes(1));
    const { oldLogIds, entries, logs: newLogs } = correctOrderMock.mock.calls[0][0];
    expect(oldLogIds).toEqual(["9"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      product: "KP6",
      quantityInButir: 40,
      category: "egg",
      invoiceSupplier: "NEW-7",
      date: "2026-10-20",
    });
    expect(newLogs[0].recorded_at).toBe(RECORDED);
    expect(newLogs[0].metadata.relatedEntryId).toBe(entries[0].id);
  });
});
