import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

/** Whether any physical-count row exists for today (drives the header reminder dot). */
export function useStockCountStatus() {
  const [countedToday, setCountedToday] = useState(true); // assume done until known, to avoid a flash
  useEffect(() => {
    let active = true;
    (async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { count } = await supabase
        .from("stock_counts")
        .select("id", { count: "exact", head: true })
        .eq("count_date", today);
      if (active) setCountedToday((count ?? 0) > 0);
    })();
    return () => {
      active = false;
    };
  }, []);
  return { countedToday };
}
