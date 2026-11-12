// @vitest-environment jsdom
// Jumlah on a loose-egg order line: never a live submit, onSubmit is a mock.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { QuickOutflowBuilder } from "@/components/QuickOutflowBuilder";
import type { StockSummary, OutflowEntry } from "@/types/inventory";
import type { ActivityLogMetadata } from "@/types/activityLog";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "staff@js.test" } }) }));
vi.mock("@/hooks/useBuyers", () => ({
  useBuyers: () => ({ buyers: [{ id: "b1", name: "OSAVE BKS" }], isLoading: false }),
}));
vi.mock("@/hooks/useBuyerDcs", () => ({
  useBuyerDcs: () => ({ dcsForBuyer: () => [], isLoading: false, error: null }),
}));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({
    skus: [{ id: "s1", code: "KP10B", displayName: "Kampung 10 Biasa", eggProduct: "PUYUH", eggsPerPack: 10, packagingItem: "MIKA 10", isActive: true }],
  }),
}));
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: {
      "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
      PUYUH: { unit: "butir", eggs_per_unit: 1 },
    },
    eggProductNames: ["NEGERI BIASA", "PUYUH"],
    boxCapacityMap: {},
    labelsPerPackMap: {},
    getTypesByCategory: () => [],
  }),
}));
vi.mock("@/hooks/useDuplicateOrderCheck", () => ({ useDuplicateOrderCheck: () => ({ check: async () => [] }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/usePurchaseOrders", () => ({ useRecentPurchaseOrders: () => ({ data: [] }) }));
// jsdom can't drive Radix Select; a native one keeps the same value/onValueChange contract.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

const STOCK = 1_000_000; // never short: these tests are about the number
const stock = [
  { product: "NEGERI BIASA", category: "egg", totalStock: STOCK },
  { product: "PUYUH", category: "egg", totalStock: STOCK },
  { product: "MIKA 10", category: "packaging", totalStock: STOCK },
] as StockSummary[];

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(() => cleanup());

const renderBuilder = () => {
  const onSubmit = vi.fn(async (_e: OutflowEntry[], _u: string, _m?: ActivityLogMetadata) => true);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <QuickOutflowBuilder stockSummary={stock} inflows={[]} onSubmit={onSubmit} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  return onSubmit;
};

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-line-id]")];
const addLine = () => fireEvent.click(screen.getByRole("button", { name: /Tambah Baris/ }));
const lineTypeSelect = (i: number) => rows()[i].querySelectorAll("select")[0];
const unitSelect = (i: number) => rows()[i].querySelectorAll("select")[1];
const qtyInput = (i: number) => within(rows()[i]).getByPlaceholderText("Masukkan jml");
const typeQty = (i: number, value: string) => fireEvent.change(qtyInput(i), { target: { value } });
const pickEgg = (i: number, egg: string) => {
  fireEvent.click(within(rows()[i]).getAllByRole("combobox").find((el) => el.tagName === "BUTTON") as HTMLElement);
  fireEvent.click(screen.getByRole("option", { name: egg }));
};
const setUnit = (i: number, unit: "butir" | "kg") => fireEvent.change(unitSelect(i), { target: { value: unit } });
const addLoose = (egg: string | null, qty: string, unit: "butir" | "kg" = "butir") => {
  addLine();
  const i = rows().length - 1;
  fireEvent.change(lineTypeSelect(i), { target: { value: "loose" } });
  if (egg) pickEgg(i, egg);
  setUnit(i, unit);
  typeQty(i, qty);
  return i;
};
const addPack = (qty: string) => {
  addLine();
  const i = rows().length - 1;
  fireEvent.click(within(rows()[i]).getByText("Pilih SKU...").closest("button") as HTMLElement);
  fireEvent.click(screen.getByRole("option", { name: /Kampung 10 Biasa/ }));
  typeQty(i, qty);
};
const pickBuyer = () => {
  fireEvent.click(screen.getByText("Pilih pembeli...").closest("button") as HTMLElement);
  fireEvent.click(screen.getByRole("option", { name: "OSAVE BKS" }));
};
const submitButton = () => screen.getByRole("button", { name: /Simpan Pesanan|Kirim Semua/ });
const queueButton = () => screen.getByRole("button", { name: /Tambah ke Antrian/ });
const INVALID = /Perbaiki jumlah bertanda merah/;
const NEEDS_PRODUCT = /Pilih produknya/;

describe("OrderLineItem — loose Jumlah", () => {
  it.each([
    ["PUYUH", "butir", "1.500", 1500],
    ["PUYUH", "butir", "12.500", 12500],
    ["NEGERI BIASA", "butir", "1.550", 100], // butir on a kg product: 1550 / 15.5
    ["NEGERI BIASA", "kg", "1500", 1500],
    ["NEGERI BIASA", "kg", "52,89", 52.89],
    ["NEGERI BIASA", "kg", "52.89", 52.89],
    ["NEGERI BIASA", "kg", "1,5", 1.5],
    // kg reads as the screens print it: a dot before three digits groups thousands.
    ["NEGERI BIASA", "kg", "1.500", 1500],
    ["NEGERI BIASA", "kg", "12.345,67", 12345.67],
    ["NEGERI BIASA", "kg", "1.200,5", 1200.5],
  ] as const)("%s in %s: %j records %d", async (egg, unit, typed, want) => {
    const onSubmit = renderBuilder();
    pickBuyer();
    const i = addLoose(egg, typed, unit);
    expect(qtyInput(i)).not.toHaveAttribute("aria-invalid");

    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toHaveLength(1);
    expect(onSubmit.mock.calls[0][0][0]).toMatchObject({ product: egg, quantityInButir: want });
  });

  it.each([
    ["PUYUH", "butir", "2,5"],
    ["PUYUH", "butir", "1.5"],
    ["PUYUH", "butir", "12abc"],
    ["PUYUH", "butir", "-5"],
    ["PUYUH", "butir", "0"],
    ["NEGERI BIASA", "kg", "12abc"],
    ["NEGERI BIASA", "kg", "1,500.5"], // en-US grouping
    ["NEGERI BIASA", "kg", "12.34.567"],
    ["NEGERI BIASA", "kg", "1.500,5,5"],
  ] as const)("%s in %s: %j is flagged and blocks the valid line beside it", async (egg, unit, typed) => {
    const onSubmit = renderBuilder();
    pickBuyer();
    addPack("5");
    const i = addLoose(egg, typed, unit);

    expect(qtyInput(i)).toHaveAttribute("aria-invalid", "true");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toBeDisabled();
    expect(queueButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(INVALID);
    expect(qtyInput(i)).toHaveValue(typed); // what was typed stays, so it can be fixed

    typeQty(i, "5");
    expect(qtyInput(i)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(queueButton()).toBeEnabled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("re-judges the number when the unit changes", async () => {
    const onSubmit = renderBuilder();
    pickBuyer();
    const i = addLoose("NEGERI BIASA", "2,5", "butir");
    expect(qtyInput(i)).toHaveAttribute("aria-invalid", "true"); // 2,5 butir
    expect(submitButton()).toBeDisabled();

    setUnit(i, "kg");
    expect(qtyInput(i)).not.toHaveAttribute("aria-invalid"); // 2,5 kg

    setUnit(i, "butir");
    expect(qtyInput(i)).toHaveAttribute("aria-invalid", "true");

    setUnit(i, "kg");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0][0]).toMatchObject({ product: "NEGERI BIASA", quantityInButir: 2.5 });
  });

  it("re-judges the number when the egg changes: Kg means nothing on a butir egg", () => {
    renderBuilder();
    const i = addLoose("NEGERI BIASA", "2,5", "kg");
    expect(qtyInput(i)).not.toHaveAttribute("aria-invalid");

    pickEgg(i, "PUYUH");
    expect(qtyInput(i)).toHaveAttribute("aria-invalid", "true");

    pickEgg(i, "NEGERI BIASA");
    expect(qtyInput(i)).not.toHaveAttribute("aria-invalid");
  });

  it("a number typed before the egg isn't red, but can't be dropped beside a valid line", () => {
    renderBuilder();
    pickBuyer();
    addPack("5");
    const i = addLoose(null, "5");

    expect(qtyInput(i)).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(NEEDS_PRODUCT);

    pickEgg(i, "PUYUH");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("a flagged line holds Submit All too: submitting would clear it unrecorded", () => {
    renderBuilder();
    pickBuyer();
    addPack("5");
    fireEvent.click(queueButton());
    expect(submitButton()).toBeEnabled();

    addLoose("PUYUH", "12abc");
    expect(submitButton()).toBeDisabled();
  });

  it("the typed text never reaches the order metadata", async () => {
    const onSubmit = renderBuilder();
    pickBuyer();
    addLoose("PUYUH", "1.500");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][2].orderLines).toEqual([
      { skuCode: undefined, packQty: undefined, eggProduct: "PUYUH", looseQty: 1500, looseUnit: "butir" },
    ]);
  });

  it("a queued line comes back with what was typed", () => {
    renderBuilder();
    pickBuyer();
    addLoose("NEGERI BIASA", "2,125", "kg");
    fireEvent.click(queueButton());
    expect(rows()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit queued order" }));
    expect(qtyInput(0)).toHaveValue("2,125");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toBeEnabled();
  });

  it("switching the line type clears the typed number", () => {
    renderBuilder();
    const i = addLoose("PUYUH", "12abc");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(lineTypeSelect(i), { target: { value: "pack" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(lineTypeSelect(i), { target: { value: "loose" } });
    expect(qtyInput(i)).toHaveValue("");
  });
});
