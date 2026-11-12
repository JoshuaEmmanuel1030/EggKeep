// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { format, parseISO, subDays } from "date-fns";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { InflowForm } from "@/components/InflowForm";
import { kasDateLabel } from "@/lib/kasTunai";
import { toast } from "@/hooks/use-toast";
import type { InflowEntry, StockSummary } from "@/types/inventory";

// Everything that reaches Supabase is behind these hooks, so no test here can write.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "staff@js.test" } }) }));
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: {
      "NEGERI OMEGA": { unit: "kg", eggs_per_unit: 15.5 },
      "KAMPUNG BIASA": { unit: "butir", eggs_per_unit: 1 },
    },
    eggProductNames: ["KAMPUNG BIASA", "NEGERI OMEGA", "PUYUH BARU"], // PUYUH BARU: no conversion
    getTypesByCategory: (category: string) =>
      ({ box: [{ name: "BOX OSAVE" }], label: [{ name: "LABEL OSAVE" }], packaging: [{ name: "MIKA 10" }] })[category] ?? [],
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  localStorage.setItem("js-online-language", "id");
  vi.mocked(toast).mockClear();
});
afterEach(() => cleanup());

const toggle = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
const pickProduct = (row: number, product: string) => {
  fireEvent.click(screen.getAllByRole("combobox")[row]);
  fireEvent.click(screen.getByRole("option", { name: new RegExp(product) }));
};
const typeQty = (row: number, value: string) =>
  fireEvent.change(screen.getAllByPlaceholderText("Masukkan jml")[row], { target: { value } });
const typeSupplier = (row: number, value: string) =>
  fireEvent.change(screen.getAllByPlaceholderText("Opsional")[row], { target: { value } });
const submitButton = () => screen.getByRole("button", { name: /Tambah ke Inventaris/ });

const submitted = async (onSubmit: ReturnType<typeof vi.fn>) => {
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0] as unknown as [InflowEntry[], string];
};

const STOCK = [
  { product: "NEGERI OMEGA", totalStock: 186 },
  { product: "KAMPUNG BIASA", totalStock: 2000 },
] as StockSummary[];

const form = (onSubmit: ReturnType<typeof vi.fn>, tablet: boolean) => (
  <LanguageProvider>
    <InflowForm onSubmit={onSubmit as never} tablet={tablet} stockSummary={STOCK} />
  </LanguageProvider>
);
const todayIso = () => format(new Date(), "yyyy-MM-dd");

