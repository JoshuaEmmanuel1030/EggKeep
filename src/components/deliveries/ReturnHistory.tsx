import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useDeliveryReturns, type SaveGroup } from "@/hooks/useDeliveryReturns";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useVoidEntry } from "@/hooks/useVoidEntry";
import { formatDateId, RETURN_REASON_LABEL_ID } from "@/lib/deliveryExport";
import { insufficientStockProduct, voidReturnErrorCode } from "@/lib/returnLines";
import { nativeToPieces } from "@/lib/returnsCap";
import { cn } from "@/lib/utils";
import type { DeliveryLine } from "@/types/deliveries";
import { ReturnCodeParts } from "@/components/GroupedActivityLog";

const wibDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const wibTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

// §6.5.7 "Riwayat retur": every return on the faktur's egg outflow rows (any
// sku_code, voided included), by save group, with "Batalkan retur ini".
export function ReturnHistory({ eggOutflowIds, lines, poVoided }: { eggOutflowIds: string[]; lines: DeliveryLine[]; poVoided: boolean }) {
  const { t, language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  const r = t.deliveries.retur;
  const { user } = useAuth();
  const { canEdit } = useVoidEntry();
  const { conversionMap } = useItemTypes();
  const { saveGroups, voidSaveGroup } = useDeliveryReturns(eggOutflowIds);
  const [target, setTarget] = useState<SaveGroup | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (eggOutflowIds.length === 0) return null;
  const skus = new Set(lines.map((l) => l.skuCode));
  const unitOf = (product: string) => conversionMap[product]?.unit;
  const who = (userId: string | null, email: string | null) => (userId && userId === user?.id ? r.you : email ?? "admin");

  const confirmVoid = async () => {
    if (!target) return;
    if (!reason.trim()) {
      toast.error(r.voidErrReason);
      return;
    }
    setBusy(true);
    try {
      const res = await voidSaveGroup(target.rows[0].id, reason.trim());
      if (res.ok) {
        toast.success(r.voidDone);
        setTarget(null);
        setReason("");
        return;
      }
      const code = voidReturnErrorCode(res);
      const msg: Record<string, string> = {
        INSUFFICIENT_STOCK: r.voidErrInsufficientStock.replace("{product}", insufficientStockProduct(res.message) ?? ""),
        NOT_ALLOWED: r.voidErrNotAllowed,
        VOID_WINDOW_CLOSED: r.voidErrWindowClosed,
        VOID_BLOCKED: r.voidErrBlocked,
        DEADLOCK: r.voidErrDeadlock,
        REASON_REQUIRED: r.voidErrReason,
        NETWORK: r.voidErrNetwork,
      };
      toast.error(msg[code] ?? res.message ?? r.voidErrOther);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{r.historyTitle}</h3>
        {saveGroups.length === 0 && <p className="text-sm text-muted-foreground">{r.historyEmpty}</p>}
        {saveGroups.map((g) => {
          const live = g.rows.filter((x) => !x.voided_at);
          const pieces = (disp: string) =>
            g.rows.filter((x) => x.disposition === disp).reduce((n, x) => n + nativeToPieces(Number(x.quantity), unitOf(x.product)), 0);
          const sum = { restock: pieces("restock"), retakan: pieces("retakan"), writeoff: pieces("writeoff"), total: 0 };
          sum.total = sum.restock + sum.retakan + sum.writeoff;
          return (
            <div key={g.key} className="rounded-lg border p-3 text-sm">
              <div className={cn("space-y-1", g.voided && "line-through opacity-70")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular-nums">
                    {formatDateId(g.returnDate)} · {wibTime(g.createdAt)} · {who(g.userId, g.userEmail)}
                  </span>
                  <span className="font-mono text-xs">{g.skuCode ?? "—"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{sum.total.toLocaleString(locale)} butir · <ReturnCodeParts returns={sum} /></span>
                  {g.reason && <span>{RETURN_REASON_LABEL_ID[g.reason] ?? g.reason}</span>}
                  {(!g.skuCode || !skus.has(g.skuCode)) && <span className="italic">{r.noLine}</span>}
                </div>
                {g.rows.map((x) => (
                  <p key={x.id} className="text-xs text-muted-foreground tabular-nums">
                    {x.disposition} {Number(x.quantity).toLocaleString(locale)} {unitOf(x.product) === "kg" ? "kg" : "butir"} {x.product}
                  </p>
                ))}
              </div>
              {g.rows
                .filter((x) => x.voided_at)
                .map((x) => (
                  <div key={x.id} className="mt-1 text-xs text-muted-foreground">
                    <p>
                      {r.voided}: {r.voidedBy
                        .replace("{who}", who(x.voided_by, x.voided_by === g.userId ? g.userEmail : null))
                        .replace("{when}", `${formatDateId(wibDate(x.voided_at!))} ${wibTime(x.voided_at!)}`)
                        .replace("{reason}", x.void_reason ?? "")}
                    </p>
                    {(x.disposition === "retakan" || (x.disposition === "restock" && !poVoided)) && (
                      <p>
                        {r.pulled
                          .replace("{date}", formatDateId(wibDate(x.voided_at!)))
                          .replace("{qty}", nativeToPieces(Number(x.quantity), unitOf(x.product)).toLocaleString(locale))
                          .replace("{product}", x.disposition === "retakan" ? `${x.product} (RETAKAN)` : x.product)}
                      </p>
                    )}
                  </div>
                ))}
              {live.length > 0 && canEdit(g.createdAt, g.userId) && (
                <Button type="button" size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setTarget(g)}>
                  <Undo2 className="h-3.5 w-3.5" />
                  {r.voidAction}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!target} onOpenChange={(open) => !open && !busy && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{r.voidTitle}</DialogTitle>
            <DialogDescription>{r.voidBody}</DialogDescription>
          </DialogHeader>
          <Input autoFocus placeholder={r.voidReason} aria-label={r.voidReason} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setTarget(null)}>{t.common.cancel}</Button>
            <Button type="button" variant="destructive" disabled={busy || !reason.trim()} onClick={confirmVoid}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {r.voidConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
