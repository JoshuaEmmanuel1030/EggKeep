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
// NEGERI OMEGA is kg-native -> its order-line bubble must convert back to butir.
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: { "NEGERI OMEGA": { unit: "kg" } },
    boxCapacityMap: { osave: { N10O: 18 } },
  }),
}));
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
    // A box SKU return keyed by its own code (OSVN10O), on the NEGERI OMEGA outflow.
    // Stored in kg (10.58) -> the bubble must show butir (10.58 * 15.5 = 164).
    "outflow-3": {
      restock: 10.58, retakan: 0, writeoff: 0, total: 10.58,
      bySku: { OSVN10O: { restock: 10.58, retakan: 0, writeoff: 0, total: 10.58 } },
    },
  }),
}));
// KP10B/KP6B are normal packs (eggProduct set). OSVN10O is a BOX SKU: it carries no
// eggProduct of its own — its egg comes from base pack N10O -> NEGERI OMEGA.
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({ skus: [
    { code: "KP10B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10 },
    { code: "KP6B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 6 },
    { code: "N10O", eggProduct: "NEGERI OMEGA", eggsPerPack: 10 },
    { code: "OSVN10O", eggProduct: "", eggsPerPack: 0, basePackCode: "N10O", boxMode: "osave" },
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

// A box-SKU order line (OSVN10O) whose egg (NEGERI OMEGA, via base pack N10O) had
// a return. Regression: box SKUs carry no eggProduct, so the feed must resolve it
// through the base pack or the per-SKU bubble never renders.
const boxEggLog: ActivityLog = {
  id: "3", user_id: "u1", action_type: "outflow", category: "egg",
  product: "NEGERI OMEGA", quantity_butir: 580.65,
  recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
  client_id: "c3",
  metadata: {
    orderType: "quick_outflow", buyerName: "Osave", relatedEntryId: "outflow-3",
    orderLines: [{ skuCode: "OSVN10O", packQty: 50 }],
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
    // code is colour-coded per disposition -> each segment is its own span.
    expect(screen.getByText("25O")).toBeInTheDocument();
    expect(screen.getByText("25R")).toBeInTheDocument(); // no H segment (0)
  });

  it("shows each pack SKU's own return (no doubling)", () => {
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[sharedEggLog]} viewMode="grouped" />
      </LanguageProvider>
    );
    expect(screen.getByText("20O")).toBeInTheDocument(); // KP10B's own code
    expect(screen.getByText("11O")).toBeInTheDocument(); // KP6B's own code (not doubled)
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
    expect(screen.getByText(/31 returned/)).toBeInTheDocument();
    expect(screen.getByText("31O")).toBeInTheDocument();
  });

  it("shows the return bubble on a BOX SKU line in butir (kg egg converted)", () => {
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[boxEggLog]} viewMode="grouped" />
      </LanguageProvider>
    );
    // 10.58 kg stored -> 164 butir on the order line (kg conversion stays in materials).
    expect(screen.getByText(/164 returned/)).toBeInTheDocument();
    expect(screen.getByText("164O")).toBeInTheDocument();
  });
});
