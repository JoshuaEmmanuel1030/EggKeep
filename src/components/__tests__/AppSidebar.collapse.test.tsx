// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AppSidebar, SIDEBAR_COLLAPSED_KEY } from "@/components/AppSidebar";

// Keep the sidebar pure of Supabase / network.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { email: "gudang@js.id" }, signOut: vi.fn() }),
}));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useStockCountStatus", () => ({ useStockCountStatus: () => ({ countedToday: true }) }));
vi.mock("@/hooks/useDeliveries", () => ({ useOpenDeliveries: () => ({ count: 3 }) }));

const renderSidebar = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AppSidebar active="outflow" pendingCount={2} isOnline />
      </LanguageProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  // jsdom has no matchMedia; SettingsMenu's InstallDialog probes display-mode on mount.
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(cleanup);

describe("AppSidebar collapse", () => {
  it("defaults to expanded, toggles to the 72px rail and persists it", () => {
    renderSidebar();
    const toggle = screen.getByRole("button", { name: "Hide menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("gudang@js.id")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("1");
    expect(screen.getByRole("complementary")).toHaveClass("w-[72px]");
    // Email text goes; the online dot on the avatar carries the status instead.
    expect(screen.queryByText("gudang@js.id")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Online" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("0");
  });

  it("reads the collapsed state on mount (each page mounts its own sidebar)", () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    renderSidebar();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("keeps accessible names, badge counts and footer controls when collapsed", () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    renderSidebar();
    const outflow = screen.getByRole("button", { name: /^Orders/ });
    expect(outflow).toHaveAttribute("aria-current", "page");
    expect(outflow).toHaveAttribute("title");
    expect(screen.getByRole("button", { name: /Deliveries.*3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activit.*2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("falls back to expanded when storage throws", () => {
    // Throw only for the sidebar key (LanguageProvider reads storage too, unguarded).
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    const blocked = (key: string) => {
      if (key === SIDEBAR_COLLAPSED_KEY) throw new Error("blocked");
    };
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      blocked(key);
      return realGet.call(this, key);
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, v: string) {
      blocked(key);
      realSet.call(this, key, v);
    });
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Hide menu" }));
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
