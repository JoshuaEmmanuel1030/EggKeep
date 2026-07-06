import { useState } from "react";
import { CloudOff, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { QueuedOutflowOrder } from "@/lib/outflowOutbox";

interface OutflowOutboxBannerProps {
  orders: QueuedOutflowOrder[];
  onDiscard: (id: string) => void;
  onRetry: (id: string) => void;
}

/**
 * Pending-sync indicator for the offline outflow outbox: a slim banner with the
 * queued-order count and a dialog to inspect queued orders and retry/discard a
 * failed one. Rendered only while the queue is non-empty.
 */
export function OutflowOutboxBanner({ orders, onDiscard, onRetry }: OutflowOutboxBannerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  if (orders.length === 0) return null;

  const hasFailed = orders.some((o) => o.status === "failed");

  return (
    <div
      className={`mb-4 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
        hasFailed
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {hasFailed ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : (
          <CloudOff className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">
          {orders.length} {t.outbox.pendingOrders}
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 shrink-0">
            {t.outbox.view}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.outbox.queuedOutflows}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {orders.map((order) => {
              const buyer =
                order.logs[0]?.metadata?.buyerName ||
                order.entries[0]?.invoiceSupplier ||
                "—";
              return (
                <div key={order.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{buyer}</span>
                    <Badge variant={order.status === "failed" ? "destructive" : "secondary"}>
                      {order.status === "failed" ? t.outbox.statusFailed : t.outbox.statusPending}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.outbox.queuedAt}: {new Date(order.queuedAt).toLocaleString()}
                  </p>
                  <ul className="text-xs space-y-0.5">
                    {order.entries.map((entry) => (
                      <li key={entry.id}>
                        {entry.product} × {entry.quantityInButir}
                      </li>
                    ))}
                  </ul>
                  {order.status === "failed" && (
                    <>
                      {order.failReason && (
                        <p className="text-xs text-destructive break-words">{order.failReason}</p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1"
                          onClick={() => onRetry(order.id)}
                        >
                          <RefreshCw className="h-3 w-3" />
                          {t.outbox.retry}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 gap-1"
                          onClick={() => {
                            if (window.confirm(t.outbox.discardConfirm)) {
                              onDiscard(order.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                          {t.outbox.discard}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
