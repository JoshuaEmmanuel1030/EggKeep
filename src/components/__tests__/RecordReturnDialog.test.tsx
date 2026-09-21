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
  useItemTypes: () => ({ conversionMap: { "NEGERI BIASA": { unit: "kg" } } }),
}));
// No prior returns by default -> the cap equals the full sold quantity.
const priorReturnsMock = vi.fn<() => Record<string, number>>(() => ({}));
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

const restockInput = () => screen.getByLabelText(/restock/i) as HTMLInputElement;
const retakanInput = () => screen.getByLabelText(/retakan/i) as HTMLInputElement;
const writeoffInput = () => screen.getByLabelText(/write off/i) as HTMLInputElement;

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
    priorReturnsMock.mockReturnValue({ "outflow-1": 100 });
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
});
