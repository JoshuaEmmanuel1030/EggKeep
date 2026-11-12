// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { DeliveryReturnLines } from "@/components/deliveries/DeliveryReturnLines";
import { renderWithQuery } from "@/test/renderWithQuery";
import { summarizeReturns, type ReturnRow } from "@/lib/returnsSummary";
import { formatDateId } from "@/lib/deliveryExport";
import { localToday } from "@/lib/buyerProfile";
import type { DeliveryDetailData } from "@/hooks/useDelivery";
import type { DeliveryLine, DeliveryPo } from "@/types/deliveries";
import type { PackSKU } from "@/types/catalog";
import type { RecordReturnInput } from "@/types/returns";

// ── Fixtures: faktur 2610319, Osave DPK, 19 Oct 2026 ──────────────────────────
// OSVN10B box = 18 × N10B (10 eggs) = 180 eggs; 86 boxes sold = 15,480 eggs.
const PO: DeliveryPo = {
  invoiceRef: "2610319",
  buyerName: "Osave",
  dcName: "DPK",
  outflowDate: "2026-10-19",
  recordedAt: "2026-10-19T02:00:00Z",
  orderLines: [
    { skuCode: "OSVN10B", packQty: 86 },
    { skuCode: "OSVN10O", packQty: 33 },
  ],
  eggTotals: [
    { product: "NEGERI BIASA", quantity: 998.71, outflowId: "of-nb" },
    { product: "NEGERI OMEGA", quantity: 383.23, outflowId: "of-no" },
  ],
};

const sku = (s: Partial<PackSKU> & Pick<PackSKU, "code">): PackSKU => ({
  id: s.code,
  displayName: s.code,
  eggsPerPack: 1,
  eggProduct: "",
  packagingItem: null,
  isActive: true,
  createdAt: "",
  ...s,
});
const SKUS: PackSKU[] = [
  sku({ code: "N10B", eggsPerPack: 10, eggProduct: "NEGERI BIASA" }),
  sku({ code: "N10O", eggsPerPack: 10, eggProduct: "NEGERI OMEGA" }),
  sku({ code: "OSVN10B", basePackCode: "N10B", boxMode: "box osave", unitLabel: "box" }),
  sku({ code: "OSVN10O", basePackCode: "N10O", boxMode: "box osave", unitLabel: "box" }),
  sku({ code: "N30B", eggsPerPack: 150, eggProduct: "NEGERI BIASA", unitLabel: "box" }),
];

const line = (over: Partial<DeliveryLine> = {}): DeliveryLine => ({
  id: "line-1",
  deliveryId: "del-1",
  skuCode: "OSVN10B",
  unitLabel: "box",
  piecesPerUnit: 180,
  quantity: 7,
  reason: "pecah",
  note: null,
  claimRef: null,
  claimRefNorm: null,
  expectedExpiry: null,
  source: "app",
  createdBy: null,
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
  ...over,
});

let rowSeq = 0;
const returnRow = (over: Partial<ReturnRow>): ReturnRow => ({
  id: `ret-${++rowSeq}`,
  outflow_id: "of-nb",
  sku_code: "OSVN10B",
  product: "NEGERI BIASA",
  category: "egg",
  quantity: 0,
  disposition: "restock",
  reason: "pecah",
  return_date: "2026-10-20",
  created_at: "2026-10-20T03:00:00Z",
  user_id: "u1",
  user_email: "gudang@js.test",
  voided_at: null,
  void_reason: null,
  voided_by: null,
  ...over,
});

// ── Hook mocks. Every hook returns an object built once per test (stable
// identities: a fresh object per render would re-run the memos/effects). ─────
type RecordResult = { ok: boolean; kind?: "network" | "server"; message?: string };
const recordMock = vi.fn<(input: RecordReturnInput) => Promise<RecordResult>>();
const upsertLineMock = { mutateAsync: vi.fn(async () => {}), isPending: false };
const deleteLineMock = { mutateAsync: vi.fn(async () => {}), isPending: false };
const setClaimRefMock = { mutateAsync: vi.fn(async () => {}), isPending: false };
const ensureDeliveryMock = vi.fn(async () => "del-1");

let deliveryHook: Record<string, unknown>;
let returnsHook: Record<string, unknown>;

