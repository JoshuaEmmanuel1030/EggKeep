// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { InflowForm } from "@/components/InflowForm";
import { toast } from "@/hooks/use-toast";
import type { InflowEntry } from "@/types/inventory";

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

describe("InflowForm submit payload", () => {
  const renderForm = (onSubmit: ReturnType<typeof vi.fn>) =>
    render(
      <LanguageProvider>
        <InflowForm onSubmit={onSubmit as never} />
      </LanguageProvider>
    );

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
});