// Both layouts run the same handleSubmit, so both must send the same payload.
describe.each([
  ["phone", false],
  ["tablet", true],
])("InflowForm submit payload (%s)", (_layout, tablet) => {
  const renderForm = (onSubmit: ReturnType<typeof vi.fn>) => render(form(onSubmit, tablet));

  it("sends one entry per valid row in category order, each in the product's native unit", async () => {
    const onSubmit = vi.fn(async () => true);
    renderForm(onSubmit);

    // Kemasan is ticked first: the payload still follows CATEGORIES, not click order.
    toggle("Kemasan");
    pickProduct(0, "MIKA 10");
    typeQty(0, "500");

    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA"); // the egg row renders above the Kemasan row
    typeQty(0, "52,89");
    typeSupplier(0, "Farm A");

    fireEvent.click(screen.getAllByRole("button", { name: /Tambah Item/ })[0]);
    pickProduct(1, "KAMPUNG BIASA");
    typeQty(1, "1500");

    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: "2026-10-20" } });

    const [entries, email] = await submitted(onSubmit);
    expect(email).toBe("staff@js.test");
    const base = { id: expect.any(String), createdAt: expect.any(String), date: "2026-10-20" };
    expect(entries).toEqual([
      // kg-native: the typed number IS the stock quantity, never converted.
      { ...base, category: "egg", product: "NEGERI OMEGA", unit: "kg", quantity: 52.89, quantityInButir: 52.89, remainingButir: 52.89, invoiceSupplier: "Farm A" },
      // A butir egg's `unit` is "pcs" (getProductUnit), even though the stock unit reads butir.
      { ...base, category: "egg", product: "KAMPUNG BIASA", unit: "pcs", quantity: 1500, quantityInButir: 1500, remainingButir: 1500, invoiceSupplier: undefined },
      { ...base, category: "packaging", product: "MIKA 10", unit: "pcs", quantity: 500, quantityInButir: 500, remainingButir: 500, invoiceSupplier: undefined },
    ]);
  });

  it("drops rows that aren't valid and categories switched off", async () => {
    const onSubmit = vi.fn(async () => true);
    renderForm(onSubmit);

    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "10");
    fireEvent.click(screen.getAllByRole("button", { name: /Tambah Item/ })[0]);
    pickProduct(1, "KAMPUNG BIASA");
    typeQty(1, "0"); // zero
    fireEvent.click(screen.getAllByRole("button", { name: /Tambah Item/ })[0]);
    typeQty(2, "7"); // no product

    toggle("Kotak");
    pickProduct(3, "BOX OSAVE");
    typeQty(3, "3");
    toggle("Kotak"); // switched back off: its rows go with it

    const [entries] = await submitted(onSubmit);
    expect(entries.map((e) => e.product)).toEqual(["NEGERI OMEGA"]);
  });

  it("on success clears the form and toasts the count", async () => {
    const onSubmit = vi.fn(async () => true);
    renderForm(onSubmit);
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "10");

    await submitted(onSubmit);

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Telur/ })).not.toBeChecked());
    expect(screen.queryByPlaceholderText("Masukkan jml")).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith({ title: "Stok Ditambahkan", description: "1 item ditambahkan ke inventaris" });
  });

  it("on failure keeps what was typed and toasts the error", async () => {
    const onSubmit = vi.fn(async () => false);
    renderForm(onSubmit);
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "10");

    await submitted(onSubmit);

    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.getByPlaceholderText("Masukkan jml")).toHaveValue("10");
    expect(toast).toHaveBeenCalledWith({
      title: "Gagal menyimpan",
      description: "Barang masuk tidak tersimpan. Silakan coba lagi.",
      variant: "destructive",
    });
  });

  it("puts the date back on today after a successful submit, not after a failed one", async () => {
    const past = format(subDays(new Date(), 3), "yyyy-MM-dd");
    const fill = () => {
      toggle("Telur");
      pickProduct(0, "NEGERI OMEGA");
      typeQty(0, "10");
      fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: past } });
    };

    const rejected = vi.fn(async () => false);
    const { unmount } = renderForm(rejected);
    fill();
    await submitted(rejected);
    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.getByLabelText("Tanggal")).toHaveValue(past);
    unmount();

    const accepted = vi.fn(async () => true);
    renderForm(accepted);
    fill();
    const [entries] = await submitted(accepted);
    expect(entries[0].date).toBe(past);
    await waitFor(() => expect(screen.getByLabelText("Tanggal")).toHaveValue(todayIso()));
  });
});

