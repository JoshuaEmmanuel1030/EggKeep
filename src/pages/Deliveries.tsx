import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Calendar, ChevronLeft, Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { AppSidebar } from "@/components/AppSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIsTabletLandscape } from "@/hooks/use-mobile";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useUserRole } from "@/hooks/useUserRole";
import { useDeliveries, type DateRange } from "@/hooks/useDeliveries";
import type { DeliveryDetailData } from "@/hooks/useDelivery";
import { addDays, localToday, toLocalDate } from "@/lib/buyerProfile";
import { customerLabel, filterDeliveryItems, normalizeInvoiceRef } from "@/lib/deliveryFlags";
import { buildDeliveryLogCsv, deliveryLogFilename } from "@/lib/deliveryExport";
import { downloadCSV } from "@/lib/inventory";
import { cn } from "@/lib/utils";
import type { DeliveryListItem } from "@/types/deliveries";
import { DeliveryDetail } from "@/components/deliveries/DeliveryDetail";
import { DeliveryStatusChip } from "@/components/deliveries/DeliveryStatusChip";

const DEFAULT_RANGE_DAYS = 14;

type Chips = { notLogged: boolean; notDelivered: boolean; invoiceNotBack: boolean };

// /deliveries — Log Pengiriman & Retur, Phase 1: one row per PO / faktur with
// its delivery status and faktur-balik state; detail on tap. Deep link:
// /deliveries?invoice=<ref> (the order cards on Activities use it).
export default function Deliveries() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTablet = useIsTabletLandscape();
  const { isAdmin } = useUserRole();
  const { pendingCount, isOnline } = useOfflineSync();
  const locale = language === "id" ? "id-ID" : "en-US";

  const today = localToday();
  const [range, setRange] = useState<DateRange>({ from: addDays(today, -(DEFAULT_RANGE_DAYS - 1)), to: today });
  const [search, setSearch] = useState("");
  const [chips, setChips] = useState<Chips>({ notLogged: false, notDelivered: false, invoiceNotBack: false });
  const { data, isLoading, isError, refetch } = useDeliveries(range);

  const items = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => filterDeliveryItems(items, { search, ...chips }), [items, search, chips]);

  const selectedRef = searchParams.get("invoice");
  const selectedNorm = normalizeInvoiceRef(selectedRef);
  const selectedItem = selectedNorm ? items.find((i) => i.invoiceRefNorm === selectedNorm && !i.duplicateInvoice) ?? null : null;
  const placeholder: DeliveryDetailData | undefined = selectedItem
    ? { delivery: selectedItem.delivery, po: selectedItem.po, poState: selectedItem.po ? "ok" : "missing", duplicatePos: 0 }
    : undefined;

  const select = (ref: string | null) => {
    setSearchParams(ref ? { invoice: ref } : {});
    if (ref && !isTablet) window.scrollTo({ top: 0 });
  };

  const handleExport = () => {
    const deliveries = items.filter((i) => i.delivery).map((i) => i.delivery!);
    if (deliveries.length === 0) {
      toast.info(t.deliveries.exportEmpty);
      return;
    }
    downloadCSV(buildDeliveryLogCsv(deliveries), deliveryLogFilename(range.from, range.to));
  };

  const fmtShort = (s: string) => toLocalDate(s).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const chipDefs: [keyof Chips, string][] = [
    ["notLogged", t.deliveries.filterNotLogged],
    ["notDelivered", t.deliveries.filterNotDelivered],
    ["invoiceNotBack", t.deliveries.filterInvoiceNotBack],
  ];

  const list = (
    <div className="min-w-0 space-y-3">
      {/* Date range + export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5 rounded-lg border bg-card px-2 h-10">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-primary" />
          <input
            type="date"
            aria-label={t.deliveries.from}
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
            className="w-[104px] bg-transparent text-xs font-semibold outline-none"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            aria-label={t.deliveries.to}
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
            className="w-[104px] bg-transparent text-xs font-semibold outline-none"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="h-10 gap-1.5 px-2.5 sm:px-3" title={t.deliveries.export}>
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">{t.deliveries.export}</span>
        </Button>
      </div>

      {/* Search + chips */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.deliveries.searchPlaceholder}
          className="h-10 pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chipDefs.map(([key, label]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={chips[key] ? "default" : "outline"}
            aria-pressed={chips[key]}
            onClick={() => setChips((c) => ({ ...c, [key]: !c[key] }))}
            className="h-8 rounded-full px-3 text-xs"
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t.deliveries.loading}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center text-sm text-muted-foreground">
            <p>{t.deliveries.loadError}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>{t.deliveries.retry}</Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.deliveries.empty}</p>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.deliveries.emptyFiltered}</p>
      ) : (
        <div className="space-y-2">
          {visible.map((it) => (
            <DeliveryRow
              key={it.key}
              item={it}
              selected={isTablet && it.invoiceRefNorm === selectedNorm}
              onSelect={() => select(it.invoiceRef)}
              fmtShort={fmtShort}
            />
          ))}
        </div>
      )}

      {data && data.hiddenNoInvoice > 0 && (
        <p className="text-xs text-muted-foreground">{t.deliveries.hiddenNoInvoice.replace("{n}", String(data.hiddenNoInvoice))}</p>
      )}
    </div>
  );

  const detail = selectedRef ? (
    <DeliveryDetail
      key={selectedNorm}
      invoiceRef={selectedRef}
      placeholder={placeholder}
      isAdmin={isAdmin}
      onBack={isTablet ? undefined : () => select(null)}
      onInvoiceRefChanged={(ref) => select(ref)}
    />
  ) : null;

  const titleBar = (
    <div className="mb-3 flex items-center gap-2">
      {/* No back arrow on tablet: the sidebar is the navigation there. */}
      {!isTablet && !selectedRef && (
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="h-9 w-9 shrink-0" aria-label={t.deliveries.back}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}
      <div className="min-w-0">
        <h1 className="font-display text-lg font-bold leading-tight">{t.deliveries.title}</h1>
        <p className="text-xs text-muted-foreground">{t.deliveries.subtitle}</p>
      </div>
    </div>
  );

  if (isTablet) {
    return (
      <div className="flex h-app overflow-hidden bg-background">
        <AppSidebar active="deliveries" pendingCount={pendingCount} isOnline={isOnline} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="px-6 py-6">
            {titleBar}
            <div className="flex gap-4">
              <div className="w-[340px] shrink-0">{list}</div>
              <div className="min-w-0 flex-1 border-l pl-4">
                {detail ?? <p className="py-8 text-center text-muted-foreground">{t.deliveries.pickDelivery}</p>}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl px-4 py-6 sm:px-6">
        {!selectedRef && titleBar}
        {detail ?? list}
      </main>
    </div>
  );
}

function DeliveryRow({
  item,
  selected,
  onSelect,
  fmtShort,
}: {
  item: DeliveryListItem;
  selected: boolean;
  onSelect: () => void;
  fmtShort: (s: string) => string;
}) {
  const { t } = useLanguage();
  const d = item.delivery;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full min-w-0 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50",
        selected && "border-primary bg-accent"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono font-semibold">{item.invoiceRef}</span>
        <DeliveryStatusChip status={d?.status ?? null} className="shrink-0" />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {customerLabel(item.buyerName, item.dcName)}
          {d?.driverName ? ` · ${d.driverName}` : ""}
        </span>
        <span className="shrink-0 tabular-nums">{fmtShort(item.deliveryDate)}</span>
      </div>
      {(d || item.poMissing || item.duplicateInvoice) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {d && (
            <Badge
              variant="outline"
              className={cn(
                "font-normal",
                d.invoiceReturnedAt
                  ? "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"
                  : item.flags.invoiceNotBack
                  ? "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300"
                  : "text-muted-foreground"
              )}
            >
              {t.deliveries.invoiceBack}: {d.invoiceReturnedAt ? fmtShort(d.invoiceReturnedAt) : "✗"}
            </Badge>
          )}
          {item.poMissing && <Badge variant="outline" className="border-amber-300 font-normal text-amber-800 dark:text-amber-300">{t.deliveries.poMissing}</Badge>}
          {item.duplicateInvoice && <Badge variant="outline" className="border-amber-300 font-normal text-amber-800 dark:text-amber-300">{t.deliveries.duplicateInvoice}</Badge>}
        </div>
      )}
    </button>
  );
}
