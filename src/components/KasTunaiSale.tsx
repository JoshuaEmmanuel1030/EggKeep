import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertCircle, Check, ChevronDown, ChevronRight, ChevronsUpDown, ShoppingCart, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConversionMap, InflowEntry, OutflowEntry } from "@/types/inventory";
import { ActivityLog, ActivityLogMetadata } from "@/types/activityLog";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { loadOutbox } from "@/lib/outflowOutbox";
import { RadialAddButton, revealPickedRow, type RadialItem } from "./RadialAddButton";
import {
  buildKasEntries,
  eggRingItems,
  isBrokenKasLine,
  isValidKasLine,
  kasDateLabel,
  kasSaleSummary,
  kasStockQty,
  mergeKasSales,
  todaysKasSales,
  type KasLine,
  type KasSale,
} from "@/lib/kasTunai";

interface KasTunaiSaleProps {
  inflows: InflowEntry[];
  logs: ActivityLog[];
  onSubmit: (entries: OutflowEntry[], userEmail: string, metadata?: ActivityLogMetadata) => Promise<boolean>;
  onClose: () => void;
  // Lines with a product and qty > 0, for the rail's count pill.
  onValidCountChange: (n: number) => void;
}

const LABEL = "text-[13.5px] font-semibold text-ek-nav";
const INPUT =
  "h-12 rounded-[11px] border-ek-border bg-card px-3.5 text-base md:text-base placeholder:text-[#a89d90] focus-visible:border-amber-600 focus-visible:ring-[3px] focus-visible:ring-amber-600/15 focus-visible:ring-offset-0";
const INPUT_SM = "h-11 rounded-[10px] px-3 text-[15px] md:text-[15px]";

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyLine = (): KasLine => ({ id: crypto.randomUUID(), product: "", qty: "", inputUnit: "butir" });
// Picking a product (dropdown or radial): a non-kg product is always entered in butir.
const productPatch = (product: string, conversionMap: ConversionMap): Partial<KasLine> =>
  conversionMap[product]?.unit === "kg" ? { product } : { product, inputUnit: "butir" };

