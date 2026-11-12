// @vitest-environment jsdom
// The numbers typed on Stok Fisik: never a live save, saveCounts/deleteCounts are mocks.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { format } from "date-fns";
import { LanguageProvider } from "@/contexts/LanguageContext";
import StockCount from "@/pages/StockCount";
import type { StockCountRecord } from "@/types/stockCount";

// Stable identities: the page seeds its draft from an effect on these.
const h = vi.hoisted(() => ({
  records: [] as StockCountRecord[],
  saveCounts: vi.fn(async () => true),
  deleteCounts: vi.fn(async () => true),
  items: {
    itemTypes: [
      { id: "kg", category: "egg", name: "NEGERI BIASA" },
      { id: "btr", category: "egg", name: "PUYUH" },
    ],
    conversionMap: {
      "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
      PUYUH: { unit: "butir", eggs_per_unit: 1 },
    },
  },
  sync: {
    inflows: [
      { id: "i1", date: "2026-11-01", product: "NEGERI BIASA", category: "egg", quantityInButir: 1500, remainingButir: 1500 },
      { id: "i2", date: "2026-11-01", product: "PUYUH", category: "egg", quantityInButir: 1500, remainingButir: 1500 },
    ],
  },
}));

vi.mock("@/hooks/useStockCounts", () => ({
  useStockCounts: () => ({ records: h.records, saveCounts: h.saveCounts, deleteCounts: h.deleteCounts }),
}));
vi.mock("@/hooks/useItemTypes", () => ({ useItemTypes: () => h.items }));
vi.mock("@/hooks/useInventorySync", () => ({ useInventorySync: () => h.sync }));
vi.mock("@/hooks/useOfflineSync", () => ({ useOfflineSync: () => ({ pendingCount: 0, isOnline: true }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "staff@js.test" } }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsTabletLandscape: () => false }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: async () => ({ data: [] }),
  };
  return { supabase: { from: () => chain } };
});

const TODAY = format(new Date(), "yyyy-MM-dd");
const saved = (itemTypeId: string, quantity: number, location: StockCountRecord["location"] = "js_warehouse"): StockCountRecord => ({
  id: `${itemTypeId}-${location}`,
  countDate: TODAY,
  location,
  itemTypeId,
  product: itemTypeId === "kg" ? "NEGERI BIASA" : "PUYUH",
  category: "egg",
  quantity,
  systemQty: 1500,
  countedBy: null,
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  localStorage.setItem("js-online-language", "id");
  h.records = [];
  h.saveCounts.mockClear();
  h.deleteCounts.mockClear();
});
afterEach(() => cleanup());

const renderPage = () =>
  render(
    <LanguageProvider>
      <StockCount />
    </LanguageProvider>
  );

const LOC = { js: 0, tst: 1, loaded: 2 } as const;
const cells = () => [...document.querySelectorAll<HTMLInputElement>('input[placeholder="—"]')];
const cell = (row: number, loc: keyof typeof LOC = "js") => cells()[row * 3 + LOC[loc]];
const typeCount = (row: number, value: string, loc: keyof typeof LOC = "js") =>
  fireEvent.change(cell(row, loc), { target: { value } });
const rowOf = (row: number) => cell(row).closest(".grid") as HTMLElement;
const addLine = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: /Tambah baris barang/ }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
};
const saveButton = () => screen.getByRole("button", { name: "Simpan hitungan" });
const INVALID = /Perbaiki jumlah bertanda merah/;
const savedEntries = () => (h.saveCounts.mock.calls[0] as unknown[])[0];

