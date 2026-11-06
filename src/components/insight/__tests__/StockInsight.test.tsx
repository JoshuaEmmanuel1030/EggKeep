// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { StockInsight } from "@/components/insight/StockInsight";
import { localToday } from "@/lib/buyerProfile";
import type { InsightData } from "@/hooks/useInsightData";
import type { InflowEntry, StockSummary } from "@/types/inventory";

vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: {},
    itemTypes: [
      { name: "PUYUH", category: "egg", isRetakan: false },
      { name: "PUYUH (RETAKAN)", category: "egg", isRetakan: true },
    ],
  }),
}));

beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(cleanup);

const today = localToday();
const inflow = (product: string, remainingButir: number) =>
  ({ id: product, product, date: today, remainingButir, quantityInButir: remainingButir, category: "egg", invoiceSupplier: "TST (CREAM)" }) as InflowEntry;
const EMPTY = { orders: [], returns: [], deductions: [], counts: [], deliveries: [], deliveryLines: [] } as InsightData;

function show(data: InsightData) {
  return render(
    <LanguageProvider>
      <StockInsight
        stockSummary={[{ product: "PUYUH", category: "egg", totalStock: 100 } as StockSummary]}
        inflows={[inflow("PUYUH", 100), inflow("PUYUH (RETAKAN)", 25)]}
        outflows={[]}
        freshnessDaysByProduct={{}}
        data={data}
        returnCov={{ start: "2020-01-01", staleSince: null }}
        days={28}
        periodLabel="4 minggu"
        control={null}
      />
    </LanguageProvider>
  );
}

describe("Stok tab", () => {
  it("says when the app last counted, beside the variance it shows", () => {
    show({
      ...EMPTY,
      counts: [
        { product: "PUYUH", countDate: "2026-10-23", quantity: 90, systemQty: 100 },
        { product: "PUYUH", countDate: "2026-10-31", quantity: 20, systemQty: 100 },
      ],
    });
    expect(screen.getByText(/Selisih dari Stok Fisik di aplikasi, terakhir 31 Okt\./)).toBeInTheDocument();
    expect(screen.getByText("−80 butir")).toBeInTheDocument();
  });

  it("gives no count date when the app has no counts", () => {
    show(EMPTY);
    expect(screen.queryByText(/Selisih dari Stok Fisik/)).not.toBeInTheDocument();
  });

  it("says the retakan card only covers store returns", () => {
    show(EMPTY);
    expect(screen.getByText(/dari retur toko/)).toBeInTheDocument();
  });

  it("keeps (RETAKAN) stock out of the age lists and cleans the supplier name", () => {
    show(EMPTY);
    expect(screen.queryByText("PUYUH (RETAKAN)")).not.toBeInTheDocument();
    expect(screen.getAllByText(/· TST$/).length).toBeGreaterThan(0);
  });
});