// Tablet Kas Tunai: a quick walk-in cash sale, eggs only. Stays mounted while
// the drawer is closed so a half-entered sale survives. Stock goes out through
// the same onSubmit path as every outflow (record_order_outflows RPC).
export function KasTunaiSale({ inflows, logs, onSubmit, onClose, onValidCountChange }: KasTunaiSaleProps) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  const { conversionMap, eggProductNames, itemTypes } = useItemTypes();
  // null = today, so a drawer left open past midnight still records "today".
  const [date, setDate] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<KasLine[]>(() => [emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [justRecorded, setJustRecorded] = useState<KasSale[]>([]);
  const dateRef = useRef<HTMLInputElement>(null);

  const availableByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inflows) {
      if (i.category === "egg" && i.remainingButir > 0) m.set(i.product, (m.get(i.product) ?? 0) + i.remainingButir);
    }
    return m;
  }, [inflows]);

  const validCount = lines.filter((l) => isValidKasLine(l, conversionMap)).length;
  const hasBrokenLine = lines.some((l) => isBrokenKasLine(l, conversionMap));
  useEffect(() => onValidCountChange(validCount), [validCount, onValidCountChange]);

  // The day is a dependency so a drawer left open past midnight drops
  // yesterday's sales on its next render, like the date header does.
  const max = today();
  const sales = useMemo(() => {
    const day = parseISO(max);
    return mergeKasSales(todaysKasSales(logs, day), justRecorded, day);
  }, [logs, justRecorded, max]);

  const updateLine = (id: string, patch: Partial<KasLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  // The form is never empty: removing the last line leaves a fresh one.
  const removeLine = (id: string) =>
    setLines((prev) => {
      const rest = prev.filter((l) => l.id !== id);
      return rest.length ? rest : [emptyLine()];
    });

  const radialEggs = useMemo(() => eggRingItems(eggProductNames, itemTypes), [itemTypes, eggProductNames]);

  // A radial pick fills the first line with no egg yet, else appends one; the
  // effect below focuses its Jumlah and flashes it once rendered.
  const bodyRef = useRef<HTMLDivElement>(null);
  const pickedLineId = useRef<string | null>(null);
  const pickEgg = ({ key }: RadialItem) => {
    const patch = productPatch(key, conversionMap);
    const empty = lines.find((l) => !l.product);
    const line = empty ?? emptyLine();
    pickedLineId.current = line.id;
    setLines((prev) => (empty ? prev.map((l) => (l.id === line.id ? { ...l, ...patch } : l)) : [...prev, { ...line, ...patch }]));
  };
  useEffect(() => {
    const id = pickedLineId.current;
    pickedLineId.current = null;
    const row = id && bodyRef.current?.querySelector<HTMLElement>(`[data-line-id="${id}"]`);
    if (row) revealPickedRow(row); // the card's only input: Jumlah
  }, [lines]);

  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  const handleSubmit = async () => {
    const saleDate = date ?? today();
    const recordedAt = new Date().toISOString();
    const entries = buildKasEntries(lines, saleDate, conversionMap, recordedAt);
    if (entries.length === 0 || hasBrokenLine || submitting) return;

    const saleId = crypto.randomUUID();
    const name = customerName.trim();
    const metadata: ActivityLogMetadata = {
      orderType: "manual",
      outflowDate: saleDate,
      saleId,
      ...(name ? { customerName: name } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };

    setSubmitting(true);
    const ok = await onSubmit(entries, user?.email || "", metadata);
    setSubmitting(false);

    // The toast store keeps one toast, so ours would replace the one already
    // shown: a rejection ("Stok Tidak Cukup: <egg>") toasts in the RPC hook,
    // and a sale queued offline toasts "saved offline" in Index, where
    // "dipotong dari stok" would be untrue.
    if (!ok) return;
    const queued = loadOutbox().some((o) => o.entries.some((e) => e.id === entries[0].id));

    setJustRecorded((prev) => [
      {
        saleId,
        recordedAt,
        customerName: name || undefined,
        lines: entries.map((e) => ({ product: e.product, quantity: e.quantityInButir })),
      },
      ...prev,
    ]);
    setDate(null);
    setCustomerName("");
    setNote("");
    setLines([emptyLine()]);
    if (!queued) toast({ title: t.kas.recorded, description: t.kas.recordedDesc.replace("{n}", String(entries.length)) });
  };

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-ek-border pb-3 pl-5 pr-3.5 pt-4">
        <h3 className="m-0 flex flex-1 items-center gap-2.5 font-display text-[19px] font-semibold tracking-normal text-ek-fg">
          <ShoppingCart aria-hidden className="h-5 w-5 shrink-0 text-amber-600" />
          <span className="flex flex-col leading-[1.15]">
            {t.kas.title}
            <small className="flex items-center gap-1 font-sans text-[13px] font-medium text-ek-mfg">
              {t.kas.subtitle} ·
              <span className="relative inline-flex">
                <button
                  type="button"
                  onClick={openPicker}
                  title={t.kas.changeDate}
                  className={cn(
                    "inline-flex items-center gap-0.5 whitespace-nowrap border-b border-dotted border-[#b8ab9a] leading-[1.2] hover:text-ek-fg",
                    date && "border-amber-500 text-amber-700"
                  )}
                >
                  {date ? kasDateLabel(date, locale) : t.kas.today}
                  <ChevronDown aria-hidden className="h-3 w-3 opacity-60" strokeWidth={2.4} />
                </button>
                <input
                  ref={dateRef}
                  type="date"
                  value={date ?? max}
                  max={max}
                  tabIndex={-1}
                  aria-label={t.common.date}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDate(v && v < max ? v : null);
                  }}
                  className="pointer-events-none absolute bottom-0 left-0 h-px w-px border-0 p-0 opacity-0"
                />
              </span>
              {date && (
                <button
                  type="button"
                  onClick={() => setDate(null)}
                  aria-label={t.kas.backToToday}
                  title={t.kas.backToToday}
                  className="ml-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-ek-mfg hover:bg-ek-muted hover:text-ek-fg"
                >
                  <X aria-hidden className="h-[11px] w-[11px]" strokeWidth={2.6} />
                </button>
              )}
            </small>
          </span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.kas.close}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] text-ek-nav hover:bg-ek-muted"
        >
          <ChevronRight aria-hidden className="h-5 w-5" />
        </button>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{t.kas.customerName}</span>
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={t.common.optional}
            className={INPUT}
          />
        </label>

        <div className={cn(LABEL, "mt-4")}>{t.kas.eggs}</div>
        {lines.map((line) => (
          <KasLineCard
            key={line.id}
            line={line}
            productOptions={eggProductNames}
            conversionMap={conversionMap}
            available={availableByProduct.get(line.product) ?? 0}
            locale={locale}
            onUpdate={(patch) => updateLine(line.id, patch)}
            onRemove={() => removeLine(line.id)}
          />
        ))}
        <RadialAddButton
          caption={t.kas.addEgg}
          items={radialEggs}
          banner={{ text: t.radial.pickEgg }}
          centerVerb={t.radial.add}
          onTap={() => setLines((prev) => [...prev, emptyLine()])}
          onPick={pickEgg}
        />

        <label className="mt-3.5 flex flex-col gap-1.5">
          <span className={LABEL}>{t.kas.note}</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.common.optional} className={INPUT} />
        </label>

        <div className="mt-5 border-t border-ek-border pt-1">
          <div className={cn(LABEL, "mt-4 flex items-baseline justify-between")}>
            {t.kas.todayList}
            <span className="text-[13px] font-medium text-ek-mfg">{t.kas.salesCount.replace("{n}", String(sales.length))}</span>
          </div>
          {sales.slice(0, 5).map((s) => (
            <div key={s.saleId} className="flex gap-3 border-b border-ek-border py-2.5 text-[13.5px] last:border-b-0">
              <span className="w-10 shrink-0 font-semibold tabular-nums text-ek-mfg">
                {format(parseISO(s.recordedAt), language === "id" ? "HH.mm" : "HH:mm")}
              </span>
              <span className="min-w-0 leading-[1.35] text-ek-mfg">
                <b className="block text-sm font-semibold text-ek-fg">{s.customerName || t.kas.noName}</b>
                {kasSaleSummary(s, conversionMap, locale)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-ek-border px-5 pb-4 pt-3">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={validCount === 0 || hasBrokenLine || submitting}
          className="h-[54px] w-full gap-2 rounded-[13px] bg-amber-600 text-base font-semibold text-white hover:bg-amber-700 disabled:opacity-[.45]"
        >
          <ShoppingCart aria-hidden className="h-[18px] w-[18px]" />
          {submitting ? t.outflow.recording : t.kas.submit}
        </Button>
      </div>
    </>
  );
}

interface KasLineCardProps {
  line: KasLine;
  productOptions: string[];
  conversionMap: ConversionMap;
  available: number; // native unit
  locale: string;
  onUpdate: (patch: Partial<KasLine>) => void;
  onRemove: () => void;
}

function KasLineCard({ line, productOptions, conversionMap, available, locale, onUpdate, onRemove }: KasLineCardProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  // Weight-sold eggs (catalog unit 'kg') get the Butir/Kg switch.
  const isKg = conversionMap[line.product]?.unit === "kg";
  const factor = conversionMap[line.product]?.eggs_per_unit || 0;
  const stockQty = kasStockQty(line, conversionMap); // native unit
  const stockUnit = isKg ? "kg" : "butir";
  const inputUnit = isKg && line.inputUnit === "kg" ? "kg" : "butir";
  // Warn only: the RPC is the stock authority, and a walk-in sale shouldn't
  // be blocked by a stale count.
  const over = !!line.product && stockQty > available + 1e-9;
  // Flag the number only once an egg is picked (typing qty first is normal).
  const broken = !!line.product && isBrokenKasLine(line, conversionMap);
  const nf = (n: number) => n.toLocaleString(locale);

  return (
    // data-line-id: the sale finds a radial-picked card by it to focus and flash it.
    <div data-line-id={line.id} className="mt-2.5 flex flex-col gap-2.5 rounded-xl border border-ek-border bg-card px-3 pb-3 pt-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_112px_auto] items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={LABEL}>{t.outflow.eggType}</span>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                aria-label={t.outflow.eggType}
                className={cn(
                  INPUT,
                  INPUT_SM,
                  "w-full justify-between gap-2 font-semibold text-ek-fg hover:bg-card",
                  !line.product && "font-normal text-[#a89d90]"
                )}
              >
                <span className="min-w-0 truncate">{line.product || t.common.selectDots}</span>
                <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-ek-mfg" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[270px] overflow-hidden rounded-[14px] border-ek-border p-0 shadow-[0_14px_36px_rgba(0,0,0,.16)]"
              align="start"
            >
              <Command>
                <CommandInput placeholder={t.common.searchDots} className="text-[15px]" />
                <CommandList className="max-h-[264px] p-1.5">
                  <CommandEmpty>{t.common.noResultsFound}</CommandEmpty>
                  <CommandGroup className="p-0">
                    {productOptions.map((option) => (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => {
                          onUpdate(productPatch(option, conversionMap));
                          setOpen(false);
                        }}
                        className="min-h-[44px] gap-2 rounded-[9px] px-2.5 text-[15px]"
                      >
                        <Check
                          aria-hidden
                          className={cn("h-4 w-4 shrink-0 text-amber-700", line.product === option ? "opacity-100" : "opacity-0")}
                        />
                        {option}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{t.common.quantity}</span>
          <span className="relative">
            <Input
              type="text"
              inputMode="decimal"
              value={line.qty}
              onChange={(e) => onUpdate({ qty: e.target.value })}
              aria-label={`${t.common.quantity} (${inputUnit})`}
              aria-invalid={broken || undefined}
              placeholder="0"
              className={cn(
                INPUT,
                INPUT_SM,
                "pr-[52px] font-semibold tabular-nums",
                over && "border-amber-500",
                broken && "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/15"
              )}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13.5px] text-ek-mfg">
              {inputUnit}
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={onRemove}
          aria-label={t.activity.removeLine}
          className="flex h-9 w-9 items-center justify-center rounded-[11px] text-red-600 hover:bg-red-50"
        >
          <Trash2 aria-hidden className="h-4 w-4" />
        </button>
      </div>

      {isKg && (
        <div className="flex items-center gap-2.5 text-[13px] font-semibold text-ek-mfg">
          <span className={cn(inputUnit === "butir" && "text-amber-700")}>Butir</span>
          <Switch
            checked={inputUnit === "kg"}
            onCheckedChange={(checked) => onUpdate({ inputUnit: checked ? "kg" : "butir" })}
            aria-label={`${t.outflow.butirPcs} / ${t.outflow.kilogram}`}
            className="h-[26px] w-11 data-[state=checked]:bg-amber-600 data-[state=unchecked]:bg-[#d9cfbf]"
          />
          <span className={cn(inputUnit === "kg" && "text-amber-700")}>Kg</span>
          {line.qty && (
            <small className="ml-1 text-[13px] font-medium">
              {inputUnit === "kg"
                ? `≈ ${nf(Math.round(stockQty * factor))} butir`
                : `≈ ${nf(stockQty)} kg`}
            </small>
          )}
        </div>
      )}

      {line.product && (
        <div className={cn("text-[13px] text-ek-mfg", over && "text-amber-700")}>
          {over && (
            <>
              <AlertCircle aria-hidden className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              {t.outflow.exceedsStock} {nf(Math.round((stockQty - available) * 100) / 100)} {stockUnit} ·{" "}
            </>
          )}
          {t.common.available}: <b className="font-semibold text-ek-fg">{nf(available)}</b> {stockUnit}
        </div>
      )}
    </div>
  );
}
