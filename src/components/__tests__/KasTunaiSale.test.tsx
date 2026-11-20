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
// The saved Kas Tunai customers; a new name resolves to its row like the insert does.
const addCustomer = vi.fn(async ({ name }: { name: string }) => ({ id: "c-new", name, isActive: true }));
const customers = [
  { id: "c-rina", name: "Bu Rina", isActive: true },
  { id: "c-joko", name: "Pa Joko", isActive: true },
  { id: "c-old", name: "Bu Lama", isActive: false },
];
vi.mock("@/hooks/useCashCustomers", () => ({
  useCashCustomers: () => ({ customers, addCustomer: { mutateAsync: addCustomer } }),
}));

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

    // Starts on the anonymous walk-in; searching finds the saved customer.
    const picker = screen.getByRole("combobox", { name: "Nama pelanggan" });
    expect(picker).toHaveTextContent("Umum (tanpa nama)");
    fireEvent.click(picker);
    fireEvent.change(screen.getByPlaceholderText("Cari atau ketik nama…"), { target: { value: " bu  rina " } });
    expect(screen.queryByRole("option", { name: /Tambah/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Bu Rina" }));
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
    expect(metadata).toMatchObject({ orderType: "manual", outflowDate: entries[0].date, customerName: "Bu Rina", customerId: "c-rina" });
    expect(addCustomer).not.toHaveBeenCalled();
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

  const submitted = async (onSubmit: ReturnType<typeof vi.fn>) => {
    fireEvent.click(screen.getByRole("button", { name: /Catat Penjualan/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    return onSubmit.mock.calls[0][2] as Record<string, unknown>;
  };
  const searchCustomer = (text: string) => {
    fireEvent.click(screen.getByRole("combobox", { name: "Nama pelanggan" }));
    fireEvent.change(screen.getByPlaceholderText("Cari atau ketik nama…"), { target: { value: text } });
  };

  it("a sale with no customer picked is anonymous: no name, no id", async () => {
    const onSubmit = vi.fn(async () => true);
    renderKas(onSubmit);
    fillKg("1");
    const metadata = await submitted(onSubmit);
    expect(metadata).not.toHaveProperty("customerName");
    expect(metadata).not.toHaveProperty("customerId");
    await waitFor(() => expect(screen.getByText("1 penjualan")).toBeInTheDocument());
    // Listed under "Hari ini" as Umum (the picker button shows the same words).
    expect(screen.getAllByText("Umum (tanpa nama)").length).toBeGreaterThan(1);
  });

  it("a placeholder like 'Customer' can't be added as a customer, only Umum is offered", () => {
    renderKas(vi.fn(async () => true));
    searchCustomer("customer");
    expect(screen.queryByRole("option", { name: /Tambah/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Umum (tanpa nama)" })).toBeInTheDocument();
  });

  it("a new name is saved to the list and the sale carries its id", async () => {
    addCustomer.mockClear();
    const onSubmit = vi.fn(async () => true);
    renderKas(onSubmit);
    searchCustomer("  Bu   Sari ");
    fireEvent.click(screen.getByRole("option", { name: /Tambah .Bu Sari./ }));
    expect(addCustomer).toHaveBeenCalledWith({ name: "Bu Sari" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Nama pelanggan" })).toHaveTextContent("Bu Sari"));
    fillKg("1");
    await waitFor(async () => expect(await addCustomer.mock.results[0].value).toBeTruthy());
    const metadata = await submitted(onSubmit);
    expect(metadata).toMatchObject({ customerName: "Bu Sari", customerId: "c-new" });
  });

  it("when saving the new name fails (offline), the sale still carries the name", async () => {
    addCustomer.mockClear();
    addCustomer.mockRejectedValueOnce(new Error("Failed to fetch"));
    const onSubmit = vi.fn(async () => true);
    renderKas(onSubmit);
    searchCustomer("Bu Sari");
    fireEvent.click(screen.getByRole("option", { name: /Tambah/ }));
    fillKg("1");
    const metadata = await submitted(onSubmit);
    expect(metadata).toMatchObject({ customerName: "Bu Sari" });
    expect(metadata).not.toHaveProperty("customerId");
  });

  it("an inactive customer is hidden from search but reused on its exact name", () => {
    renderKas(vi.fn(async () => true));
    searchCustomer("bu");
    expect(screen.queryByRole("option", { name: "Bu Lama" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Cari atau ketik nama…"), { target: { value: "bu lama" } });
    expect(screen.getByRole("option", { name: "Bu Lama" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Tambah/ })).not.toBeInTheDocument();
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

  // ── Queue (Tambah ke Antrian → Catat Semua), like the PO builder ─────────────
  const queueBtn = () => screen.getByRole("button", { name: "Tambah ke Antrian" });
  // Pick a saved customer by its exact name, else add the typed one; "" = Umum.
  const name = (v: string) => {
    if (!v) return;
    searchCustomer(v);
    fireEvent.click(screen.queryByRole("option", { name: v }) ?? screen.getByRole("option", { name: /Tambah/ }));
  };
  const picker = () => screen.getByRole("combobox", { name: "Nama pelanggan" });
  const queuedNames = () => [...document.querySelectorAll("[data-queued-sale]")].map((el) => el.querySelector(".font-bold")?.textContent);
  const queueSale = (customer: string, qty: string) => {
    name(customer);
    fillKg(qty);
    fireEvent.click(queueBtn());
  };
  type Call = [OutflowEntry[], string, Record<string, unknown>];

  it("queues sales, then Catat Semua records each as its own sale and empties the queue", async () => {
    vi.mocked(toast).mockClear();
    const onSubmit = vi.fn(async () => true);
    const onCount = vi.fn();
    render(
      <LanguageProvider>
        <KasTunaiSale inflows={inflows} logs={[]} onSubmit={onSubmit} onClose={() => {}} onValidCountChange={onCount} />
      </LanguageProvider>
    );
    expect(queueBtn()).toBeDisabled();

    queueSale("Bu Rina", "1");
    // The form clears for the next customer; the sale sits in the queue.
    expect(picker()).toHaveTextContent("Umum (tanpa nama)");
    expect(screen.getByLabelText("Jumlah (butir)")).toHaveValue("");
    expect(screen.getByText("Penjualan dalam Antrian")).toBeInTheDocument();
    expect(screen.getByText("Bu Rina")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCount).toHaveBeenLastCalledWith(1); // the rail pill still shows what's waiting

    queueSale("", "0,5"); // no name
    expect(queuedNames()).toEqual(["Bu Rina", "Umum (tanpa nama)"]);
    expect(screen.getByText(/Total antrian/).parentElement).toHaveTextContent("1,5 kg NEGERI BIASA");

    // A sale still in the form goes along as the last one.
    name("Pak Budi");
    fillKg("0,25");
    // Pak Budi is new: his row comes back from the (mocked) insert before the press.
    await waitFor(async () => expect(await addCustomer.mock.results.at(-1)?.value).toMatchObject({ name: "Pak Budi" }));
    const submit = screen.getByRole("button", { name: "Catat Semua (3)" });
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));

    const calls = onSubmit.mock.calls as unknown as Call[];
    expect(calls.map(([e]) => e.map((x) => x.quantityInButir))).toEqual([[1], [0.5], [0.25]]);
    expect(calls.map(([, , m]) => m.customerName)).toEqual(["Bu Rina", undefined, "Pak Budi"]);
    expect(calls.map(([, , m]) => m.customerId)).toEqual(["c-rina", undefined, "c-new"]); // each sale keeps its own pick
    const saleIds = calls.map(([, , m]) => m.saleId);
    expect(new Set(saleIds).size).toBe(3);
    expect(calls.every(([, , m]) => m.orderType === "manual")).toBe(true);

    await waitFor(() => expect(screen.queryByText("Penjualan dalam Antrian")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Catat Penjualan/ })).toBeDisabled();
    expect(screen.getByText("3 penjualan")).toBeInTheDocument();
    expect(toast).toHaveBeenLastCalledWith({ title: "3 penjualan tercatat", description: "Telur dipotong dari stok" });
  });

  it("a rejected queued sale stays, marked, the others are recorded, and no toast of its own", async () => {
    let n = 0;
    const onSubmit = vi.fn(async () => ++n !== 2); // the second sale is rejected
    renderKas(onSubmit);
    queueSale("A", "1");
    queueSale("B", "1");
    queueSale("C", "1");
    vi.mocked(toast).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Catat Semua (3)" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));

    await waitFor(() => expect(screen.getByRole("button", { name: "Catat Semua (1)" })).toBeEnabled());
    const left = document.querySelectorAll("[data-queued-sale]");
    expect(left).toHaveLength(1);
    expect(left[0]).toHaveTextContent("B");
    expect(left[0]).toHaveTextContent("Ditolak");
    expect(screen.getByText("2 penjualan")).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled(); // the RPC hook's "Stok Tidak Cukup" stays up

    // Re-pressing records only B, with the same saleId.
    const bSaleId = (onSubmit.mock.calls[1] as unknown as Call)[2].saleId;
    fireEvent.click(screen.getByRole("button", { name: "Catat Semua (1)" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(4));
    expect((onSubmit.mock.calls[3] as unknown as Call)[2]).toMatchObject({ customerName: "B", saleId: bSaleId });
    await waitFor(() => expect(document.querySelectorAll("[data-queued-sale]")).toHaveLength(0));
  });

  it("a rejected form sale stays in the form, not the queue", async () => {
    const onSubmit = vi.fn(async (_e: OutflowEntry[], _u: string, m?: Record<string, unknown>) => m?.customerName !== "Form");
    renderKas(onSubmit as unknown as () => Promise<boolean>);
    queueSale("Queued", "1");
    name("Form");
    fillKg("0,5");
    fireEvent.click(screen.getByRole("button", { name: "Catat Semua (2)" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /Catat Penjualan/ })).toBeEnabled());
    expect(document.querySelectorAll("[data-queued-sale]")).toHaveLength(0);
    expect(picker()).toHaveTextContent("Form");
    expect(screen.getByLabelText("Jumlah (kg)")).toHaveValue("0,5");
  });

  it("Ubah loads a queued sale back; a sale in the form swaps into the queue; a half-typed form blocks it", () => {
    renderKas(vi.fn(async () => true));
    queueSale("Bu Rina", "1");
    fireEvent.change(screen.getByLabelText("Catatan"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Ubah Bu Rina" })).toBeDisabled(); // a note but no sale

    fireEvent.change(screen.getByLabelText("Catatan"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Ubah Bu Rina" }));
    expect(picker()).toHaveTextContent("Bu Rina");
    expect(screen.getByLabelText("Jumlah (kg)")).toHaveValue("1");
    expect(document.querySelectorAll("[data-queued-sale]")).toHaveLength(0);

    // Bu Rina's sale is in the form; editing another swaps them.
    fireEvent.click(queueBtn());
    queueSale("Pak Budi", "2");
    name("Bu Sari");
    fillKg("0,5");
    fireEvent.click(screen.getByRole("button", { name: "Ubah Pak Budi" }));
    expect(picker()).toHaveTextContent("Pak Budi");
    expect(screen.getByLabelText("Jumlah (kg)")).toHaveValue("2");
    expect(queuedNames()).toEqual(["Bu Rina", "Bu Sari"]);

    fireEvent.click(screen.getByRole("button", { name: "Hapus Bu Rina" }));
    expect(document.querySelectorAll("[data-queued-sale]")).toHaveLength(1);
  });

  it("the stock hint counts what the queue already takes", () => {
    renderKas(vi.fn(async () => true)); // 3 kg on hand
    queueSale("A", "2");
    fillKg("1,5");
    expect(screen.getByText(/Melebihi stok tersedia sebanyak 0,5 kg/)).toBeInTheDocument();
    expect(screen.getByText(/Tersedia/)).toHaveTextContent("Tersedia: 1 kg · 2 kg di antrian");
  });

  it("a queued sale keeps its picked date; the form keeps the date for the next one", async () => {
    const onSubmit = vi.fn(async () => true);
    renderKas(onSubmit);
    const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: yesterday } });
    queueSale("A", "1");
    expect(screen.getByTitle("Ubah tanggal")).toHaveTextContent(kasDateLabel(yesterday, "id-ID"));
    expect(document.querySelector("[data-queued-sale]")).toHaveTextContent(kasDateLabel(yesterday, "id-ID"));

    fireEvent.click(screen.getByRole("button", { name: "Kembali ke hari ini" }));
    queueSale("B", "1");
    fireEvent.click(screen.getByRole("button", { name: "Catat Semua (2)" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const dates = (onSubmit.mock.calls as unknown as Call[]).map(([e, , m]) => [e[0].date, m.outflowDate]);
    expect(dates).toEqual([
      [yesterday, yesterday],
      [format(new Date(), "yyyy-MM-dd"), format(new Date(), "yyyy-MM-dd")],
    ]);
  });
});

