// @vitest-environment jsdom
// Jumlah on the manual outflow form: never a live submit, onSubmit is a mock.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { OutflowForm } from "@/components/OutflowForm";
import type { InflowEntry, OutflowEntry } from "@/types/inventory";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "staff@js.test" } }) }));
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: {
      "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
      PUYUH: { unit: "butir", eggs_per_unit: 1 },
    },
    eggProductNames: ["NEGERI BIASA", "PUYUH"],
    itemTypes: [
      { id: "e1", category: "egg", name: "NEGERI BIASA", isRetakan: false },
      { id: "e2", category: "egg", name: "PUYUH", isRetakan: false },
    ],
    getTypesByCategory: (c: string) => (c === "packaging" ? [{ name: "MIKA 10" }] : []),
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const STOCK = 1_000_000; // never overstock: these tests are about the number
const inflows = [
  { product: "NEGERI BIASA", category: "egg", remainingButir: STOCK },
  { product: "PUYUH", category: "egg", remainingButir: STOCK },
  { product: "MIKA 10", category: "packaging", remainingButir: STOCK },
] as InflowEntry[];

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(() => cleanup());

const renderForm = () => {
  const onSubmit = vi.fn(async (_entries: OutflowEntry[], _email: string) => true);
  render(
    <LanguageProvider>
      <OutflowForm inflows={inflows} onSubmit={onSubmit} />
    </LanguageProvider>
  );
  return onSubmit;
};

const enable = (category: string) => fireEvent.click(screen.getByRole("checkbox", { name: category }));
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-line-id]")];
const qtyInput = (i: number) => within(rows()[i]).getByPlaceholderText("Masukkan jml");
const typeQty = (i: number, value: string) => fireEvent.change(qtyInput(i), { target: { value } });
const pickProduct = (i: number, product: string) => {
  fireEvent.click(within(rows()[i]).getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: product }));
};
const kgSwitch = (i: number) => fireEvent.click(within(rows()[i]).getByRole("switch"));
const addEggRow = () => fireEvent.click(screen.getByRole("button", { name: "Tambah telur" }));
const addRow = () => fireEvent.click(screen.getByRole("button", { name: "Tambah Item" }));
const submitButton = () => screen.getByRole("button", { name: /Hapus dari Inventaris/ });
const INVALID = /Perbaiki jumlah bertanda merah/;
const NEEDS_PRODUCT = /Pilih produknya/;

describe("OutflowForm — Jumlah", () => {
  it.each([
    ["Telur", "PUYUH", false, "1.500", 1500],
    ["Telur", "PUYUH", false, "12.500", 12500],
    ["Telur", "NEGERI BIASA", false, "1.550", 100], // butir on a kg product: 1550 / 15.5
    ["Kemasan", "MIKA 10", false, "1.500", 1500],
    ["Telur", "NEGERI BIASA", true, "1500", 1500],
    ["Telur", "NEGERI BIASA", true, "52,89", 52.89],
    ["Telur", "NEGERI BIASA", true, "52.89", 52.89],
    ["Telur", "NEGERI BIASA", true, "1,5", 1.5],
    // kg reads as the screens print it: a dot before three digits groups thousands.
    ["Telur", "NEGERI BIASA", true, "1.500", 1500],
    ["Telur", "NEGERI BIASA", true, "12.345,67", 12345.67],
    ["Telur", "NEGERI BIASA", true, "1.200,5", 1200.5],
  ])("%s %s (kg switch %s): %j records %d", async (category, product, kg, typed, want) => {
    const onSubmit = renderForm();
    enable(category);
    pickProduct(0, product);
    if (kg) kgSwitch(0);
    typeQty(0, typed);
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");

    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toHaveLength(1);
    expect(onSubmit.mock.calls[0][0][0]).toMatchObject({ product, quantityInButir: want });
  });

  it.each([
    ["PUYUH", false, "2,5"],
    ["PUYUH", false, "1.5"],
    ["PUYUH", false, "1,500"],
    ["PUYUH", false, "12abc"],
    ["PUYUH", false, "-5"],
    ["PUYUH", false, "0"],
    ["NEGERI BIASA", true, "12abc"],
    ["NEGERI BIASA", true, "-5"],
    ["NEGERI BIASA", true, "1,500.5"], // en-US grouping
    ["NEGERI BIASA", true, "12.34.567"],
    ["NEGERI BIASA", true, "1.500,5,5"],
  ])("%s (kg switch %s): %j is flagged and blocks the valid row beside it", async (product, kg, typed) => {
    const onSubmit = renderForm();
    enable("Telur");
    pickProduct(0, product);
    if (kg) kgSwitch(0);
    typeQty(0, typed);
    addEggRow();
    pickProduct(1, "PUYUH");
    typeQty(1, "10");

    expect(qtyInput(0)).toHaveAttribute("aria-invalid", "true");
    expect(qtyInput(1)).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(INVALID);

    // Enter in a field submits the form without touching the button.
    fireEvent.submit(submitButton().closest("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();

    typeQty(0, "5");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toHaveLength(2);
  });

  it("a flagged row isn't counted as ready to remove", () => {
    renderForm();
    enable("Telur");
    pickProduct(0, "PUYUH");
    typeQty(0, "12abc");
    expect(screen.queryByText(/siap dihapus/i)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    typeQty(0, "12");
    expect(screen.getByText(/siap dihapus/i)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("re-judges the number when the kg switch flips", () => {
    renderForm();
    enable("Telur");
    pickProduct(0, "NEGERI BIASA");
    typeQty(0, "2,5");
    expect(qtyInput(0)).toHaveAttribute("aria-invalid", "true"); // 2,5 butir

    kgSwitch(0);
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid"); // 2,5 kg

    kgSwitch(0);
    expect(qtyInput(0)).toHaveAttribute("aria-invalid", "true");
  });

  it("a number typed before the product isn't red, but can't be dropped beside a valid row", async () => {
    const onSubmit = renderForm();
    enable("Telur");
    typeQty(0, "5");
    addEggRow();
    pickProduct(1, "PUYUH");
    typeQty(1, "10");

    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(NEEDS_PRODUCT);

    pickProduct(0, "PUYUH");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].map((e) => e.quantityInButir)).toEqual([5, 10]);
  });

  it("a blank row with a product isn't flagged and doesn't block", async () => {
    const onSubmit = renderForm();
    enable("Kemasan");
    pickProduct(0, "MIKA 10");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
    addRow();
    pickProduct(1, "MIKA 10");
    typeQty(1, "7");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].map((e) => e.quantityInButir)).toEqual([7]);
  });
});
