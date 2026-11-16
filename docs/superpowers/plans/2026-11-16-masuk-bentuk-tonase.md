# Masuk Bentuk + per-line Tonase weight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Masuk egg line be entered in the form it arrived in (iket, tray, pack, karton, curah, tonase) instead of only a native-unit amount, with Tonase carrying the weight its load was weighed at.

**Architecture:** A `forms` JSONB column on `item_types` holds each egg product's forms in display order. A pure `src/lib/eggForms.ts` turns a form plus a typed count into the product's native unit. A new `BentukRow` component renders the form button, the inline picker and the Tonase weight control, and is dropped into both of `InflowForm`'s row layouts. `inflows` gains `form`, `form_count` and `tonase_kg` as a record of how the number was reached; `quantity_butir` still holds the native-unit result, so nothing downstream changes.

**Tech Stack:** React 18 + TypeScript, Tailwind + shadcn/ui, Supabase (Postgres + generated types), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-masuk-bentuk-tonase-design.md`
**Design reference (local, untracked):** `docs/superpowers/specs/design_handoff_masuk_bentuk/README.md`
**Branch:** `feat/masuk-bentuk`, worktree `.claude/worktrees/masuk-bentuk`, cut from `origin/main` at 9aac72a.

## Global Constraints

- **kg-native stock.** `quantity_butir` holds the product's NATIVE unit (kg for `item_types.unit='kg'`, butir otherwise). Never convert kg↔butir when storing. A form only changes how the quantity is entered.
- **Every user-facing string goes in BOTH `src/locales/id.ts` and `src/locales/en.ts`.** UI copy is Bahasa Indonesia.
- **Migrations are applied with the Supabase MCP `apply_migration` against project `lgtixzpjbkzapecirbfj`, BEFORE pushing frontend code that depends on them.**
- **Verify gate before any push: `npm run verify`** (Supabase ref guard, `tsc --noEmit -p tsconfig.app.json`, full vitest run).
- **The GitHub repo is PUBLIC.** No stock levels, sales or volume figures in commits, code comments or PR text. Form names and bundle sizes are packaging config and are fine.
- The repo compiles with `strict: false`; discriminated-union narrowing does not work. Use explicit checks.
- All tap targets 44 px or taller.
- Numbers display with `tabular-nums` and id-ID formatting (`toLocaleString(locale)`).

## Deliberate deviations from the spec

1. **No code fallback dict for the catalogue.** The spec said forms would have "a code dict as the offline fallback", mirroring `CONVERSION_DICT`. Dropped: when the catalogue has not loaded, `formsFor` returns `[]`, the Bentuk row does not render, and entry falls back to Langsung — which is exactly today's behaviour. A dict would be a second copy of data the owner edits in the Catalog, and it would go stale. Raise it with the owner if offline form entry turns out to matter.
2. **No separate `formCount` field in component state.** The existing `quantity` string doubles as the count when a form is chosen, so no new input and no new state field. `form_count` is derived at submit.
3. **`unitWord` added to each catalogue entry** (`iket`, `tray`, `pack`, `karton`, `satuan`). The spec left the field's unit label to be derived from the form name, which breaks on names like "Negeri 15's". One data field beats a guessing function.

## File Structure

| File | Responsibility |
|---|---|
| Create `supabase/migrations/20261116000000_egg_forms.sql` | `item_types.forms`, the three `inflows` columns, and the seed catalogue |
| Create `src/lib/eggForms.ts` | Form types, catalogue lookup, entry unit, conversion to native. Pure, no React |
| Create `src/lib/__tests__/eggForms.test.ts` | Unit tests for the above |
| Create `src/components/inflow/BentukRow.tsx` | Bentuk label, form button, inline picker, Tonase weight control |
| Create `src/components/inflow/__tests__/BentukRow.test.tsx` | Picker behaviour, Tonase stepper and clamping |
| Modify `src/types/inventory.ts` | `ItemType.forms`; `InflowEntry.form/formCount/tonaseKg` |
| Modify `src/hooks/useItemTypes.ts` | Map the `forms` column |
| Modify `src/components/InflowForm.tsx` | Form-aware parse/validity, render `BentukRow` in both rows, conversion line, submit payload, Ringkasan chaining |
| Modify `src/components/InflowSummaryPanel.tsx` | The `{form} × {count}` note |
| Modify `src/hooks/useInventorySync.ts` | Persist and read back the three columns |
| Modify `src/locales/id.ts`, `src/locales/en.ts` | New strings |
| Modify `src/integrations/supabase/types.ts` | Regenerated after the migration |

---

### Task 1: Database columns and the seed catalogue

**Files:**
- Create: `supabase/migrations/20261116000000_egg_forms.sql`
- Modify: `src/integrations/supabase/types.ts` (regenerated)

**Interfaces:**
- Consumes: nothing.
- Produces: `item_types.forms jsonb` holding `[{ id, name, size?, unit, unitWord? }]`; `inflows.form text`, `inflows.form_count numeric`, `inflows.tonase_kg numeric`. `unit` is one of `kg`, `butir`, `native`, `weighed`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261116000000_egg_forms.sql`:

```sql
-- Masuk "Bentuk": the form an egg delivery arrived in, plus Tonase's per-load weight.
-- Spec: docs/superpowers/specs/2026-11-16-masuk-bentuk-tonase-design.md
--
-- forms is display-ordered. A line stores the form's id, so renaming a form in the
-- Catalog does not corrupt history. Sizes are the warehouse sheet's; the owner edits
-- them afterwards.

alter table public.item_types
  add column if not exists forms jsonb;

comment on column public.item_types.forms is
  'Egg-only: the forms this product can arrive in, in display order. Array of '
  '{id, name, size?, unit, unitWord?}; unit is kg | butir | native | weighed. '
  'weighed (Tonase) has no size: the weight lives on the line.';

alter table public.inflows
  add column if not exists form text,
  add column if not exists form_count numeric,
  add column if not exists tonase_kg numeric;

comment on column public.inflows.form is
  'item_types.forms[].id this line was entered in; null = Langsung (native amount as typed).';
comment on column public.inflows.form_count is
  'How many of that form were entered. quantity_butir still holds the native-unit result.';
comment on column public.inflows.tonase_kg is
  'kg per satuan used for a weighed form, so history stays right when later loads differ.';

update public.item_types t set forms = v.forms
from (values
  ('NEGERI BIASA', '[
     {"id":"iket15kg","name":"Iket 15 kg","size":15,"unit":"kg","unitWord":"iket"},
     {"id":"iket10kg","name":"Iket 10 kg","size":10,"unit":"kg","unitWord":"iket"},
     {"id":"negeri15","name":"Negeri 15''s","size":15,"unit":"butir","unitWord":"pack"},
     {"id":"negeri10","name":"Negeri 10''s","size":10,"unit":"butir","unitWord":"pack"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"kartonosave","name":"Karton Osave","size":180,"unit":"butir","unitWord":"karton"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"tonase","name":"Tonase","unit":"weighed","unitWord":"satuan"},
     {"id":"iketanosave","name":"Iketan Osave","size":150,"unit":"butir","unitWord":"iket"},
     {"id":"negeri6","name":"Negeri 6''s","size":6,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('NEGERI OMEGA', '[
     {"id":"iket15kg","name":"Iket 15 kg","size":15,"unit":"kg","unitWord":"iket"},
     {"id":"iket10kg","name":"Iket 10 kg","size":10,"unit":"kg","unitWord":"iket"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack6","name":"Pack 6''s","size":6,"unit":"butir","unitWord":"pack"},
     {"id":"kartonosave","name":"Karton Osave","size":180,"unit":"butir","unitWord":"karton"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"pack10","name":"Pack 10''s","size":10,"unit":"butir","unitWord":"pack"},
     {"id":"pack15","name":"Pack 15''s","size":15,"unit":"butir","unitWord":"pack"},
     {"id":"no6","name":"No''6","size":6,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('KAMPUNG MERAH', '[
     {"id":"iket300","name":"Iket 300","size":300,"unit":"butir","unitWord":"iket"},
     {"id":"pack15","name":"Pack 15''s","size":15,"unit":"butir","unitWord":"pack"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack6","name":"Pack 6''s","size":6,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"pack10","name":"Pack 10''s","size":10,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('KAMPUNG BIASA', '[
     {"id":"iket300","name":"Iket 300","size":300,"unit":"butir","unitWord":"iket"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack10","name":"Pack 10''s","size":10,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"pack6","name":"Pack 6''s","size":6,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('PUYUH', '[
     {"id":"ikat900","name":"Ikat 900","size":900,"unit":"butir","unitWord":"ikat"},
     {"id":"ikat1350","name":"Ikat 1350","size":1350,"unit":"butir","unitWord":"ikat"},
     {"id":"pack25","name":"Pack 25''s","size":25,"unit":"butir","unitWord":"pack"},
     {"id":"tray90","name":"Tray 90","size":90,"unit":"butir","unitWord":"tray"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"puyuh30","name":"Puyuh 30''s","size":30,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('ASIN MATENG', '[
     {"id":"ikat300","name":"Ikat 300","size":300,"unit":"butir","unitWord":"ikat"},
     {"id":"ikat270","name":"Ikat 270","size":270,"unit":"butir","unitWord":"ikat"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack4","name":"Pack 4''s","size":4,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"}
   ]'::jsonb),
  ('BEBEK TAWAR', '[
     {"id":"ikat300","name":"Ikat 300","size":300,"unit":"butir","unitWord":"ikat"},
     {"id":"ikat270","name":"Ikat 270","size":270,"unit":"butir","unitWord":"ikat"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack4","name":"Pack 4''s","size":4,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"}
   ]'::jsonb),
  ('ASIN MENTAH', '[
     {"id":"ikat200","name":"Ikat 200","size":200,"unit":"butir","unitWord":"ikat"},
     {"id":"tray20","name":"Tray 20","size":20,"unit":"butir","unitWord":"tray"},
     {"id":"pack4","name":"Pack 4''s","size":4,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"}
   ]'::jsonb)
) as v(name, forms)
where t.name = v.name
  and t.category = 'egg'
  and t.deleted_at is null
  and coalesce(t.is_retakan, false) = false;
```

