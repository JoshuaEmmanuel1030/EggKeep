// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { format, subDays } from "date-fns";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { KasTunaiSale } from "@/components/KasTunaiSale";
import { kasDateLabel } from "@/lib/kasTunai";
import { toast } from "@/hooks/use-toast";
import { enqueueOutflowOrder, OUTFLOW_OUTBOX_KEY } from "@/lib/outflowOutbox";
import type { InflowEntry, OutflowEntry } from "@/types/inventory";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "staff@js.test" } }) }));
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: {
      "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
      KAMPUNG: { unit: "butir", eggs_per_unit: 1 },
      "KAMPUNG (RETAKAN)": { unit: "butir", eggs_per_unit: 1 },
    },
    eggProductNames: ["KAMPUNG", "KAMPUNG (RETAKAN)", "NEGERI BIASA"],
    itemTypes: [
      { id: "e1", category: "egg", name: "KAMPUNG", isRetakan: false },
      { id: "e2", category: "egg", name: "KAMPUNG (RETAKAN)", isRetakan: true },
      { id: "e3", category: "egg", name: "NEGERI BIASA", isRetakan: false },
    ],
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

// 3 kg on hand, so 3,5 kg is over stock (a warning, not a block).
const inflows = [{ product: "NEGERI BIASA", category: "egg", remainingButir: 3 }] as InflowEntry[];

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(() => cleanup());

