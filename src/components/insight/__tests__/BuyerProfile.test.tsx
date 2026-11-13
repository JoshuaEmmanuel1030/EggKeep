// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { BuyerProfile } from "@/components/insight/BuyerProfile";
import { addDays, localToday } from "@/lib/buyerProfile";
import { Coverage, KasSaleRow, OrderRow, kasTunaiCustomers, summarizeBuyer } from "@/lib/insight";
import type { InsightData } from "@/hooks/useInsightData";

// Live data has no named Kas Tunai sale yet, so these states can't be seen in the app.
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({ conversionMap: { "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 }, "KAMPUNG BIASA": { unit: "butir", eggs_per_unit: 1 } } }),
}));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({ skus: [{ code: "N10B", displayName: "Negeri 10 Biasa", unitLabel: "pak" }] }),
}));

beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(cleanup);

const today = localToday();
const ago = (n: number) => addDays(today, -n);
const covered: Coverage = { start: "2020-01-01", staleSince: null };
const thin: Coverage = { start: ago(3), staleSince: null };
const EMPTY = { orders: [], returns: [], deductions: [], counts: [], deliveries: [], deliveryLines: [] } as InsightData;

const sale = (name: string | undefined, daysAgo: number, lines: [string, number][]): KasSaleRow => ({
  saleId: `${name}${daysAgo}`,
  customerName: name,
  tracked: true,
  outflowDate: ago(daysAgo),
  orderLines: lines.map(([skuCode, packQty]) => ({ skuCode, packQty })),
  eggTotals: lines.map(([product, quantity]) => ({ product, quantity })),
});

function show(props: Partial<Parameters<typeof BuyerProfile>[0]> & Pick<Parameters<typeof BuyerProfile>[0], "b">) {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <BuyerProfile
          asOf={today}
          cov={covered}
          days={7}
          periodLabel="7 hari"
          data={EMPTY}
          returnedIds={new Set()}
          returnCov={covered}
          customers={[]}
          customer={null}
          kasTransactions={{ total: 0, named: 0 }}
          onSelect={() => {}}
          {...props}
        />
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe("Kas Tunai customer", () => {
  const sales = [
    sale("Bu Ani", 1, [["KAMPUNG BIASA", 30]]),
    sale("bu ani", 9, [["KAMPUNG BIASA", 20]]),
    sale("Bu  Ani", 2, [["NEGERI BIASA", 2.5]]),
  ];
  const customer = kasTunaiCustomers(sales)[0];

  it("shows the merged spellings exactly as typed, and each egg in its own unit", () => {
    const b = summarizeBuyer("kas:bu ani", "cash", customer.name, customer.sales, today, 7, covered);
    show({ b, customer });
    expect(screen.getByText("Bu  Ani", { normalizer: (s) => s })).toBeInTheDocument(); // double space kept
    expect(screen.getByText("bu ani")).toBeInTheDocument();
    expect(screen.getByText("Biasa dibeli")).toBeInTheDocument();
    expect(screen.getByText("25 butir")).toBeInTheDocument(); // median of 30 and 20
    expect(screen.getByText("2,5 kg")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Rp/);
  });

  it("won't call a customer new or returning while names have only just started", () => {
    const b = summarizeBuyer("kas:bu ani", "cash", customer.name, customer.sales, today, 7, thin);
    show({ b, customer, cov: thin });
    expect(screen.getAllByText("Belum cukup data").length).toBeGreaterThan(0);
    expect(screen.queryByText("Kembali")).not.toBeInTheDocument();
    expect(screen.queryByText("Baru")).not.toBeInTheDocument();
  });
});

describe("Kas Tunai aggregate", () => {
  it("lists top products per product in native units, never a cross-product total", () => {
    const sales = [sale("Bu Ani", 1, [["KAMPUNG BIASA", 30], ["NEGERI BIASA", 2]]), sale(undefined, 2, [["KAMPUNG BIASA", 10]])];
    const b = summarizeBuyer("kas", "cashAll", "Kas Tunai", sales, today, 7, covered);
    show({ b, customers: kasTunaiCustomers(sales), kasTransactions: { total: 2, named: 1 } });
    expect(screen.getByText("40 butir")).toBeInTheDocument();
    expect(screen.getByText("2 kg")).toBeInTheDocument();
    expect(screen.queryByText(/^42/)).not.toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument(); // named buyers
  });

  it("says there are no sales instead of showing zeros as a result", () => {
    show({ b: summarizeBuyer("kas", "cashAll", "Kas Tunai", [], today, 7, { start: null, staleSince: null }) });
    expect(screen.getByText("Belum ada transaksi Kas Tunai.")).toBeInTheDocument();
  });
});

describe("PO buyer", () => {
  const order = (daysAgo: number, invoiceRef: string, outflowIds: string[] = []): OrderRow => ({
    outflowDate: ago(daysAgo),
    orderLines: [{ skuCode: "N10B", packQty: 10 }],
    eggTotals: [],
    invoiceRef,
    outflowIds,
  });

  it("hides delivered and rejected until the delivery log covers most fakturs", () => {
    const orders = [order(1, "A"), order(2, "B"), order(3, "C")];
    const data = { ...EMPTY, deliveries: [{ id: "d", invoiceRefNorm: "A", status: "terkirim" }] } as InsightData;
    show({ b: summarizeBuyer("po:X", "po", "X", orders, today, 7, covered), data });
    expect(screen.getByText("1 dari 3 faktur dicatat di Log Pengiriman.")).toBeInTheDocument();
    expect(screen.queryByText("Lihat di Pengiriman")).not.toBeInTheDocument();
  });

  it("shows no lead time when POs are entered after delivery", () => {
    const orders = [{ ...order(2, "A"), recordedAt: new Date().toISOString() }, { ...order(3, "B"), recordedAt: new Date().toISOString() }];
    show({ b: summarizeBuyer("po:X", "po", "X", orders, today, 7, covered) });
    expect(screen.getByText("PO dicatat saat/sesudah kirim")).toBeInTheDocument();
  });

  it("opens Pengiriman from a return spike", () => {
    const orders = [order(1, "A", ["a"]), order(2, "B", ["b"]), order(30, "C", ["c"])];
    const returnedIds = new Set(["a", "b", "c"]);
    const b = summarizeBuyer("po:X", "po", "X", orders, today, 7, covered, { outflowIds: returnedIds, cov: covered });
    show({ b, returnedIds });
    expect(b.returnsUp).toBe(true);
    expect(screen.getByRole("button", { name: /Lihat di Pengiriman/ })).toBeInTheDocument();
  });

  it("says when a buyer is late", () => {
    // Every Monday for 8 weeks, then nothing: run the page from the day after a missed Monday.
    const monday = (() => {
      let d = today;
      while (new Date(`${d}T00:00`).getDay() !== 1) d = addDays(d, -1);
      return d;
    })();
    const asOf = addDays(monday, 1);
    const orders = [7, 14, 21, 28].map((n) => ({ ...order(0, "M"), outflowDate: addDays(monday, -n) }));
    show({ b: summarizeBuyer("po:X", "po", "X", orders, asOf, 7, covered), asOf });
    expect(screen.getByText("Telat 1 hari.")).toBeInTheDocument();
    expect(screen.getByText("Terlambat")).toBeInTheDocument();
  });
});
