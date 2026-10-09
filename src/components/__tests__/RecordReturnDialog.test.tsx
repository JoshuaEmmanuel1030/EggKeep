// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
      "KAMPUNG BIASA": { unit: "btr" },
    },
    boxCapacityMap: { osave: { N10B: 18 } },
  }),
}));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({
    skus: [
      { code: "KP10B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10 },
      { code: "KP6B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 6 },
      { code: "N30B", eggProduct: "NEGERI BIASA", eggsPerPack: 30 },
      // Base pack for the box below: 10 NEGERI BIASA eggs per pack.
      { code: "N10B", eggProduct: "NEGERI BIASA", eggsPerPack: 10 },
      // Box SKU: no eggProduct/eggsPerPack of its own — resolved via base × capacity.
      { code: "OSVN10B", eggProduct: "", eggsPerPack: 0, basePackCode: "N10B", boxMode: "osave" },
    ],
  }),
}));
// No prior returns by default -> the cap equals the full sold quantity.
import type { OutflowReturns } from "@/hooks/usePriorReturns";
const priorReturnsMock = vi.fn<() => Record<string, OutflowReturns>>(() => ({}));
vi.mock("@/hooks/usePriorReturns", () => ({
  usePriorReturns: () => priorReturnsMock(),
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

function renderDialog(over: Partial<React.ComponentProps<typeof RecordReturnDialog>> = {}) {
  return render(
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
}

const restockInput = () => screen.getByLabelText(/ok/i) as HTMLInputElement;
const retakanInput = () => screen.getByLabelText(/retak/i) as HTMLInputElement;
const writeoffInput = () => screen.getByLabelText(/hancur/i) as HTMLInputElement;

describe("RecordReturnDialog", () => {
  beforeEach(() => {
    recordReturnMock.mockClear();
    recordReturnMock.mockResolvedValue({ ok: true });
    priorReturnsMock.mockReset();
    priorReturnsMock.mockReturnValue({});
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
      "outflow-1": { restock: 100, retakan: 0, writeoff: 0, total: 100, bySku: {} },
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
});
