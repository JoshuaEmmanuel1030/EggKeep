// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    "outflow-1": { restock: 25, retakan: 25, writeoff: 0, total: 50 },
  }),
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

afterEach(() => cleanup());

describe("GroupedActivityLog — returns annotation", () => {
  it("shows delivered qty, original, and B/R/A code on a returned egg line", () => {
    render(
      <LanguageProvider>
        <GroupedActivityLog logs={[log]} viewMode="grouped" />
      </LanguageProvider>
    );
    expect(screen.getByText("150")).toBeInTheDocument(); // 200 - 50 delivered
    expect(screen.getByText(/was 200/i)).toBeInTheDocument();
    expect(screen.getByText(/50 returned/i)).toBeInTheDocument();
    expect(screen.getByText(/25B 25R/)).toBeInTheDocument(); // no 0A
  });
});