// The screens print id-ID ("1.500 butir"), so Jumlah has to read it back that way.
describe.each([
  ["phone", false],
  ["tablet", true],
])("InflowForm Jumlah (%s)", (_layout, tablet) => {
  const renderForm = () => {
    const onSubmit = vi.fn(async () => true);
    render(form(onSubmit, tablet));
    return onSubmit;
  };
  const qtyInput = (row: number) => screen.getAllByPlaceholderText("Masukkan jml")[row];
  const addRow = () => fireEvent.click(screen.getAllByRole("button", { name: /Tambah Item/ })[0]);

  it.each([
    // butir and pcs: whole numbers, the dot groups thousands.
    ["Telur", "KAMPUNG BIASA", "1.500", 1500],
    ["Telur", "KAMPUNG BIASA", "12.500", 12500],
    ["Telur", "KAMPUNG BIASA", "1.500.000", 1500000],
    ["Telur", "KAMPUNG BIASA", " 1500 ", 1500],
    ["Telur", "PUYUH BARU", "1.500", 1500], // no conversion: butir
    ["Kemasan", "MIKA 10", "1.500", 1500],
    // kg: id-ID as the screens print it, so a dot before three digits groups thousands.
    ["Telur", "NEGERI OMEGA", "1.500", 1500],
    ["Telur", "NEGERI OMEGA", " 1.500 ", 1500],
    ["Telur", "NEGERI OMEGA", "23.842", 23842],
    ["Telur", "NEGERI OMEGA", "1.500.000", 1500000],
    ["Telur", "NEGERI OMEGA", "23.818,16", 23818.16],
    ["Telur", "NEGERI OMEGA", "1.200,5", 1200.5],
    // ...otherwise one decimal separator, either one.
    ["Telur", "NEGERI OMEGA", "1500", 1500],
    ["Telur", "NEGERI OMEGA", "52,89", 52.89],
    ["Telur", "NEGERI OMEGA", "52.89", 52.89],
    ["Telur", "NEGERI OMEGA", "1,5", 1.5],
    ["Telur", "NEGERI OMEGA", "1,500", 1.5], // a comma is always the decimal
    ["Telur", "NEGERI OMEGA", "0.500", 0.5], // a leading zero can't be thousands
  ])("%s %s: %j records %d", async (category, product, typed, want) => {
    const onSubmit = renderForm();
    toggle(category);
    pickProduct(0, product);
    typeQty(0, typed);
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");

    const [entries] = await submitted(onSubmit);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ product, quantity: want, quantityInButir: want, remainingButir: want });
  });

  it.each([
    ["Telur", "KAMPUNG BIASA", "2,5"],
    ["Telur", "KAMPUNG BIASA", "1.5"],
    ["Telur", "KAMPUNG BIASA", "12abc"],
    ["Telur", "KAMPUNG BIASA", "1.500,5"],
    ["Telur", "KAMPUNG BIASA", "1,500"],
    ["Telur", "KAMPUNG BIASA", "1 500"],
    ["Telur", "KAMPUNG BIASA", "-5"],
    ["Kemasan", "MIKA 10", "2,5"],
    ["Telur", "NEGERI OMEGA", "12abc"],
    ["Telur", "NEGERI OMEGA", "-5"],
    ["Telur", "NEGERI OMEGA", "1,500.5"], // en-US grouping
    ["Telur", "NEGERI OMEGA", "12.34.567"],
    ["Telur", "NEGERI OMEGA", "1.500,5,5"],
  ])("%s %s: %j is flagged and blocks the valid row beside it", async (category, product, typed) => {
    const onSubmit = renderForm();
    toggle(category);
    pickProduct(0, product);
    typeQty(0, typed);
    addRow();
    pickProduct(1, product);
    typeQty(1, "10");

    expect(qtyInput(0)).toHaveAttribute("aria-invalid", "true");
    expect(qtyInput(1)).not.toHaveAttribute("aria-invalid");
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/Perbaiki jumlah bertanda merah/)).toBeInTheDocument();
    expect(screen.queryByText("siap ditambahkan")).not.toBeInTheDocument();

    fireEvent.submit(submitButton().closest("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();

    typeQty(0, "5");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Perbaiki jumlah bertanda merah/)).not.toBeInTheDocument();
    expect(screen.getByText("siap ditambahkan")).toBeInTheDocument();
    const [entries] = await submitted(onSubmit);
    expect(entries.map((e) => e.quantity)).toEqual([5, 10]);
  });

  it("a flagged number alone doesn't count as an item", () => {
    renderForm();
    toggle("Telur");
    pickProduct(0, "KAMPUNG BIASA");
    typeQty(0, "12abc");
    expect(screen.queryByText("siap ditambahkan")).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("judges the number by the picked product's unit, and not before one is picked", () => {
    renderForm();
    toggle("Telur");
    typeQty(0, "2,5"); // typing the number first is normal
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");

    pickProduct(0, "NEGERI OMEGA");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");

    pickProduct(0, "KAMPUNG BIASA");
    expect(qtyInput(0)).toHaveAttribute("aria-invalid", "true");

    pickProduct(0, "NEGERI OMEGA");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
  });

  it("blank isn't flagged", () => {
    renderForm();
    toggle("Telur");
    pickProduct(0, "KAMPUNG BIASA");
    typeQty(0, "   ");
    expect(qtyInput(0)).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Perbaiki jumlah bertanda merah/)).not.toBeInTheDocument();
  });

  it("switching the category off takes its flagged row with it", async () => {
    const onSubmit = renderForm();
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "10");
    toggle("Kotak");
    pickProduct(1, "BOX OSAVE");
    typeQty(1, "2,5");
    expect(submitButton()).toBeDisabled();

    toggle("Kotak");
    const [entries] = await submitted(onSubmit);
    expect(entries.map((e) => e.product)).toEqual(["NEGERI OMEGA"]);
  });

  it("shows no conversion line for a number it won't record", () => {
    renderForm();
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "12");
    expect(screen.getByText(/ = /)).toBeInTheDocument();
    typeQty(0, "12abc");
    expect(screen.queryByText(/ = /)).not.toBeInTheDocument();
  });
});