vi.mock("@/hooks/useDelivery", () => ({
  useDelivery: () => deliveryHook,
  lineSaveErrorCode: () => null,
}));
vi.mock("@/hooks/useDeliveryReturns", () => ({
  useDeliveryReturns: () => returnsHook,
}));
const packSkusHook = { skus: SKUS, isLoading: false };
vi.mock("@/hooks/usePackSKUs", () => ({ usePackSKUs: () => packSkusHook }));
const itemTypesHook = {
  conversionMap: {
    "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
    "NEGERI OMEGA": { unit: "kg", eggs_per_unit: 15.5 },
  },
  boxCapacityMap: { "box osave": { N10B: 18, N10O: 18 } },
};
vi.mock("@/hooks/useItemTypes", () => ({ useItemTypes: () => itemTypesHook }));
const expiryHook = { data: [] };
vi.mock("@/hooks/useExpiryRules", () => ({ useExpiryRules: () => expiryHook }));
const authHook = { user: { email: "admin@js.test" } };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authHook }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

function setup({ lines = [line()], rows = [] as ReturnRow[], po = PO }: { lines?: DeliveryLine[]; rows?: ReturnRow[]; po?: DeliveryPo } = {}) {
  const data: DeliveryDetailData = {
    delivery: {
      id: "del-1",
      invoiceRef: "2610319",
      invoiceRefNorm: "2610319",
      buyerName: "Osave",
      dcName: "DPK",
      deliveryDate: "2026-10-19",
      driverId: null,
      driverName: null,
      status: "terkirim",
      invoiceReturnedAt: null,
      invoiceCheckedBy: null,
      pic: null,
      notes: null,
      createdAt: "",
      updatedAt: "",
    },
    po,
    poState: "ok",
    duplicatePos: 0,
    lines,
    eggOutflowIds: ["of-nb", "of-no"],
  };
  deliveryHook = {
    data,
    ensureDelivery: ensureDeliveryMock,
    upsertLine: upsertLineMock,
    deleteLine: deleteLineMock,
    setClaimRefForDelivery: setClaimRefMock,
  };
  returnsHook = { rows, summary: summarizeReturns(rows), saveGroups: [], record: recordMock };
  return renderWithQuery(
    <LanguageProvider>
      <DeliveryReturnLines invoiceRef="2610319" />
    </LanguageProvider>
  );
}

// ── Queries (English: LanguageProvider defaults to "en" with empty storage) ──
const pecahInput = () => screen.getByRole("textbox", { name: "Broken (eggs)" }) as HTMLInputElement;
const receivedInput = () => screen.getByRole("textbox", { name: "Eggs received" }) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: "Save" });
const confirmButton = () => screen.getByRole("button", { name: "Save to stock" });
const today = formatDateId(localToday());

async function saveToStock(pecah: string) {
  fireEvent.change(pecahInput(), { target: { value: pecah } });
  fireEvent.click(saveButton());
  fireEvent.click(await screen.findByRole("button", { name: "Save to stock" }));
  await waitFor(() => expect(recordMock).toHaveBeenCalled());
}

