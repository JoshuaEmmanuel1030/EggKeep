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
import { Loader2, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { DependencyCheckResult } from "@/lib/catalogDependencies";

interface RenameWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oldName: string;
  newName: string;
  dependencies: DependencyCheckResult | null;
  isSaving: boolean;
  onConfirm: () => void;
}

/**
 * Warns before renaming a catalog item that is referenced elsewhere. References are
 * matched by NAME, so a rename silently orphans history until the permanent
 * name->UUID migration lands. This only warns; it does not block the rename.
 */
export function RenameWarningDialog({
  open,
  onOpenChange,
  oldName,
  newName,
  dependencies,
  isSaving,
  onConfirm,
}: RenameWarningDialogProps) {
  const { t } = useLanguage();

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
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            {t.catalog.renameTitle}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                {t.catalog.renameWarning
                  .replace("{old}", oldName)
                  .replace("{new}", newName)}
              </p>
              {dependencies?.hasDependencies && (
                <div className="rounded-md bg-amber-500/10 p-3 text-amber-700">
                  <p className="font-medium">{t.catalog.renameOrphans}</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {dependencies.dependencyDetails.map((detail, idx) => (
                      <li key={idx}>{formatDependencyDetail(detail)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSaving}>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.common.save}
              </>
            ) : (
              t.catalog.renameAnyway
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
