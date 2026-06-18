import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, Loader2, CheckCircle } from "lucide-react";
import { useRecalculateInventory } from "@/hooks/useRecalculateInventory";
import { useLanguage } from "@/contexts/LanguageContext";

export function RecalculateInventoryButton() {
  const { recalculate, isLoading, results } = useRecalculateInventory();
  const [showResults, setShowResults] = useState(false);
  const { t } = useLanguage();

  const handleRecalculate = async () => {
    const success = await recalculate();
    if (success) {
      setShowResults(true);
    }
  };

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={isLoading} className="gap-2">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t.admin.recalculateInventory}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.admin.recalculateInventoryTitle}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{t.admin.recalculateInventoryDescription}</p>
              <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                <li>{t.admin.recalculateStep1}</li>
                <li>{t.admin.recalculateStep2}</li>
                <li>{t.admin.recalculateStep3}</li>
              </ul>
              <p className="font-medium mt-2">{t.admin.recalculateWarning}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecalculate}>
              {t.admin.recalculateConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              {t.admin.recalculationComplete}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3">
            {results && results.length > 0 ? (
              <div className="divide-y">
                {results.map((result) => (
                  <div key={result.product_name} className="py-2">
                    <p className="font-medium">{result.product_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {result.outflows_processed} {t.admin.outflowsProcessed},{" "}
                      {result.deductions_created} {t.admin.deductionsCreated}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t.admin.totalDeducted}: {result.total_deducted.toLocaleString()} butir
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t.admin.noOutflowsToProcess}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