describe("DeliveryReturnLines (Retur section)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    recordMock.mockResolvedValue({ ok: true });
  });
  afterEach(() => cleanup());

  it("CUJ 1: 7 box OSVN10B, Pecah 172 → confirmation text, then restock 70.19 kg + retakan 11.1 kg", async () => {
    setup();
    expect(receivedInput().value).toBe("1260"); // 7 × 180 prefilled
    fireEvent.change(pecahInput(), { target: { value: "172" } });
    fireEvent.click(saveButton());

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        `7 box × 180 = 1,260 eggs · Received 1,260 · Broken 172 → Retakan · OK 1,088 → back to stock. ` +
          `Sold 15,480 eggs, already returned 0 eggs. Back at warehouse ${today}.`
      )
    ).toBeInTheDocument();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    const input = recordMock.mock.calls[0][0];
    expect(input).toMatchObject({ reason: "pecah", buyerName: "Osave", returnDate: localToday() });
    const common = { skuCode: "OSVN10B", product: "NEGERI BIASA", outflowId: "of-nb", category: "egg", expectedPrior: 0 };
    expect(input.lines).toHaveLength(2);
    expect(input.lines[0]).toMatchObject({ ...common, disposition: "restock", quantity: 70.19 });
    expect(input.lines[1]).toMatchObject({ ...common, disposition: "retakan", quantity: 11.1 });
    expect(upsertLineMock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("Pecah blank → saves the store side only: no dialog, no record_return, toast Saved", async () => {
    setup();
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
    expect(upsertLineMock.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "line-1", deliveryId: "del-1", skuCode: "OSVN10B", quantity: 7, reason: "pecah", piecesPerUnit: 180 })
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("Pecah 0 with 1,260 received → one restock-only line of 81.29 kg", async () => {
    setup();
    await saveToStock("0");
    const lines = recordMock.mock.calls[0][0].lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ disposition: "restock", quantity: 81.29, outflowId: "of-nb" });
  });

  it("a box SKU added in pak counts 10 eggs per unit", () => {
    setup({ lines: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add return line" }));
    const opt = screen.getByText(/^OSVN10B ·/).parentElement!;
    fireEvent.click(within(opt).getByRole("button", { name: "pak" }));
    fireEvent.change(screen.getByLabelText("Return qty (pak)"), { target: { value: "3" } });
    expect(screen.getByText("3 pak × 10 = 30 eggs")).toBeInTheDocument();
  });

  it("N30B (non-box SKU on a box faktur unit) counts 150 eggs per box", () => {
    setup({ lines: [], po: { ...PO, orderLines: [...PO.orderLines, { skuCode: "N30B", packQty: 4 }] } });
    fireEvent.click(screen.getByRole("button", { name: "Add return line" }));
    const opt = screen.getByText(/^N30B ·/).parentElement!;
    fireEvent.click(within(opt).getByRole("button"));
    fireEvent.change(screen.getByLabelText("Return qty (box)"), { target: { value: "2" } });
    expect(screen.getByText("2 box × 150 = 300 eggs")).toBeInTheDocument();
  });

  it("a SKU that already has a physical-return line → the new line offers only non-physical reasons", () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add return line" }));
    const opt = screen.getByText(/^OSVN10B ·/).parentElement!;
    fireEvent.click(within(opt).getByRole("button", { name: "box" }));

    const rows = container.querySelectorAll<HTMLElement>(".border-l-\\[3px\\]");
    expect(rows).toHaveLength(2);
    const draft = within(rows[1]);
    expect(draft.getByRole("button", { name: "Kurang" })).toHaveAttribute("aria-pressed", "true");
    for (const physical of ["Pecah", "Ditolak", "Tukar Guling"]) {
      expect(draft.queryByRole("button", { name: physical })).not.toBeInTheDocument();
    }
    expect(draft.getByText("No goods come back")).toBeInTheDocument();
  });

  it.each([
    ["kurang", "Stock has not changed."],
    ["lebih", "The surplus was never deducted from stock"],
  ])("reason %s → no warehouse inputs, 'No goods come back' + its hint", (reason, hint) => {
    setup({ lines: [line({ reason })] });
    expect(screen.getByText("No goods come back")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${hint}`))).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Eggs received" })).not.toBeInTheDocument();
  });

  describe("blocks (§6.5.3) show their message and disable Save", () => {
    it("Pecah more than received", () => {
      setup();
      fireEvent.change(pecahInput(), { target: { value: "1300" } });
      expect(screen.getByText("Broken is more than eggs received")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("received over the line's pieces after a prior return on the SKU", () => {
      // 32.26 kg restocked = 500 eggs; the line is 1,260 → 760 left.
      setup({ rows: [returnRow({ quantity: 32.26 })] });
      fireEvent.click(screen.getByRole("button", { name: "Add a second return" }));
      expect(receivedInput().value).toBe("760");
      fireEvent.change(receivedInput(), { target: { value: "761" } });
      fireEvent.change(pecahInput(), { target: { value: "0" } });
      expect(screen.getByText("More than returned: 7 box = 1,260 eggs")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("received over the egg cap when a null-SKU return used most of it", () => {
      // 998.71 − 950 = 48.71 kg left = floor(48.71 × 15.5) = 755 eggs.
      setup({ rows: [returnRow({ sku_code: null, quantity: 950 })] });
      expect(receivedInput().value).toBe("1260"); // a null-SKU return doesn't lock this SKU
      fireEvent.change(pecahInput(), { target: { value: "0" } });
      expect(screen.getByText("More than sold: NEGERI BIASA can still take 755 eggs back")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("received 0", () => {
      setup();
      fireEvent.change(receivedInput(), { target: { value: "0" } });
      fireEvent.change(pecahInput(), { target: { value: "0" } });
      expect(screen.getByText("Eggs received must be at least 1")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("non-integer received (12,5)", () => {
      setup();
      fireEvent.change(receivedInput(), { target: { value: "12,5" } });
      fireEvent.change(pecahInput(), { target: { value: "2" } });
      expect(screen.getByText("Egg counts must be whole numbers")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });
  });

  describe("typed quantities", () => {
    const qtyInput = () => screen.getByLabelText("Return qty (box)") as HTMLInputElement;
    const QTY_INVALID = "Return qty: e.g. 2,5 or 1.500";
    const WHOLE = "Egg counts must be whole numbers";

    // Box and pak can be fractional by design (spec §6.5.1), so qty follows the kg rule.
    it.each([
      ["2,5", 2.5],
      ["2.5", 2.5],
      ["1500", 1500],
      ["1.500", 1500],
      ["1.200,5", 1200.5],
    ])("store qty %j saves %d, even with Pecah blank", async (typed, want) => {
      setup();
      fireEvent.change(qtyInput(), { target: { value: typed } });
      expect(qtyInput()).not.toHaveAttribute("aria-invalid");
      fireEvent.click(saveButton());
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
      expect(upsertLineMock.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ quantity: want }));
    });

    it.each(["1.2.3", "1,500.5", "12.34.567", "1.500,5,5"])("store qty %j is flagged and can't be saved, even with Pecah blank", (typed) => {
      setup();
      fireEvent.change(qtyInput(), { target: { value: typed } });
      expect(qtyInput()).toHaveAttribute("aria-invalid", "true");
      expect(qtyInput().value).toBe(typed);
      expect(screen.getByText(QTY_INVALID)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();

      fireEvent.change(qtyInput(), { target: { value: "7" } });
      expect(qtyInput()).not.toHaveAttribute("aria-invalid");
      expect(screen.queryByText(QTY_INVALID)).not.toBeInTheDocument();
      expect(saveButton()).toBeEnabled();
    });

    it("a thousands dot in Eggs received is thousands, never 1 egg", async () => {
      setup();
      fireEvent.change(receivedInput(), { target: { value: "1.000" } });
      expect(receivedInput()).not.toHaveAttribute("aria-invalid");
      await saveToStock("0");
      const lines = recordMock.mock.calls[0][0].lines;
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ disposition: "restock", quantity: 64.52 }); // 1000 / 15.5
    });

    it("a thousands dot in Broken is thousands, never 1 egg", async () => {
      setup();
      await saveToStock("1.000");
      const lines = recordMock.mock.calls[0][0].lines;
      expect(lines.map((l) => [l.disposition, l.quantity])).toEqual([
        ["restock", 16.77], // 260 OK
        ["retakan", 64.52], // 1000 broken
      ]);
    });

    it.each(["2,5", "1.5", "1,000", "1.500,5"])("Eggs received %j is flagged and blocks the save, even with Pecah blank", (typed) => {
      setup();
      fireEvent.change(receivedInput(), { target: { value: typed } });
      expect(receivedInput()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(WHOLE)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
      fireEvent.click(saveButton());
      expect(upsertLineMock.mutateAsync).not.toHaveBeenCalled();
    });

    it.each(["2,5", "1.5", "1,000", "1.500,5"])("Broken %j is flagged, and Enter won't open the confirmation", (typed) => {
      setup();
      fireEvent.change(pecahInput(), { target: { value: typed } });
      expect(pecahInput()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(WHOLE)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();

      fireEvent.keyDown(pecahInput(), { key: "Enter" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("a saved 2.125 box reopens clean and saves back unchanged", async () => {
      setup({ lines: [line({ quantity: 2.125, piecesPerUnit: 8 })] });
      expect(qtyInput().value).toBe("2,125");
      expect(qtyInput()).not.toHaveAttribute("aria-invalid");
      expect(receivedInput().value).toBe("17"); // 2.125 × 8

      fireEvent.click(saveButton());
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
      expect(upsertLineMock.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2.125 }));
    });

    it("a fractional prefill can't pass as thousands, and holds only the warehouse save", async () => {
      // 0,125 box × 9 = 1.125 eggs: a count parser would read "1.125" as 1125.
      setup({ lines: [line({ quantity: 0.125, piecesPerUnit: 9 })] });
      expect(receivedInput().value).toBe("1,125");
      expect(receivedInput()).not.toHaveAttribute("aria-invalid"); // not typed: not red yet
      expect(saveButton()).toBeEnabled(); // the store side can still be saved

      fireEvent.change(pecahInput(), { target: { value: "0" } });
      expect(receivedInput()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(WHOLE)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("a locked warehouse side can't hold the store side", async () => {
      setup({ rows: [returnRow({ quantity: 32.26 })] });
      expect(screen.queryByRole("textbox", { name: "Eggs received" })).not.toBeInTheDocument();
      fireEvent.change(qtyInput(), { target: { value: "8" } });
      expect(saveButton()).toBeEnabled();
    });

    it("a non-physical reason can't be held by a warehouse number left behind", () => {
      setup();
      fireEvent.change(pecahInput(), { target: { value: "2,5" } });
      expect(saveButton()).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Kurang" }));
      expect(screen.queryByText(WHOLE)).not.toBeInTheDocument();
      expect(saveButton()).toBeEnabled();
    });
  });

  it("prior non-voided returns lock the warehouse side; 'Add a second return' unlocks and prefills the rest", () => {
    setup({
      rows: [
        returnRow({ quantity: 32.26 }), // 500 OK
        returnRow({ disposition: "retakan", quantity: 6.45 }), // 100 pecah
        returnRow({ quantity: 50, voided_at: "2026-10-21T00:00:00Z" }), // voided: ignored
      ],
    });
    expect(screen.getByText("Return already recorded · void it first to change it")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Eggs received" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add a second return" }));
    expect(screen.queryByText("Return already recorded · void it first to change it")).not.toBeInTheDocument();
    expect(receivedInput().value).toBe("660"); // 1,260 − 500 − 100
  });

  it("Enter in Pecah opens the confirmation; submitting the dialog records", async () => {
    setup();
    fireEvent.change(pecahInput(), { target: { value: "172" } });
    fireEvent.keyDown(pecahInput(), { key: "Enter" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.submit(confirmButton().closest("form")!);
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
  });

  it("network failure → 'Try again' resends the SAME entry ids without re-saving the line", async () => {
    recordMock.mockResolvedValueOnce({ ok: false, kind: "network" });
    setup();
    await saveToStock("172");
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(toast.error).toHaveBeenCalledWith("No connection, try again");
    expect(pecahInput()).toBeDisabled(); // frozen

    fireEvent.click(retry);
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(2));
    const ids = (n: number) => recordMock.mock.calls[n][0].lines.map((l) => l.id);
    expect(ids(1)).toEqual(ids(0));
    expect(upsertLineMock.mutateAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveButton()).toBeInTheDocument()); // unfrozen after success
  });

  it("server PRIOR_MISMATCH → the reload message", async () => {
    recordMock.mockResolvedValueOnce({ ok: false, kind: "server", message: "PRIOR_MISMATCH: expected 0, found 32.26" });
    setup();
    await saveToStock("172");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "A return for OSVN10B was just recorded (from Activities or another phone); reload"
      )
    );
  });

  it("server RETURN_EXCEEDS_OUTFLOW → errExceeds with the remaining cap in eggs", async () => {
    // 100 kg already returned without a SKU: 898.71 kg left = 13,930 eggs; 1,550 eggs returned.
    recordMock.mockResolvedValueOnce({ ok: false, kind: "server", message: "RETURN_EXCEEDS_OUTFLOW: of-nb" });
    setup({ rows: [returnRow({ sku_code: null, quantity: 100 })] });
    await saveToStock("172");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("More than sold: OSVN10B can still take 13,930 eggs back (already returned 1,550)")
    );
  });

  it("deleting a line with returns warns they stay as 'retur tanpa baris'", async () => {
    setup({ rows: [returnRow({ quantity: 32.26 })] });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Line OSVN10B \(Pecah\) will be deleted\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/show as "retur tanpa baris" in the return history/)).toBeInTheDocument();
  });
});
