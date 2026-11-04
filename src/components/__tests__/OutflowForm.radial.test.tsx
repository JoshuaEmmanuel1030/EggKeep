// @vitest-environment jsdom
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
    eggProductNames: ["NEGERI BIASA", "PUYUH", "PUYUH (RETAKAN)"],
    itemTypes: [
      { id: "e1", category: "egg", name: "NEGERI BIASA", isRetakan: false },
      { id: "e2", category: "egg", name: "PUYUH", isRetakan: false },
      { id: "e3", category: "egg", name: "PUYUH (RETAKAN)", isRetakan: true },
    ],
    getTypesByCategory: () => [],
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const inflows = [
  { product: "NEGERI BIASA", category: "egg", remainingButir: 100 },
  { product: "PUYUH", category: "egg", remainingButir: 100 },
] as InflowEntry[];

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(() => cleanup());

const renderForm = (onSubmit: (entries: OutflowEntry[], email: string) => Promise<boolean> = async () => true) =>
  render(
    <LanguageProvider>
      <OutflowForm inflows={inflows} onSubmit={onSubmit} />
    </LanguageProvider>
  );

const enable = (category: string) => fireEvent.click(screen.getByRole("checkbox", { name: category }));
const trigger = () => screen.getByRole("button", { name: "Tambah telur" });
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-line-id]")];
const qtyOf = (row: HTMLElement) => within(row).getByPlaceholderText("Masukkan jml");
const productOf = (row: HTMLElement) => within(row).getByRole("combobox");
const submit = () => fireEvent.click(screen.getByRole("button", { name: /Hapus dari Inventaris/ }));

const ptr = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
// Two items on the ring: NEGERI BIASA at the top, PUYUH at the bottom.
const pick = (product: "NEGERI BIASA" | "PUYUH") => {
  const y = product === "PUYUH" ? 570 : 430;
  fireEvent.pointerDown(trigger(), ptr(200, 500));
  fireEvent.pointerMove(window, ptr(200, y));
  fireEvent.pointerUp(window, ptr(200, y));
  fireEvent.click(trigger()); // the trailing click adds nothing
};

describe("OutflowForm — radial egg pick", () => {
  it("offers the eggs without their (RETAKAN) children", () => {
    renderForm();
    enable("Telur");
    fireEvent.pointerDown(trigger(), ptr(200, 500));
    fireEvent.pointerMove(window, ptr(200, 430));
    expect([...document.querySelectorAll(".ek-rad-it")].map((el) => el.textContent)).toEqual(["NEGERIBIASA", "PUYUH"]);
    expect(document.querySelector(".ek-rad-hd")).toHaveTextContent("Pilih telur");
    fireEvent.pointerCancel(window, ptr(200, 430));
  });

  it("fills the first empty egg row, focusing its Quantity and flashing it", () => {
    renderForm();
    enable("Telur");
    expect(rows()).toHaveLength(1); // enabling starts with one empty row
    pick("PUYUH");
    expect(rows()).toHaveLength(1);
    expect(productOf(rows()[0])).toHaveTextContent("PUYUH");
    expect(qtyOf(rows()[0])).toHaveFocus(); // not the invoice input after it
    expect(rows()[0]).toHaveClass("ek-rad-new");
  });

  it("skips filled rows to the first empty one, and leaves later empty rows alone", () => {
    renderForm();
    enable("Telur");
    pick("PUYUH");
    fireEvent.click(trigger()); // a plain tap still adds an empty row
    fireEvent.click(trigger());
    expect(rows()).toHaveLength(3);
    pick("NEGERI BIASA");
    expect(rows()).toHaveLength(3);
    expect(productOf(rows()[1])).toHaveTextContent("NEGERI BIASA");
    expect(productOf(rows()[2])).toHaveTextContent("Pilih...");
    expect(qtyOf(rows()[1])).toHaveFocus();
  });

  it("appends a row when none is empty", () => {
    renderForm();
    enable("Telur");
    pick("PUYUH");
    pick("NEGERI BIASA");
    expect(rows()).toHaveLength(2);
    expect(productOf(rows()[0])).toHaveTextContent("PUYUH");
    expect(productOf(rows()[1])).toHaveTextContent("NEGERI BIASA");
    expect(qtyOf(rows()[1])).toHaveFocus();
  });

  it("works from no rows at all", () => {
    renderForm();
    enable("Telur");
    fireEvent.click(within(rows()[0]).getAllByRole("button")[0]); // its bin
    expect(rows()).toHaveLength(0);
    pick("PUYUH");
    expect(rows()).toHaveLength(1);
    expect(productOf(rows()[0])).toHaveTextContent("PUYUH");
  });

  it("a kg product keeps the row's unit and offers the switch; a butir product is butir with none", () => {
    renderForm();
    enable("Telur");
    pick("NEGERI BIASA");
    expect(screen.getByText("Jumlah (butir)")).toBeInTheDocument();
    fireEvent.click(within(rows()[0]).getByRole("switch"));
    expect(screen.getByText("Jumlah (kg)")).toBeInTheDocument();

    pick("PUYUH");
    expect(within(rows()[1]).queryByRole("switch")).toBeNull();
    expect(within(rows()[1]).getByText("Jumlah (butir)")).toBeInTheDocument();
    expect(within(rows()[0]).getByText("Jumlah (kg)")).toBeInTheDocument(); // the first row is untouched
  });

  it("box, label and packaging keep their Tambah Item button and hint; eggs have neither", () => {
    renderForm();
    enable("Telur");
    expect(screen.queryByRole("button", { name: "Tambah Item" })).toBeNull();
    enable("Kotak");
    enable("Label");
    enable("Kemasan");
    expect(screen.getAllByRole("button", { name: "Tambah Item" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Tambah telur" })).toHaveLength(1);

    // Empty the egg and box sections (each one row; eggs come first): only box hints.
    fireEvent.click(within(rows()[0]).getAllByRole("button")[0]);
    expect(screen.queryByText(/Klik "Tambah Item"/)).toBeNull();
    fireEvent.click(within(rows()[0]).getAllByRole("button")[0]);
    expect(screen.getAllByText(/Klik "Tambah Item"/)).toHaveLength(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Tambah Item" })[0]);
    expect(rows()).toHaveLength(3); // the box row is back, beside label and packaging
    expect(screen.queryByText(/Klik "Tambah Item"/)).toBeNull();
  });

  it.each([
    ["NEGERI BIASA", 2], // butir on a kg product: 31 / 15.5 = 2 kg
    ["PUYUH", 31],
  ] as const)("a submit after picking %s sends the entry the combobox path sends", async (product, quantityInButir) => {
    const onSubmit = vi.fn(async (_entries: OutflowEntry[], _email: string) => true);
    renderForm(onSubmit);

    enable("Telur");
    fireEvent.click(productOf(rows()[0]));
    fireEvent.click(screen.getByRole("option", { name: product }));
    fireEvent.change(qtyOf(rows()[0]), { target: { value: "31" } });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rows()).toHaveLength(0)); // the form reset

    enable("Telur");
    pick(product);
    fireEvent.change(qtyOf(rows()[0]), { target: { value: "31" } });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    const sent = (call: number) => onSubmit.mock.calls[call][0].map(({ id, createdAt, ...rest }) => rest);
    expect(sent(1)).toEqual(sent(0));
    expect(sent(1)).toHaveLength(1);
    expect(sent(1)[0]).toMatchObject({ product, quantityInButir, category: "egg" });
    expect(onSubmit.mock.calls[1][1]).toBe("staff@js.test");
  });
});