- [ ] **Step 2: Apply it**

Apply with the Supabase MCP `apply_migration` tool against project `lgtixzpjbkzapecirbfj`, naming it `20261116000000_egg_forms` so it matches the repo file. Do not run it through `execute_sql`.

- [ ] **Step 3: Verify the shape**

Run this through the Supabase MCP `execute_sql`:

```sql
select t.name,
       jsonb_array_length(t.forms) as form_count,
       t.forms -> 0 ->> 'id'       as first_form
from public.item_types t
where t.category = 'egg' and t.deleted_at is null and coalesce(t.is_retakan,false) = false
order by t.name;
```

Expected: eight rows, each with a non-null `form_count`; RETAKAN children and non-egg rows untouched (`forms` null). Then:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'inflows'
  and column_name in ('form','form_count','tonase_kg')
order by column_name;
```

Expected: three rows — `form` text, `form_count` numeric, `tonase_kg` numeric.

- [ ] **Step 4: Regenerate the Supabase types**

Use the Supabase MCP `generate_typescript_types` tool and write the result over `src/integrations/supabase/types.ts`. Confirm `inflows` Row/Insert/Update now carry `form`, `form_count` and `tonase_kg`, and `item_types` carries `forms`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors. (The regenerated file is additive; nothing reads the new columns yet.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261116000000_egg_forms.sql src/integrations/supabase/types.ts
git commit -m "feat(masuk): add item_types.forms and the inflow form columns"
```

---

### Task 2: The catalogue in code — `eggForms` and `ItemType.forms`

**Files:**
- Create: `src/lib/eggForms.ts`
- Create: `src/lib/__tests__/eggForms.test.ts`
- Modify: `src/types/inventory.ts` (the `ItemType` interface, after `isRetakan`)
- Modify: `src/hooks/useItemTypes.ts` (the `mapped` object in `fetchItemTypes`)

**Interfaces:**
- Consumes: `item_types.forms` from Task 1.
- Produces:
  - `export type FormUnit = "kg" | "butir" | "native" | "weighed"`
  - `export interface EggForm { id: string; name: string; size?: number; unit: FormUnit; unitWord?: string }`
  - `export const TONASE_MIN_KG = 5`, `TONASE_MAX_KG = 30`, `TONASE_STEP_KG = 0.1`
  - `formsFor(product: string, itemTypes: ItemType[]): EggForm[]`
  - `findForm(forms: EggForm[], id: string | null | undefined): EggForm | null`
  - `entryUnit(form: EggForm | null, nativeUnit: "kg" | "butir" | "pcs"): "kg" | "butir" | "pcs"`
  - `toNative(args: { form: EggForm | null; count: number | null; nativeUnit: "kg" | "butir" | "pcs"; eggsPerUnit?: number; tonaseKg?: number | null }): number | null`
  - `formUnitWord(form: EggForm | null, nativeUnit: string): string`
  - `ItemType.forms?: EggForm[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/eggForms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  formsFor, findForm, entryUnit, toNative, formUnitWord,
  TONASE_MIN_KG, TONASE_MAX_KG, type EggForm,
} from "@/lib/eggForms";
import type { ItemType } from "@/types/inventory";

const IKET15: EggForm = { id: "iket15kg", name: "Iket 15 kg", size: 15, unit: "kg", unitWord: "iket" };
const TRAY30: EggForm = { id: "tray30", name: "Tray 30", size: 30, unit: "butir", unitWord: "tray" };
const CURAH: EggForm = { id: "curah", name: "Curah", size: 1, unit: "native" };
const TONASE: EggForm = { id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" };

const ITEM_TYPES: ItemType[] = [
  { id: "1", category: "egg", name: "NEGERI BIASA", unit: "kg", eggsPerUnit: 15.5, forms: [IKET15, TRAY30, CURAH, TONASE] },
  { id: "2", category: "egg", name: "KAMPUNG BIASA", unit: "btr", eggsPerUnit: 1, forms: [TRAY30, CURAH] },
  { id: "3", category: "egg", name: "NEGERI BARU", unit: "kg", eggsPerUnit: 15.5 },
  { id: "4", category: "packaging", name: "NEGERI ISI 10" },
];

describe("formsFor", () => {
  it("returns the product's forms in catalogue order", () => {
    expect(formsFor("NEGERI BIASA", ITEM_TYPES).map((f) => f.id)).toEqual(["iket15kg", "tray30", "curah", "tonase"]);
  });

  it("returns [] for a product with no forms configured", () => {
    expect(formsFor("NEGERI BARU", ITEM_TYPES)).toEqual([]);
  });

  it("returns [] for an unknown product and for a non-egg item", () => {
    expect(formsFor("NOPE", ITEM_TYPES)).toEqual([]);
    expect(formsFor("NEGERI ISI 10", ITEM_TYPES)).toEqual([]);
  });

  it("returns [] when the catalogue has not loaded", () => {
    expect(formsFor("NEGERI BIASA", [])).toEqual([]);
  });
});

describe("findForm", () => {
  const forms = formsFor("NEGERI BIASA", ITEM_TYPES);

  it("finds a form by id", () => {
    expect(findForm(forms, "tray30")).toEqual(TRAY30);
  });

  it("treats null, undefined and empty as Langsung", () => {
    expect(findForm(forms, null)).toBeNull();
    expect(findForm(forms, undefined)).toBeNull();
    expect(findForm(forms, "")).toBeNull();
  });

  it("returns null for an id that is no longer in the catalogue", () => {
    expect(findForm(forms, "removed")).toBeNull();
  });
});

describe("entryUnit", () => {
  it("is the native unit for Langsung", () => {
    expect(entryUnit(null, "kg")).toBe("kg");
    expect(entryUnit(null, "butir")).toBe("butir");
  });

  it("is the native unit for Curah", () => {
    expect(entryUnit(CURAH, "kg")).toBe("kg");
  });

  it("is a whole count for every bundled form, whatever the product", () => {
    expect(entryUnit(IKET15, "kg")).toBe("butir");
    expect(entryUnit(TRAY30, "kg")).toBe("butir");
    expect(entryUnit(TONASE, "kg")).toBe("butir");
  });
});

describe("toNative", () => {
  const kg = { nativeUnit: "kg" as const, eggsPerUnit: 15.5 };
  const btr = { nativeUnit: "butir" as const, eggsPerUnit: 1 };

  it("multiplies a kg form by its size", () => {
    expect(toNative({ form: IKET15, count: 79, ...kg })).toBe(1185);
  });

  it("divides a butir form by eggs per kg on a kg product", () => {
    expect(toNative({ form: TRAY30, count: 20, ...kg })).toBe(38.71);
  });

  it("multiplies a butir form by its size on a butir product", () => {
    expect(toNative({ form: TRAY30, count: 5, ...btr })).toBe(150);
  });

  it("uses the line's weight for a weighed form", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 16.8, ...kg })).toBe(168);
  });

  it("returns null for a weighed form with no weight yet", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: null, ...kg })).toBeNull();
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 0, ...kg })).toBeNull();
  });

  it("refuses a weighed form on a butir product: Tonase is kg-only", () => {
    expect(toNative({ form: TONASE, count: 10, tonaseKg: 16.8, ...btr })).toBeNull();
  });

  it("passes Curah and Langsung through as typed", () => {
    expect(toNative({ form: CURAH, count: 24, ...kg })).toBe(24);
    expect(toNative({ form: null, count: 52.89, ...kg })).toBe(52.89);
  });

  it("returns null for a missing, zero or negative count", () => {
    expect(toNative({ form: IKET15, count: null, ...kg })).toBeNull();
    expect(toNative({ form: IKET15, count: 0, ...kg })).toBeNull();
    expect(toNative({ form: IKET15, count: -3, ...kg })).toBeNull();
  });

  it("returns null when a kg product has no conversion configured", () => {
    expect(toNative({ form: TRAY30, count: 20, nativeUnit: "kg", eggsPerUnit: undefined })).toBeNull();
  });

  it("rounds to 2 dp, like the rest of the app", () => {
    expect(toNative({ form: TRAY30, count: 7, ...kg })).toBe(13.55);
  });
});

describe("formUnitWord", () => {
  it("uses the catalogue word when there is one", () => {
    expect(formUnitWord(IKET15, "kg")).toBe("iket");
    expect(formUnitWord(TONASE, "kg")).toBe("satuan");
  });

  it("falls back to the native unit for Curah and Langsung", () => {
    expect(formUnitWord(CURAH, "kg")).toBe("kg");
    expect(formUnitWord(null, "butir")).toBe("butir");
  });
});

describe("Tonase bounds", () => {
  it("are a wide sanity range, not a tight band", () => {
    expect(TONASE_MIN_KG).toBeLessThan(10);
    expect(TONASE_MAX_KG).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --run src/lib/__tests__/eggForms.test.ts`
