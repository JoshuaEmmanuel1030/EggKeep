// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { GroupedActivityLog } from "@/components/GroupedActivityLog";
import type { ActivityLog } from "@/types/activityLog";

vi.mock("@/hooks/useVoidEntry", () => ({
  useVoidEntry: () => ({
    canEdit: () => false,
    getEditWindowHours: () => 0,
    voidOutflow: vi.fn(),
    voidInflow: vi.fn(),
    findRelatedEntryId: vi.fn(),
  }),
}));
vi.mock("@/hooks/useItemTypes", () => ({ useItemTypes: () => ({ conversionMap: {} }) }));
vi.mock("@/hooks/useRecordReturn", () => ({
  useRecordReturn: () => ({ recordReturn: vi.fn(), saving: false }),
}));
vi.mock("@/hooks/usePriorReturns", () => ({
  usePriorReturns: () => ({
    "outflow-1": { restock: 25, retakan: 25, writeoff: 0, total: 50, bySku: {} },
    "outflow-2": {
      restock: 31, retakan: 0, writeoff: 0, total: 31,
      bySku: {
        KP10B: { restock: 20, retakan: 0, writeoff: 0, total: 20 },
        KP6B: { restock: 11, retakan: 0, writeoff: 0, total: 11 },
      },
    },
  }),
}));
// KP10B/KP6B are built from KAMPUNG BIASA eggs — the SKU->egg map the pack line uses.
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({ skus: [
    { code: "KP10B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10 },
    { code: "KP6B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 6 },
  ] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const log: ActivityLog = {
  id: "1",
  user_id: "u1",
  action_type: "outflow",
  category: "egg",
  product: "KP6",
  quantity_butir: 200,
  recorded_at: "2026-10-01T09:15:05.000Z",
  created_at: "2026-10-01T09:15:05.000Z",
  client_id: "c",
  metadata: {
    orderType: "quick_outflow",
    buyerName: "OSAVE BKS",
    relatedEntryId: "outflow-1",
    orderLines: [{ eggProduct: "KP6", looseQty: 200 }],
  },
};

// A shared egg (KAMPUNG BIASA) feeding two pack SKUs (KP10B, KP6B) in one order.
// Each SKU line shows ONLY its own per-SKU return (no doubling); the egg's pooled
// total shows once in the materials/delivered figure.
const sharedEggLog: ActivityLog = {
  id: "2", user_id: "u1", action_type: "outflow", category: "egg",
  product: "KAMPUNG BIASA", quantity_butir: 10092,
  recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
  client_id: "c2",
  metadata: {
    orderType: "quick_outflow", buyerName: "Astro", relatedEntryId: "outflow-2",
    orderLines: [{ skuCode: "KP10B", packQty: 840 }, { skuCode: "KP6B", packQty: 282 }],
    relatedProducts: [{ product: "KAMPUNG BIASA", quantity: 10092, type: "egg" }],
  },
};

afterEach(() => cleanup());

describe("GroupedActivityLog — returns annotation", () => {
  it("shows delivered qty, original, and O/R/H code on a returned egg line", () => {
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[log]} viewMode="grouped" />
      </LanguageProvider>
    );
    expect(screen.getByText("150")).toBeInTheDocument(); // 200 - 50 delivered
    expect(screen.getByText(/was 200/i)).toBeInTheDocument();
    expect(screen.getByText(/50 returned/i)).toBeInTheDocument();
    expect(screen.getByText(/25O 25R/)).toBeInTheDocument(); // no 0A
  });

  it("shows each pack SKU's own return (no doubling)", () => {
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[sharedEggLog]} viewMode="grouped" />
      </LanguageProvider>
    );
    expect(screen.getByText(/20 returned · 20O/)).toBeInTheDocument(); // KP10B
    expect(screen.getByText(/11 returned · 11O/)).toBeInTheDocument(); // KP6B
    // The egg's pooled total (31) shows once in materials — see next test.
  });

  it("shows the egg's pooled total once in the delivered/materials figure", () => {
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[sharedEggLog]} viewMode="grouped" />
      </LanguageProvider>
    );
    // Open the materials breakdown where the pooled egg figure lives.
    fireEvent.click(screen.getByText(/View materials breakdown/i));
    // 31 total returned against KAMPUNG BIASA shows on its delivered line.
    expect(screen.getByText(/31 returned · 31O/)).toBeInTheDocument();
  });
});
