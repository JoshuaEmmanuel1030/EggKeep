// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { RecordReturnDialog } from "@/components/RecordReturnDialog";
import type { ActivityLog } from "@/types/activityLog";
import type { RecordReturnInput } from "@/types/returns";

// ── Hook mocks: keep the component pure of Supabase / network. ────────────────
const recordReturnMock =
  vi.fn<(input: RecordReturnInput) => Promise<{ ok: boolean; message?: string }>>(
    async () => ({ ok: true })
  );
vi.mock("@/hooks/useRecordReturn", () => ({
  useRecordReturn: () => ({ recordReturn: recordReturnMock, saving: false }),
}));
// Stable fn identity across renders — a fresh vi.fn each render would re-trigger
// the dialog's resolve effect and loop.
const findRelatedEntryIdMock = vi.fn(async (log: ActivityLog) => `outflow-${log.id}`);
vi.mock("@/hooks/useVoidEntry", () => ({
  useVoidEntry: () => ({ findRelatedEntryId: findRelatedEntryIdMock }),
}));
vi.mock("@/hooks/useItemTypes", () => ({
  // NEGERI BIASA is kg-native; conversionMap drives the unit label.
  // boxCapacityMap: OSVN10B (box) holds 18 of its base pack N10B.
  useItemTypes: () => ({
    conversionMap: {
      "NEGERI BIASA": { unit: "kg" },
      "NEGERI OMEGA": { unit: "kg" },
      "KAMPUNG BIASA": { unit: "btr" },
    },
    boxCapacityMap: { osave: { N10B: 18 } },
  }),
}));
const PACK_SKUS = [
  { code: "KP10B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10 },
  { code: "KP6B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 6 },
  { code: "N30B", eggProduct: "NEGERI BIASA", eggsPerPack: 30 },
  // Base pack for the box below: 10 NEGERI BIASA eggs per pack.
  { code: "N10B", eggProduct: "NEGERI BIASA", eggsPerPack: 10 },
  // Box SKU: no eggProduct/eggsPerPack of its own — resolved via base × capacity.
  { code: "OSVN10B", eggProduct: "", eggsPerPack: 0, basePackCode: "N10B", boxMode: "osave" },
];
const packSkusMock = vi.fn(() => ({ skus: PACK_SKUS, isLoading: false }));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => packSkusMock(),
}));
// No prior returns by default -> the cap equals the full sold quantity.
import type { OutflowReturns } from "@/hooks/usePriorReturns";
const priorReturnsMock = vi.fn<(ids: (string | null)[]) => Record<string, OutflowReturns>>(() => ({}));
vi.mock("@/hooks/usePriorReturns", () => ({
  usePriorReturns: (ids: (string | null)[]) => priorReturnsMock(ids),
}));
// sonner toast is a no-op in tests.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const eggLog: ActivityLog = {
  id: "1",
  user_id: "u1",
  action_type: "outflow",
  product: "NEGERI BIASA",
  quantity_butir: 155, // native kg
  category: "egg",
  recorded_at: "2026-09-03T09:15:00.000Z",
  created_at: "2026-09-03T09:15:00.000Z",
  client_id: "c1",
};

const dialog = (over: Partial<React.ComponentProps<typeof RecordReturnDialog>> = {}) => (
  <LanguageProvider>
    <RecordReturnDialog
      open
      onOpenChange={() => {}}
      buyerName="OSAVE BKS"
      eggLogs={[eggLog]}
      {...over}
    />
  </LanguageProvider>
);
const renderDialog = (over: Partial<React.ComponentProps<typeof RecordReturnDialog>> = {}) =>
  render(dialog(over));

const restockInput = () => screen.getByLabelText(/ok/i) as HTMLInputElement;
const retakanInput = () => screen.getByLabelText(/retak/i) as HTMLInputElement;
const writeoffInput = () => screen.getByLabelText(/hancur/i) as HTMLInputElement;

