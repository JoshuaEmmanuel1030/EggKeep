# Per-SKU Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users record returns per order-line (SKU) in pieces, summed per egg product for stock, with classes OK/Retak/Hancur (code O/R/H), Negeri pieces→kg at flat 1/15.5, and per-SKU display on the Activities feed.

**Architecture:** Read-mostly over the existing returns pipeline. One DB migration adds `returns.sku_code` and threads it through `record_return` (cap/retakan/restock logic unchanged). The return dialog becomes per-order-line; pieces→native conversion and the shared-egg combined cap are pure, tested helpers. The feed gets a per-SKU breakdown from `usePriorReturns`.

**Tech Stack:** React + TypeScript, Supabase (Postgres RPC, MCP `apply_migration`), Vitest + React Testing Library (jsdom), i18n `src/locales/{en,id}.ts`.

Spec: `docs/superpowers/specs/2026-10-08-per-sku-returns-design.md`. Prior branch context: `docs/superpowers/plans/2026-10-08-returns-in-activities.md` (same branch `feat/returns-in-activities`, PR #7).

## Global Constraints

- Verify gate: `npx tsc --noEmit -p tsconfig.app.json` and `npm test -- --run` both pass. (The SQL in Task 1 has no vitest coverage — see its note.)
- DB migrations apply via Supabase MCP `apply_migration` against project `lgtixzpjbkzapecirbfj`, BEFORE pushing frontend that depends on them. **Applying to prod is a gated step the controller/human performs — NOT a subagent.**
- Stock/cap math is in the product's NATIVE unit (kg for kg-native/Negeri, butir otherwise). Pieces↔kg conversion is client-side.
- `NEGERI_PIECES_PER_KG = 15.5`, flat, for every kg-native product. kg-native detected via `conversionMap[eggProduct].unit === 'kg'`.
- Code letters are FIXED `O`/`R`/`H` (OK/Retak/Hancur = restock/retakan/writeoff), not translated. Dialog class labels are `OK` / `Retak` / `Hancur` in BOTH locales.
- Every user-facing string in BOTH `src/locales/en.ts` and `id.ts`.
- DB disposition values stay `restock`/`retakan`/`writeoff` (do NOT rename the enum). Only display labels/letters change.
- Repo compiles with `strict: false`.
- Invariants: eggs pool per product (one outflow per egg); retakan = fresh inflow on the `… (RETAKAN)` child; restock to the egg's own FIFO; cap keyed by `outflow_id`.

---

### Task 1: DB migration — `returns.sku_code` + RPC passthrough

**Files:**
- Create: `supabase/migrations/20261008000000_returns_sku_code.sql`

**Interfaces:**
- Produces: `returns.sku_code text` column; `record_return` accepts `sku_code` per line and persists it. No signature change (still `record_return(p_return jsonb)`).

**Note on testing:** Postgres functions are not covered by vitest. Verification here is (a) the diff vs `20260921000000_retakan_reuse_guard.sql` touches ONLY the two `insert into returns` lines, and (b) a gated apply to prod (or a Supabase dev branch) done by the controller/human. No frontend depends on this until Task 5 submits `sku_code`, and the column is nullable, so order is safe.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261008000000_returns_sku_code.sql`. It adds the column, then redefines `record_return` — copied verbatim from `20260921000000_retakan_reuse_guard.sql` with ONLY the `insert into returns` column list and values list extended with `sku_code`:

```sql
-- Per-SKU returns: tag each return row with the pack SKU it was entered under,
-- so the Activities feed can attribute a pooled-egg return to its order line.
-- Nullable + no backfill: existing rows (and loose/manual returns) stay null and
-- match by product. The cap/retakan/restock logic is unchanged from 20260921.

alter table public.returns add column if not exists sku_code text;

create or replace function public.record_return(p_return jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_line jsonb;
  v_id uuid;
  v_outflow_id uuid;
  v_qty numeric;
  v_disp text;
  v_cat inventory_category;
  v_outflow outflows%rowtype;
  v_returned numeric;
  v_remaining numeric;
  v_restore numeric;
  v_already numeric;
  v_total_deducted numeric;
  v_total_restored numeric;
  v_eps constant numeric := 1e-9;
  v_return_date date := (p_return->>'return_date')::date;
  v_buyer text := nullif(p_return->>'buyer_name','');
  v_reason text := nullif(p_return->>'reason','');
  ded record;
  v_parent record;
  v_retakan_name text;
  v_retakan_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: must be signed in to record returns';
  end if;
  if p_return->'lines' is null or jsonb_typeof(p_return->'lines') <> 'array'
     or jsonb_array_length(p_return->'lines') = 0 then
    raise exception 'NO_ENTRIES: lines must be a non-empty array';
  end if;

  for v_line in select * from jsonb_array_elements(p_return->'lines') loop
    v_id         := nullif(v_line->>'id','')::uuid;
    v_outflow_id := (v_line->>'outflow_id')::uuid;
    v_qty        := (v_line->>'quantity')::numeric;
    v_disp       := v_line->>'disposition';
    v_cat        := (v_line->>'category')::inventory_category;

    if v_outflow_id is null or v_qty is null or v_qty <= 0
       or v_disp not in ('restock','writeoff','retakan') then
      raise exception 'INVALID_ENTRY: outflow_id, positive quantity, valid disposition required (got % / % / %)',
        v_outflow_id, v_qty, v_disp;
    end if;

    if v_id is not null and exists (select 1 from returns where id = v_id) then
      continue;
    end if;
    if v_id is null then v_id := gen_random_uuid(); end if;

    select * into v_outflow from outflows where id = v_outflow_id for update;
    if not found then
      raise exception 'INVALID_ENTRY: outflow % not found', v_outflow_id;
    end if;
    if v_outflow.voided_at is not null then
      raise exception 'OUTFLOW_VOIDED: cannot return against a voided outflow %', v_outflow_id;
    end if;

    select coalesce(sum(quantity),0) into v_returned from returns where outflow_id = v_outflow_id;
    if v_returned + v_qty > v_outflow.quantity_butir + v_eps then
      raise exception 'RETURN_EXCEEDS_OUTFLOW: % returned + % > % sold',
        v_returned, v_qty, v_outflow.quantity_butir;
    end if;

    -- CHANGED: persist sku_code (null for loose/manual returns).
    insert into returns (id, outflow_id, return_date, product, item_type_id, category,
                         quantity, disposition, buyer_name, reason, user_id, sku_code)
    values (v_id, v_outflow_id, v_return_date, v_line->>'product',
            (select id from item_types where name = v_line->>'product' and category = v_cat and deleted_at is null limit 1),
            v_cat, v_qty, v_disp, v_buyer, v_reason, v_user, nullif(v_line->>'sku_code',''));

    if v_disp = 'writeoff' then
      continue;
    end if;

    if v_disp = 'retakan' then
      select id, category, unit, eggs_per_unit, freshness_days, low_stock_threshold, count_tolerance
        into v_parent
        from item_types
        where name = v_line->>'product' and category = v_cat and deleted_at is null
        order by created_at asc
        limit 1;
      if not found then
        raise exception 'PARENT_TYPE_MISSING: no active catalog item %/% to attach a retakan child',
          v_cat, v_line->>'product';
      end if;

      v_retakan_name := (v_line->>'product') || ' (RETAKAN)';
      insert into item_types (name, category, unit, eggs_per_unit, freshness_days,
                              low_stock_threshold, count_tolerance, is_retakan, parent_item_type_id)
      values (v_retakan_name, v_parent.category, v_parent.unit, v_parent.eggs_per_unit,
              v_parent.freshness_days, v_parent.low_stock_threshold, v_parent.count_tolerance,
              true, v_parent.id)
      on conflict (category, name) do nothing;

      update item_types
        set deleted_at = null,
            is_retakan = true,
            parent_item_type_id = coalesce(parent_item_type_id, v_parent.id)
        where category = v_parent.category and name = v_retakan_name
          and (deleted_at is not null or parent_item_type_id is null or is_retakan = false);

      select id into v_retakan_id from item_types
        where category = v_parent.category and name = v_retakan_name;

      insert into inflows (id, date, product, item_type_id, category,
                           quantity_original, quantity_butir, remaining_butir, user_id, created_at)
      values (gen_random_uuid(), v_return_date, v_retakan_name, v_retakan_id, v_parent.category,
              v_qty, v_qty, v_qty, v_user, now());
      continue;
    end if;

    select coalesce(sum(fd.quantity_deducted),0) into v_total_deducted
      from fifo_deductions fd where fd.outflow_id = v_outflow_id;
    select coalesce(sum(rr.quantity_restored),0) into v_total_restored
      from return_restocks rr join returns r on r.id = rr.return_id
      where r.outflow_id = v_outflow_id;
    if v_qty > (v_total_deducted - v_total_restored) + v_eps then
      raise exception 'RESTOCK_EXCEEDS_DEDUCTED: % > deductible % (deducted % - restored %)',
        v_qty, v_total_deducted - v_total_restored, v_total_deducted, v_total_restored;
    end if;

    v_remaining := v_qty;
    for ded in
      select fd.inflow_id, fd.quantity_deducted
      from fifo_deductions fd
      join inflows i on i.id = fd.inflow_id
      where fd.outflow_id = v_outflow_id and i.voided_at is null
      order by i.date asc, i.created_at asc
      for update of i
    loop
      exit when v_remaining <= v_eps;
      select coalesce(sum(rr.quantity_restored),0) into v_already
        from return_restocks rr
        join returns r on r.id = rr.return_id
        where r.outflow_id = v_outflow_id and rr.inflow_id = ded.inflow_id;
      v_restore := least(v_remaining, ded.quantity_deducted - v_already);
      if v_restore <= v_eps then continue; end if;

      update inflows set remaining_butir = remaining_butir + v_restore where id = ded.inflow_id;
      insert into return_restocks (return_id, inflow_id, quantity_restored)
      values (v_id, ded.inflow_id, v_restore);
      v_remaining := v_remaining - v_restore;
    end loop;

    if v_remaining > v_eps then
      raise exception 'RESTOCK_UNALLOCATED: % butir has no live batch to restore to (voided batch?)', v_remaining;
    end if;
  end loop;
end;
$$;

grant execute on function public.record_return(jsonb) to authenticated;
```

- [ ] **Step 2: Self-check the diff**

Run: `git diff --no-index supabase/migrations/20260921000000_retakan_reuse_guard.sql supabase/migrations/20261008000000_returns_sku_code.sql` (expect only: the `alter table` header lines, the two `insert into returns` lines gaining `sku_code` / `nullif(v_line->>'sku_code','')`).
Expected: no other logic lines differ.

- [ ] **Step 3: Commit** (apply to prod is a separate gated step the controller/human runs via MCP `apply_migration` — do NOT apply from the subagent)

```bash
git add supabase/migrations/20261008000000_returns_sku_code.sql
git commit -m "feat(returns): add sku_code to returns + record_return passthrough"
```

---

### Task 2: `returnCode` → O/R/H, label i18n, `skuCode` on the payload

**Files:**
- Modify: `src/lib/activityGrouping.ts` (returnCode letters)
- Modify: `src/lib/__tests__/activityGrouping.test.ts` (expectations)
- Modify: `src/types/returns.ts` (`ReturnLineInput.skuCode`)
- Modify: `src/lib/returnRpc.ts` (map `sku_code`)
- Modify: `src/locales/en.ts`, `src/locales/id.ts` (class labels)

**Interfaces:**
- Produces: `returnCode` emitting `O`/`R`/`H`; `ReturnLineInput` with optional `skuCode: string`; RPC payload lines carrying `sku_code`.

- [ ] **Step 1: Update the returnCode tests to O/R/H**

In `src/lib/__tests__/activityGrouping.test.ts`, change the three expectations:

```ts
describe("returnCode", () => {
  it("omits zero buckets", () => {
    expect(returnCode({ restock: 25, retakan: 25, writeoff: 0, total: 50 })).toBe("25O 25R");
  });
  it("renders all three when present", () => {
    expect(returnCode({ restock: 20, retakan: 25, writeoff: 5, total: 50 })).toBe("20O 25R 5H");
  });
  it("is empty when nothing returned", () => {
    expect(returnCode({ restock: 0, retakan: 0, writeoff: 0, total: 0 })).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run src/lib/__tests__/activityGrouping.test.ts`
Expected: FAIL (still emits `25B 25R`).

- [ ] **Step 3: Change the letters in `returnCode`**

In `src/lib/activityGrouping.ts`, update the three pushes:

```ts
export function returnCode(r: ReturnsSummary): string {
  const parts: string[] = [];
  if (r.restock > 0) parts.push(`${r.restock.toLocaleString()}O`);
  if (r.retakan > 0) parts.push(`${r.retakan.toLocaleString()}R`);
  if (r.writeoff > 0) parts.push(`${r.writeoff.toLocaleString()}H`);
  return parts.join(" ");
}
```

Update its comment to say `OK/Retak/Hancur`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run src/lib/__tests__/activityGrouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `skuCode` to the payload type + RPC mapping**

In `src/types/returns.ts`, add to `ReturnLineInput`:

```ts
  // The pack SKU this return was entered under (null for loose/manual returns),
  // so the feed can attribute a pooled-egg return to its order line.
  skuCode?: string;
```

In `src/lib/returnRpc.ts`, inside `lines.map`, add the field:

```ts
        lines: input.lines.map((l) => ({
          id: l.id,
          outflow_id: l.outflowId,
          product: l.product,
          category: l.category,
          quantity: l.quantity,
          disposition: l.disposition,
          sku_code: l.skuCode ?? null,
        })),
```

- [ ] **Step 6: Rename the dialog class labels in both locales**

In `src/locales/en.ts` and `src/locales/id.ts`, set the same values in both:

```ts
    returnRestock: 'OK',
    returnWriteOff: 'Hancur',
    returnRetakan: 'Retak',
```

(leave `returnRetakanHelp` as-is.)

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean.

```bash
git add src/lib/activityGrouping.ts src/lib/__tests__/activityGrouping.test.ts src/types/returns.ts src/lib/returnRpc.ts src/locales/en.ts src/locales/id.ts
git commit -m "feat(returns): O/R/H code, OK/Retak/Hancur labels, skuCode on payload"
```

---

### Task 3: `usePriorReturns` — per-SKU breakdown

**Files:**
- Modify: `src/hooks/usePriorReturns.ts`
- Modify: `src/components/__tests__/RecordReturnDialog.test.tsx` (mock shape)

**Interfaces:**
- Produces:
  ```ts
  export interface OutflowReturns extends ReturnsSummary {
    bySku: Record<string, ReturnsSummary>; // key "" for null sku_code
  }
  export function usePriorReturns(ids): Record<string, OutflowReturns>;
  ```
  `.total`/`.restock`/… stay at top level (dialog cap unchanged); `bySku` is new.

- [ ] **Step 1: Update the dialog test mock to the extended shape**

In `src/components/__tests__/RecordReturnDialog.test.tsx`, the prior-return mock (the `it("caps to what's still returnable…")` test) must include `bySku`:

```ts
    priorReturnsMock.mockReturnValue({
      "outflow-1": { restock: 100, retakan: 0, writeoff: 0, total: 100, bySku: {} },
    });
```

And change the mock's type import usage from `ReturnsSummary` to the new `OutflowReturns`:

```ts
import type { OutflowReturns } from "@/hooks/usePriorReturns";
const priorReturnsMock = vi.fn<() => Record<string, OutflowReturns>>(() => ({}));
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run src/components/__tests__/RecordReturnDialog.test.tsx`
Expected: FAIL to typecheck/compile (OutflowReturns not exported yet).

- [ ] **Step 3: Extend the hook**

In `src/hooks/usePriorReturns.ts`:
- Add the `OutflowReturns` interface (export).
- Add `sku_code` to the `.select(...)`.
- Build `bySku` alongside the totals:

```ts
export interface OutflowReturns extends ReturnsSummary {
  bySku: Record<string, ReturnsSummary>;
}

// ...inside the hook, return type Record<string, OutflowReturns>:
      const { data, error } = await (supabase.from as any)("returns")
        .select("outflow_id, quantity, disposition, sku_code")
        .in("outflow_id", ids);
      if (cancelled || error || !data) return;
      const next: Record<string, OutflowReturns> = {};
      for (const r of data as {
        outflow_id: string; quantity: number; disposition: Disposition; sku_code: string | null;
      }[]) {
        const o =
          next[r.outflow_id] ??
          (next[r.outflow_id] = { restock: 0, retakan: 0, writeoff: 0, total: 0, bySku: {} });
        const q = Number(r.quantity);
        o[r.disposition] += q;
        o.total += q;
        const skuKey = r.sku_code ?? "";
        const s = o.bySku[skuKey] ?? (o.bySku[skuKey] = { restock: 0, retakan: 0, writeoff: 0, total: 0 });
        s[r.disposition] += q;
        s.total += q;
      }
      setMap(next);
```

Update `useState`/return type to `Record<string, OutflowReturns>`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run src/components/__tests__/RecordReturnDialog.test.tsx`
Expected: PASS (cap still reads `.total`).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean (the feed in GroupedActivityLog already reads `returnsMap[id]` as `ReturnsSummary`; `OutflowReturns extends ReturnsSummary`, so existing reads still compile).

```bash
git add src/hooks/usePriorReturns.ts src/components/__tests__/RecordReturnDialog.test.tsx
git commit -m "feat(returns): usePriorReturns exposes per-SKU breakdown (bySku)"
```

---

### Task 4: Pure entry helpers — pieces→native + shared-egg cap

**Files:**
- Modify: `src/lib/returnsCap.ts` (add helpers)
- Modify/Create: `src/lib/__tests__/returnsCap.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export const NEGERI_PIECES_PER_KG = 15.5;
  // pieces -> product native unit. kg: round(pieces/15.5, 2). butir: pieces as-is.
  export function piecesToNative(pieces: number, unit: "kg" | "btr" | string | undefined): number;
  // native -> pieces for display caps. inverse of the above (kg: native*15.5).
  export function nativeToPieces(native: number, unit: "kg" | "btr" | string | undefined): number;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/returnsCap.test.ts` (create if absent, importing the existing `remainingReturnable` too if the file is new — check the current file first):

```ts
import { piecesToNative, nativeToPieces, NEGERI_PIECES_PER_KG } from "../returnsCap";

describe("piecesToNative / nativeToPieces", () => {
  it("passes butir through unchanged", () => {
    expect(piecesToNative(200, "btr")).toBe(200);
    expect(nativeToPieces(200, "btr")).toBe(200);
  });
  it("converts kg pieces at flat 15.5, rounded to 2dp", () => {
    expect(piecesToNative(31, "kg")).toBe(2); // 31/15.5 = 2.00
    expect(piecesToNative(100, "kg")).toBe(6.45); // 6.4516.. -> 6.45
    expect(NEGERI_PIECES_PER_KG).toBe(15.5);
  });
  it("nativeToPieces inverts kg", () => {
    expect(nativeToPieces(2, "kg")).toBe(31);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run src/lib/__tests__/returnsCap.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement**

Append to `src/lib/returnsCap.ts`:

```ts
// Negeri (kg-native eggs) are counted back in pieces and converted to kg at a
// flat 15.5 pieces/kg (owner's rule — not the per-product catalog factor).
export const NEGERI_PIECES_PER_KG = 15.5;

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Pieces entered by the user -> the product's native stock unit.
export function piecesToNative(pieces: number, unit: string | undefined): number {
  return unit === "kg" ? round2(pieces / NEGERI_PIECES_PER_KG) : pieces;
}

// Native remaining/sold -> pieces, for showing caps in the entry unit.
export function nativeToPieces(native: number, unit: string | undefined): number {
  return unit === "kg" ? Math.round(native * NEGERI_PIECES_PER_KG) : native;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run src/lib/__tests__/returnsCap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/returnsCap.ts src/lib/__tests__/returnsCap.test.ts
git commit -m "feat(returns): pieces<->native helpers (flat 15.5 for kg)"
```

---

### Task 5: Return dialog — per-order-line entry

**Files:**
- Modify: `src/components/RecordReturnDialog.tsx` (row model, labels, submit)
- Modify: `src/components/GroupedActivityLog.tsx` (pass `orderLines` on return request)
- Modify: `src/components/__tests__/RecordReturnDialog.test.tsx` (per-line + conversion + shared-cap tests)

**Interfaces:**
- Consumes: `usePackSKUs` (`skus[].code`/`.eggProduct`/`.eggsPerPack`), `usePriorReturns` (`OutflowReturns`, Task 3), `piecesToNative`/`nativeToPieces` (Task 4), `conversionMap` (unit).
- Produces: emits `ReturnLineInput[]` carrying `skuCode` and native `quantity`.

**Design (read before editing):** The dialog renders one row per entry source:
- If `orderLines` is provided and has pack lines → one row per order line.
- Each pack line resolves its egg product via `usePackSKUs` (`code→eggProduct`) and its egg's outflow via the matching `eggLogs` entry (`product === eggProduct`) → `findRelatedEntryId`.
- Loose egg lines (and the legacy `eggLogs`-only path when no `orderLines`) render one row per egg product with `skuCode` undefined — unchanged behaviour.
- The user types **pieces** in each OK/Retak/Hancur box. Sold-pieces reference for a pack row = `packQty × eggsPerPack`.
- **Shared-egg cap:** group rows by egg product; the budget is that egg's `remaining_native` (`outflow.quantity_butir − priorReturns[outflowId].total`). Enforce `Σ piecesToNative(row pieces) ≤ remaining_native` across all rows of that egg. On submit, keep a running native remainder per egg so rounding can never exceed the cap.

- [ ] **Step 1: Write failing tests (per-line rows, conversion, shared cap)**

Add to `src/components/__tests__/RecordReturnDialog.test.tsx`. Add a `usePackSKUs` mock and an `orderLines`-driven render. (Keep existing tests; they use the no-`orderLines` path which still renders per egg log.)

```ts
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({
    skus: [
      { code: "KP10B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10 },
      { code: "KP6B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 6 },
      { code: "N30B", eggProduct: "NEGERI BIASA", eggsPerPack: 30 },
    ],
  }),
}));
```

```ts
it("emits one line per SKU with the entered pieces (butir egg)", async () => {
  // Two KAMPUNG BIASA SKUs share one egg outflow; the dialog shows a row per SKU.
  const eggLog: ActivityLog = {
    id: "e1", user_id: "u1", action_type: "outflow", category: "egg",
    product: "KAMPUNG BIASA", quantity_butir: 10092,
    recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
    client_id: "c",
    metadata: { relatedEntryId: "outflow-1" },
  };
  render(
    <LanguageProvider>
      <RecordReturnDialog
        open onOpenChange={() => {}} buyerName="Astro" eggLogs={[eggLog]}
        orderLines={[
          { skuCode: "KP10B", packQty: 840 },
          { skuCode: "KP6B", packQty: 282 },
        ]}
      />
    </LanguageProvider>
  );
  // One OK box per SKU row (labelled OK now).
  const okBoxes = await screen.findAllByLabelText(/ok/i);
  expect(okBoxes).toHaveLength(2);
  fireEvent.change(okBoxes[0], { target: { value: "20" } }); // KP10B
  fireEvent.change(okBoxes[1], { target: { value: "11" } }); // KP6B
  fireEvent.click(screen.getByRole("button", { name: /record return/i }));

  await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
  const { lines } = recordReturnMock.mock.calls[0]![0];
  expect(lines).toEqual([
    expect.objectContaining({ skuCode: "KP10B", product: "KAMPUNG BIASA", quantity: 20, disposition: "restock", outflowId: "outflow-1" }),
    expect.objectContaining({ skuCode: "KP6B", product: "KAMPUNG BIASA", quantity: 11, disposition: "restock", outflowId: "outflow-1" }),
  ]);
});

it("converts Negeri pieces to kg (flat 15.5) on submit", async () => {
  const eggLog: ActivityLog = {
    id: "e2", user_id: "u1", action_type: "outflow", category: "egg",
    product: "NEGERI BIASA", quantity_butir: 100, // native kg
    recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
    client_id: "c", metadata: { relatedEntryId: "outflow-2" },
  };
  render(
    <LanguageProvider>
      <RecordReturnDialog open onOpenChange={() => {}} buyerName="Astro" eggLogs={[eggLog]}
        orderLines={[{ skuCode: "N30B", packQty: 50 }]} />
    </LanguageProvider>
  );
  const okBox = (await screen.findAllByLabelText(/ok/i))[0];
  fireEvent.change(okBox, { target: { value: "31" } }); // 31 pcs -> 2.00 kg
  fireEvent.click(screen.getByRole("button", { name: /record return/i }));
  await vi.waitFor(() => expect(recordReturnMock).toHaveBeenCalledTimes(1));
  const { lines } = recordReturnMock.mock.calls[0]![0];
  expect(lines[0]).toEqual(expect.objectContaining({ skuCode: "N30B", quantity: 2, disposition: "restock" }));
});
```

(Note: `conversionMap` mock must mark NEGERI BIASA as kg — the existing file already does: `{ "NEGERI BIASA": { unit: "kg" } }`. Add `"KAMPUNG BIASA": { unit: "btr" }` if the butir path needs it; absence already defaults to butir via `unitLabel`.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run src/components/__tests__/RecordReturnDialog.test.tsx`
Expected: FAIL (dialog still renders per egg log, no SKU rows, no conversion).

- [ ] **Step 3: Add the `orderLines` prop + row model**

In `RecordReturnDialog.tsx`:
- Add to props: `orderLines?: Array<{ skuCode?: string; packQty?: number; eggProduct?: string; looseQty?: number }>;`
- Add `import { usePackSKUs } from "@/hooks/usePackSKUs";` and `import { piecesToNative, nativeToPieces } from "@/lib/returnsCap";`
- Build the row list. Each row needs: a stable `key`, a display `label` (SKU code or egg product), the `eggProduct`, the resolved `outflowId` (from the matching egg log), the egg `unit`, and `soldPieces`.

```ts
const { skus } = usePackSKUs();
const skuMap = useMemo(() => {
  const m: Record<string, { eggProduct: string; eggsPerPack: number }> = {};
  for (const s of skus) m[s.code] = { eggProduct: s.eggProduct, eggsPerPack: s.eggsPerPack };
  return m;
}, [skus]);

// One entry row per order line (pack SKU) when orderLines is given; otherwise
// fall back to one row per egg log (loose/manual — unchanged behaviour).
interface Row { key: string; label: string; eggProduct: string; skuCode?: string; }
const rows: Row[] = useMemo(() => {
  const packLines = (orderLines ?? []).filter((l) => l.skuCode && l.packQty);
  if (packLines.length > 0) {
    return packLines.map((l) => ({
      key: l.skuCode!, label: l.skuCode!,
      eggProduct: skuMap[l.skuCode!]?.eggProduct ?? l.skuCode!, skuCode: l.skuCode!,
    }));
  }
  return eggLogs.map((log) => ({ key: log.id, label: log.product, eggProduct: log.product }));
}, [orderLines, skuMap, eggLogs]);
```

- Map each row's `eggProduct` to its egg log and outflow id. Reuse the existing `resolvedIds` machinery but key it by egg product via the egg logs (the egg log whose `product === row.eggProduct`). Keep `lines` state keyed by `row.key`.

- [ ] **Step 4: Per-egg shared cap + pieces display**

For each row, `unit = conversionMap[row.eggProduct]?.unit`. The egg's `remaining_native = remainingReturnable(eggLog.quantity_butir, prior.total)`; `remaining_pieces = nativeToPieces(remaining_native, unit)`. Group rows by `eggProduct`; the clamp for a row's bucket must bound the row's line total AND the egg-group's summed pieces to `remaining_pieces`. Extend the existing `setBucket` clamp: compute `otherRowsPiecesForEgg` (sum of all OTHER rows mapping to the same egg) and clamp so `thisRowSum + otherRowsPieces ≤ remaining_pieces`.

Show each row's sold reference in pieces: pack row `soldPieces = packQty × skuMap[sku].eggsPerPack`; show the shared remaining-pieces cap in the hint.

- [ ] **Step 5: Submit — convert + carry skuCode, running native remainder per egg**

Replace the submit mapping so each emitted line uses native quantity and carries `skuCode`, with a per-egg running remainder guarding the cap:

```ts
// remaining native budget per egg product (shared across its rows)
const eggRemaining: Record<string, number> = {};
for (const row of rows) {
  const unit = conversionMap[row.eggProduct]?.unit;
  const log = eggLogByProduct[row.eggProduct];
  if (!log) continue;
  if (!(row.eggProduct in eggRemaining)) {
    eggRemaining[row.eggProduct] = remainingFor(log); // native, minus prior
  }
}

const resolved: ReturnLineInput[] = [];
for (const row of rows) {
  const outflowId = eggOutflowId[row.eggProduct];
  if (!outflowId) { toast.error(...); return; }
  const unit = conversionMap[row.eggProduct]?.unit;
  const state = lines[row.key] ?? EMPTY_LINE;
  for (const { key } of BUCKETS) {
    const pieces = parseQty(state[key]);
    if (pieces <= 0) continue;
    const want = piecesToNative(pieces, unit);
    const quantity = Math.min(want, eggRemaining[row.eggProduct]);
    if (quantity <= 0) continue;
    resolved.push({
      id: makeId(), outflowId, skuCode: row.skuCode,
      product: row.eggProduct, category: eggLogByProduct[row.eggProduct].category,
      quantity, disposition: key,
    });
    eggRemaining[row.eggProduct] -= quantity;
  }
}
```

- [ ] **Step 6: Pass `orderLines` from the feed**

In `GroupedActivityLog.tsx`:
- Extend `ReturnRequest` with `orderLines?: BuyerOrder["orderLines"]`.
- In `BuyerOrderCard`'s return button: `onReturnClick({ buyerName: order.buyerName, eggLogs, orderLines: order.orderLines })`.
- `ManualOutflowEntry`/`ChronologicalEntry` keep calling without `orderLines` (loose/manual → per-egg rows).
- Pass `orderLines={returnRequest?.orderLines}` into `<RecordReturnDialog />`.

- [ ] **Step 7: Run dialog tests + typecheck**

Run: `npm test -- --run src/components/__tests__/RecordReturnDialog.test.tsx`
Expected: PASS (existing + new per-line/conversion tests).

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/RecordReturnDialog.tsx src/components/GroupedActivityLog.tsx src/components/__tests__/RecordReturnDialog.test.tsx
git commit -m "feat(returns): per-order-line return entry (pieces, shared-egg cap, skuCode)"
```

---

### Task 6: Feed — per-SKU bubble (no doubling) + materials total with unit note

**Files:**
- Modify: `src/components/GroupedActivityLog.tsx`
- Modify: `src/components/__tests__/GroupedActivityLog.returns.test.tsx`

**Interfaces:**
- Consumes: `usePriorReturns` `OutflowReturns.bySku` (Task 3).

- [ ] **Step 1: Update the pack-bubble test to expect per-SKU (no doubling) + add a unit-note assertion**

In `GroupedActivityLog.returns.test.tsx`, update the `usePriorReturns` mock to include `bySku`, and assert each SKU shows only its own return. Two KAMPUNG BIASA SKUs, different per-SKU amounts:

```ts
vi.mock("@/hooks/usePriorReturns", () => ({
  usePriorReturns: () => ({
    "outflow-1": { restock: 25, retakan: 25, writeoff: 0, total: 50, bySku: {} },
    "outflow-2": {
      restock: 31, retakan: 0, writeoff: 0, total: 31,
      bySku: {
        KP10B: { restock: 20, retakan: 0, writeoff: 0, total: 20 },
        KP6B: { restock: 11, retakan: 0, writeoff: 0, total: 11 },
      },
    },
  }),
}));
vi.mock("@/hooks/usePackSKUs", () => ({
  usePackSKUs: () => ({ skus: [
    { code: "KP10B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 10 },
    { code: "KP6B", eggProduct: "KAMPUNG BIASA", eggsPerPack: 6 },
  ] }),
}));
```

Replace the single-pack `packLog` test with one order carrying BOTH SKU lines and the shared egg log:

```ts
const sharedEggLog: ActivityLog = {
  id: "2", user_id: "u1", action_type: "outflow", category: "egg",
  product: "KAMPUNG BIASA", quantity_butir: 10092,
  recorded_at: "2026-10-05T07:21:00.000Z", created_at: "2026-10-05T07:21:00.000Z",
  client_id: "c2",
  metadata: {
    orderType: "quick_outflow", buyerName: "Astro", relatedEntryId: "outflow-2",
    orderLines: [{ skuCode: "KP10B", packQty: 840 }, { skuCode: "KP6B", packQty: 282 }],
  },
};

it("shows each pack SKU's own return (no doubling)", () => {
  render(<LanguageProvider><GroupedActivityLog logs={[sharedEggLog]} viewMode="grouped" /></LanguageProvider>);
  expect(screen.getByText(/20 returned · 20O/)).toBeInTheDocument(); // KP10B
  expect(screen.getByText(/11 returned · 11O/)).toBeInTheDocument(); // KP6B
  // The egg's pooled total (31) shows once in materials — see next test.
});
```

(Delete or update the earlier assertions that expected `25B 25R`/`11 returned · 11B` to the O/R/H letters.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run src/components/__tests__/GroupedActivityLog.returns.test.tsx`
Expected: FAIL (bubble still uses `returnsByProduct`, shows same total on both lines).

- [ ] **Step 3: Switch the pack bubble to `bySku`**

In `GroupedActivityLog.tsx` `BuyerOrderCard`:
- Build a `returnsBySkuForOrder` lookup: for each pack order line, find the egg log for its egg product (`skuToEgg[skuCode]`), get its `outflow` summary from `returnsMap`, and read `.bySku[skuCode]`.

```ts
const skuReturns = (skuCode: string): ReturnsSummary | undefined => {
  const eggProduct = skuToEgg[skuCode];
  const log = eggLogs.find((l) => l.product === eggProduct);
  const outflow = log ? returnsMap[log.metadata?.relatedEntryId ?? ""] : undefined;
  return outflow?.bySku?.[skuCode];
};
```

- Pack SKU line: `<ReturnBubble returns={skuReturns(line.skuCode)} />` (replaces the current `returnsByProduct[skuToEgg[...]]`).

- [ ] **Step 4: Materials row shows the egg's pooled total + unit note**

The materials egg row keeps using `returnsByProduct[item.product]` (the egg's total across SKUs). Add a unit note. Extend `DeliveredLine` with an optional trailing unit note already present via its `unit` arg — confirm the materials `DeliveredLine` passes `unit={unitLabel(item.product, item.type)}` (it does), so `pcs`/`kg` already shows. For the returned indicator specifically, ensure the `(N returned · code)` line is followed by the unit when the egg is kg: append ` {unit}` inside `DeliveredLine`'s amber badge line.

In `DeliveredLine`, change the amber badge line to include the unit:

```tsx
      <span className="text-[11px] text-amber-700 dark:text-amber-400 tabular-nums">
        ({t.activity.returnedBadge.replace("{n}", returns.total.toLocaleString())} · {returnCode(returns)}) {unit}
      </span>
```

(The delivered number already shows `unit` above; the trailing `{unit}` on the returned line is the explicit pcs/kg note the spec asks for.)

- [ ] **Step 5: Add the materials-total assertion**

Add to the returns test (same `sharedEggLog`, expand materials or assert the delivered line):

```ts
it("shows the egg's pooled total once in the delivered/materials figure", () => {
  render(<LanguageProvider><GroupedActivityLog logs={[sharedEggLog]} viewMode="grouped" /></LanguageProvider>);
  // 31 total returned against KAMPUNG BIASA shows on its delivered line.
  expect(screen.getByText(/31 returned · 31O/)).toBeInTheDocument();
});
```

(If the egg only appears in the expandable materials section, the test should open it first via the "view materials" trigger; include that click if needed.)

- [ ] **Step 6: Run returns test + full suite + typecheck**

Run: `npm test -- --run src/components/__tests__/GroupedActivityLog.returns.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`
Expected: tsc clean; all suites green.

- [ ] **Step 7: Commit**

```bash
git add src/components/GroupedActivityLog.tsx src/components/__tests__/GroupedActivityLog.returns.test.tsx
git commit -m "feat(returns): per-SKU bubble via bySku + pooled total with pcs/kg note"
```

---

## Self-Review

**Spec coverage:**
- `sku_code` column + RPC passthrough → Task 1. ✓
- O/R/H letters → Task 2; OK/Retak/Hancur labels both locales → Task 2. ✓
- `skuCode` on payload + RPC mapping → Task 2. ✓
- `usePriorReturns` per-SKU breakdown → Task 3. ✓
- pieces→native flat 15.5 helpers → Task 4. ✓
- Per-order-line entry + shared-egg cap + pieces + convert on submit → Task 5. ✓
- Caller passes `orderLines`; loose/manual stay per-egg → Task 5 Step 6. ✓
- Feed per-SKU bubble (no doubling) → Task 6; materials pooled total + pcs/kg note → Task 6. ✓
- Invariants (pool per egg, retakan child, restock FIFO, cap per outflow_id) → Task 1 keeps RPC logic; dialog emits native qty per egg. ✓

**Placeholder scan:** Task 5 Steps 3-5 give real code for the row model, cap, and submit; Step 4's clamp extension is described with the exact quantities it bounds. No TBD/TODO.

**Type consistency:** `OutflowReturns extends ReturnsSummary` (Task 3) — feed reads `.bySku` (Task 6), dialog reads `.total` (unchanged). `ReturnLineInput.skuCode` (Task 2) consumed in Task 5 submit and mapped in `returnRpc` (Task 2). `piecesToNative`/`nativeToPieces` (Task 4) consumed in Task 5. Names consistent.

**Scope:** One coherent feature; Task 1 (DB) gates Tasks 2-6 only at apply-time (nullable column, safe ordering). Tasks 2-4 are independent and could run in any order; Task 5 depends on 2+3+4; Task 6 depends on 3 (+5 for the caller `orderLines`, but Task 6's tests drive the feed directly).

**Known ceilings (ponytail):** flat 15.5 is a deliberate constant, not catalog-driven (owner's call, Task 4). Shared-egg rounding is bounded by the per-egg running remainder on submit (Task 5 Step 5) and the RPC's `v_eps` cap. Loose/manual returns keep `sku_code = null` and match by product (Task 5 fallback, Task 6 materials path).
```