Expected: FAIL — cannot resolve `@/lib/eggForms`.

- [ ] **Step 3: Add `forms` to the `ItemType` type**

In `src/types/inventory.ts`, add to the `ItemType` interface, right after `isRetakan`:

```ts
  // Egg-only: the forms this product can arrive in, in display order. Undefined
  // (or []) means the Bentuk row does not render and entry stays native-unit.
  // See src/lib/eggForms.ts.
  forms?: EggForm[];
```

and at the top of the file:

```ts
import type { EggForm } from "@/lib/eggForms";
```

- [ ] **Step 4: Write `eggForms.ts`**

Create `src/lib/eggForms.ts`:

```ts
// The forms an egg delivery can arrive in ("Bentuk"), and the arithmetic that turns
// a count of them into the product's native unit. Catalogue data lives on
// item_types.forms; this module only reads it. No I/O, no React.
// Spec: docs/superpowers/specs/2026-11-16-masuk-bentuk-tonase-design.md

import type { ItemType } from "@/types/inventory";

/** kg: a weight per bundle. butir: an egg count per bundle. native: the amount as
 *  typed (Curah). weighed: the size is the line's own scale reading (Tonase). */
export type FormUnit = "kg" | "butir" | "native" | "weighed";

export interface EggForm {
  id: string;
  name: string;
  /** Absent for `weighed`, whose size is the line's weight. */
  size?: number;
  unit: FormUnit;
  /** The word shown inside the Jumlah field ("iket", "tray", "satuan"). Absent for
   *  `native`, which uses the product's own unit. */
  unitWord?: string;
}

/** A sanity range, not a band the scale has to sit in: wide enough for any real
 *  load, tight enough to catch a mistyped 168 or 1,6. */
export const TONASE_MIN_KG = 5;
export const TONASE_MAX_KG = 30;
export const TONASE_STEP_KG = 0.1;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The forms configured for an egg product, in catalogue order. */
export function formsFor(product: string, itemTypes: ItemType[]): EggForm[] {
  const type = itemTypes.find((t) => t.name === product && t.category === "egg");
  return type?.forms ?? [];
}

/** The form an id refers to. Null means Langsung: no form, the amount as typed. */
export function findForm(forms: EggForm[], id: string | null | undefined): EggForm | null {
  if (!id) return null;
  return forms.find((f) => f.id === id) ?? null;
}

/** Which unit the typed Jumlah is in, for parseQtyInput. A bundled form is counted,
 *  so it takes whole numbers — which is what the "butir" mode of parseQtyInput gives
 *  (integers, with a dot reading as thousands). Langsung and Curah are native. */
export function entryUnit(
  form: EggForm | null,
  nativeUnit: "kg" | "butir" | "pcs"
): "kg" | "butir" | "pcs" {
  if (!form || form.unit === "native") return nativeUnit;
  return "butir";
}

/** The native-unit quantity a line will record, or null when it cannot be worked
 *  out yet (no count, no Tonase weight, no conversion configured). */
export function toNative(args: {
  form: EggForm | null;
  count: number | null;
  nativeUnit: "kg" | "butir" | "pcs";
  eggsPerUnit?: number;
  tonaseKg?: number | null;
}): number | null {
  const { form, count, nativeUnit, eggsPerUnit, tonaseKg } = args;
  if (count == null || count <= 0) return null;

  // Langsung and Curah: the number is already native.
  if (!form || form.unit === "native") return count;

  if (form.unit === "weighed") {
    // Tonase is a weight per satuan, so it only makes sense on a kg product.
    if (nativeUnit !== "kg") return null;
    if (tonaseKg == null || tonaseKg <= 0) return null;
    return round2(count * tonaseKg);
  }

  if (form.size == null || form.size <= 0) return null;
  if (form.unit === "kg") return round2(count * form.size);

  // butir-sized bundle
  if (nativeUnit === "kg") {
    if (!eggsPerUnit || eggsPerUnit <= 0) return null;
    return round2((count * form.size) / eggsPerUnit);
  }
  return count * form.size;
}

/** The word shown inside the Jumlah field for this form. */
export function formUnitWord(form: EggForm | null, nativeUnit: string): string {
  if (!form || form.unit === "native") return nativeUnit;
  return form.unitWord ?? nativeUnit;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/__tests__/eggForms.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Map the column in `useItemTypes`**

In `src/hooks/useItemTypes.ts`, inside `fetchItemTypes`'s `mapped` object, add after the `isRetakan` line:

```ts
        // Egg-only: the forms this product can arrive in (Masuk Bentuk).
        forms:
          ((row as { forms?: EggForm[] | null }).forms as EggForm[] | null) ?? undefined,
```

and add to the imports at the top of the file:

```ts
import type { EggForm } from "@/lib/eggForms";
```

Leave `addItemType` and `updateItemType` alone: the spec makes a Catalog editor for forms a non-goal, and neither mutation touching `forms` means neither can wipe it.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`
Expected: no type errors; every existing test still passes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/eggForms.ts src/lib/__tests__/eggForms.test.ts src/types/inventory.ts src/hooks/useItemTypes.ts
git commit -m "feat(masuk): egg form catalogue and native-unit conversion"
```

---

### Task 3: The `BentukRow` component

**Files:**
- Create: `src/components/inflow/BentukRow.tsx`
- Create: `src/components/inflow/__tests__/BentukRow.test.tsx`
- Modify: `src/locales/id.ts`, `src/locales/en.ts`

**Interfaces:**
- Consumes: `EggForm`, `formUnitWord`, `TONASE_MIN_KG`, `TONASE_MAX_KG`, `TONASE_STEP_KG` from Task 2; `parseQtyInput`, `qtyInputText` from `@/lib/stockCount`.
- Produces:

```ts
export interface BentukRowProps {
  forms: EggForm[];
  formId: string | null;
  tonaseKg: string;                       // raw text, owned by the parent
  nativeUnit: "kg" | "butir" | "pcs";
  open: boolean;                          // the parent allows one open picker at a time
  onOpenChange: (open: boolean) => void;
  onChangeForm: (id: string | null) => void;
  onChangeTonase: (value: string) => void;
}
export function BentukRow(props: BentukRowProps): JSX.Element | null;
```

- [ ] **Step 1: Add the locale strings**

In `src/locales/id.ts`, inside the `inflow` object (after `noConversion`):

```ts
    form: 'Bentuk',
    formDirect: 'Langsung ({unit})',
    formDirectHint: 'sudah ditimbang / diketahui',
    qtyPlaceholderForm: 'Jumlah',
    tonaseWeightToday: 'Berat per satuan',
    tonaseSizeLine: '× {kg} kg per satuan · berat berubah tiap muatan',
