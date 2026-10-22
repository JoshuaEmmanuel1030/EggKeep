// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { GroupedActivityLog } from "@/components/GroupedActivityLog";
import type { ActivityLog } from "@/types/activityLog";

vi.mock("@/hooks/useVoidEntry", () => ({
  useVoidEntry: () => ({
    canEdit: () => true,
    getEditWindowHours: () => 40,
    voidOutflow: vi.fn(),
    voidInflow: vi.fn(),
    findRelatedEntryId: vi.fn(),
    isAdmin: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@js.id" }, loading: false }) }));
vi.mock("@/hooks/useItemTypes", () => ({ useItemTypes: () => ({ conversionMap: {} }) }));
vi.mock("@/hooks/usePackSKUs", () => ({ usePackSKUs: () => ({ skus: [] }) }));
vi.mock("@/hooks/usePriorReturns", () => ({ usePriorReturns: () => ({}) }));
vi.mock("@/hooks/useRecordReturn", () => ({ useRecordReturn: () => ({ recordReturn: vi.fn(), saving: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function order(createdMinAgo: number, userId = "u1"): ActivityLog[] {
  const at = minutesAgo(createdMinAgo);
  const md = {
    orderType: "quick_outflow" as const, buyerName: "OSAVE BKS",
    orderLines: [{ skuCode: "KP6B", packQty: 10 }],
    relatedProducts: [{ product: "KAMPUNG BIASA", quantity: 60, type: "egg" }, { product: "Mika 6", quantity: 10, type: "packaging" }],
  };
  return [
    { id: "1", user_id: userId, action_type: "outflow", category: "egg", product: "KAMPUNG BIASA", quantity_butir: 60, recorded_at: at, created_at: at, client_id: "c1", isSynced: true, metadata: { ...md, relatedEntryId: "o1" } },
    { id: "2", user_id: userId, action_type: "outflow", category: "packaging", product: "Mika 6", quantity_butir: 10, recorded_at: at, created_at: at, client_id: "c2", isSynced: true, metadata: { ...md, relatedEntryId: "o2" } },
  ];
}
const renderFeed = (logs: ActivityLog[]) =>
  render(<LanguageProvider><GroupedActivityLog logs={logs} viewMode="grouped" /></LanguageProvider>);

describe("Edit order button (1-hour window)", () => {
  afterEach(() => cleanup());

  it("shows for your own order entered 10 minutes ago", () => {
    renderFeed(order(10));
    expect(screen.getByRole("button", { name: /edit order/i })).toBeInTheDocument();
  });
  it("is gone after the hour", () => {
    renderFeed(order(61));
    expect(screen.queryByRole("button", { name: /edit order/i })).not.toBeInTheDocument();
  });
  it("is not offered on someone else's order (non-admin)", () => {
    renderFeed(order(10, "u2"));
    expect(screen.queryByRole("button", { name: /edit order/i })).not.toBeInTheDocument();
  });
});