describe("RecordReturnDialog", () => {
  beforeEach(() => {
    recordReturnMock.mockClear();
    recordReturnMock.mockResolvedValue({ ok: true });
    priorReturnsMock.mockReset();
    priorReturnsMock.mockReturnValue({});
    packSkusMock.mockReset();
    packSkusMock.mockReturnValue({ skus: PACK_SKUS, isLoading: false });
  });
  afterEach(() => cleanup());

  it("disables confirm until a valid quantity is entered", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: /record return/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(restockInput(), { target: { value: "30" } });
    expect(confirm).toBeEnabled();
  });

  it("clamps the line total to the amount sold and shows the over-max hint", () => {
    renderDialog();
    fireEvent.change(restockInput(), { target: { value: "999" } });
    expect(restockInput().value).toBe("155"); // clamped to what was sold
    expect(screen.getByText(/only 155 kg were sold/i)).toBeInTheDocument();
  });

  it("caps the second bucket by the room the first bucket left", () => {
    renderDialog();
    fireEvent.change(restockInput(), { target: { value: "100" } });
    // Only 55 kg of room remains; a 90 write-off must clamp to 55.
    fireEvent.change(writeoffInput(), { target: { value: "90" } });
    expect(writeoffInput().value).toBe("55");
  });

  it("calls recordReturn with a correctly-shaped RecordReturnInput", async () => {
    renderDialog();
    fireEvent.change(restockInput(), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));

    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));

    const input = recordReturnMock.mock.calls[0]![0];
    expect(input).toMatchObject({
      buyerName: "OSAVE BKS",
      lines: [
        {
          outflowId: "outflow-1",
          product: "NEGERI BIASA",
          category: "egg",
          quantity: 40,
          disposition: "restock",
        },
      ],
    });
    expect(input.returnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.lines[0]!.id).toBeTruthy(); // client UUID for idempotency
  });

  it("splits one returned line across all three dispositions", async () => {
    renderDialog();
    fireEvent.change(restockInput(), { target: { value: "12" } });
    fireEvent.change(retakanInput(), { target: { value: "13" } });
    fireEvent.change(writeoffInput(), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));

    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    const { lines } = recordReturnMock.mock.calls[0]![0];

    expect(lines).toHaveLength(3);
    // All three point at the same outflow row.
    expect(new Set(lines.map((l) => l.outflowId))).toEqual(new Set(["outflow-1"]));
    // Distinct client ids so each is independently idempotent.
    expect(new Set(lines.map((l) => l.id)).size).toBe(3);
    expect(lines.map((l) => [l.disposition, l.quantity])).toEqual([
      ["restock", 12],
      ["retakan", 13],
      ["writeoff", 25],
    ]);
  });

  it("omits zero buckets when only some are filled", async () => {
    renderDialog();
    fireEvent.change(retakanInput(), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));

    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    const { lines } = recordReturnMock.mock.calls[0]![0];
    expect(lines).toEqual([expect.objectContaining({ disposition: "retakan", quantity: 10 })]);
  });

  it("caps to what's still returnable after a prior partial return", async () => {
    // 100 of the 155 sold already came back -> only 55 kg is still returnable.
    priorReturnsMock.mockReturnValue({
      "outflow-1": { restock: 100, retakan: 0, writeoff: 0, total: 100, bySku: {}, anyReturns: true },
    });
    renderDialog();
    fireEvent.change(restockInput(), { target: { value: "5" } });
    // The outflow id resolves asynchronously on open; once it does the cap
    // tightens from 155 to 55, visible in the "of {max}" hint.
    await screen.findByText(/of 55 kg sold/i);
    // A fresh entry above the tightened cap now clamps to 55.
    fireEvent.change(restockInput(), { target: { value: "90" } });
    expect(restockInput().value).toBe("55");
  });

  it("shows the empty message when there are no egg lines", () => {
    renderDialog({ eggLogs: [] });
    expect(screen.getByText(/no egg lines to return/i)).toBeInTheDocument();
  });

  it("emits one line per SKU with the entered pieces (butir egg)", async () => {
    // Two KAMPUNG BIASA SKUs share one egg outflow; the dialog shows a row per SKU.
    const kampungLog: ActivityLog = {
      id: "1", user_id: "u1", action_type: "outflow", category: "egg",
      product: "KAMPUNG BIASA", quantity_butir: 10092,
      recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
      client_id: "c",
    };
    renderDialog({
      eggLogs: [kampungLog],
      orderLines: [
        { skuCode: "KP10B", packQty: 840 },
        { skuCode: "KP6B", packQty: 282 },
      ],
    });
    // One OK box per SKU row (labelled OK now).
    const okBoxes = await screen.findAllByLabelText(/ok/i);
    expect(okBoxes).toHaveLength(2);
    fireEvent.change(okBoxes[0], { target: { value: "20" } }); // KP10B
    fireEvent.change(okBoxes[1], { target: { value: "11" } }); // KP6B
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));

    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    const { lines } = recordReturnMock.mock.calls[0]![0];
    expect(lines).toEqual([
      expect.objectContaining({ skuCode: "KP10B", product: "KAMPUNG BIASA", quantity: 20, disposition: "restock", outflowId: "outflow-1" }),
      expect.objectContaining({ skuCode: "KP6B", product: "KAMPUNG BIASA", quantity: 11, disposition: "restock", outflowId: "outflow-1" }),
    ]);
  });

  it("converts Negeri pieces to kg (flat 15.5) on submit", async () => {
    const negeriLog: ActivityLog = {
      id: "1", user_id: "u1", action_type: "outflow", category: "egg",
      product: "NEGERI BIASA", quantity_butir: 100, // native kg
      recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
      client_id: "c",
    };
    renderDialog({
      eggLogs: [negeriLog],
      orderLines: [{ skuCode: "N30B", packQty: 50 }],
    });
    const okBox = (await screen.findAllByLabelText(/ok/i))[0];
    fireEvent.change(okBox, { target: { value: "31" } }); // 31 pcs -> 2.00 kg
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));
    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    const { lines } = recordReturnMock.mock.calls[0]![0];
    expect(lines[0]).toEqual(expect.objectContaining({ skuCode: "N30B", quantity: 2, disposition: "restock" }));
  });

  it("accepts input for a box SKU (eggs resolved via base pack × capacity)", async () => {
    // Regression: a box SKU (OSVN10B) carries no egg count of its own, so the
    // row's cap resolved to 0 and the input rejected every keystroke. It must
    // resolve eggProduct/eggs via its base pack (N10B ×18) so entry works.
    const negeriLog: ActivityLog = {
      id: "1", user_id: "u1", action_type: "outflow", category: "egg",
      product: "NEGERI BIASA", quantity_butir: 100, // native kg
      recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
      client_id: "c",
    };
    renderDialog({
      eggLogs: [negeriLog],
      orderLines: [{ skuCode: "OSVN10B", packQty: 1 }],
    });
    const okBox = (await screen.findAllByLabelText(/ok/i))[0] as HTMLInputElement;
    fireEvent.change(okBox, { target: { value: "31" } }); // was blocked before the fix
    expect(okBox.value).toBe("31"); // input now accepts the value
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));
    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    const { lines } = recordReturnMock.mock.calls[0]![0];
    expect(lines[0]).toEqual(
      expect.objectContaining({ skuCode: "OSVN10B", product: "NEGERI BIASA", quantity: 2, disposition: "restock" })
    );
  });

  it("adds a native-unit row for a loose egg no pack line covers (mixed PO)", async () => {
    // Regression: with any pack line present, rows came only from pack lines, so
    // a Telur Lepas egg no pack SKU uses (NEGERI OMEGA here) had no row at all.
    const mk = (id: string, product: string, qty: number): ActivityLog => ({
      id, user_id: "u1", action_type: "outflow", category: "egg", product, quantity_butir: qty,
      recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z", client_id: "c",
    });
    renderDialog({
      eggLogs: [mk("1", "NEGERI BIASA", 100), mk("2", "NEGERI OMEGA", 40)],
      orderLines: [
        { skuCode: "N30B", packQty: 50 },
        { eggProduct: "NEGERI OMEGA", looseQty: 40 },
      ],
    });
    // N30B row + one NEGERI OMEGA row; NEGERI BIASA stays pooled under N30B.
    const okBoxes = (await screen.findAllByLabelText(/ok/i)) as HTMLInputElement[];
    expect(okBoxes).toHaveLength(2);
    expect(screen.getByText("NEGERI OMEGA")).toBeInTheDocument();
    // Entry is native kg, capped at the 40 kg sold.
    fireEvent.change(okBoxes[1], { target: { value: "999" } });
    expect(okBoxes[1].value).toBe("40");
    fireEvent.change(okBoxes[1], { target: { value: "2,5" } });
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));
    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    const { lines } = recordReturnMock.mock.calls[0]![0];
    // 2.5 kg as typed — not run through piecesToNative (which would give 0.16).
    expect(lines).toEqual([
      expect.objectContaining({ product: "NEGERI OMEGA", quantity: 2.5, outflowId: "outflow-2", skuCode: undefined }),
    ]);
  });

  it("keeps the prior-returns cap when pack SKUs load after open", async () => {
    // Regression: SKUs arriving after open changed the row set, the reset effect
    // wiped the resolved outflow ids, and the cap forgot the 150 kg already back.
    priorReturnsMock.mockImplementation((ids) =>
      ids.includes("outflow-1")
        ? { "outflow-1": { restock: 150, retakan: 0, writeoff: 0, total: 150, bySku: {}, anyReturns: true } }
        : {}
    );
    packSkusMock.mockReturnValue({ skus: [], isLoading: true });
    // Stable props, like both callers pass from returnRequest state.
    const props = { eggLogs: [eggLog], orderLines: [{ skuCode: "N30B", packQty: 50 }] };
    const { rerender } = renderDialog(props);
    await act(() => new Promise((r) => setTimeout(r, 0))); // outflow ids resolve
    // No interim native row for an egg the (still loading) pack row covers.
    expect(screen.getAllByLabelText(/ok/i)).toHaveLength(1);

    packSkusMock.mockReturnValue({ skus: PACK_SKUS, isLoading: false });
    rerender(dialog(props));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const okBox = screen.getByLabelText(/ok/i) as HTMLInputElement;
    fireEvent.change(okBox, { target: { value: "999" } });
    expect(okBox.value).toBe("78"); // 5 kg left × 15.5 pieces/kg
  });

  it("merges duplicate SKU lines into one row so a return is emitted once", async () => {
    // Regression: two N30B lines made two rows sharing one key/state, so one
    // entry was submitted twice (double restock).
    renderDialog({
      orderLines: [
        { skuCode: "N30B", packQty: 50 },
        { skuCode: "N30B", packQty: 20 },
      ],
    });
    const okBoxes = await screen.findAllByLabelText(/ok/i);
    expect(okBoxes).toHaveLength(1);
    expect(screen.getByText(/2[.,]100 butir/)).toBeInTheDocument(); // 70 packs × 30
    fireEvent.change(okBoxes[0], { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));
    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    const { lines } = recordReturnMock.mock.calls[0]![0];
    expect(lines).toEqual([expect.objectContaining({ skuCode: "N30B", quantity: 2 })]);
  });

  describe("typed quantities", () => {
    const log = (product: string, qty: number): ActivityLog => ({
      id: "1", user_id: "u1", action_type: "outflow", category: "egg", product, quantity_butir: qty,
      recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z", client_id: "c",
    });
    // Pack rows are typed in pieces; a row with no pack line takes the native unit.
    const piecesKg = () => renderDialog({ eggLogs: [log("NEGERI BIASA", 100)], orderLines: [{ skuCode: "N30B", packQty: 50 }] });
    const piecesButir = () => renderDialog({ eggLogs: [log("KAMPUNG BIASA", 10000)], orderLines: [{ skuCode: "KP10B", packQty: 800 }] });
    const nativeKg = () => renderDialog({ eggLogs: [log("NEGERI BIASA", 5000)] });
    const nativeButir = () => renderDialog({ eggLogs: [log("KAMPUNG BIASA", 10000)] });
    const confirm = () => screen.getByRole("button", { name: /record return/i });
    const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
    const recorded = async () => {
      fireEvent.click(confirm());
      await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
      return recordReturnMock.mock.calls[0]![0].lines;
    };

    it.each([
      ["pieces on a kg egg", "1.550", 100, piecesKg], // 1550 pieces / 15.5
      ["pieces on a butir egg", "1.500", 1500, piecesButir],
      ["native butir", "1.500", 1500, nativeButir],
      ["native kg", "1500", 1500, nativeKg],
      ["native kg", "52,89", 52.89, nativeKg],
      ["native kg", "52.89", 52.89, nativeKg],
      // kg reads as the screens print it: a dot before three digits groups thousands.
      ["native kg", "1.500", 1500, nativeKg],
      ["native kg", "1.200,5", 1200.5, nativeKg],
    ] as const)("%s reads %j as %d", async (_name, typed, want, setup) => {
      setup();
      const ok = (await screen.findAllByLabelText(/ok/i))[0] as HTMLInputElement;
      type(ok, typed);
      expect(ok).not.toHaveAttribute("aria-invalid");
      expect(ok.value).toBe(typed);
      expect((await recorded())[0]).toMatchObject({ disposition: "restock", quantity: want });
    });

    it.each([
      ["pieces", "2,5", piecesKg],
      ["pieces", "1.5", piecesKg],
      ["pieces", "1,500", piecesKg],
      ["pieces", "1.500,5", piecesKg],
      ["native butir", "2,5", nativeButir],
      ["native butir", "1.5", nativeButir],
      ["native kg", "1,500.5", nativeKg], // en-US grouping
      ["native kg", "12.34.567", nativeKg],
      ["native kg", "1.500,5,5", nativeKg],
    ] as const)("%s: %j is flagged and blocks the good bucket beside it", async (_name, typed, setup) => {
      setup();
      const ok = (await screen.findAllByLabelText(/ok/i))[0] as HTMLInputElement;
      const hancur = writeoffInput();
      type(hancur, "5");
      type(ok, typed);

      expect(ok).toHaveAttribute("aria-invalid", "true");
      expect(hancur).not.toHaveAttribute("aria-invalid");
      expect(ok.value).toBe(typed); // what was typed stays, so it can be fixed
      expect(screen.getByRole("alert")).toHaveTextContent("Fix the quantities marked in red");
      expect(confirm()).toBeDisabled();
      fireEvent.click(confirm());
      expect(recordReturnMock).not.toHaveBeenCalled();

      type(ok, "10");
      expect(ok).not.toHaveAttribute("aria-invalid");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect((await recorded()).map((l) => l.disposition)).toEqual(["restock", "writeoff"]);
    });

    it("a flagged number alone leaves nothing to confirm", async () => {
      piecesKg();
      const ok = (await screen.findAllByLabelText(/ok/i))[0] as HTMLInputElement;
      type(ok, "2,5");
      expect(confirm()).toBeDisabled();
      expect(screen.queryByText(/of .* butir sold/i)).not.toBeInTheDocument();
    });

    it("the cap reads the thousands dot too: 1.600 pieces clamps to the 1550 left", async () => {
      piecesKg();
      const ok = (await screen.findAllByLabelText(/ok/i))[0] as HTMLInputElement;
      type(ok, "1.600");
      expect(ok.value).toBe("1550");
      expect(ok).not.toHaveAttribute("aria-invalid");
    });

    it("the cap reads a kg thousands dot too: 12.345 kg clamps to the 5000 sold", async () => {
      nativeKg();
      const ok = (await screen.findAllByLabelText(/ok/i))[0] as HTMLInputElement;
      type(ok, "12.345");
      expect(ok.value).toBe("5000");
      expect(ok).not.toHaveAttribute("aria-invalid");
    });

    it("clamping to a fractional kg stays readable instead of reading as thousands", async () => {
      renderDialog({ eggLogs: [log("NEGERI BIASA", 2.125)] });
      const ok = (await screen.findAllByLabelText(/ok/i))[0] as HTMLInputElement;
      type(ok, "999");
      expect(ok.value).toBe("2,125");
      expect(ok).not.toHaveAttribute("aria-invalid");
      expect((await recorded())[0]).toMatchObject({ quantity: 2.125 });
    });

    it("0 in a bucket is nothing to return, not a bad number", async () => {
      nativeButir();
      type(restockInput(), "12");
      type(retakanInput(), "0");
      expect(retakanInput()).not.toHaveAttribute("aria-invalid");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect((await recorded()).map((l) => [l.disposition, l.quantity])).toEqual([["restock", 12]]);
    });

    it("letters never reach the number: 12abc shows and records 12", async () => {
      nativeButir();
      type(restockInput(), "12abc");
      expect(restockInput().value).toBe("12");
      expect((await recorded())[0]).toMatchObject({ quantity: 12 });
    });
  });
});
