// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, within, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { QuickOutflowBuilder } from "@/components/QuickOutflowBuilder";
import { toast } from "@/hooks/use-toast";
import { localToday, type RecentPo } from "@/lib/buyerProfile";
import { calculateLineMaterials } from "@/lib/outflowCalculator";
import { HOLD_MS, PHONE_HOLD_MS } from "@/lib/radial";
import type { StockSummary } from "@/types/inventory";

// Pass-through spy: the only place a test can see the raw line object.
vi.mock("@/lib/outflowCalculator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/outflowCalculator")>();
  return { ...actual, calculateLineMaterials: vi.fn(actual.calculateLineMaterials) };
});

// ── Hook mocks: no Supabase / network. ────────────────────────────────────────
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: "staff@js.test" } }) }));
vi.mock("@/hooks/useBuyers", () => ({
  useBuyers: () => ({
    buyers: [{ id: "b1", name: "OSAVE BKS", pinnedSkuIds: ["s2"] }, { id: "b2", name: "TOKO BARU" }],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useBuyerDcs", () => ({
  useBuyerDcs: () => ({
    dcsForBuyer: (id?: string) => (id === "b1" ? [{ id: "dc1", buyerId: "b1", name: "BKS" }] : []),
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({
    skus: [
      { id: "s1", code: "KP10B", displayName: "Kampung 10 Biasa", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10, packagingItem: "MIKA 10", isActive: true },
      { id: "s2", code: "KP6", displayName: "Kampung 6", eggProduct: "KAMPUNG BIASA", eggsPerPack: 6, packagingItem: "MIKA 6", isActive: true },
      { id: "s3", code: "OLD10", displayName: "Lama 10", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10, packagingItem: "MIKA 10", isActive: false },
    ],
  }),
}));
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    conversionMap: { "KAMPUNG BIASA": { unit: "butir", eggs_per_unit: 1 } },
    eggProductNames: ["KAMPUNG BIASA"],
    boxCapacityMap: {},
    labelsPerPackMap: {},
    getTypesByCategory: () => [{ name: "LABEL OSVN" }],
  }),
}));
vi.mock("@/hooks/useDuplicateOrderCheck", () => ({ useDuplicateOrderCheck: () => ({ check: async () => [] }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const recent = vi.hoisted(() => ({ data: [] as RecentPo[] }));
vi.mock("@/hooks/usePurchaseOrders", () => ({ useRecentPurchaseOrders: () => recent }));

// Last 8 weeks. OSAVE BKS: KP6 in 2 POs, KP10B in 1. All buyers: OLD10 3 (but
// inactive, so dropped), KP10B 3, KP6 2. TOKO BARU has none.
const po = (buyerName: string, ...codes: string[]): RecentPo => ({
  buyerName,
  outflowDate: localToday(),
  orderLines: codes.map((skuCode) => ({ skuCode, packQty: 1 })),
});
recent.data = [
  po("OSAVE BKS", "KP6", "KP10B"),
  po("OSAVE BKS", "KP6"),
  po("SBOX", "OLD10", "KP10B"),
  po("SBOX", "OLD10", "KP10B"),
  po("SBOX", "OLD10"),
];

// Mika 10 is 40 in stock, so 42 packs is 2 short.
const stock = [
  { product: "KAMPUNG BIASA", category: "egg", totalStock: 5000 },
  { product: "MIKA 10", category: "packaging", totalStock: 40 },
] as StockSummary[];

const queryClient = new QueryClient();
const ui = (tablet?: boolean) => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <QuickOutflowBuilder stockSummary={stock} inflows={[]} onSubmit={async () => true} tablet={tablet} />
    </LanguageProvider>
  </QueryClientProvider>
);

// Radix Popper and cmdk need these; jsdom has neither.
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(() => cleanup());

const addPackLine = (qty: string) => {
  fireEvent.click(screen.getByRole("button", { name: /Tambah Baris/ }));
  // Combobox triggers have no accessible name (as on the phone): find by text.
  fireEvent.click(screen.getByText("Pilih SKU...").closest("button"));
  fireEvent.click(screen.getByRole("option", { name: /Kampung 10 Biasa/ }));
  fireEvent.change(screen.getByLabelText("Jumlah (paket)"), { target: { value: qty } });
};

const ptr = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
const trigger = () => screen.getByRole("button", { name: "Tambah Baris" });
const ringItems = () => [...document.querySelectorAll(".ek-rad-it")].map((el) => el.textContent);
// Press, then drag 70 px up: opens the ring and highlights item 0.
const openRing = () => {
  fireEvent.pointerDown(trigger(), ptr(500, 400));
  fireEvent.pointerMove(window, ptr(500, 330));
};

describe("QuickOutflowBuilder — tablet (6a)", () => {
  it("renders the 6a structure with no line-type or label selects", () => {
    render(ui(true));
    expect(screen.getByRole("heading", { level: 1, name: "Pembuat Purchase Order" })).toBeInTheDocument();
    expect(screen.getByText("0 baris")).toBeInTheDocument();
    expect(screen.getByText("Belum ada baris pesanan.")).toBeInTheDocument();
    expect(screen.getByText("Tambah baris pesanan untuk melihat ringkasan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Tambah Baris/ }));
    expect(screen.getByText("1 baris")).toBeInTheDocument();
    // Buyer, DC and the line's SKU picker; nothing else.
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.queryByText(/Label \(Opsional\)/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hapus baris" })).toBeInTheDocument();
    // No materials yet → no Rincian bahan button.
    expect(screen.queryByRole("button", { name: /Rincian bahan/ })).not.toBeInTheDocument();
  });

  it("Rincian bahan lists the line's materials and flags the short one", () => {
    render(ui(true));
    addPackLine("42");
    expect(screen.getByText("pak")).toBeInTheDocument();
    expect(screen.getByText("KP10B")).toBeInTheDocument();

    const btn = screen.getByRole("button", { name: /Rincian bahan/ });
    expect(btn).toHaveTextContent("Stok kurang");
    fireEvent.click(btn);
    const pop = screen.getByRole("dialog");
    expect(within(pop).getByText("KAMPUNG BIASA")).toBeInTheDocument();
    expect(within(pop).getByText("420 butir")).toBeInTheDocument();
    expect(within(pop).getByText("MIKA 10")).toBeInTheDocument();
    expect(within(pop).getByText("42 pcs")).toBeInTheDocument();
    expect(within(pop).getByText("-2")).toBeInTheDocument();

    // Ringkasan Pesanan in the right panel carries the per-shortage line.
    expect(screen.getByText("Peringatan Stok")).toBeInTheDocument();
    expect(screen.getByText("MIKA 10: butuh 42, punya 40")).toBeInTheDocument();
  });

  it("queues into the right panel; edit loads the order back", () => {
    render(ui(true));
    fireEvent.click(screen.getByText("Pilih pembeli...").closest("button"));
    fireEvent.click(screen.getByRole("option", { name: "OSAVE BKS" }));
    addPackLine("5");
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Antrian/ }));

    expect(screen.getByText("Pesanan dalam Antrian")).toBeInTheDocument();
    expect(screen.getByText(/1 baris • 50 KAMPUNG BIASA/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daftar Ambil/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kirim Semua \(1\)/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Tambah ke Antrian/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Ubah OSAVE BKS" }));
    expect(screen.queryByText("Pesanan dalam Antrian")).not.toBeInTheDocument();
    expect(screen.getByText("1 baris")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan Pesanan" })).toBeEnabled();
  });

  it("recording a PO refreshes the recent-PO caches (radial ranking, buyer stats)", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(ui(true));
    fireEvent.click(screen.getByText("Pilih pembeli...").closest("button"));
    fireEvent.click(screen.getByRole("option", { name: "OSAVE BKS" }));
    addPackLine("5");
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Antrian/ }));
    fireEvent.click(screen.getByRole("button", { name: /Kirim Semua \(1\)/ }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["purchase_orders"] }));
    invalidate.mockRestore();
  });

  it("Simpan Pesanan with valid lines but no buyer asks for the buyer", () => {
    vi.mocked(toast).mockClear();
    render(ui(true));
    addPackLine("5");
    fireEvent.click(screen.getByRole("button", { name: "Simpan Pesanan" }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Silakan pilih pembeli" }));
  });

  it("an open Rincian bahan does not reopen by itself after rotating back", () => {
    const { rerender } = render(ui(true));
    addPackLine("5");
    fireEvent.click(screen.getByRole("button", { name: /Rincian bahan/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(ui(false));
    rerender(ui(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("phone keeps today's row; rotating keeps the unsaved lines", () => {
    const { rerender } = render(ui(false));
    fireEvent.click(screen.getByRole("button", { name: /Tambah Baris/ }));
    expect(screen.getByText(/Label \(Opsional\)/)).toBeInTheDocument();
    // Buyer, DC, line type, SKU, label.
    expect(screen.getAllByRole("combobox")).toHaveLength(5);

    rerender(ui(true));
    expect(screen.getByText("1 baris")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  // ── Radial quick-add on Tambah Baris ─────────────────────────────────────────
  it("a short tap still adds a blank line", () => {
    render(ui(true));
    fireEvent.pointerDown(trigger(), ptr(500, 400));
    fireEvent.pointerUp(window, ptr(500, 400));
    fireEvent.click(trigger());
    expect(screen.getByText("1 baris")).toBeInTheDocument();
    expect(screen.getByText("Pilih SKU...")).toBeInTheDocument();
    expect(document.querySelector(".ek-rad")).toBeNull();
  });

  it("press-drag-release appends a pack line with that SKU, focused and flashed", () => {
    render(ui(true));
    openRing();
    expect(document.querySelector(".ek-rad-hd")).toHaveTextContent("Sering dipesan · semua pembeli8 minggu terakhir");
    expect(ringItems()).toEqual(["KP10B", "KP6"]); // OLD10 is inactive
    expect(document.querySelector(".ek-rad-on")).toHaveTextContent("KP10B");

    fireEvent.pointerUp(window, ptr(500, 330));
    fireEvent.click(trigger()); // the trailing click adds nothing
    expect(screen.getByText("1 baris")).toBeInTheDocument();
    const qty = screen.getByLabelText("Jumlah (paket)");
    const row = qty.closest("[data-line-id]") as HTMLElement;
    expect(within(row).getByText("KP10B")).toBeInTheDocument();
    expect(within(row).getByText("Kampung 10 Biasa")).toBeInTheDocument();
    expect(qty).toHaveFocus();
    expect(row).toHaveClass("ek-rad-new");
  });

  it("ranks the buyer's own SKUs with pins; a buyer with no history falls back to all", () => {
    render(ui(true));
    fireEvent.click(screen.getByText("Pilih pembeli...").closest("button"));
    fireEvent.click(screen.getByRole("option", { name: "OSAVE BKS" }));
    openRing();
    expect(document.querySelector(".ek-rad-hd")).toHaveTextContent("Sering dipesan · OSAVE BKS8 minggu terakhir");
    expect(ringItems()).toEqual(["KP6", "KP10B"]);
    expect(document.querySelector(".ek-rad-pin")).toHaveTextContent("KP6");

    // Back into the dead zone and release: cancelled, and its click adds nothing.
    fireEvent.pointerMove(window, ptr(500, 400));
    fireEvent.pointerUp(window, ptr(500, 400));
    fireEvent.click(trigger());
    expect(screen.getByText("0 baris")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByRole("option", { name: "TOKO BARU" }));
    openRing();
    expect(document.querySelector(".ek-rad-hd")).toHaveTextContent("TOKO BARU belum ada riwayat · semua pembeli");
    expect(ringItems()).toEqual(["KP10B", "KP6"]);
    expect(document.querySelector(".ek-rad-pin")).toBeNull();
    fireEvent.pointerCancel(window, ptr(500, 330));
  });
});

describe("QuickOutflowBuilder — phone radial", () => {
  const qtyInputs = () => screen.queryAllByPlaceholderText("Masukkan jml");

  it("a plain tap adds a blank pack line", () => {
    render(ui(false));
    fireEvent.pointerDown(trigger(), ptr(200, 600));
    fireEvent.pointerUp(window, ptr(200, 600));
    fireEvent.click(trigger());
    expect(qtyInputs()).toHaveLength(1);
    expect(screen.getByText("Pilih SKU...")).toBeInTheDocument();
    expect(document.querySelector(".ek-rad")).toBeNull();
  });

  it("a pick appends a pack line with exactly { id, lineType, skuCode } and focuses its Jumlah", () => {
    render(ui(false));
    fireEvent.click(trigger()); // a blank line first: the pick appends after it
    openRing();
    expect(ringItems()).toEqual(["KP10B", "KP6"]);
    fireEvent.pointerUp(window, ptr(500, 330));
    fireEvent.click(trigger()); // the trailing click adds nothing

    expect(qtyInputs()).toHaveLength(2);
    const qty = qtyInputs()[1];
    const row = qty.closest("[data-line-id]") as HTMLElement;
    expect(within(row).getByText("Kampung 10 Biasa")).toBeInTheDocument();
    expect(qty).toHaveFocus();
    expect(row).toHaveClass("ek-rad-new");

    const line = vi.mocked(calculateLineMaterials).mock.calls.at(-1)[0];
    expect(line).toStrictEqual({ id: row.getAttribute("data-line-id"), lineType: "pack", skuCode: "KP10B" });
  });

  it("the phone waits the longer hold; the tablet keeps 90 ms", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(ui(false));
      fireEvent.pointerDown(trigger(), ptr(200, 600));
      act(() => void vi.advanceTimersByTime(PHONE_HOLD_MS - 1));
      expect(document.querySelector(".ek-rad")).toBeNull();
      act(() => void vi.advanceTimersByTime(1));
      expect(document.querySelector(".ek-rad")).not.toBeNull();
      unmount();

      render(ui(true));
      fireEvent.pointerDown(trigger(), ptr(200, 600));
      act(() => void vi.advanceTimersByTime(HOLD_MS));
      expect(document.querySelector(".ek-rad")).not.toBeNull();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
});
