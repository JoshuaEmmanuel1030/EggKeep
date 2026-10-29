import { useNavigate } from "react-router-dom";
import {
  BarChart2,
  Download,
  Egg,
  History,
  House,
  Library,
  LogOut,
  PackageMinus,
  PackagePlus,
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
import { useOpenDeliveryCount } from "@/hooks/useDeliveries";
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
  onExport?: () => void;
}

const footerIconBtn = "h-11 w-11 shrink-0 text-ek-nav hover:bg-ek-muted hover:text-ek-fg";

/** Tablet-landscape left sidebar shared by every page (replaces the top Header + tab bar there). */
export function AppSidebar({ active, pendingCount, isOnline, onSelectTab, onExport }: AppSidebarProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const { countedToday } = useStockCountStatus();
  const openDeliveries = useOpenDeliveryCount();

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

  const go = (key: SidebarKey) => {
    if (key === "stockCount") navigate("/stock-count");
    else if (key === "deliveries") navigate("/deliveries");
    else if (onSelectTab) onSelectTab(key);
    else navigate("/", { state: { tab: key } });
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/auth");
  };

  const email = user?.email ?? "";

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-ek-border bg-card px-3 py-5">
      <div className="flex items-center gap-2.5 px-2.5 pb-[18px] font-display text-[21px] font-semibold tracking-[-0.02em] text-ek-fg">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-primary">
          <Egg className="h-4 w-4 text-white" strokeWidth={2.2} />
        </span>
        EggKeep
      </div>

      <nav className="flex flex-col gap-1">
        {items.map(([key, label, Icon]) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => go(key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-12 w-full shrink-0 items-center gap-3 rounded-[11px] px-3 text-left text-[15.5px] font-semibold text-ek-nav transition-colors",
                "hover:bg-ek-muted hover:text-ek-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
              </span>
              <span className="min-w-0 truncate">{label}</span>
              {key === "deliveries" && openDeliveries != null && openDeliveries > 0 && (
                <span
                  className="ml-auto flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground"
                  title={t.deliveries.openCount.replace("{n}", String(openDeliveries))}
                >
                  {openDeliveries}
                  <span className="sr-only"> {t.deliveries.openCount.replace("{n}", String(openDeliveries))}</span>
                </span>
              )}
              {key === "activity" && pendingCount > 0 && (
                <span
                  className="ml-auto flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs tabular-nums text-white"
                  title={t.activity.statPending}
                >
                  {pendingCount}
                  <span className="sr-only"> {t.activity.statPending}</span>
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-ek-border">
        <div className="flex items-center gap-2.5 p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ek-muted font-bold uppercase text-ek-fg">
            {email.charAt(0)}
          </span>
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
              {isOnline ? t.activity.online : t.activity.offline}
            </span>
          </span>
        </div>

        {/* The top Header is hidden on tablet, so its functions live here. -mx-2 borrows the
            aside padding so all four controls fit the 208px rail. The [&>button] rules lift
            SettingsMenu / LanguageToggle to 44px touch targets (px-2 keeps the row on one line). */}
        <div className="-mx-2 flex flex-wrap items-center justify-between gap-y-1 [&>button]:h-11 [&>button]:min-w-11 [&>button]:px-2">
          <SettingsMenu />
          <LanguageToggle />
          {onExport && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onExport}
              title={t.header.exportCsv}
              aria-label={t.header.exportCsv}
              className={footerIconBtn}
            >
              <Download className="h-5 w-5" />
            </Button>
          )}
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