describe("StockCount — typed counts", () => {
  it("a butir count reads the thousands dot, so 1.500 matches a system 1.500", async () => {
    renderPage();
    addLine("PUYUH");
    typeCount(0, "1.500");

    expect(cell(0)).not.toHaveAttribute("aria-invalid");
    expect(within(rowOf(0)).getByText("0.0%")).toBeInTheDocument(); // not -99.9%

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saveCounts).toHaveBeenCalledTimes(1));
    expect(savedEntries()).toEqual([
      { itemTypeId: "btr", product: "PUYUH", category: "egg", location: "js_warehouse", quantity: 1500, systemQty: 1500 },
    ]);
  });

  it.each([
    ["1500", 1500],
    ["52,89", 52.89],
    ["52.89", 52.89],
    // kg reads as the screens print it: a dot before three digits groups thousands.
    ["1.500", 1500],
    ["12.345,67", 12345.67],
    ["1.200,5", 1200.5],
  ])("a kg count takes %j", async (typed, want) => {
    renderPage();
    addLine("NEGERI BIASA");
    typeCount(0, typed);
    expect(cell(0)).not.toHaveAttribute("aria-invalid");

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saveCounts).toHaveBeenCalledTimes(1));
    expect(savedEntries()).toEqual([expect.objectContaining({ product: "NEGERI BIASA", quantity: want })]);
  });

  it.each([
    ["PUYUH", "2,5"],
    ["PUYUH", "1.5"],
    ["PUYUH", "12abc"],
    ["PUYUH", "-5"],
    ["NEGERI BIASA", "12abc"],
    ["NEGERI BIASA", "-5"],
    ["NEGERI BIASA", "1,500.5"], // en-US grouping
    ["NEGERI BIASA", "12.34.567"],
    ["NEGERI BIASA", "1.500,5,5"],
  ])("%s %j is flagged, shows no deviation and blocks the save", (product, typed) => {
    renderPage();
    addLine(product);
    typeCount(0, typed);

    expect(cell(0)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(INVALID);
    expect(saveButton()).toBeDisabled();
    expect(within(rowOf(0)).getByText("·")).toBeInTheDocument();
    expect(cell(0)).toHaveValue(typed); // what was typed stays, so it can be fixed
  });

  it("flags the TST and Muat cells too, leaving the good cell beside them alone", () => {
    renderPage();
    addLine("PUYUH");
    typeCount(0, "1.500", "js");
    typeCount(0, "2,5", "loaded");

    expect(cell(0, "js")).not.toHaveAttribute("aria-invalid");
    expect(cell(0, "tst")).not.toHaveAttribute("aria-invalid");
    expect(cell(0, "loaded")).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();

    typeCount(0, "2,5", "tst");
    typeCount(0, "", "loaded");
    expect(cell(0, "tst")).toHaveAttribute("aria-invalid", "true");
    expect(cell(0, "loaded")).not.toHaveAttribute("aria-invalid");
    expect(saveButton()).toBeDisabled();
  });

  it("a bad number over a saved count holds the save, so it can't delete that count", async () => {
    h.records = [saved("btr", 1500)];
    renderPage();
    expect(cell(0)).toHaveValue("1500");

    typeCount(0, "abc");
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(h.saveCounts).not.toHaveBeenCalled();
    expect(h.deleteCounts).not.toHaveBeenCalled();

    typeCount(0, "1.480");
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saveCounts).toHaveBeenCalledTimes(1));
    expect(savedEntries()).toEqual([expect.objectContaining({ quantity: 1480 })]);
    expect(h.deleteCounts).not.toHaveBeenCalled();
  });

  it("blank still means not counted: not flagged, and it clears a saved count", async () => {
    h.records = [saved("btr", 1500), saved("btr", 20, "loaded")];
    renderPage();
    typeCount(0, "   ", "loaded");

    expect(cell(0, "loaded")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.deleteCounts).toHaveBeenCalledTimes(1));
    expect(h.deleteCounts).toHaveBeenCalledWith([{ itemTypeId: "btr", location: "loaded" }]);
    expect(savedEntries()).toEqual([expect.objectContaining({ location: "js_warehouse", quantity: 1500 })]);
  });

  it.each(["PUYUH", "NEGERI BIASA"])("%s: 0 is a real count, not blank and not bad", async (product) => {
    renderPage();
    addLine(product);
    typeCount(0, "0");

    expect(cell(0)).not.toHaveAttribute("aria-invalid");
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saveCounts).toHaveBeenCalledTimes(1));
    expect(savedEntries()).toEqual([expect.objectContaining({ product, quantity: 0 })]);
  });

  it("a saved 2.125 kg reopens clean and saves back unchanged", async () => {
    h.records = [saved("kg", 2.125)];
    renderPage();
    expect(cell(0)).toHaveValue("2,125");
    expect(cell(0)).not.toHaveAttribute("aria-invalid");

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saveCounts).toHaveBeenCalledTimes(1));
    expect(savedEntries()).toEqual([expect.objectContaining({ quantity: 2.125 })]);
    expect(h.deleteCounts).not.toHaveBeenCalled();
  });

  it("today's butir count an old bundle saved as 1,5 reopens flagged, to be fixed", () => {
    h.records = [saved("btr", 1.5)];
    renderPage();
    expect(cell(0)).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();

    typeCount(0, "1.500");
    expect(cell(0)).not.toHaveAttribute("aria-invalid");
    expect(saveButton()).toBeEnabled();
  });

  it("a past date is read-only: nothing to fix, so nothing is flagged", () => {
    h.records = [{ ...saved("btr", 1.5), countDate: "2026-10-01" }];
    renderPage();
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2026-10-01" } });

    expect(cell(0)).toBeDisabled();
    expect(cell(0)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simpan hitungan" })).not.toBeInTheDocument();
  });
});
