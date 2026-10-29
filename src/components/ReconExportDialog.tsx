import { useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns";
import { FileSpreadsheet } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/hooks/use-toast";
import { captureError } from "@/lib/monitoring";
import { exportRekonsiliasi, type NumberFormat } from "@/lib/reconXlsx";

interface ReconExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

// Export Rekonsiliasi (spec §4): date range + presets, number format, void and
// RETAKAN toggles. The file itself is built from the v_recon_* views, never
// from the dashboard's in-memory stock.
export function ReconExportDialog({ open, onOpenChange }: ReconExportDialogProps) {
  const { t } = useLanguage();
  const [from, setFrom] = useState(() => ymd(startOfMonth(new Date())));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [numberFormat, setNumberFormat] = useState<NumberFormat>("id");
  const [includeVoid, setIncludeVoid] = useState(false);
  const [includeRetakan, setIncludeRetakan] = useState(true);
  const [busy, setBusy] = useState(false);

  const preset = (f: Date, u: Date) => { setFrom(ymd(f)); setTo(ymd(u)); };
  const valid = from !== "" && to !== "" && from <= to;

  const run = async () => {
    setBusy(true);
    try {
      const rows = await exportRekonsiliasi({ from, to, includeVoid, includeRetakan }, numberFormat);
      toast({ title: t.recon.done, description: `${rows} ${t.recon.rowsExported}` });
      onOpenChange(false);
    } catch (e) {
      captureError(e, { operation: "recon_export" });
      toast({ title: t.recon.failed, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const today = new Date();
  const lastMonth = subMonths(today, 1);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {t.recon.title}
          </DialogTitle>
          <DialogDescription>{t.recon.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="recon-from">{t.recon.from}</Label>
              <Input id="recon-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recon-to">{t.recon.to}</Label>
              <Input id="recon-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => preset(startOfMonth(today), today)}>{t.recon.thisMonth}</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => preset(startOfMonth(lastMonth), endOfMonth(lastMonth))}>{t.recon.lastMonth}</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => preset(subDays(today, 6), today)}>{t.recon.last7}</Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recon-format">{t.recon.numberFormat}</Label>
            <Select value={numberFormat} onValueChange={(v) => setNumberFormat(v as NumberFormat)}>
              <SelectTrigger id="recon-format"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="id">{t.recon.numberFormatId}</SelectItem>
                <SelectItem value="std">{t.recon.numberFormatStd}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeVoid} onCheckedChange={(c) => setIncludeVoid(c === true)} />
            {t.recon.includeVoid}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeRetakan} onCheckedChange={(c) => setIncludeRetakan(c === true)} />
            {t.recon.includeRetakan}
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t.common.cancel}</Button>
          <Button onClick={run} disabled={!valid || busy}>{busy ? t.recon.exporting : t.recon.export}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
