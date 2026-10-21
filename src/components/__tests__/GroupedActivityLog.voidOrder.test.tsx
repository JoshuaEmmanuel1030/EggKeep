// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { GroupedActivityLog } from "@/components/GroupedActivityLog";
import type { ActivityLog } from "@/types/activityLog";

const voidOutflowMock = vi.fn(async () => true);
vi.mock("@/hooks/useVoidEntry", () => ({
  useVoidEntry: () => ({
    canEdit: () => true, // editable so the Void order button renders
    getEditWindowHours: () => 40,
    voidOutflow: voidOutflowMock,
    voidInflow: vi.fn(async () => true),
    findRelatedEntryId: vi.fn(async (l: ActivityLog) => `outflow-${l.id}`),
  }),
}));
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({ conversionMap: {} }),
}));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({ skus: [] }),
}));
vi.mock("@/hooks/useRecordReturn", () => ({
  useRecordReturn: () => ({ recordReturn: vi.fn(), saving: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Two rows in the SAME 30s bucket -> one buyer order with two live rows, so
// "Void order" goes through the order-level confirm dialog.
const base = {
  user_id: "u1",
  action_type: "outflow" as const,
  category: "egg" as const,
  created_at: "2026-09-03T09:15:05.000Z",
  client_id: "c",
  metadata: {
    orderType: "quick_outflow" as const,
    buyerName: "OSAVE BKS",
    orderLines: [{ eggProduct: "KP6", looseQty: 100 }],
  },
};
const logs: ActivityLog[] = [
  { ...base, id: "1", product: "KP6", quantity_butir: 100, recorded_at: "2026-09-03T09:15:05.000Z" },
  { ...base, id: "2", product: "NEGERI BIASA", quantity_butir: 155, recorded_at: "2026-09-03T09:15:06.000Z" },
];

function renderFeed() {
  return render(
    <LanguageProvider>
      <GroupedActivityLog logs={logs} viewMode="grouped" />
    </LanguageProvider>
  );
}

describe("GroupedActivityLog — void order AlertDialog flow", () => {
  beforeEach(() => voidOutflowMock.mockClear());
  afterEach(() => cleanup());

  it("renders a single grouped buyer order for same-bucket rows", () => {
    renderFeed();
    // One buyer header, not two.
    expect(screen.getAllByText("OSAVE BKS")).toHaveLength(1);
  });

  it("opens the confirm AlertDialog when Void order is clicked", () => {
    renderFeed();
    fireEvent.click(screen.getByRole("button", { name: /void order/i }));
    // AlertDialog confirm title appears.
    expect(screen.getByText(/void this entire order\?/i)).toBeInTheDocument();
  });

  it("confirming advances to the reason step (does not void until reason given)", () => {
    renderFeed();
    // The card's "Void order" button is the only one before the dialog opens.
    fireEvent.click(screen.getByRole("button", { name: /void order/i }));

    // Confirm inside the AlertDialog (its own "Void order" action button).
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /void order/i }));

    // The reason-collection VoidEntryDialog is now open; nothing voided yet.
    expect(screen.getByText(/reason for voiding/i)).toBeInTheDocument();
    expect(voidOutflowMock).not.toHaveBeenCalled();
  });
});

describe("GroupedActivityLog — one void action, no edit pencil", () => {
  afterEach(() => cleanup());

  it("a single-material order still offers Void order and no edit button", () => {
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[logs[0]]} viewMode="grouped" />
      </LanguageProvider>
    );
    expect(screen.getByRole("button", { name: /void order/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("a Cash (manual) entry offers Void Entry, which opens the reason step", () => {
    const cash: ActivityLog = {
      ...logs[0], id: "m1", metadata: { orderType: "manual" },
    };
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[cash]} viewMode="grouped" />
      </LanguageProvider>
    );
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /void entry/i }));
    expect(screen.getByText(/reason for voiding/i)).toBeInTheDocument();
  });
});

describe("GroupedActivityLog — Void order skips rows already voided", () => {
  beforeEach(() => voidOutflowMock.mockClear());
  afterEach(() => cleanup());

  it("with one live row left, goes straight to the reason step and voids only that row", async () => {
    const partlyVoided: ActivityLog[] = [
      logs[0],
      { ...logs[1], voided_at: "2026-09-03T10:00:00.000Z", void_reason: "wrong label" },
    ];
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={partlyVoided} viewMode="grouped" />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /void order/i }));
    // No "void all N entries" confirm for a single live row.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "customer cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm void/i }));
    await waitFor(() => expect(voidOutflowMock).toHaveBeenCalledTimes(1));
    expect(voidOutflowMock).toHaveBeenCalledWith("outflow-1", "1", "customer cancelled");
  });
});