describe("KasTunaiSale", () => {
  it("records a kg sale through onSubmit with the Kas metadata, then resets", async () => {
    const onSubmit = vi.fn(async () => true);
    const onCount = vi.fn();
    render(
      <LanguageProvider>
        <KasTunaiSale inflows={inflows} logs={[]} onSubmit={onSubmit} onClose={() => {}} onValidCountChange={onCount} />
      </LanguageProvider>
    );

    const submit = screen.getByRole("button", { name: /Catat Penjualan/ });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Nama pelanggan"), { target: { value: " Bu Rina " } });
    fireEvent.click(screen.getByRole("combobox", { name: "Jenis Telur" }));
    fireEvent.click(screen.getByRole("option", { name: /NEGERI BIASA/ }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Jumlah (kg)"), { target: { value: "3,5" } });

    expect(screen.getByText(/Melebihi stok tersedia sebanyak 0,5 kg/)).toBeInTheDocument();
    expect(submit).toBeEnabled();
    expect(onCount).toHaveBeenLastCalledWith(1);

    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [entries, email, metadata] = onSubmit.mock.calls[0] as unknown as [
      { product: string; quantityInButir: number; category: string; date: string }[],
      string,
      Record<string, unknown>,
    ];
    expect(email).toBe("staff@js.test");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ product: "NEGERI BIASA", quantityInButir: 3.5, category: "egg" });
    expect(metadata).toMatchObject({ orderType: "manual", outflowDate: entries[0].date, customerName: "Bu Rina" });
    expect(typeof metadata.saleId).toBe("string");
    expect(metadata).not.toHaveProperty("note");

    // Reset, and the sale is listed under "Hari ini" straight away.
    await waitFor(() => expect(screen.getByLabelText("Jumlah (butir)")).toHaveValue(""));
    expect(screen.getByText("1 penjualan")).toBeInTheDocument();
    expect(screen.getByText("Bu Rina")).toBeInTheDocument();
    expect(screen.getByText("3,5 kg NEGERI BIASA")).toBeInTheDocument();
  });

  // The toast store holds one toast: Kas must not replace the one Index / the
  // RPC hook already showed.
  const fillKg = (qty: string) => {
    fireEvent.click(screen.getByRole("combobox", { name: "Jenis Telur" }));
    fireEvent.click(screen.getByRole("option", { name: /NEGERI BIASA/ }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Jumlah (kg)"), { target: { value: qty } });
  };
  const renderKas = (onSubmit: () => Promise<boolean>) =>
    render(
      <LanguageProvider>
        <KasTunaiSale inflows={inflows} logs={[]} onSubmit={onSubmit} onClose={() => {}} onValidCountChange={() => {}} />
      </LanguageProvider>
    );

  it("a rejected sale keeps the form and adds no toast of its own", async () => {
    vi.mocked(toast).mockClear();
    const onSubmit = vi.fn(async () => false);
    renderKas(onSubmit);
    fillKg("3,5");
    fireEvent.click(screen.getByRole("button", { name: /Catat Penjualan/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /Catat Penjualan/ })).toBeEnabled());
    expect(toast).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Jumlah (kg)")).toHaveValue("3,5");
  });

  it("a sale queued offline doesn't claim stock was deducted", async () => {
    vi.mocked(toast).mockClear();
    const onSubmit = vi.fn(async (entries: OutflowEntry[]) => {
      enqueueOutflowOrder({ entries, logs: [] });
      return true;
    });
    renderKas(onSubmit as unknown as () => Promise<boolean>);
    fillKg("1");
    fireEvent.click(screen.getByRole("button", { name: /Catat Penjualan/ }));
    await waitFor(() => expect(screen.getByText("1 penjualan")).toBeInTheDocument());
    expect(toast).not.toHaveBeenCalled();
    localStorage.removeItem(OUTFLOW_OUTBOX_KEY);
  });

  it("a typed qty that won't be recorded blocks the sale", () => {
    renderKas(vi.fn(async () => true));
    fireEvent.click(screen.getByRole("combobox", { name: "Jenis Telur" }));
    fireEvent.click(screen.getByRole("option", { name: /NEGERI BIASA/ }));
    fireEvent.change(screen.getByLabelText("Jumlah (butir)"), { target: { value: "2,5" } });
    expect(screen.getByLabelText("Jumlah (butir)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /Catat Penjualan/ })).toBeDisabled();
  });

  it("the date link records a past date, and × goes back to today", async () => {
    const onSubmit = vi.fn(async () => true);
    renderKas(onSubmit);
    const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent("hari ini");
    expect(screen.queryByRole("button", { name: "Kembali ke hari ini" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: yesterday } });
    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent(kasDateLabel(yesterday, "id-ID"));

    fireEvent.click(screen.getByRole("button", { name: "Kembali ke hari ini" }));
    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent("hari ini");

    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: yesterday } });
    fillKg("1");
    fireEvent.click(screen.getByRole("button", { name: /Catat Penjualan/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [entries, , metadata] = onSubmit.mock.calls[0] as unknown as [{ date: string }[], string, { outflowDate: string }];
    expect(entries[0].date).toBe(yesterday);
    expect(metadata.outflowDate).toBe(yesterday);

    // A recorded sale puts the link back on today.
    await waitFor(() => expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent("hari ini"));
  });

  // ── Radial quick-add on Tambah telur, bin on every line ──────────────────────
  const ptr = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
  const trigger = () => screen.getByRole("button", { name: "Tambah telur" });
  const bins = () => screen.getAllByRole("button", { name: "Hapus baris" });
  // Two items: KAMPUNG at the top, NEGERI BIASA at the bottom. Press, drag
  // 70 px that way, release, then the browser's trailing click.
  const pick = (dy: number) => {
    fireEvent.pointerDown(trigger(), ptr(500, 400));
    fireEvent.pointerMove(window, ptr(500, 400 + dy));
    fireEvent.pointerUp(window, ptr(500, 400 + dy));
    fireEvent.click(trigger());
  };

  it("the ring offers the non-retakan eggs; a pick fills the empty line, focused and flashed", () => {
    renderKas(vi.fn(async () => true));
    fireEvent.pointerDown(trigger(), ptr(500, 400));
    fireEvent.pointerMove(window, ptr(500, 470));
    expect(document.querySelector(".ek-rad-hd")).toHaveTextContent("Pilih telur");
    expect([...document.querySelectorAll(".ek-rad-it")].map((el) => el.textContent)).toEqual(["KAMPUNG", "NEGERIBIASA"]);
    expect(document.querySelector(".ek-rad-c")).toHaveTextContent("TambahNEGERI");
    fireEvent.pointerUp(window, ptr(500, 470));
    fireEvent.click(trigger());

    expect(bins()).toHaveLength(1); // filled, not appended
    expect(screen.getByRole("combobox", { name: "Jenis Telur" })).toHaveTextContent("NEGERI BIASA");
    expect(screen.getByRole("switch")).toBeInTheDocument(); // kg product: Butir/Kg switch
    const qty = screen.getByLabelText("Jumlah (butir)");
    expect(qty).toHaveFocus();
    expect(qty.closest("[data-line-id]")).toHaveClass("ek-rad-new");
  });

  it("with no empty line a pick appends one; a non-kg egg is entered in butir", () => {
    renderKas(vi.fn(async () => true));
    fillKg("2");
    pick(-70); // KAMPUNG
    expect(bins()).toHaveLength(2);
    expect(screen.getByLabelText("Jumlah (kg)")).toHaveValue("2"); // first line untouched
    const [first, second] = screen.getAllByRole("combobox", { name: "Jenis Telur" });
    expect(first).toHaveTextContent("NEGERI BIASA");
    expect(second).toHaveTextContent("KAMPUNG");
    const qty = screen.getByLabelText("Jumlah (butir)");
    expect(qty).toHaveFocus();
    expect(within(qty.closest("[data-line-id]") as HTMLElement).queryByRole("switch")).toBeNull();
  });

  it("a tap adds an empty line; the bin shows on every line and the last one leaves a fresh line", () => {
    renderKas(vi.fn(async () => true));
    expect(bins()).toHaveLength(1);
    fireEvent.click(screen.getByRole("combobox", { name: "Jenis Telur" }));
    fireEvent.click(screen.getByRole("option", { name: /NEGERI BIASA/ }));
    fireEvent.click(trigger());
    expect(bins()).toHaveLength(2);

    fireEvent.click(bins()[1]);
    expect(bins()).toHaveLength(1);
    fireEvent.click(bins()[0]);
    expect(bins()).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Jenis Telur" })).toHaveTextContent("Pilih...");
  });
});
