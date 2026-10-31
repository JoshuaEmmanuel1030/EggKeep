import { Link, useInRouterContext } from "react-router-dom";
import { Truck } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import type { DeliveryStatus } from "@/types/deliveries";

type T = ReturnType<typeof useLanguage>["t"];

// Status Kirim label (fixed Indonesian warehouse vocabulary in both locales).
export function deliveryStatusLabel(t: T, status: DeliveryStatus | null | undefined): string {
  switch (status) {
    case "belum_terkirim":
      return t.deliveries.statusBelumTerkirim;
    case "terkirim":
      return t.deliveries.statusTerkirim;
    case "ditolak":
      return t.deliveries.statusDitolak;
    case "batal":
      return t.deliveries.statusBatal;
    default:
      return t.deliveries.notLogged;
  }
}

// Chip colours: not logged = quiet, belum terkirim = amber, terkirim = green,
// ditolak / batal = red.
export function deliveryStatusTone(status: DeliveryStatus | null | undefined): string {
  switch (status) {
    case "terkirim":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "belum_terkirim":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
    case "ditolak":
    case "batal":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
    default:
      return "border-dashed text-muted-foreground";
  }
}

export const deliveryLink = (invoiceRef: string) => `/deliveries?invoice=${encodeURIComponent(invoiceRef.trim())}`;

interface DeliveryStatusChipProps {
  status: DeliveryStatus | null | undefined;
  // When set, the chip deep-links to that faktur on /deliveries.
  invoiceRef?: string;
  className?: string;
}

// Read-only delivery status chip for order cards and the deliveries list.
// Works outside a Router too (plain anchor), so feed tests need no router.
export function DeliveryStatusChip({ status, invoiceRef, className }: DeliveryStatusChipProps) {
  const { t } = useLanguage();
  const inRouter = useInRouterContext();
  const label = deliveryStatusLabel(t, status);
  const cls = cn(
    "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4",
    deliveryStatusTone(status),
    className
  );
  const body = (
    <>
      <Truck className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (!invoiceRef) return <span className={cls}>{body}</span>;
  const href = deliveryLink(invoiceRef);
  const title = `${t.deliveries.chipLabel} · ${invoiceRef}`;
  return inRouter ? (
    <Link to={href} className={cn(cls, "hover:opacity-80")} title={title} onClick={(e) => e.stopPropagation()}>
      {body}
    </Link>
  ) : (
    <a href={href} className={cn(cls, "hover:opacity-80")} title={title}>
      {body}
    </a>
  );
}
