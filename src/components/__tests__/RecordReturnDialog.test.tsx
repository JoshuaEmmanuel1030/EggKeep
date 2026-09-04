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
vi.mock("@/hooks/useVoidEntry", () => ({
  useVoidEntry: () => ({
    // Resolve every log to a deterministic outflow id.
    findRelatedEntryId: vi.fn(async (log: ActivityLog) => `outflow-${log.id}`),
  }),
}));
vi.mock("@/hooks/useItemTypes", () => ({
  // NEGERI BIASA is kg-native; conversionMap drives the unit label.
  useItemTypes: () => ({ conversionMap: { "NEGERI BIASA": { unit: "kg" } } }),
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

describe("RecordReturnDialog", () => {
  beforeEach(() => {
    recordReturnMock.mockClear();
    recordReturnMock.mockResolvedValue({ ok: true });
  });
  afterEach(() => cleanup());

  it("disables confirm until a valid quantity is entered", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: /record return/i });
    expect(confirm).toBeDisabled();

    const qty = screen.getByLabelText(/returned/i);
    fireEvent.change(qty, { target: { value: "30" } });
    expect(confirm).toBeEnabled();
  });

  it("clamps quantity to the amount sold and shows the over-max hint", () => {
    renderDialog();
    const qty = screen.getByLabelText(/returned/i) as HTMLInputElement;

    fireEvent.change(qty, { target: { value: "999" } });
    expect(qty.value).toBe("155"); // clamped to max
    expect(screen.getByText(/only 155 kg were sold/i)).toBeInTheDocument();
  });

  it("calls recordReturn with a correctly-shaped RecordReturnInput", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/returned/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));

    // Wait a microtask for the async submit handler.
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

  it("sends the write-off disposition when toggled", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/returned/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /write off/i }));
    fireEvent.click(screen.getByRole("button", { name: /record return/i }));

    await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
    expect(recordReturnMock.mock.calls[0]![0].lines[0]!.disposition).toBe("writeoff");
  });

  it("shows the empty message when there are no egg lines", () => {
    renderDialog({ eggLogs: [] });
    expect(screen.getByText(/no egg lines to return/i)).toBeInTheDocument();
  });
});
