import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useDelivery, lineSaveErrorCode } from "@/hooks/useDelivery";
import { useDeliveryReturns } from "@/hooks/useDeliveryReturns";
import { useExpiryRules } from "@/hooks/useExpiryRules";
import { useItemTypes } from "@/hooks/useItemTypes";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { localToday } from "@/lib/buyerProfile";
import { buildLineViews, customerLabel, lineHasPhysicalReturn, NO_PHYSICAL_RETURN } from "@/lib/deliveryFlags";
import { formatDateId, RETURN_REASON_LABEL_ID } from "@/lib/deliveryExport";
import { expectedExpiry, resolveShelfLife } from "@/lib/expiryRules";
import { buildReturnLines, buildSkuEggMap, piecesPerUnit, returnErrorCode, type SkuEgg } from "@/lib/returnLines";
import { NEGERI_PIECES_PER_KG, nativeToPieces, remainingReturnable } from "@/lib/returnsCap";
import type { OutflowReturns } from "@/lib/returnsSummary";
import { returnCode } from "@/lib/activityGrouping";
import { cn } from "@/lib/utils";
import { RETURN_REASONS, type DeliveryLine, type DeliveryLineView, type DeliveryPo } from "@/types/deliveries";
import type { ReturnDisposition } from "@/types/returns";

// Four chips cover 105 of October's 117 item rows; "Lainnya…" opens the full list.
const CHIP_REASONS = ["pecah", "ditolak", "tukar_guling", "kurang"];

