import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { ActivityLog } from "@/types/activityLog";

interface VoidEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: ActivityLog | null;
  onConfirm: (reason: string) => Promise<void>;
  loading?: boolean;
}

export function VoidEntryDialog({
  open,
  onOpenChange,
  entry,
  onConfirm,
  loading = false,
}: VoidEntryDialogProps) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    await onConfirm(reason.trim());
    setReason("");
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setReason("");
    }
    onOpenChange(newOpen);
  };

  if (!entry) return null;

  const isInflow = entry.action_type === "inflow";
  const entryType = isInflow ? t.activity.inflows : t.activity.manualOutflows;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {t.activity.voidEntry}
          </DialogTitle>
          <DialogDescription>
            {t.activity.voidWarning}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Entry Summary */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <p className="text-sm font-medium">{entryType}</p>
            <p className="text-sm text-muted-foreground">
              {entry.product} • {entry.quantity_butir.toLocaleString()} {t.common.pcs}
            </p>
            {entry.metadata?.buyerName && (
              <p className="text-sm text-muted-foreground">
                {t.outflow.buyer}: {entry.metadata.buyerName}
              </p>
            )}
          </div>

          {/* Reason Input */}
          <div className="space-y-2">
            <Label htmlFor="void-reason">{t.activity.voidReason} *</Label>
            <Textarea
              id="void-reason"
              placeholder={t.activity.voidReasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!reason.trim() || loading}
          >
            {loading ? t.common.saving : t.activity.confirmVoid}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
