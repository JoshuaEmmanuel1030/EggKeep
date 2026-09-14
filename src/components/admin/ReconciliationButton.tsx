import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShieldCheck, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useReconciliation } from "@/hooks/useReconciliation";
import { useLanguage } from "@/contexts/LanguageContext";

export function ReconciliationButton() {
  const { reconcile, isLoading, discrepancies } = useReconciliation();
  const [showResults, setShowResults] = useState(false);
  const { t } = useLanguage();

  const handleCheck = async () => {
    const ok = await reconcile();
    if (!ok) {
      toast.error(t.admin.reconcileFailed);
      return;
    }
    // reconcile() sets discrepancies before returning; read the fresh value.
    setShowResults(true);
  };

  const rows = discrepancies ?? [];
  const clean = rows.length === 0;

  return (
    <>
      <Button variant="outline" disabled={isLoading} className="gap-2" onClick={handleCheck}>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {t.admin.reconcileCheck}
      </Button>

      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {clean ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              )}
              {t.admin.reconcileTitle}
            </DialogTitle>
          </DialogHeader>

          {clean ? (
            <p className="text-muted-foreground">{t.admin.reconcileClean}</p>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">
                {rows.length} {t.admin.reconcileFound}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-3">{t.admin.reconcileProduct}</th>
                      <th className="py-2 px-3 text-right">{t.admin.reconcileStored}</th>
                      <th className="py-2 px-3 text-right">{t.admin.reconcileExpected}</th>
                      <th className="py-2 px-3 text-right">{t.admin.reconcileDrift}</th>
                      <th className="py-2 pl-3">{t.admin.reconcileKind}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.inflow_id}>
                        <td className="py-2 pr-3 font-medium">{r.product}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.stored_remaining.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.expected_remaining.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-destructive">{r.drift.toLocaleString()}</td>
                        <td className="py-2 pl-3">{r.kind}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">{t.admin.reconcileHint}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