const parseNum = (raw: string): number => {
  const n = parseFloat((raw ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

interface SkuOption {
  code: string;
  packQty: number; // PO quantity in the SKU's own unit (boxes for a box SKU)
  egg: SkuEgg | undefined;
}

// §6.5: delivery lines on the faktur, store side + warehouse side, one explicit
// confirmed save per line that records the stock return through record_return.
// Online-only (no outbox). Nothing stock-side is stored on delivery_lines.
export function DeliveryReturnLines({ invoiceRef }: { invoiceRef: string }) {
  const { t } = useLanguage();
  const r = t.deliveries.retur;
  const { user } = useAuth();
  const { data, ensureDelivery, setClaimRefForDelivery } = useDelivery(invoiceRef);
  const { skus } = usePackSKUs();
  const { conversionMap, boxCapacityMap } = useItemTypes();
  const { data: rules = [] } = useExpiryRules();
  const eggOutflowIds = useMemo(() => data?.eggOutflowIds ?? [], [data?.eggOutflowIds]);
  const returns = useDeliveryReturns(eggOutflowIds);

  const po = data?.po ?? null;
  const livePo = data?.poState === "ok" ? po : null;
  const delivery = data?.delivery ?? null;
  const skuEggMap = useMemo(() => buildSkuEggMap(skus, boxCapacityMap), [skus, boxCapacityMap]);
  const unitByProduct = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const [p, c] of Object.entries(conversionMap)) m[p] = c.unit;
    return m;
  }, [conversionMap]);
  const views = useMemo(
    () => buildLineViews(data?.lines ?? [], po, returns.rows, unitByProduct, skuEggMap, eggOutflowIds),
    [data?.lines, po, returns.rows, unitByProduct, skuEggMap, eggOutflowIds]
  );

  // Unsaved lines added with "Tambah baris retur"; dropped once the server row exists.
  const [drafts, setDrafts] = useState<DeliveryLine[]>([]);
  const savedIds = new Set(views.map((v) => v.id));
  const pendingDrafts = drafts.filter((d) => !savedIds.has(d.id));
  const allLines: DeliveryLine[] = [...views, ...pendingDrafts];

  // PO pack-SKU lines, one option per SKU (quantities summed). Loose eggs are not offered.
  const skuOptions: SkuOption[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of po?.orderLines ?? []) if (l.skuCode) m.set(l.skuCode, (m.get(l.skuCode) ?? 0) + (l.packQty ?? 0));
    return [...m].map(([code, packQty]) => ({ code, packQty, egg: skuEggMap[code] }));
  }, [po, skuEggMap]);

  // Faktur-level No. Retur OSV: the value every line shares, else blank. Not stored.
  const refs = new Set(allLines.map((l) => (l.claimRef ?? "").trim()));
  const sharedRef = refs.size === 1 ? [...refs][0] : "";
  const [fakturRef, setFakturRef] = useState("");
  useEffect(() => setFakturRef(sharedRef), [sharedRef]);

  const [picking, setPicking] = useState(false);
  const addDraft = (opt: SkuOption, unit: "pak" | "box") => {
    const ppu = opt.egg ? piecesPerUnit(opt.egg, unit) : null;
    if (!ppu) return;
    const base = opt.egg?.basePackCode ?? opt.code;
    const rule = resolveShelfLife(rules, customerLabel(po?.buyerName, po?.dcName), base);
    const hasPhysical = allLines.some((l) => l.skuCode === opt.code && lineHasPhysicalReturn(l));
    const used = new Set(allLines.filter((l) => l.skuCode === opt.code).map((l) => l.reason));
    const reason = (hasPhysical ? [...NO_PHYSICAL_RETURN] : ["pecah"]).find((x) => !used.has(x)) ?? "";
    setDrafts((ds) => [
      ...ds,
      {
        id: newId(),
        deliveryId: delivery?.id ?? "",
        skuCode: opt.code,
        unitLabel: unit,
        piecesPerUnit: ppu,
        quantity: 0,
        reason,
        note: null,
        claimRef: fakturRef.trim() || null,
        claimRefNorm: null,
        expectedExpiry: po ? expectedExpiry(po.outflowDate, rule) : null,
        source: "app",
        createdBy: null,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    setPicking(false);
  };

  const applyRefToAll = async () => {
    const ref = fakturRef.trim();
    if (!ref || !delivery) return;
    setDrafts((ds) => ds.map((d) => (d.claimRef ? d : { ...d, claimRef: ref })));
    try {
      await setClaimRefForDelivery.mutateAsync({ deliveryId: delivery.id, claimRef: ref });
      toast.success(r.saved);
    } catch (e) {
      toast.error((e as { message?: string })?.message || r.errOther);
    }
  };

  if (!data) return null;
  const voided = data.poState === "voided";
  const full = delivery?.status === "terkirim" && !allLines.some((l) => l.quantity > 0);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{r.section}</h3>
          {full && <Badge variant="outline" className="border-emerald-200 font-normal text-emerald-700 dark:text-emerald-300">{r.fullReceived}</Badge>}
        </div>

        {!voided && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="faktur-claim-ref" className="text-xs font-semibold text-muted-foreground">{r.fakturClaimRef}</Label>
              <Input id="faktur-claim-ref" className="h-11" value={fakturRef} onChange={(e) => setFakturRef(e.target.value)} />
            </div>
            <Button type="button" variant="outline" className="h-11" disabled={!fakturRef.trim() || !delivery} onClick={applyRefToAll}>
              {r.applyToAll}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {allLines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              view={views.find((v) => v.id === line.id) ?? null}
              po={po}
              livePo={livePo}
              poBlock={
                data.poState !== "ok"
                  ? r.poInactive
                  : data.duplicatePos > 0
                  ? r.duplicatePo.replace("{n}", String(data.duplicatePos + 1))
                  : null
              }
              readOnly={voided}
              skuOption={skuOptions.find((o) => o.code === line.skuCode)}
              egg={skuEggMap[line.skuCode]}
              eggPerUnit={conversionMap}
              unitByProduct={unitByProduct}
              summary={returns.summary}
              siblings={allLines.filter((l) => l.skuCode === line.skuCode && l.id !== line.id)}
              invoiceRef={invoiceRef}
              ensureDelivery={() => (livePo ? ensureDelivery(livePo, user?.email ?? null) : Promise.resolve(delivery?.id ?? ""))}
              onDiscard={() => setDrafts((ds) => ds.filter((d) => d.id !== line.id))}
              record={returns.record}
            />
          ))}
        </div>

        {livePo && !voided && (
          picking ? (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold text-muted-foreground">{r.pickSku}</p>
              {skuOptions.length === 0 && <p className="text-sm text-muted-foreground">{r.noSkuLeft}</p>}
              {skuOptions.map((opt) => {
                const box = opt.egg ? piecesPerUnit(opt.egg, "box") : null;
                const pak = opt.egg ? piecesPerUnit(opt.egg, "pak") : null;
                const isBox = !!opt.egg?.isBoxMode;
                const sku = skus.find((s) => s.code === opt.code);
                const unitWord = sku?.unitLabel === "box" ? r.unitBox : r.unitPak;
                const perPoUnit = isBox ? box : pak;
                const used = new Set(allLines.filter((l) => l.skuCode === opt.code).map((l) => l.reason));
                if (used.size >= RETURN_REASONS.length) return null;
                return (
                  <div key={opt.code} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 font-mono">
                      {r.skuOption
                        .replace("{code}", opt.code)
                        .replace("{qty}", String(opt.packQty))
                        .replace("{unit}", unitWord)
                        .replace("{pieces}", perPoUnit ? (opt.packQty * perPoUnit).toLocaleString("id-ID") : "?")}
                    </span>
                    {isBox ? (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={!box} onClick={() => addDraft(opt, "box")}>{r.unitBox}</Button>
                        <Button type="button" size="sm" variant="outline" disabled={!pak} onClick={() => addDraft(opt, "pak")}>{r.unitPak}</Button>
                        {!box && <span className="w-full text-xs text-amber-700 dark:text-amber-400">{r.boxNoCapacity}</span>}
                      </>
                    ) : (
                      <Button type="button" size="sm" variant="outline" disabled={!pak} onClick={() => addDraft(opt, sku?.unitLabel === "box" ? "box" : "pak")}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
              <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>{t.common.cancel}</Button>
            </div>
          ) : (
            <Button type="button" variant="outline" className="h-11 w-full gap-2" onClick={() => setPicking(true)}>
              <Plus className="h-4 w-4" />
              {r.addLine}
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}

interface LineRowProps {
  line: DeliveryLine;
  view: DeliveryLineView | null; // null while unsaved
  po: DeliveryPo | null;
  livePo: DeliveryPo | null;
  poBlock: string | null; // why no warehouse save is possible for the whole faktur
  readOnly: boolean;
  skuOption: SkuOption | undefined; // undefined: the SKU is not on the live PO
  egg: SkuEgg | undefined;
  eggPerUnit: Record<string, { unit: string; eggs_per_unit: number }>;
  unitByProduct: Record<string, string | undefined>;
  summary: Record<string, OutflowReturns>;
  siblings: DeliveryLine[];
  invoiceRef: string;
  ensureDelivery: () => Promise<string>;
  onDiscard: () => void;
  record: ReturnType<typeof useDeliveryReturns>["record"];
}

function LineRow(props: LineRowProps) {
  const { line, view, po, livePo, poBlock, readOnly, skuOption, egg, eggPerUnit, unitByProduct, summary, siblings } = props;
  const { t, language } = useLanguage();
  const r = t.deliveries.retur;
  const locale = language === "id" ? "id-ID" : "en-US";
  const nf = (n: number) => n.toLocaleString(locale);
  const { upsertLine, deleteLine } = useDelivery(props.invoiceRef);
  const isDraft = !view;
  const priorReturns = view?.returns ?? null;

  // Store side.
  const [qty, setQty] = useState(line.quantity ? String(line.quantity) : "");
  const [reason, setReason] = useState(line.reason);
  const [note, setNote] = useState(line.note ?? "");
  const [claimRef, setClaimRef] = useState(line.claimRef ?? "");
  const [expiry, setExpiry] = useState(line.expectedExpiry ?? "");
  useEffect(() => {
    if (isDraft) return;
    setQty(line.quantity ? String(line.quantity) : "");
    setReason(line.reason);
    setNote(line.note ?? "");
    setClaimRef(line.claimRef ?? "");
    setExpiry(line.expectedExpiry ?? "");
  }, [line.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warehouse side.
  const [returnDate, setReturnDate] = useState(localToday());
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [pecah, setPecah] = useState("");
  const [disp, setDisp] = useState<"retakan" | "writeoff">("retakan");
  const [secondReturn, setSecondReturn] = useState(false);
  const [frozen, setFrozen] = useState(false); // after a NETWORK failure: ids pinned, inputs frozen
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Return-entry ids for this save attempt (§6.5.5): fresh after every success,
  // void or change of the SKU's stored returns, pinned while frozen.
  const idsRef = useRef<Record<ReturnDisposition, string> | null>(null);
  const returnsSig = priorReturns ? `${priorReturns.okPieces}/${priorReturns.pecahPieces}` : "";
  useEffect(() => {
    if (!frozen) idsRef.current = null;
  }, [returnsSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const quantity = parseNum(qty);
  const linePieces = quantity * line.piecesPerUnit;
  const physical = lineHasPhysicalReturn({ reason });
  const priorSkuPieces = priorReturns ? priorReturns.okPieces + priorReturns.pecahPieces : 0;
  const locked = !!priorReturns && !secondReturn;
  const receivedDefault = Math.max(0, linePieces - priorSkuPieces);
  const receivedValue = receivedTouched ? received : String(receivedDefault);
  const receivedN = parseNum(receivedValue);
  const pecahN = parseNum(pecah);
  const warehouseFilled = physical && pecah.trim() !== "" && !locked;
  const okN = receivedN - pecahN;

  // The egg outflow row this SKU's eggs came off, and its cap (§6.2.4, §6.5.3).
  const eggProduct = egg?.eggProduct ?? "";
  const eggEntry = (po?.eggTotals ?? []).find((e) => e.product === eggProduct) ?? null;
  const outflowId = eggEntry?.outflowId ?? null;
  const eggUnit = unitByProduct[eggProduct];
  const priorNative = outflowId ? summary[outflowId]?.total ?? 0 : 0;
  const remainingNative = remainingReturnable(eggEntry?.quantity ?? 0, priorNative);
  const capPieces = eggUnit === "kg" ? Math.floor(remainingNative * NEGERI_PIECES_PER_KG) : remainingNative;
  const priorEggPieces = nativeToPieces(priorNative, eggUnit);
  const soldPieces = skuOption && egg ? skuOption.packQty * ((egg.isBoxMode ? egg.piecesPerBox : egg.piecesPerPak) ?? 0) : 0;
  const unitWord = line.unitLabel === "box" ? r.unitBox : r.unitPak;
  const factor = eggPerUnit[eggProduct]?.eggs_per_unit;

  // Reasons this line may take: one physical-return line per SKU; reasons used
  // on the SKU's other lines are not offered; a line with returns stays physical.
  const siblingHasPhysical = siblings.some((s) => lineHasPhysicalReturn(s));
  const usedBySiblings = new Set(siblings.map((s) => s.reason));
  const allowedReasons = RETURN_REASONS.filter(
    (x) =>
      !usedBySiblings.has(x) &&
      (!siblingHasPhysical || NO_PHYSICAL_RETURN.has(x)) &&
      (!priorReturns || !NO_PHYSICAL_RETURN.has(x))
  );

  const block: string | null = (() => {
    if (!warehouseFilled) return null;
    if (!reason) return r.noReason;
    if (quantity <= 0) return r.qtyZero;
    if (poBlock) return poBlock;
    if (!skuOption) return r.poNotMatch;
    if (!outflowId) return r.noOutflow;
    if (typeof navigator !== "undefined" && !navigator.onLine && !frozen) return r.offline;
    if (!Number.isInteger(receivedN) || !Number.isInteger(pecahN)) return r.notInteger;
    if (receivedN < 1) return r.receivedMin;
    if (pecahN > receivedN) return r.pecahOverReceived;
    if (receivedN + priorSkuPieces > linePieces)
      return r.overLine.replace("{qty}", nf(quantity)).replace("{unit}", unitWord).replace("{pieces}", nf(linePieces));
    if (receivedN > capPieces) return r.overSold.replace("{egg}", eggProduct).replace("{n}", nf(capPieces));
    return null;
  })();

  const piecesEq = r.piecesEq
    .replace("{qty}", nf(quantity))
    .replace("{unit}", unitWord)
    .replace("{ppu}", nf(line.piecesPerUnit))
    .replace("{pieces}", nf(linePieces));
  const dispLabel = disp === "retakan" ? r.dispShortRetakan : r.dispShortHancur;
  const otherSku = Math.max(0, priorEggPieces - priorSkuPieces);
  const confirmText = r.confirmBody
    .replace("{qty}", nf(quantity))
    .replace("{unit}", unitWord)
    .replace("{ppu}", nf(line.piecesPerUnit))
    .replace("{pieces}", nf(linePieces))
    .replace("{received}", nf(receivedN))
    .replace("{pecah}", nf(pecahN))
    .replace("{disp}", dispLabel)
    .replace("{ok}", nf(okN))
    .replace("{sold}", nf(soldPieces))
    .replace("{prior}", nf(priorEggPieces))
    .replace("{other}", otherSku > 0 ? r.confirmOther.replace("{n}", nf(otherSku)) : "")
    .replace("{date}", formatDateId(returnDate));

  const errorMessage = (code: string, message?: string): string => {
    const remaining = nf(nativeToPieces(remainingNative, eggUnit));
    switch (code) {
      case "RETURN_EXCEEDS_OUTFLOW":
        return r.errExceeds.replace("{sku}", line.skuCode).replace("{n}", remaining).replace("{m}", nf(priorEggPieces));
      case "RESTOCK_EXCEEDS_DEDUCTED":
        return r.errRestockExceeds.replace("{sku}", line.skuCode);
      case "RESTOCK_UNALLOCATED":
        return r.errUnallocated;
      case "OUTFLOW_VOIDED":
        return r.errOutflowVoided;
      case "PARENT_TYPE_MISSING":
        return r.errParentMissing.replace("{egg}", eggProduct);
      case "PRIOR_MISMATCH":
        return r.errPriorMismatch.replace("{sku}", line.skuCode);
      case "INVALID_ENTRY":
        return r.errInvalid;
      case "AUTH_REQUIRED":
        return r.errAuth;
      case "NO_ENTRIES":
        return r.errNoEntries;
      case "DEADLOCK":
        return r.errDeadlock;
      default:
        return message || r.errOther;
    }
  };

  // §6.5.5: deliveries row (if none) -> delivery line -> record_return.
  const save = async (withStock: boolean) => {
    setBusy(true);
    try {
      if (!frozen) {
        try {
          const deliveryId = line.deliveryId || (await props.ensureDelivery());
          await upsertLine.mutateAsync({
            id: line.id,
            deliveryId,
            skuCode: line.skuCode,
            unitLabel: line.unitLabel,
            piecesPerUnit: line.piecesPerUnit,
            quantity,
            reason,
            note: note.trim() || null,
            claimRef: claimRef.trim() || null,
            expectedExpiry: expiry || null,
          });
        } catch (e) {
          const dup = lineSaveErrorCode(e);
          const label = RETURN_REASON_LABEL_ID[reason] ?? reason;
          toast.error(
            dup === "DUPLICATE_PHYSICAL_LINE"
              ? r.dupPhysical.replace("{sku}", line.skuCode)
              : dup === "DUPLICATE_LINE"
              ? r.dupLine.replace("{sku}", line.skuCode).replace("{reason}", label)
              : (e as { message?: string })?.message || r.errOther
          );
          return;
        }
        if (physical && reason !== "lebih" && soldPieces > 0 && linePieces > soldPieces) {
          toast.warning(r.storeOverSold.replace("{pieces}", nf(linePieces)).replace("{sold}", nf(soldPieces)));
        }
      }
      if (!withStock) {
        toast.success(r.saved);
        return;
      }
      if (!idsRef.current) idsRef.current = { restock: newId(), retakan: newId(), writeoff: newId() };
      const ids = idsRef.current;
      const built = buildReturnLines({
        rows: [
          {
            key: line.skuCode,
            skuCode: line.skuCode,
            eggProduct,
            inPieces: true,
            buckets: {
              restock: Math.max(0, okN),
              retakan: disp === "retakan" ? pecahN : 0,
              writeoff: disp === "writeoff" ? pecahN : 0,
            },
          },
        ],
        outflowIdByProduct: { [eggProduct]: outflowId },
        remainingNativeByProduct: { [eggProduct]: remainingNative },
        unitByProduct: { [eggProduct]: eggUnit },
        categoryByProduct: { [eggProduct]: "egg" },
        expectedPriorByProduct: { [eggProduct]: priorNative },
        ids: (_key, d) => ids[d],
      });
      if (!built.ok) {
        toast.error(r.overSold.replace("{egg}", eggProduct).replace("{n}", nf(capPieces)));
        return;
      }
      const res = await props.record({
        returnDate,
        buyerName: livePo?.buyerName,
        reason,
        lines: built.lines!,
      });
      if (res.ok) {
        const pieces = { restock: Math.max(0, okN), retakan: disp === "retakan" ? pecahN : 0, writeoff: disp === "writeoff" ? pecahN : 0 };
        toast.success(r.recorded.replace("{pieces}", nf(receivedN)).replace("{code}", returnCode({ ...pieces, total: receivedN })));
        idsRef.current = null;
        setFrozen(false);
        setSecondReturn(false);
        setPecah("");
        setReceived("");
        setReceivedTouched(false);
        setConfirmOpen(false);
      } else if (res.kind === "network") {
        setFrozen(true);
        setConfirmOpen(false);
        toast.error(r.frozen);
      } else {
        setFrozen(false);
        idsRef.current = null;
        setConfirmOpen(false);
        toast.error(errorMessage(returnErrorCode(res), res.message));
      }
    } finally {
      setBusy(false);
    }
  };

  const onSimpan = () => (warehouseFilled ? setConfirmOpen(true) : void save(false));
  // Frozen after a network failure: "Coba lagi" resends only the RPC, so the store side is frozen too.
  const disabledAll = readOnly || busy || frozen;
  const fieldLabel = "text-xs font-semibold text-muted-foreground";
  const warehouseDisabled = disabledAll || locked || frozen;

  return (
    <div className={cn("rounded-lg border border-l-[3px] bg-card p-3 space-y-3", physical && !priorReturns && !isDraft ? "border-l-orange-500" : "border-l-border")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono font-semibold">{line.skuCode}</span>
          {skuOption && (
            <span className="ml-2 text-xs text-muted-foreground">
              {r.sentQty.replace("{qty}", nf(skuOption.packQty)).replace("{unit}", unitWord)}
              {soldPieces ? ` (${nf(soldPieces)} butir)` : ""}
            </span>
          )}
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={r.delete}
            onClick={() => (isDraft ? props.onDiscard() : setDeleteOpen(true))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {!skuOption && po && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {r.poNotMatch}
        </p>
      )}

      {/* Store side */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`qty-${line.id}`} className={fieldLabel}>{r.qty} ({unitWord})</Label>
          <Input
            id={`qty-${line.id}`}
            inputMode="decimal"
            className="h-11"
            value={qty}
            disabled={disabledAll}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9.,]/g, ""))}
          />
          {quantity > 0 && <p className="text-xs tabular-nums text-muted-foreground">{piecesEq}</p>}
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className={fieldLabel}>{r.reason}</Label>
          <div className="flex flex-wrap gap-1.5">
            {CHIP_REASONS.filter((x) => allowedReasons.includes(x as (typeof RETURN_REASONS)[number]) || x === reason).map((x) => (
              <Button
                key={x}
                type="button"
                size="sm"
                variant={reason === x ? "default" : "outline"}
                aria-pressed={reason === x}
                disabled={disabledAll || !!priorReturns && NO_PHYSICAL_RETURN.has(x)}
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setReason(x)}
              >
                {RETURN_REASON_LABEL_ID[x]}
              </Button>
            ))}
            <Select value={CHIP_REASONS.includes(reason) ? "" : reason} onValueChange={setReason} disabled={disabledAll}>
              <SelectTrigger className="h-8 w-auto rounded-full px-3 text-xs" aria-label={r.reasonMore}>
                <SelectValue placeholder={r.reasonMore} />
              </SelectTrigger>
              <SelectContent>
                {allowedReasons.map((x) => (
                  <SelectItem key={x} value={x}>{RETURN_REASON_LABEL_ID[x]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`note-${line.id}`} className={fieldLabel}>{r.note}</Label>
          <Input id={`note-${line.id}`} className="h-11" value={note} disabled={disabledAll} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`ref-${line.id}`} className={fieldLabel}>{r.claimRef}</Label>
            <Input id={`ref-${line.id}`} className="h-11" value={claimRef} disabled={disabledAll} onChange={(e) => setClaimRef(e.target.value)} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`exp-${line.id}`} className={fieldLabel}>{r.expiry}</Label>
            <Input id={`exp-${line.id}`} type="date" className="h-11" value={expiry} disabled={disabledAll} onChange={(e) => setExpiry(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Warehouse side */}
      <div className="space-y-2 border-t pt-3">
        <p className={fieldLabel}>{r.warehouse}</p>
        {!physical ? (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>{r.noPhysical}</p>
            {reason === "kurang" && <Hint text={r.hintKurang} />}
            {reason === "lebih" && <Hint text={r.hintLebih} />}
            {reason === "masih_ditanyakan" && <Badge variant="outline" className="font-normal">{r.unresolvedMarker}</Badge>}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {priorReturns
                ? r.priorReturned
                    .replace("{code}", returnCode({ restock: priorReturns.okPieces, retakan: nativeToPieces(priorReturns.retakanNative, eggUnit), writeoff: nativeToPieces(priorReturns.writeoffNative, eggUnit), total: priorSkuPieces }))
                    .replace("{date}", formatDateId(priorReturns.firstReturnDate))
                : r.priorNone}
            </p>
            {view?.mismatch && (
              <Hint
                text={r.mismatch
                  .replace("{pieces}", nf(priorSkuPieces))
                  .replace("{qty}", nf(line.quantity))
                  .replace("{unit}", unitWord)
                  .replace("{ppu}", nf(line.piecesPerUnit))}
              />
            )}
            {eggUnit === "kg" && factor != null && factor !== NEGERI_PIECES_PER_KG && (
              <Hint text={r.catalogFactor.replace("{f}", String(factor).replace(".", ","))} />
            )}
            {locked ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">{r.locked}</span>
                {!readOnly && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setSecondReturn(true)}>{r.secondReturn}</Button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`rdate-${line.id}`} className={fieldLabel}>{r.returnDate}</Label>
                  <Input
                    id={`rdate-${line.id}`}
                    type="date"
                    className="h-11"
                    value={returnDate}
                    min={po?.outflowDate}
                    max={localToday()}
                    disabled={warehouseDisabled}
                    onChange={(e) => e.target.value && setReturnDate(e.target.value)}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`recv-${line.id}`} className={fieldLabel}>{r.received}</Label>
                  <Input
                    id={`recv-${line.id}`}
                    inputMode="numeric"
                    className="h-11"
                    value={receivedValue}
                    disabled={warehouseDisabled}
                    onChange={(e) => {
                      setReceivedTouched(true);
                      setReceived(e.target.value.replace(/[^0-9.,]/g, ""));
                    }}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`pecah-${line.id}`} className={fieldLabel}>{r.pecah}</Label>
                  <Input
                    id={`pecah-${line.id}`}
                    inputMode="numeric"
                    className="h-11"
                    value={pecah}
                    disabled={warehouseDisabled}
                    onChange={(e) => setPecah(e.target.value.replace(/[^0-9.,]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && warehouseFilled && !block) {
                        e.preventDefault();
                        setConfirmOpen(true);
                      }
                    }}
                  />
                </div>
                <div className="min-w-0 space-y-1.5" role="radiogroup" aria-label={r.pecah}>
                  {(["retakan", "writeoff"] as const).map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={`disp-${line.id}`} checked={disp === d} disabled={warehouseDisabled} onChange={() => setDisp(d)} />
                      {d === "retakan" ? r.dispRetakan : r.dispHancur}
                    </label>
                  ))}
                </div>
                {pecah.trim() !== "" && (
                  <p className="text-xs tabular-nums text-muted-foreground sm:col-span-2">
                    {r.okLine.replace("{received}", nf(receivedN)).replace("{pecah}", nf(pecahN)).replace("{ok}", nf(okN))}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {block && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {block}
        </p>
      )}
      {frozen && <p className="text-xs text-destructive">{r.frozen}</p>}

      {!readOnly && (
        <div className="flex justify-end">
          <Button
            type="button"
            className="h-11 min-w-[96px]"
            disabled={busy || !reason || !!block}
            onClick={() => (frozen ? void save(true) : onSimpan())}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {frozen ? r.retry : r.save}
          </Button>
        </div>
      )}

      {/* §6.5.4 confirmation */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{r.confirmTitle}</DialogTitle>
            <DialogDescription className="tabular-nums">{confirmText}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(true);
            }}
          >
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>{t.common.cancel}</Button>
              <Button type="submit" autoFocus disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {r.confirmSave}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete (a line with returns warns: they stay as "retur tanpa baris") */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{r.deleteTitle}</DialogTitle>
            <DialogDescription>
              {r.deleteBody.replace("{sku}", line.skuCode).replace("{reason}", RETURN_REASON_LABEL_ID[line.reason] ?? line.reason)}
              {priorReturns ? ` ${r.deleteWithReturns}` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteLine.isPending}
              onClick={async () => {
                try {
                  await deleteLine.mutateAsync(line.id);
                  setDeleteOpen(false);
                } catch (e) {
                  toast.error((e as { message?: string })?.message || r.errOther);
                }
              }}
            >
              {r.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {text}
    </p>
  );
}
