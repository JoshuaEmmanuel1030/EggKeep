import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Info, Loader2, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useDelivery, isDuplicateInvoiceError, type DeliveryDetailData, type DeliveryPatch } from "@/hooks/useDelivery";
import { useDrivers } from "@/hooks/useDrivers";
import { localToday, toLocalDate } from "@/lib/buyerProfile";
import { STATUS_NEEDS_NOTE, customerLabel } from "@/lib/deliveryFlags";
import { DELIVERY_STATUSES, type DeliveryStatus, type Driver } from "@/types/deliveries";
import { DeliveryStatusChip, deliveryStatusLabel } from "./DeliveryStatusChip";
import { DriverDialog } from "./DriverDialog";

const NO_DRIVER = "__none__";

interface DeliveryDetailProps {
  invoiceRef: string;
  placeholder?: DeliveryDetailData; // the list row, shown while the detail loads
  isAdmin: boolean;
  onBack?: () => void; // phone / portrait only
  onInvoiceRefChanged?: (ref: string) => void;
}

// Phase 1 sections: Pengiriman (driver / status / PIC / notes over a read-only
// PO header) and Faktur balik. Opening writes nothing: the first edit creates
// the deliveries row, later edits update it. Selects save on change, text
// fields on blur. While the PO is live its buyer, DC and date are shown and
// copied into the row's snapshot on every save.
export function DeliveryDetail({ invoiceRef, placeholder, isAdmin, onBack, onInvoiceRefChanged }: DeliveryDetailProps) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const email = user?.email ?? null;
  const { data, isLoading, isError, refetch, save } = useDelivery(invoiceRef, placeholder);
  const { drivers, activeDrivers } = useDrivers();
  const locale = language === "id" ? "id-ID" : "en-US";

  const delivery = data?.delivery ?? null;
  const po = data?.po ?? null;
  const livePo = data?.poState === "ok" ? po : null;
  // Live PO fields first; the snapshot only once the PO is gone.
  const buyerName = po?.buyerName ?? delivery?.buyerName ?? "";
  const dcName = po ? po.dcName : delivery?.dcName ?? null;
  const deliveryDate = po?.outflowDate ?? delivery?.deliveryDate ?? "";
  // A PO can be logged; an orphan delivery can still be edited.
  const canEdit = !!delivery || !!livePo;
  const status: DeliveryStatus = delivery?.status ?? "belum_terkirim";

  // Text fields edit locally and save on blur. Defaults for a PO not yet logged.
  const [pic, setPic] = useState("");
  const [notes, setNotes] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  useEffect(() => {
    setPic(delivery ? delivery.pic ?? "" : email ?? "");
    setNotes(delivery?.notes ?? "");
    setCheckedBy(delivery?.invoiceCheckedBy ?? "");
  }, [delivery?.id, delivery?.updatedAt, email]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (patch: DeliveryPatch, successMessage?: string): Promise<boolean> => {
    if (!canEdit) return false;
    try {
      await save.mutateAsync({ existing: delivery, po: livePo, patch, savedBy: email });
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (e) {
      toast.error(
        isDuplicateInvoiceError(e) ? t.deliveries.invoiceInUse : (e as { message?: string } | null)?.message || t.deliveries.saveError
      );
      return false;
    }
  };

  // Status: ditolak / batal ask for a note first (it replaces the old note).
  const [noteDialog, setNoteDialog] = useState<{ status: DeliveryStatus; note: string } | null>(null);
  const handleStatus = (next: DeliveryStatus) => {
    if (next === status) return;
    if (STATUS_NEEDS_NOTE.has(next)) setNoteDialog({ status: next, note: delivery?.notes ?? "" });
    else void persist({ status: next });
  };
  const confirmNote = async () => {
    if (!noteDialog || !noteDialog.note.trim()) return;
    const ok = await persist({ status: noteDialog.status, notes: noteDialog.note.trim() });
    if (ok) setNoteDialog(null);
  };

  // Driver: active drivers, plus the one currently set even when retired.
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const driverOptions: Driver[] = [...activeDrivers];
  const current = delivery?.driverId ? drivers.find((d) => d.id === delivery.driverId) : undefined;
  if (current && !current.isActive) driverOptions.push(current);
  const handleDriver = (value: string) => {
    if (value === NO_DRIVER) void persist({ driverId: null, driverName: null });
    else {
      const d = drivers.find((x) => x.id === value);
      if (d) void persist({ driverId: d.id, driverName: d.name });
    }
  };

  // Faktur balik.
  const markInvoiceBack = () => persist({ invoiceReturnedAt: localToday(), invoiceCheckedBy: email }, t.deliveries.saved);
  const clearInvoiceBack = () => persist({ invoiceReturnedAt: null, invoiceCheckedBy: null });

  // Ubah No. Faktur (delivery no longer matches a PO).
  const [refDraft, setRefDraft] = useState<string | null>(null);
  const saveRef = async () => {
    const next = (refDraft ?? "").trim();
    if (!next) return;
    const ok = await persist({ invoiceRef: next }, t.deliveries.saved);
    if (ok) {
      setRefDraft(null);
      onInvoiceRefChanged?.(next);
    }
  };

  const fmtDate = (s: string | null | undefined) =>
    s ? toLocalDate(s).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "";
  const fieldLabel = "text-xs font-semibold text-muted-foreground";
  const stockHint = status === "batal" ? t.deliveries.stockHintBatal : status === "ditolak" ? t.deliveries.stockHintDitolak : null;

  return (
    <div className="min-w-0 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        {onBack && (
          <Button variant="ghost" size="icon" aria-label={t.deliveries.back} onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-lg font-bold">{invoiceRef}</h2>
          <p className="truncate text-sm text-muted-foreground">
            {customerLabel(buyerName, dcName)}
            {deliveryDate ? ` · ${fmtDate(deliveryDate)}` : ""}
          </p>
        </div>
        <DeliveryStatusChip status={delivery?.status ?? null} className="shrink-0" />
      </div>

      {/* Edge-case banners (§8) */}
      {data && data.poState !== "ok" && delivery && (
        <Banner
          title={data.poState === "voided" ? t.deliveries.poVoided : t.deliveries.poMissing}
          help={data.poState === "voided" ? t.deliveries.poVoidedHelp : t.deliveries.poMissingHelp}
          action={
            data.poState === "missing" ? (
              <Button size="sm" variant="outline" onClick={() => setRefDraft(delivery.invoiceRef)}>
                {t.deliveries.changeInvoiceRef}
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.duplicatePos > 0 && <Banner title={t.deliveries.duplicateInvoice} help={t.deliveries.duplicateInvoiceHelp} />}

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError && !data ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center text-sm text-muted-foreground">
            <p>{t.deliveries.loadError}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>{t.deliveries.retry}</Button>
          </CardContent>
        </Card>
      ) : data && !po && !delivery ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {t.deliveries.notFound.replace("{ref}", invoiceRef)}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 1. Pengiriman */}
          <Card>
            <CardContent className="space-y-4 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t.deliveries.sectionShipment}</h3>

              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t.deliveries.customer}</dt>
                <dd className="min-w-0 break-words font-medium">{customerLabel(buyerName, dcName) || "—"}</dd>
                <dt className="text-muted-foreground">{t.deliveries.date}</dt>
                <dd className="tabular-nums">{fmtDate(deliveryDate) || "—"}</dd>
                <dt className="text-muted-foreground">{t.deliveries.invoiceRef}</dt>
                <dd className="min-w-0 break-all font-mono">{invoiceRef}</dd>
              </dl>

              {po && po.orderLines.length > 0 && (
                <div>
                  <p className={fieldLabel}>{t.deliveries.orderLines}</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {po.orderLines.map((line, i) => (
                      <li key={i} className="flex min-w-0 items-center gap-2">
                        <Badge variant={line.skuCode ? "secondary" : "outline"} className="max-w-[60%] font-mono text-xs">
                          <span className="min-w-0 truncate">{line.skuCode ?? line.eggProduct}</span>
                        </Badge>
                        <span className="text-muted-foreground">×</span>
                        <span className="font-semibold tabular-nums">{line.skuCode ? line.packQty ?? "" : line.looseQty ?? ""}</span>
                        <span className="text-xs text-muted-foreground">{line.skuCode ? t.deliveries.packs : t.deliveries.loose}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!delivery && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t.deliveries.firstSaveHint}
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="delivery-driver" className={fieldLabel}>{t.deliveries.driver}</Label>
                  <div className="flex gap-1.5">
                    <Select value={delivery?.driverId ?? NO_DRIVER} onValueChange={handleDriver} disabled={!canEdit}>
                      <SelectTrigger id="delivery-driver" className="h-11 min-w-0 flex-1">
                        <SelectValue placeholder={t.deliveries.selectDriver} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_DRIVER}>{t.deliveries.noDriver}</SelectItem>
                        {driverOptions.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}{d.isActive ? "" : ` (${t.deliveries.inactive})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isAdmin && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 shrink-0"
                        aria-label={t.deliveries.addDriver}
                        title={t.deliveries.addDriver}
                        onClick={() => setDriverDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="delivery-status" className={fieldLabel}>{t.deliveries.status}</Label>
                  <Select value={status} onValueChange={(v) => handleStatus(v as DeliveryStatus)} disabled={!canEdit}>
                    <SelectTrigger id="delivery-status" className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DELIVERY_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{deliveryStatusLabel(t, s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {delivery && stockHint && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {stockHint}
                    </p>
                  )}
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="delivery-pic" className={fieldLabel}>{t.deliveries.pic}</Label>
                  <Input
                    id="delivery-pic"
                    className="h-11"
                    value={pic}
                    disabled={!canEdit}
                    onChange={(e) => setPic(e.target.value)}
                    onBlur={() => { if (pic.trim() !== (delivery?.pic ?? (delivery ? "" : email ?? ""))) void persist({ pic: pic.trim() || null }); }}
                  />
                </div>

                <div className="min-w-0 space-y-1.5 sm:col-span-2">
                  <Label htmlFor="delivery-notes" className={fieldLabel}>{t.deliveries.notes}</Label>
                  <Textarea
                    id="delivery-notes"
                    rows={2}
                    value={notes}
                    disabled={!canEdit}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => { if (notes.trim() !== (delivery?.notes ?? "")) void persist({ notes: notes.trim() || null }); }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Faktur balik */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t.deliveries.sectionInvoiceBack}</h3>
              {delivery?.invoiceReturnedAt ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="invoice-returned-at" className={fieldLabel}>{t.deliveries.invoiceReturnedAt}</Label>
                    <Input
                      id="invoice-returned-at"
                      type="date"
                      className="h-11"
                      value={delivery.invoiceReturnedAt}
                      max={localToday()}
                      onChange={(e) => { if (e.target.value) void persist({ invoiceReturnedAt: e.target.value }); }}
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="invoice-checked-by" className={fieldLabel}>{t.deliveries.checkedBy}</Label>
                    <Input
                      id="invoice-checked-by"
                      className="h-11"
                      value={checkedBy}
                      onChange={(e) => setCheckedBy(e.target.value)}
                      onBlur={() => { if (checkedBy.trim() !== (delivery.invoiceCheckedBy ?? "")) void persist({ invoiceCheckedBy: checkedBy.trim() || null }); }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={clearInvoiceBack}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t.deliveries.clearInvoiceBack}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">{t.deliveries.invoiceNotBackYet}</p>
                  <Button type="button" className="h-11 gap-2" onClick={markInvoiceBack} disabled={!canEdit || save.isPending}>
                    <Check className="h-4 w-4" />
                    {t.deliveries.markInvoiceBack}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Note required for ditolak / batal */}
      <Dialog open={!!noteDialog} onOpenChange={(open) => { if (!open) setNoteDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.deliveries.noteRequiredTitle}</DialogTitle>
            <DialogDescription>
              {t.deliveries.noteRequiredDesc.replace("{status}", noteDialog ? deliveryStatusLabel(t, noteDialog.status) : "")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            autoFocus
            value={noteDialog?.note ?? ""}
            placeholder={t.deliveries.notePlaceholder}
            onChange={(e) => setNoteDialog((d) => (d ? { ...d, note: e.target.value } : d))}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setNoteDialog(null)}>{t.common.cancel}</Button>
            <Button type="button" onClick={confirmNote} disabled={!noteDialog?.note.trim() || save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t.common.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ubah No. Faktur */}
      <Dialog open={refDraft !== null} onOpenChange={(open) => { if (!open) setRefDraft(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.deliveries.changeInvoiceRef}</DialogTitle>
            <DialogDescription>{t.deliveries.poMissingHelp}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void saveRef(); }} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-ref-edit">{t.deliveries.invoiceRef}</Label>
              <Input id="invoice-ref-edit" value={refDraft ?? ""} onChange={(e) => setRefDraft(e.target.value)} autoFocus />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRefDraft(null)}>{t.common.cancel}</Button>
              <Button type="submit" disabled={!(refDraft ?? "").trim() || save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t.common.save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DriverDialog
        open={driverDialogOpen}
        onOpenChange={setDriverDialogOpen}
        driver={null}
        onSaved={(d) => void persist({ driverId: d.id, driverName: d.name })}
      />
    </div>
  );
}

function Banner({ title, help, action }: { title: string; help: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-xs opacity-90">{help}</p>
      </div>
      {action}
    </div>
  );
}
