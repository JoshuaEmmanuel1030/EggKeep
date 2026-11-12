// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { StockAdjustmentDialog } from "@/components/StockAdjustmentDialog";
import { en } from "@/locales/en";

// ── No Supabase / network: rpc is a mock keyed by function name. ───────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const line = (over: Record<string, unknown>) => ({
  item_type_id: "it-p", product: "PUYUH", unit: "btr",
  physical_js: 1200, physical_loaded: 0, target: 1200,
  book_at_count: 5000, book_now: 4500, delta: -3800, applied: -3800, shortfall: 0,
  ...over,
});
const PREVIEW = [
  line({}),
  // Short: must lose 40 but only 25 is on hand -> clamp, 15 flagged.
  line({ item_type_id: "it-r", product: "ASIN MATENG", physical_js: 0, target: 0, book_at_count: 40,
         book_now: 25, delta: -40, applied: -25, shortfall: 15 }),
  line({ item_type_id: "it-n", product: "NEGERI BIASA", unit: "kg", physical_js: 900, target: 900,
         book_at_count: 750.5, book_now: 600.25, delta: 149.5, applied: 149.5 }),
];

const s = en.stockCount;
function renderDialog(onApplied = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <LanguageProvider>
      <StockAdjustmentDialog open onOpenChange={onOpenChange} onApplied={onApplied} />
    </LanguageProvider>,
  );
  return { onApplied, onOpenChange };
}

beforeEach(() => {
  rpc.mockReset();
  toast.mockReset();
  rpc.mockImplementation(async (fn: string) =>
    fn === "stock_count_adjustment_preview" ? { data: PREVIEW, error: null } : { data: { id: "adj-1" }, error: null });
});
afterEach(cleanup);

describe("StockAdjustmentDialog", () => {
  it("previews every line with what will change and flags a shortfall", async () => {
    renderDialog();
    const puyuh = await screen.findByTestId("adj-line-PUYUH");
    expect(within(puyuh).getByText((1200).toLocaleString())).toBeInTheDocument();
    expect(within(puyuh).getByText((5000).toLocaleString())).toBeInTheDocument();
    expect(within(puyuh).getByText(`-${(3800).toLocaleString()}`)).toBeInTheDocument();
    // After = book_now + applied.
    expect(within(puyuh).getByText((4500 - 3800).toLocaleString())).toBeInTheDocument();
    const asin = screen.getByTestId("adj-line-ASIN MATENG");
    expect(within(asin).getByText(new RegExp(s.adjustShortfall))).toBeInTheDocument();
    expect(within(screen.getByTestId("adj-line-NEGERI BIASA")).getByText(`+${(149.5).toLocaleString()}`)).toBeInTheDocument();
  });

  it("only confirms after SESUAIKAN is typed, then sends the shown deltas", async () => {
    const { onApplied, onOpenChange } = renderDialog();
    await screen.findByTestId("adj-line-PUYUH");
    const confirm = screen.getByRole("button", { name: s.adjustConfirm });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(new RegExp(s.adjustTypeToConfirm)), { target: { value: "sesuai" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(new RegExp(s.adjustTypeToConfirm)), { target: { value: "SESUAIKAN" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("apply_stock_count_adjustment", {
      p_expected: [
        { item_type_id: "it-p", delta: -3800, applied: -3800 },
        { item_type_id: "it-r", delta: -40, applied: -25 },
        { item_type_id: "it-n", delta: 149.5, applied: 149.5 },
      ],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: s.adjustSuccess }));
  });

  it("reloads the preview when the server says it is stale", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "stock_count_adjustment_preview"
        ? { data: PREVIEW, error: null }
        : { data: null, error: { message: "PREVIEW_STALE: stock changed since the preview, reload it" } });
    const { onApplied } = renderDialog();
    await screen.findByTestId("adj-line-PUYUH");
    fireEvent.change(screen.getByLabelText(new RegExp(s.adjustTypeToConfirm)), { target: { value: "SESUAIKAN" } });
    fireEvent.click(screen.getByRole("button", { name: s.adjustConfirm }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: s.adjustStale })));
    expect(rpc.mock.calls.filter(([fn]) => fn === "stock_count_adjustment_preview")).toHaveLength(2);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("says so and keeps confirm off when nothing would change", async () => {
    rpc.mockImplementation(async () => ({ data: [line({ delta: 0, applied: 0 })], error: null }));
    renderDialog();
    expect(await screen.findByText(s.adjustNothing)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(new RegExp(s.adjustTypeToConfirm)), { target: { value: "SESUAIKAN" } });
    expect(screen.getByRole("button", { name: s.adjustConfirm })).toBeDisabled();
  });
});
