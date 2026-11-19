// The column payload for an item_types insert or update.
//
// ONE builder on purpose. `forms` was once wired into the insert and forgotten in
// the update, so editing a product collected the forms and silently dropped them —
// the only path that actually matters, since products are edited, not re-created.
// Two payload literals is how that happens, so there is now only one, and it lives
// here rather than in the hook so it can be tested without a Supabase client.

import type { EggForm } from "@/lib/eggForms";

export interface ItemTypeWrite {
  name: string;
  unit?: "kg" | "btr";
  eggsPerUnit?: number;
  boxCapacities?: Record<string, number>;
  freshnessDays?: number;
  labelsPerPack?: number;
  lowStockThreshold?: number;
  countTolerance?: number;
  forms?: EggForm[];
  countForms?: EggForm[];
}

/** The two jsonb columns, omitted entirely when undefined so saving a non-egg item
 *  leaves them alone. An empty array IS written — that is how the last form gets
 *  removed. Spread rather than named, and cast, because the generated row type
 *  calls these Json (and does not know count_forms at all), which an EggForm[] with
 *  optional fields does not satisfy. */
const jsonbColumns = (input: ItemTypeWrite) =>
  ({
    ...(input.forms === undefined ? {} : { forms: input.forms }),
    ...(input.countForms === undefined ? {} : { count_forms: input.countForms }),
  }) as unknown as Record<string, never>;

export const itemTypeColumns = (input: ItemTypeWrite) => ({
  name: input.name,
  unit: input.unit ?? null,
  eggs_per_unit: input.eggsPerUnit ?? null,
  box_capacities: input.boxCapacities ?? null,
  freshness_days: input.freshnessDays ?? null,
  labels_per_pack: input.labelsPerPack ?? null,
  low_stock_threshold: input.lowStockThreshold ?? null,
  count_tolerance: input.countTolerance ?? null,
  ...jsonbColumns(input),
});