describe("InflowForm tablet layout", () => {
  const renderTablet = (onSubmit = vi.fn(async () => true)) => render(form(onSubmit, true));
  const card = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) });

  it("counts only rows that will be recorded, on the card, the ready line and the button", () => {
    renderTablet();
    expect(card("Telur")).toHaveTextContent("Off");
    expect(screen.getByText("Tambahkan minimal satu item dengan nilai valid")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    toggle("Telur");
    expect(card("Telur")).toBeChecked();
    expect(card("Telur")).toHaveTextContent("0 item");

    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "0"); // typed, but handleSubmit would drop it
    expect(card("Telur")).toHaveTextContent("0 item");
    expect(submitButton()).toBeDisabled();

    typeQty(0, "300");
    expect(card("Telur")).toHaveTextContent("1 item");
    expect(card("Kotak")).toHaveTextContent("Off");
    expect(screen.getByText("siap ditambahkan")).toHaveTextContent("1 item");
    expect(submitButton()).toBeEnabled();

    toggle("Telur");
    expect(submitButton()).toBeDisabled();
  });

  it("Ringkasan adds the quantity to the stock in the product's own unit", () => {
    renderTablet();
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "52,89");
    typeSupplier(0, "Farm A");
    fireEvent.click(screen.getAllByRole("button", { name: /Tambah Item/ })[0]);
    pickProduct(1, "KAMPUNG BIASA");
    typeQty(1, "1500");
    toggle("Kemasan");
    pickProduct(2, "MIKA 10");
    typeQty(2, "500");

    const panel = screen.getByText("Ringkasan").closest("aside") as HTMLElement;
    // kg: 186 + 52,89, with no butir factor anywhere near it.
    expect(within(panel).getByText("+52,89 kg")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Farm A · Stok 186 → 238,89 kg");
    // butir: 2.000 + 1.500.
    expect(within(panel).getByText("+1.500 butir")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Stok 2.000 → 3.500 butir");
    // Nothing in the stock summary yet: starts from 0, in pcs.
    expect(within(panel).getByText("+500 pcs")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Stok 0 → 500 pcs");
  });

  it("Ringkasan reads a thousands dot as thousands and leaves a flagged row out", () => {
    renderTablet();
    toggle("Telur");
    pickProduct(0, "KAMPUNG BIASA");
    typeQty(0, "1.500");
    const panel = screen.getByText("Ringkasan").closest("aside") as HTMLElement;
    expect(within(panel).getByText("+1.500 butir")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Stok 2.000 → 3.500 butir");
    expect(card("Telur")).toHaveTextContent("1 item");

    typeQty(0, "2,5");
    expect(panel).not.toHaveTextContent("butir");
    expect(card("Telur")).toHaveTextContent("0 item");

    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "1.500");
    expect(within(panel).getByText("+1.500 kg")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Stok 186 → 1.686 kg");
  });

  it("shows the empty states: nothing enabled, and a category with no rows", () => {
    renderTablet();
    // The field label, the dashed block, and the Ringkasan.
    expect(screen.getAllByText("Pilih Kategori")).toHaveLength(3);

    toggle("Telur");
    expect(screen.getAllByText("Pilih Kategori")).toHaveLength(1);
    expect(screen.getAllByText('Klik "Tambah Item" untuk menambah entri')).toHaveLength(1); // Ringkasan

    fireEvent.click(screen.getByRole("button", { name: "Hapus baris" }));
    expect(screen.getAllByText('Klik "Tambah Item" untuk menambah entri')).toHaveLength(2); // + the table
  });

  it("puts the unit inside Jumlah: kg, butir, pcs", () => {
    renderTablet();
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    expect(screen.getByLabelText("Jumlah (kg)")).toBeInTheDocument();
    pickProduct(0, "KAMPUNG BIASA");
    expect(screen.getByLabelText("Jumlah (butir)")).toBeInTheDocument();
    toggle("Label");
    expect(screen.getByLabelText("Jumlah (pcs)")).toBeInTheDocument();
  });

  it("shows the conversion line for kg eggs only; a butir egg has none", () => {
    renderTablet();
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    expect(screen.queryByText(/butir\/kg/)).not.toBeInTheDocument(); // no qty yet
    typeQty(0, "300");
    expect(screen.getByText(/butir\/kg/).parentElement).toHaveTextContent("300 kg = 4.650 butir (× 15,5 butir/kg)");

    pickProduct(0, "KAMPUNG BIASA");
    expect(screen.getByLabelText("Jumlah (butir)")).toHaveValue("300");
    expect(screen.queryByText(/ = /)).not.toBeInTheDocument();
  });

  it("warns in Indonesian about an egg with no conversion, and shows no conversion line", () => {
    renderTablet();
    toggle("Telur");
    pickProduct(0, "PUYUH BARU");
    typeQty(0, "50");
    expect(screen.getByText(/Belum ada konversi satuan untuk PUYUH BARU/)).toBeInTheDocument();
    expect(screen.queryByText(/ = /)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Jumlah (butir)")).toBeInTheDocument();
  });

  it("the date link changes the date, the Ringkasan follows it, and × goes back to today", () => {
    renderTablet();
    const past = format(subDays(new Date(), 3), "yyyy-MM-dd");
    const longDate = (iso: string) =>
      parseISO(iso).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent("hari ini");
    expect(screen.getByText(longDate(todayIso()))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: past } });
    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent(kasDateLabel(past, "id-ID"));
    expect(screen.getByText(longDate(past))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Kembali ke hari ini" }));
    expect(screen.getByLabelText("Tanggal")).toHaveValue(todayIso());
    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent("hari ini");
  });

  it("rotating keeps what was typed, and a date cleared in portrait becomes today", async () => {
    const onSubmit = vi.fn(async () => true);
    const { rerender } = render(form(onSubmit, false));
    toggle("Telur");
    pickProduct(0, "NEGERI OMEGA");
    typeQty(0, "10");
    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: "" } });

    rerender(form(onSubmit, true));

    expect(screen.getByLabelText("Jumlah (kg)")).toHaveValue("10");
    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent("hari ini");
    const [entries] = await submitted(onSubmit);
    expect(entries[0].date).toBe(todayIso());
  });
});

describe("InflowForm phone layout", () => {
  it("keeps today's conversion line for a butir egg", () => {
    render(form(vi.fn(), false));
    toggle("Telur");
    pickProduct(0, "KAMPUNG BIASA");
    typeQty(0, "1500");
    expect(screen.getByText(/butir$/)).toHaveTextContent(/1500 pcs = 1[.,]500 butir/);
    expect(screen.queryByRole("heading", { name: "Ringkasan" })).not.toBeInTheDocument();
  });

  it("reads a thousands dot as thousands on the conversion line", () => {
    render(form(vi.fn(), false));
    toggle("Telur");
    pickProduct(0, "KAMPUNG BIASA");
    typeQty(0, "1.500");
    expect(screen.getByText(/butir$/)).toHaveTextContent(/1500 pcs = 1[.,]500 butir/);
  });
});
