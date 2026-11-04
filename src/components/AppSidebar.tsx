import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart2,
  Egg,
  History,
  House,
  Library,
  LogOut,
  PackageMinus,
  PackagePlus,
  PanelLeft,
  SquareCheckBig,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageToggle } from "@/components/LanguageToggle";
import { SettingsMenu } from "@/components/SettingsMenu";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useStockCountStatus } from "@/hooks/useStockCountStatus";
import { useOpenDeliveries } from "@/hooks/useDeliveries";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

export type SidebarKey =
  | "dashboard"
  | "outflow"
  | "inflow"
  | "activity"
  | "stockCount"
  | "deliveries"
  | "infos"
  | "catalog"
  | "users";

interface AppSidebarProps {
  active: SidebarKey;
  pendingCount: number;
  isOnline: boolean;
  onSelectTab?: (tab: Exclude<SidebarKey, "stockCount" | "deliveries">) => void;
}

const footerIconBtn = "h-11 w-11 shrink-0 text-ek-nav hover:bg-ek-muted hover:text-ek-fg";

// Every page mounts its own AppSidebar, so the collapsed rail is read from storage on
// init. Storage can throw (private mode, blocked site data): fall back to expanded.
export const SIDEBAR_COLLAPSED_KEY = "ek-sidebar-collapsed";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Tablet-landscape left sidebar shared by every page (replaces the top Header + tab bar there). */
export function AppSidebar({ active, pendingCount, isOnline, onSelectTab }: AppSidebarProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const { countedToday } = useStockCountStatus();
  const openDeliveries = useOpenDeliveries()?.count;
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the toggle still works for this page.
    }
  };

  const items: [SidebarKey, string, LucideIcon][] = [
    ["dashboard", t.nav.home, House],
    ["outflow", t.nav.outflow, PackageMinus],
    ["inflow", t.nav.inflow, PackagePlus],
    ["activity", t.nav.activities, History],
    ["stockCount", t.nav.stockCount, SquareCheckBig],
    ["deliveries", t.nav.deliveries, Truck],
    ["infos", t.nav.infos, BarChart2],
    ["catalog", t.nav.catalog, Library],
  ];
  if (isAdmin) items.push(["users", t.admin?.users || "Users", Users]);

  // Count badges: a pill at the row end when expanded, a corner badge on the icon when collapsed.
  const badgeFor = (key: SidebarKey): { n: number; label: string; tone: string } | null => {
    if (key === "deliveries" && openDeliveries != null && openDeliveries > 0)
      return {
        n: openDeliveries,
        label: t.deliveries.openCount.replace("{n}", String(openDeliveries)),
        tone: "bg-primary text-primary-foreground",
      };
    if (key === "activity" && pendingCount > 0)
      return { n: pendingCount, label: t.activity.statPending, tone: "bg-red-600 text-white" };
    return null;
  };

  const go = (key: SidebarKey) => {
    if (key === "stockCount") navigate("/stock-count");
    else if (key === "deliveries") navigate(openDeliveries ? "/deliveries?open=1" : "/deliveries");
    else if (onSelectTab) onSelectTab(key);
    else navigate("/", { state: { tab: key } });
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/auth");
  };

  const email = user?.email ?? "";
  const toggleLabel = collapsed ? t.nav.expandMenu : t.nav.collapseMenu;
  const statusLabel = isOnline ? t.activity.online : t.activity.offline;

  return (
    // overflow-x-hidden: on expand the full layout renders before the width animation
    // catches up; clip it instead of flashing a horizontal scrollbar.
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col gap-1 overflow-y-auto overflow-x-hidden border-r border-ek-border bg-card py-5 transition-[width] [transition-duration:180ms] [transition-timing-function:ease]",
        collapsed ? "w-[72px] px-2.5" : "w-52 px-3"
      )}
    >
      <div
        className={cn(
          "flex font-display text-[21px] font-semibold tracking-[-0.02em] text-ek-fg",
          collapsed ? "flex-col items-center gap-2.5 pb-3.5" : "items-center gap-2.5 pb-[18px] pl-2.5"
        )}
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-primary">
          <Egg className="h-4 w-4 text-white" strokeWidth={2.2} />
        </span>
        {!collapsed && "EggKeep"}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-ek-mfg transition-colors",
            "hover:bg-ek-muted hover:text-ek-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !collapsed && "ml-auto"
          )}
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex flex-col gap-1">
        {items.map(([key, label, Icon]) => {
          const isActive = key === active;
          const badge = badgeFor(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => go(key)}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? label : undefined}
              className={cn(
                "flex h-12 w-full shrink-0 items-center gap-3 rounded-[11px] text-left text-[15.5px] font-semibold text-ek-nav transition-colors",
                "hover:bg-ek-muted hover:text-ek-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed ? "justify-center px-0" : "px-3",
                isActive && "bg-ek-accent text-amber-700 hover:bg-ek-accent hover:text-amber-700"
              )}
            >
              <span className="relative shrink-0">
                <Icon className="h-5 w-5" />
                {key === "stockCount" && !countedToday && (
                  <span
                    role="img"
                    aria-label={t.stockCount.notCountedToday}
                    title={t.stockCount.notCountedToday}
                    className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card"
                  />
                )}
                {collapsed && badge && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ring-2 ring-card",
                      badge.tone
                    )}
                  >
                    {badge.n}
                  </span>
                )}
              </span>
              {/* Collapsed: the label (and badge text below) stay as the accessible name, visually hidden. */}
              <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{label}</span>
              {badge &&
                (collapsed ? (
                  <span className="sr-only">
                    {" "}
                    {badge.n} {badge.label}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "ml-auto flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-xs tabular-nums",
                      badge.tone
                    )}
                    title={badge.label}
                  >
                    {badge.n}
                    <span className="sr-only"> {badge.label}</span>
                  </span>
                ))}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-ek-border">
        <div className={cn("flex items-center gap-2.5", collapsed ? "justify-center py-3" : "p-3")}>
          <span
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ek-muted font-bold uppercase text-ek-fg"
            title={collapsed ? email : undefined}
          >
            {email.charAt(0)}
            {collapsed && (
              <span
                role="img"
                aria-label={statusLabel}
                title={statusLabel}
                className={cn(
                  "absolute bottom-0 right-0 h-2 w-2 rounded-full ring-2 ring-card",
                  isOnline ? "bg-green-500" : "bg-orange-500"
                )}
              />
            )}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <b className="block truncate text-sm text-ek-fg" title={email}>
                {email}
              </b>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-[13px] font-semibold",
                  isOnline ? "text-green-700" : "text-orange-700"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", isOnline ? "bg-green-500" : "bg-orange-500")} />
                {statusLabel}
              </span>
            </span>
          )}
        </div>

        {/* The top Header is hidden on tablet, so its functions live here. -mx-2 borrows the
            aside padding so all four controls fit the 208px rail. The [&>button] rules lift
            SettingsMenu / LanguageToggle to 44px touch targets (px-2 keeps the row on one line).
            Collapsed, they stack as centred 44px icons; the language flag goes sr-only so the
            globe fits and the button keeps its accessible name. */}
        <div
          className={
            collapsed
              ? "flex flex-col items-center gap-1 [&>button]:h-11 [&>button]:w-11 [&>button]:px-0 [&>button>span]:sr-only"
              : "-mx-2 flex flex-wrap items-center justify-between gap-y-1 [&>button]:h-11 [&>button]:min-w-11 [&>button]:px-2"
          }
        >
          <SettingsMenu />
          <LanguageToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            title={t.header.logout}
            aria-label={t.header.logout}
            className={footerIconBtn}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