```

The same keys in `src/locales/en.ts`:

```ts
    form: 'Form',
    formDirect: 'Direct ({unit})',
    formDirectHint: 'already weighed / known',
    qtyPlaceholderForm: 'Quantity',
    tonaseWeightToday: 'Weight per satuan',
    tonaseSizeLine: '× {kg} kg per satuan · changes with each load',
```

- [ ] **Step 2: Write the failing tests**

Create `src/components/inflow/__tests__/BentukRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { BentukRow } from "@/components/inflow/BentukRow";
import type { EggForm } from "@/lib/eggForms";

const FORMS: EggForm[] = [
  { id: "iket15kg", name: "Iket 15 kg", size: 15, unit: "kg", unitWord: "iket" },
  { id: "tray30", name: "Tray 30", size: 30, unit: "butir", unitWord: "tray" },
  { id: "curah", name: "Curah", size: 1, unit: "native" },
  { id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" },
];

function setup(overrides: Partial<React.ComponentProps<typeof BentukRow>> = {}) {
  const props = {
    forms: FORMS,
    formId: null as string | null,
    tonaseKg: "",
    nativeUnit: "kg" as const,
    open: false,
    onOpenChange: vi.fn(),
    onChangeForm: vi.fn(),
    onChangeTonase: vi.fn(),
    ...overrides,
  };
  render(
    <LanguageProvider>
      <BentukRow {...props} />
    </LanguageProvider>
  );
  return props;
}

beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(cleanup);

describe("BentukRow", () => {
  it("renders nothing when the product has no forms", () => {
    const { container } = render(
      <LanguageProvider>
        <BentukRow
          forms={[]} formId={null} tonaseKg="" nativeUnit="kg" open={false}
          onOpenChange={vi.fn()} onChangeForm={vi.fn()} onChangeTonase={vi.fn()}
        />
      </LanguageProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Langsung with the native unit when no form is chosen", () => {
    setup();
    expect(screen.getByRole("button", { name: /Langsung \(kg\)/ })).toBeInTheDocument();
  });

  it("shows the chosen form's name and size", () => {
    setup({ formId: "iket15kg" });
    expect(screen.getByRole("button", { name: /Iket 15 kg/ })).toBeInTheDocument();
    expect(screen.getByText(/15 kg per iket/)).toBeInTheDocument();
  });

  it("asks the parent to open the picker when the button is tapped", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Langsung/ }));
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
  });

  it("lists Langsung first, then the catalogue order", () => {
    setup({ open: true });
    const options = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const langsung = options.findIndex((t) => t.includes("Langsung"));
    const iket = options.findIndex((t) => t.includes("Iket 15 kg"));
    const tray = options.findIndex((t) => t.includes("Tray 30"));
    expect(langsung).toBeGreaterThan(-1);
    expect(langsung).toBeLessThan(iket);
    expect(iket).toBeLessThan(tray);
  });

  it("reports the picked form and closes the picker", () => {
    const props = setup({ open: true });
    fireEvent.click(screen.getByRole("button", { name: /Tray 30/ }));
    expect(props.onChangeForm).toHaveBeenCalledWith("tray30");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports null when Langsung is picked", () => {
    const props = setup({ open: true, formId: "tray30" });
    fireEvent.click(screen.getByRole("button", { name: /Langsung/ }));
    expect(props.onChangeForm).toHaveBeenCalledWith(null);
  });

  it("shows no weight control unless the form is weighed", () => {
    setup({ formId: "tray30" });
    expect(screen.queryByLabelText(/Berat per satuan/)).not.toBeInTheDocument();
  });

  it("shows the weight control for Tonase", () => {
    setup({ formId: "tonase", tonaseKg: "16,8" });
    expect(screen.getByLabelText(/Berat per satuan/)).toHaveValue("16,8");
  });

  it("steps the weight by 0,1 kg", () => {
    const props = setup({ formId: "tonase", tonaseKg: "16,8" });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("16,9");
    fireEvent.click(screen.getByRole("button", { name: /−|-/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("16,7");
  });

  it("starts stepping from the range floor when the weight is empty", () => {
    const props = setup({ formId: "tonase", tonaseKg: "" });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("5");
  });

  it("does not step past the range", () => {
    const props = setup({ formId: "tonase", tonaseKg: "30" });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("30");
  });

  it("restores the last valid weight when given something out of range", () => {
    const props = setup({ formId: "tonase", tonaseKg: "16,8" });
    const field = screen.getByLabelText(/Berat per satuan/);
    fireEvent.change(field, { target: { value: "168" } });
    fireEvent.blur(field);
    expect(props.onChangeTonase).toHaveBeenLastCalledWith("16,8");
  });

  it("keeps a valid typed weight on blur", () => {
    const props = setup({ formId: "tonase", tonaseKg: "16,8" });
    const field = screen.getByLabelText(/Berat per satuan/);
    fireEvent.change(field, { target: { value: "17,25" } });
    fireEvent.blur(field);
    expect(props.onChangeTonase).toHaveBeenLastCalledWith("17,25");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- --run src/components/inflow/__tests__/BentukRow.test.tsx`
Expected: FAIL — cannot resolve `@/components/inflow/BentukRow`.

- [ ] **Step 4: Write the component**

Create `src/components/inflow/BentukRow.tsx`:

```tsx
// Masuk "Bentuk": the form an egg line arrived in, its inline picker, and the
// per-load weight control a weighed form (Tonase) needs. Presentational — the
// parent owns the form id, the weight text and which picker is open.
// Design: docs/superpowers/specs/design_handoff_masuk_bentuk/README.md

import { useRef } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { parseQtyInput, qtyInputText } from "@/lib/stockCount";
import {
  TONASE_MAX_KG, TONASE_MIN_KG, TONASE_STEP_KG, formUnitWord, findForm, type EggForm,
} from "@/lib/eggForms";

export interface BentukRowProps {
  forms: EggForm[];
  formId: string | null;
  tonaseKg: string;
  nativeUnit: "kg" | "butir" | "pcs";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeForm: (id: string | null) => void;
  onChangeTonase: (value: string) => void;
}

/** "15 kg per iket", "30 butir per tray", "" for Langsung and Curah. */
function sizeText(form: EggForm | null, nativeUnit: string): string {
  if (!form || form.unit === "native" || form.unit === "weighed" || form.size == null) return "";
  return `${form.size} ${form.unit} per ${formUnitWord(form, nativeUnit)}`;
}

export function BentukRow({
  forms, formId, tonaseKg, nativeUnit, open, onOpenChange, onChangeForm, onChangeTonase,
}: BentukRowProps) {
  const { t } = useLanguage();
  const form = findForm(forms, formId);
  // The weight to fall back to when the field is given something unusable.
  const lastValid = useRef<string>(tonaseKg);
  const parsedWeight = parseQtyInput(tonaseKg, "kg");
  if (parsedWeight != null && parsedWeight >= TONASE_MIN_KG && parsedWeight <= TONASE_MAX_KG) {
    lastValid.current = tonaseKg;
  }

  if (forms.length === 0) return null;

  const directLabel = t.inflow.formDirect.replace("{unit}", nativeUnit);
  const size = sizeText(form, nativeUnit);

  const step = (direction: 1 | -1) => {
    const from = parsedWeight ?? (direction === 1 ? TONASE_MIN_KG - TONASE_STEP_KG : TONASE_MAX_KG + TONASE_STEP_KG);
    const next = Math.min(TONASE_MAX_KG, Math.max(TONASE_MIN_KG, Math.round((from + direction * TONASE_STEP_KG) * 10) / 10));
    onChangeTonase(qtyInputText(next));
  };

  const commitWeight = () => {
    const n = parseQtyInput(tonaseKg, "kg");
    if (n == null || n < TONASE_MIN_KG || n > TONASE_MAX_KG) onChangeTonase(lastValid.current);
  };

  return (
    <div className="ml-9 mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ek-mfg">{t.inflow.form}</span>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className={cn(
            "h-11 gap-2 rounded-[11px] border-ek-border bg-card px-3 text-sm font-semibold text-ek-fg hover:bg-card hover:text-ek-fg [&_svg]:size-3.5",
            open && "border-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.2)]"
          )}
        >
          {form ? form.name : directLabel}
          <ChevronDown aria-hidden />
        </Button>
        {size && <span className="text-[12.5px] text-ek-mfg">{size}</span>}
      </div>

      {open && (
        <div className="grid grid-cols-3 gap-1.5">
          <PickerOption
            name={directLabel}
            detail={t.inflow.formDirectHint}
            selected={!form}
            onPick={() => { onChangeForm(null); onOpenChange(false); }}
          />
          {forms.map((f) => (
            <PickerOption
              key={f.id}
              name={f.name}
              detail={sizeText(f, nativeUnit)}
              selected={f.id === formId}
              onPick={() => { onChangeForm(f.id); onOpenChange(false); }}
            />
          ))}
        </div>
      )}

      {form?.unit === "weighed" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ek-muted py-1.5 pl-3 pr-2">
          <div className="mr-auto">
            <p className="text-[13.5px] font-semibold text-ek-fg">{t.inflow.tonaseWeightToday}</p>
            <p className="text-[12.5px] text-ek-mfg">
              {t.inflow.tonaseSizeLine.replace("{kg}", tonaseKg || "—")}
            </p>
          </div>
          <div className="flex items-center rounded-xl border border-ek-border bg-card">
            <Button
              type="button" variant="ghost" aria-label="−" onClick={() => step(-1)}
              className="h-11 w-11 rounded-l-xl p-0 text-ek-fg hover:bg-ek-muted [&_svg]:size-4"
            >
              <Minus aria-hidden />
            </Button>
            <Input
              type="text"
              inputMode="decimal"
              value={tonaseKg}
              aria-label={t.inflow.tonaseWeightToday}
              onChange={(e) => onChangeTonase(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitWeight}
              className="h-11 w-[58px] border-0 bg-transparent px-0 text-right font-display text-lg font-semibold tabular-nums focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <span className="px-1 text-[13.5px] text-ek-mfg">kg</span>
            <Button
              type="button" variant="ghost" aria-label="+" onClick={() => step(1)}
              className="h-11 w-11 rounded-r-xl p-0 text-ek-fg hover:bg-ek-muted [&_svg]:size-4"
            >
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerOption({
  name, detail, selected, onPick,
}: { name: string; detail: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex min-h-[52px] flex-col justify-center rounded-[10px] bg-ek-muted px-2.5 py-1.5 text-left hover:bg-[#e9e3d8]",
        selected && "bg-ek-accent shadow-[inset_0_0_0_2px_#f59e0b]"
      )}
    >
      <span className="text-sm font-semibold text-ek-fg">{name}</span>
      {detail && <span className="text-xs text-[#5c534a]">{detail}</span>}
    </button>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --run src/components/inflow/__tests__/BentukRow.test.tsx`
Expected: PASS. If the `−` / `+` button queries miss, check the `aria-label`s are the literal `−` (U+2212) and `+` used above.

- [ ] **Step 6: Commit**

```bash
git add src/components/inflow/BentukRow.tsx src/components/inflow/__tests__/BentukRow.test.tsx src/locales/id.ts src/locales/en.ts
git commit -m "feat(masuk): Bentuk row with form picker and Tonase weight control"
```

---

### Task 4: Wire the form into `InflowForm`

**Files:**
- Modify: `src/components/InflowForm.tsx`
- Modify: `src/components/__tests__/InflowForm.test.tsx`

**Interfaces:**
- Consumes: `BentukRow` (Task 3); `formsFor`, `findForm`, `entryUnit`, `toNative`, `formUnitWord` (Task 2).
- Produces: `CategoryItem` gains `form?: string | null` and `tonaseKg?: string`; module-level `parseEnteredQty(item, category, conversionMap, forms)` and `nativeItemQty(item, category, conversionMap, forms)`; `isValidItem` and `isBrokenItem` take a fourth `forms` argument; `CategorySectionProps` and `ItemRowProps` gain `itemTypes: ItemType[]`, `openPickerId: string | null` and `onOpenPicker: (id: string | null) => void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/__tests__/InflowForm.test.tsx`. The existing `useItemTypes` mock must grow `itemTypes` with forms — update the mock at the top of the file to:

```ts
vi.mock("@/hooks/useItemTypes", () => ({
  useItemTypes: () => ({
    itemTypes: [
      {
        id: "1", category: "egg", name: "NEGERI OMEGA", unit: "kg", eggsPerUnit: 15.5,
        forms: [
          { id: "iket15kg", name: "Iket 15 kg", size: 15, unit: "kg", unitWord: "iket" },
          { id: "tray30", name: "Tray 30", size: 30, unit: "butir", unitWord: "tray" },
          { id: "curah", name: "Curah", size: 1, unit: "native" },
          { id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" },
        ],
      },
      {
        id: "2", category: "egg", name: "KAMPUNG BIASA", unit: "btr", eggsPerUnit: 1,
        forms: [{ id: "iket300", name: "Iket 300", size: 300, unit: "butir", unitWord: "iket" }],
      },
      { id: "3", category: "egg", name: "PUYUH BARU" },
    ],
    conversionMap: {
      "NEGERI OMEGA": { unit: "kg", eggs_per_unit: 15.5 },
      "KAMPUNG BIASA": { unit: "butir", eggs_per_unit: 1 },
    },
    eggProductNames: ["KAMPUNG BIASA", "NEGERI OMEGA", "PUYUH BARU"],
    getTypesByCategory: (category: string) =>
      ({ box: [{ name: "BOX OSAVE" }], label: [{ name: "LABEL OSAVE" }], packaging: [{ name: "MIKA 10" }] })[category] ?? [],
  }),
}));
```

Then add this block at the end of the file. It reuses whatever helpers the file already has for enabling a category and picking a product — read the existing tests and call the same ones rather than writing new ones.

```tsx
describe("InflowForm — Bentuk", () => {
  it("offers forms for an egg product and none for packaging", async () => {
    renderForm();
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    expect(screen.getByRole("button", { name: /Langsung \(kg\)/ })).toBeInTheDocument();
  });

  it("records a kg form as its native kg, not as the count", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.click(screen.getByRole("button", { name: /Langsung \(kg\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iket 15 kg/ }));
    fireEvent.change(screen.getByLabelText(/Jumlah \(iket\)/), { target: { value: "79" } });
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Inventaris|Catat Instock/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [entries] = onSubmit.mock.calls[0];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      product: "NEGERI OMEGA", quantity: 1185, quantityInButir: 1185,
      form: "iket15kg", formCount: 79,
    });
  });

  it("clears the quantity when the form changes, so 10 kg is never read as 10 iket", async () => {
    renderForm();
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.change(screen.getByLabelText(/Jumlah \(kg\)/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Langsung \(kg\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iket 15 kg/ }));
    expect(screen.getByLabelText(/Jumlah \(iket\)/)).toHaveValue("");
  });

  it("resets the form to Langsung when the product changes", async () => {
    renderForm();
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.click(screen.getByRole("button", { name: /Langsung \(kg\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tray 30/ }));
    await pickProduct(0, "KAMPUNG BIASA");
    expect(screen.getByRole("button", { name: /Langsung \(butir\)/ })).toBeInTheDocument();
  });

  it("blocks the submit while a Tonase line has no weight", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.click(screen.getByRole("button", { name: /Langsung \(kg\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tonase/ }));
    fireEvent.change(screen.getByLabelText(/Jumlah \(satuan\)/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Inventaris|Catat Instock/ }));
    await waitFor(() => expect(screen.getByText(/Perbaiki jumlah/)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("records a Tonase line at the weight entered on it", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.click(screen.getByRole("button", { name: /Langsung \(kg\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tonase/ }));
    fireEvent.change(screen.getByLabelText(/Berat per satuan/), { target: { value: "16,8" } });
    fireEvent.blur(screen.getByLabelText(/Berat per satuan/));
    fireEvent.change(screen.getByLabelText(/Jumlah \(satuan\)/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Inventaris|Catat Instock/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [entries] = onSubmit.mock.calls[0];
    expect(entries[0]).toMatchObject({ quantityInButir: 168, form: "tonase", formCount: 10, tonaseKg: 16.8 });
  });

  it("shows the working for a butir product once a form is chosen", async () => {
    renderForm();
    await enableCategory("egg");
    await pickProduct(0, "KAMPUNG BIASA");
    fireEvent.change(screen.getByLabelText(/Jumlah \(butir\)/), { target: { value: "1.500" } });
    expect(screen.queryByText(/× 300 butir/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Langsung \(butir\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iket 300/ }));
    fireEvent.change(screen.getByLabelText(/Jumlah \(iket\)/), { target: { value: "5" } });
    expect(screen.getByText(/5 iket × 300 butir/)).toBeInTheDocument();
    expect(screen.getByText(/1\.500/)).toBeInTheDocument();
  });

  it("shows no Bentuk row for a product with no forms", async () => {
    renderForm();
    await enableCategory("egg");
    await pickProduct(0, "PUYUH BARU");
    expect(screen.queryByText("Bentuk")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --run src/components/__tests__/InflowForm.test.tsx`
Expected: FAIL — no `Langsung (kg)` button; the submit payload has no `form`.

- [ ] **Step 3: Add the state fields and the form-aware helpers**

In `src/components/InflowForm.tsx`:

Imports:

```ts
import { BentukRow } from "@/components/inflow/BentukRow";
import { entryUnit, findForm, formUnitWord, formsFor, toNative, type EggForm } from "@/lib/eggForms";
import type { ItemType } from "@/types/inventory";
```

Extend `CategoryItem`:

```ts
interface CategoryItem {
  id: string;
  product: string;
  quantity: string;
  invoiceSupplier: string;
  /** Masuk Bentuk: catalogue form id; null/absent = Langsung. When set, `quantity`
   *  is a count of that form, not a native-unit amount. */
  form?: string | null;
  /** Raw text for a weighed form's kg per satuan. */
  tonaseKg?: string;
}
```

Replace `parseItemQty`, `isValidItem` and `isBrokenItem` with form-aware versions (keep the names used elsewhere in the file):

```ts
// What the Jumlah field holds: a count when a form is chosen, otherwise the
// native-unit amount.
const parseEnteredQty = (
  item: CategoryItem, category: InventoryCategory, conversionMap: ConversionMap, forms: EggForm[]
) =>
  parseQtyInput(
    item.quantity,
    entryUnit(findForm(forms, item.form), getStockUnit(item.product, category, conversionMap))
  );

// The native-unit quantity the line will record. Null when it can't be worked out
// yet — including a weighed form with no weight, which is why that blocks submit.
const nativeItemQty = (
  item: CategoryItem, category: InventoryCategory, conversionMap: ConversionMap, forms: EggForm[]
) =>
  toNative({
    form: findForm(forms, item.form),
    count: parseEnteredQty(item, category, conversionMap, forms),
    nativeUnit: getStockUnit(item.product, category, conversionMap),
    eggsPerUnit: conversionMap[item.product]?.eggs_per_unit,
    tonaseKg: parseQtyInput(item.tonaseKg ?? "", "kg"),
  });

const isValidItem = (
  item: CategoryItem, category: InventoryCategory, conversionMap: ConversionMap, forms: EggForm[]
) => !!item.product && (nativeItemQty(item, category, conversionMap, forms) ?? 0) > 0;

const isBrokenItem = (
  item: CategoryItem, category: InventoryCategory, conversionMap: ConversionMap, forms: EggForm[]
) => item.quantity.trim() !== "" && !isValidItem(item, category, conversionMap, forms);
```

Every existing call site of `parseItemQty`, `isValidItem` and `isBrokenItem` now needs a `forms` argument. Inside the component, `itemTypes` comes from the hook:

```ts
const { getTypesByCategory, conversionMap, eggProductNames, itemTypes } = useItemTypes();
const [openPickerId, setOpenPickerId] = useState<string | null>(null);
```

and at each call site pass `formsFor(item.product, itemTypes)`.

- [ ] **Step 4: Clear the quantity on a form change, reset the form on a product change**

Extend `updateItem` to take the extra fields and apply the two rules in one place, so both row layouts get them:

```ts
  const updateItem = (
    category: InventoryCategory,
    itemId: string,
    field: keyof CategoryItem,
    value: string | null
  ) => {
    setCategoryData((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        items: prev[category].items.map((item) => {
          if (item.id !== itemId) return item;
          const next = { ...item, [field]: value } as CategoryItem;
          // A count of iket must never be read as the previous kg amount, and a
          // form from the old product must not survive into the new one.
          if (field === "form" && value !== (item.form ?? null)) {
            next.quantity = "";
            if (findForm(formsFor(item.product, itemTypes), value)?.unit !== "weighed") next.tonaseKg = "";
          }
          if (field === "product" && value !== item.product) {
            next.form = null;
            next.tonaseKg = "";
          }
          return next;
        }),
      },
    }));
  };
```

Note `value` is now `string | null`, so `onUpdateItem`'s type in `sectionProps`, `CategorySectionProps` and `ItemRowProps` must widen to match.

- [ ] **Step 4b: Prefill a weighed form's weight**

`InflowForm` does not receive the saved inflows today, so add an optional prop beside
`stockSummary` and default it to `[]`:

```ts
interface InflowFormProps {
  onSubmit: (entries: InflowEntry[], userEmail: string) => Promise<boolean>;
  // Tablet (7a) only: the Ringkasan's stock before -> after.
  stockSummary?: StockSummary[];
  // Masuk Bentuk: for prefilling a weighed form's kg per satuan from the day's
  // most recent receipt.
  inflows?: InflowEntry[];
  tablet?: boolean;
}
```

Pass it from the Masuk page the same way `stockSummary` is passed, then add:

```ts
  // A weighed form's weight: whatever was last typed on another line in this form,
  // else the newest saved receipt for the same date, else empty — which blocks
  // submit until someone fills it in.
  const prefillTonaseKg = (): string => {
    for (const category of CATEGORIES) {
      for (const item of [...categoryData[category].items].reverse()) {
        if (parseQtyInput(item.tonaseKg ?? "", "kg") != null) return item.tonaseKg as string;
      }
    }
    const saved = inflows
      .filter((i) => i.date === date && i.tonaseKg != null && !i.voidedAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return saved?.tonaseKg != null ? qtyInputText(saved.tonaseKg) : "";
  };
```

`qtyInputText` comes from `@/lib/stockCount` — add it to that import. In `updateItem`'s
`field === "form"` branch, replace the `next.tonaseKg = ""` line with:

```ts
            const picked = findForm(formsFor(item.product, itemTypes), value);
            next.tonaseKg = picked?.unit === "weighed" ? (item.tonaseKg || prefillTonaseKg()) : "";
```

Add one test for it in Step 1's block:

```tsx
  it("prefills a second Tonase line with the weight already typed", async () => {
    renderForm();
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.click(screen.getByRole("button", { name: /Langsung \(kg\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tonase/ }));
    fireEvent.change(screen.getByLabelText(/Berat per satuan/), { target: { value: "16,8" } });
    fireEvent.click(screen.getByRole("button", { name: /Tambah Item/ }));
    await pickProduct(1, "NEGERI OMEGA");
    const buttons = screen.getAllByRole("button", { name: /Langsung \(kg\)/ });
    fireEvent.click(buttons[buttons.length - 1]);
    fireEvent.click(screen.getAllByRole("button", { name: /Tonase/ }).slice(-1)[0]);
    expect(screen.getAllByLabelText(/Berat per satuan/).slice(-1)[0]).toHaveValue("16,8");
  });
```

- [ ] **Step 5: Render the row and update the quantity field and conversion line**

Pass the new props down through `sectionProps`:

```ts
    itemTypes,
    openPickerId,
    onOpenPicker: setOpenPickerId,
```

In **both** `TableItemRow` (tablet) and the phone row component, replace the quantity `Input`'s `aria-label` and `placeholder` so the unit word follows the form, and render `BentukRow` under the main row. In `TableItemRow`, after the `</div>` that closes `TB_ROW` and before the `noConversion` warning:

```tsx
      <BentukRow
        forms={forms}
        formId={item.form ?? null}
        tonaseKg={item.tonaseKg ?? ""}
        nativeUnit={unit}
        open={openPickerId === item.id}
        onOpenChange={(next) => onOpenPicker(next ? item.id : null)}
        onChangeForm={(id) => onUpdate("form", id)}
        onChangeTonase={(value) => onUpdate("tonaseKg", value)}
      />
```

where, at the top of the row component:

```tsx
  const forms = formsFor(item.product, itemTypes);
  const form = findForm(forms, item.form);
  const unitWord = formUnitWord(form, unit);
  const enteredQty = parseEnteredQty(item, category, conversionMap, forms) ?? 0;
  const nativeQty = nativeItemQty(item, category, conversionMap, forms) ?? 0;
```

The quantity field becomes:

```tsx
          <Input
            type="text"
            inputMode="decimal"
            value={item.quantity}
            onChange={(e) => onUpdate("quantity", e.target.value)}
            aria-label={`${t.common.quantity} (${unitWord})`}
            aria-invalid={broken || undefined}
            placeholder={form ? t.inflow.qtyPlaceholderForm : t.outflow.enterQty}
            className={cn(TB_CONTROL, "pr-[66px] font-semibold tabular-nums placeholder:font-normal", broken && BROKEN_INPUT)}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13.5px] text-ek-mfg">{unitWord}</span>
```

And the conversion line's condition and body:

```tsx
      {/* Langsung on a butir product is 1:1, so its line would just repeat the
          number. With a form chosen there is working worth showing. */}
      {nativeQty > 0 && (unit === "kg" || !!form) && (
        <div className="ml-9 mr-[52px] flex items-center gap-2 rounded-[9px] bg-emerald-50 px-3 py-2 text-sm">
          <Calculator aria-hidden className="h-[15px] w-[15px] shrink-0 text-emerald-600" />
          <span>
            {form && form.unit !== "native" && (
              <>
                <b className="font-bold">{nf(enteredQty)}</b> {unitWord} ×{" "}
                <b className="font-bold">
                  {form.unit === "weighed" ? `${item.tonaseKg} kg` : `${nf(form.size as number)} ${form.unit}`}
                </b>{" "}
                ={" "}
              </>
            )}
            <b className="font-bold">{nf(nativeQty)}</b> {unit}
            {unit === "kg" && (
              <>
                {" = "}
                <b className="font-bold text-emerald-700">{nf(convertToButir(item.product, nativeQty, conversionMap))}</b> butir{" "}
                <span className="text-ek-mfg">(× {nf(conversionMap[item.product].eggs_per_unit)} butir/kg)</span>
              </>
            )}
          </span>
        </div>
      )}
```

Make the identical change in the phone row component (it has its own copy of the quantity field and the `showConversion` block; replace `showConversion` with the same condition).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --run src/components/__tests__/InflowForm.test.tsx`
Expected: PASS, including every pre-existing case in that file.

- [ ] **Step 7: Commit**

```bash
git add src/components/InflowForm.tsx src/components/__tests__/InflowForm.test.tsx
git commit -m "feat(masuk): enter an egg line in the form it arrived in"
```

---

### Task 5: Persist `form`, `form_count` and `tonase_kg`

**Files:**
- Modify: `src/types/inventory.ts` (`InflowEntry`)
- Modify: `src/components/InflowForm.tsx` (`handleSubmit`)
- Modify: `src/hooks/useInventorySync.ts` (the inflow read mapper, `addInflow`, `addMultipleInflows`)

**Interfaces:**
- Consumes: `nativeItemQty`, `parseEnteredQty` (Task 4).
- Produces: `InflowEntry.form?: string | null`, `InflowEntry.formCount?: number`, `InflowEntry.tonaseKg?: number`, all round-tripped through Supabase.

- [ ] **Step 1: Write the failing test**

The payload assertions in Task 4 already cover `handleSubmit`. Add a round-trip test for the hook mapping to `src/hooks/__tests__/useInventorySync.test.ts` if that file exists; if it does not, add this to `src/components/__tests__/InflowForm.test.tsx` instead:

```tsx
  it("sends no form fields for a Langsung line", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.change(screen.getByLabelText(/Jumlah \(kg\)/), { target: { value: "52,89" } });
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Inventaris|Catat Instock/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [entries] = onSubmit.mock.calls[0];
    expect(entries[0]).toMatchObject({ quantityInButir: 52.89, form: null });
    expect(entries[0].formCount).toBeUndefined();
    expect(entries[0].tonaseKg).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --run src/components/__tests__/InflowForm.test.tsx -t "Langsung line"`
Expected: FAIL — `form` is undefined rather than null.

- [ ] **Step 3: Extend `InflowEntry`**

In `src/types/inventory.ts`, inside `InflowEntry`, after `invoiceSupplier`:

```ts
  /** Masuk Bentuk: the catalogue form id this line was entered in; null = Langsung. */
  form?: string | null;
  /** How many of that form were entered. `quantityInButir` is still the native result. */
  formCount?: number;
  /** kg per satuan used for a weighed form, kept so history survives later loads. */
  tonaseKg?: number;
```

- [ ] **Step 4: Fill them in `handleSubmit`**

Replace the body of the per-item loop in `handleSubmit` with:

```ts
      for (const item of data.items) {
        if (!item.product || !item.quantity) continue;

        const forms = formsFor(item.product, itemTypes);
        const form = findForm(forms, item.form);
        const quantityNum = nativeItemQty(item, category, conversionMap, forms);
        if (quantityNum == null || quantityNum <= 0) continue;

        const unit = category === "egg" ? getProductUnit(item.product, conversionMap) : "pcs";
        // kg-native: stock is stored in the product's own unit, and nativeItemQty
        // already returned it, so there is no conversion here.
        const quantityInButir = quantityNum;
        const count = parseEnteredQty(item, category, conversionMap, forms);
        const weight = parseQtyInput(item.tonaseKg ?? "", "kg");

        entries.push({
          id: crypto.randomUUID(),
          date,
          product: item.product,
          quantity: quantityNum,
          unit,
          quantityInButir,
          remainingButir: quantityInButir,
          createdAt: new Date().toISOString(),
          category,
          invoiceSupplier: item.invoiceSupplier || undefined,
          form: form ? form.id : null,
          formCount: form && count != null ? count : undefined,
          tonaseKg: form?.unit === "weighed" && weight != null ? weight : undefined,
        });
      }
```

- [ ] **Step 5: Persist and read back in `useInventorySync`**

In `addInflow`'s `insert({ ... })` and in `addMultipleInflows`'s `insertData` map, add the same three lines to each:

```ts
          form: entry.form ?? null,
          form_count: entry.formCount ?? null,
          tonase_kg: entry.tonaseKg ?? null,
```

And in the inflow read mapper (where `stockAdjustmentId: row.stock_adjustment_id ?? undefined` is set), add:

```ts
        form: row.form ?? null,
        formCount: row.form_count ?? undefined,
        tonaseKg: row.tonase_kg ?? undefined,
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run src/components/__tests__/InflowForm.test.tsx`
Expected: no type errors; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/inventory.ts src/components/InflowForm.tsx src/hooks/useInventorySync.ts
git commit -m "feat(masuk): store the form, its count and the Tonase weight on an inflow"
```

---

### Task 6: Ringkasan — the form note and per-product chaining

**Files:**
- Modify: `src/components/InflowSummaryPanel.tsx`
- Modify: `src/components/InflowForm.tsx` (the `groups` build in the tablet branch)
- Modify: `src/components/__tests__/InflowForm.test.tsx`

**Interfaces:**
- Consumes: `nativeItemQty`, `parseEnteredQty`, `formsFor`, `findForm`, `formUnitWord` (Tasks 2 and 4).
- Produces: `InflowSummaryLine` gains `formName?: string`, `formCount?: number`, `formUnitWord?: string`, `tonaseKg?: string`.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/__tests__/InflowForm.test.tsx` (tablet mode, which is where the panel renders):

```tsx
describe("InflowForm — Ringkasan with forms", () => {
  it("notes the form and count under the line", async () => {
    renderForm({ tablet: true, stockSummary: [{ product: "NEGERI OMEGA", totalStock: 412, category: "egg" }] });
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.click(screen.getByRole("button", { name: /Langsung \(kg\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iket 15 kg/ }));
    fireEvent.change(screen.getByLabelText(/Jumlah \(iket\)/), { target: { value: "79" } });

    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText(/Iket 15 kg × 79/)).toBeInTheDocument();
  });

  it("chains stock before to after down two lines of one product", async () => {
    renderForm({ tablet: true, stockSummary: [{ product: "NEGERI OMEGA", totalStock: 412, category: "egg" }] });
    await enableCategory("egg");
    await pickProduct(0, "NEGERI OMEGA");
    fireEvent.change(screen.getByLabelText(/Jumlah \(kg\)/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Tambah Item/ }));
    await pickProduct(1, "NEGERI OMEGA");
    const fields = screen.getAllByLabelText(/Jumlah \(kg\)/);
    fireEvent.change(fields[1], { target: { value: "50" } });

    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText(/412 → 512/)).toBeInTheDocument();
    expect(within(panel).getByText(/512 → 562/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --run src/components/__tests__/InflowForm.test.tsx -t "Ringkasan with forms"`
Expected: FAIL — no form note; both lines read `412 → …`.

- [ ] **Step 3: Extend `InflowSummaryLine` and render the note**

In `src/components/InflowSummaryPanel.tsx`, add to `InflowSummaryLine`:

```ts
  /** Masuk Bentuk: set when the line was entered as a count of a form. */
  formName?: string;
  formCount?: number;
  formUnitWord?: string;
  /** Weighed forms only, as typed, so the note shows the scale reading. */
  tonaseKg?: string;
```

Where the line currently renders `t.inflow.stockLine`, prefix the form note on the same sub-line:

```tsx
                  {line.formName && (
                    <>
                      {line.formName} × {line.formCount}
                      {line.tonaseKg ? ` (${line.tonaseKg} kg)` : ""}
                      {" · "}
                    </>
                  )}
```

- [ ] **Step 4: Chain the running stock and pass the form fields**

In `InflowForm.tsx`'s tablet branch, replace the `groups` build with:

```ts
    // Stock before -> after runs DOWN the lines per product: a second line of the
    // same product starts where the first one left off.
    const running: Record<string, number> = {};
    const groups: InflowSummaryGroup[] = enabled.map((category) => ({
      category,
      ...CATEGORY_LOOK[category],
      lines: categoryData[category].items
        .filter((item) => isValidItem(item, category, conversionMap, formsFor(item.product, itemTypes)))
        .map((item) => {
          const forms = formsFor(item.product, itemTypes);
          const form = findForm(forms, item.form);
          const quantity = nativeItemQty(item, category, conversionMap, forms) as number;
          const unit = getStockUnit(item.product, category, conversionMap);
          const now =
            running[item.product] ??
            (stockSummary.find((s) => s.product === item.product)?.totalStock ?? 0);
          const after = now + quantity;
          running[item.product] = after;
          return {
            id: item.id,
            product: item.product,
            invoiceSupplier: item.invoiceSupplier,
            quantity,
            now,
            after,
            unit,
            formName: form ? form.name : undefined,
            formCount: form ? parseEnteredQty(item, category, conversionMap, forms) ?? undefined : undefined,
            formUnitWord: form ? formUnitWord(form, unit) : undefined,
            tonaseKg: form?.unit === "weighed" ? item.tonaseKg : undefined,
          };
        }),
    }));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --run src/components/__tests__/InflowForm.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/InflowSummaryPanel.tsx src/components/InflowForm.tsx src/components/__tests__/InflowForm.test.tsx
git commit -m "feat(masuk): Ringkasan shows the form and chains stock per product"
```

---

### Task 7: Verify, check it in the browser, open the PR

**Files:** none changed unless the checks find something.

- [ ] **Step 1: Run the verify gate**

Run: `npm run verify`
Expected: the Supabase ref guard passes, `tsc --noEmit` is clean, and the whole vitest suite passes. If vitest flakes or OOMs (workers exit, `tests 0ms`, a hang), rerun with:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --pool=forks --no-file-parallelism
```

A hang at `tests 0ms` on a component file means an infinite render loop — most likely an unstable object identity in a dependency array, such as `formsFor(...)` being called inside a `useMemo` dependency list rather than inside its body.

- [ ] **Step 2: Copy the working `.env` into this worktree**

The committed `.env` carries a stale key that the live project rejects with 401, and the ref guard does not catch it, so sign-in fails in a fresh worktree:

```bash
cp ../../../.env .env
```

Never stage it: `git status --short` must not list `.env` before a commit.

- [ ] **Step 3: Check it in the browser**

Start the dev server with the `preview_start` tool using the config name in `.claude/launch.json`, then open Masuk and, on a tablet viewport, confirm: the Bentuk row appears for an egg product with forms and not for Kemasan; the picker opens inline and pushes content down; picking a form clears the quantity and swaps the unit word; a Tonase line shows the weight bar and its conversion line updates as the weight changes; and Ringkasan chains two lines of one product. Read the console with `read_console_messages` and expect no errors.

- [ ] **Step 4: Commit anything the checks changed, then push and open the PR**

```bash
git push -u origin feat/masuk-bentuk
```

PR body: what it does, the link to the spec, the note that migration `20261116000000_egg_forms` is **already applied** to production, and the three deliberate deviations from the spec. No stock, sales or volume figures anywhere in it.

- [ ] **Step 5: Tell the owner what is left**

The Catalog has no editor for `forms`, by design. Changing a form's size needs a SQL update until one is built. Say so, and list the sizes that were seeded from the sheet and still want the warehouse's confirmation: `No'6`, `Negeri 6's`, and Iketan Osave at 150 butir.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Form catalogue on `item_types.forms` | 1 (column + seed), 2 (`formsFor`, `ItemType.forms`, hook) |
| Three inflow columns, `quantity_butir` unchanged | 1 (columns), 5 (written and read back) |
| Conversion, all five rules | 2 (`toNative` + tests) |
| Weighed only on a kg product | 2 (`toNative` guard + test) |
| Bentuk row, picker, Langsung first, one open at a time | 3 (component), 4 (`openPickerId`) |
| Clear quantity on form change, reset on product change | 4 (`updateItem`) |
| Quantity field unit word and decimals rule | 2 (`entryUnit`, `formUnitWord`), 4 (field) |
| Conversion line, including the butir-product change | 4 |
| Tonase control: ±0,1, range, select on focus, restore on blur | 3 |
| Tonase prefill order | 4 (Step 4b, added by this review) |
| Ringkasan form note and per-product chaining | 6 |
| Validation blocks a form with no count and Tonase with no weight | 4 (via `nativeItemQty` returning null) |
| Locale strings in both files | 3 |
| Tests | 2, 3, 4, 5, 6 |

**Gap found and closed:** the spec's Tonase prefill order (last weight typed on another line in the form being filled, else the most recent saved inflow for that date, else empty) had no task. It needs the saved `inflows` and a scan of the current `categoryData`, so it went into Task 4 as **Step 4b**, with the new `inflows` prop, the `prefillTonaseKg` helper, the `updateItem` change and a test.

**Placeholder scan:** none. Every code step carries the code; every test step names the command and the expected result.

**Type consistency:** `EggForm`, `FormUnit`, `formsFor`, `findForm`, `entryUnit`, `toNative`, `formUnitWord`, `TONASE_MIN_KG`, `TONASE_MAX_KG`, `TONASE_STEP_KG`, `parseEnteredQty`, `nativeItemQty`, `BentukRowProps`, `InflowSummaryLine.formName/formCount/formUnitWord/tonaseKg`, `InflowEntry.form/formCount/tonaseKg` are each defined once and used with the same names and types throughout. `onUpdateItem` widens to `string | null` in Task 4 and every consumer is listed there.
