import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { DependencyCheckResult } from "@/lib/catalogDependencies";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  itemType: string;
  dependencies: DependencyCheckResult | null;
  isCheckingDependencies: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  itemName,
  itemType,
  dependencies,
  isCheckingDependencies,
  isDeleting,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const { t } = useLanguage();
  const [confirmText, setConfirmText] = useState("");

  // Reset confirm text when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setConfirmText("");
    }
  }, [open]);

  const requiresTypeConfirm = dependencies?.hasDependencies ?? false;
  const isConfirmValid = !requiresTypeConfirm || confirmText === itemName;
  const canDelete = !isCheckingDependencies && !isDeleting && isConfirmValid;

  const formatDependencyDetail = (detail: string): string => {
    const [type, count] = detail.split(":");
    const countNum = parseInt(count, 10);
    
    switch (type) {
      case "inflows":
        return t.catalog.usedInInflows.replace("{count}", String(countNum));
      case "outflows":
        return t.catalog.usedInOutflows.replace("{count}", String(countNum));
      case "skus":
        return t.catalog.referencedBySKUs.replace("{count}", String(countNum));
      default:
        return `${countNum} ${type}`;
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {dependencies?.hasDependencies && (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            {t.catalog.deleteTitle.replace("{type}", itemType)}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              {isCheckingDependencies ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.catalog.checkingDependencies}
                </div>
              ) : dependencies?.hasDependencies ? (
                <>
                  <div className="rounded-md bg-destructive/10 p-3 text-destructive">
                    <p className="font-medium">{t.catalog.deleteWarning}</p>
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {dependencies.dependencyDetails.map((detail, idx) => (
                        <li key={idx}>{formatDependencyDetail(detail)}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t.catalog.deleteWillNotRemove}
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-delete">
                      {t.catalog.typeToConfirm.replace("{name}", itemName)}
                    </Label>
                    <Input
                      id="confirm-delete"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={itemName}
                      autoComplete="off"
                    />
                  </div>
                </>
              ) : (
                <p>
                  {t.catalog.confirmDeleteMessage
                    .replace("{type}", itemType)
                    .replace("{name}", itemName)}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t.common.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!canDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.common.deleting}
              </>
            ) : (
              t.common.delete
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
