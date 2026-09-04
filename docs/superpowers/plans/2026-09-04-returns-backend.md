# Returns (Retur) Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-built "Record return" UI functional by adding the `returns`/`return_restocks` tables and the atomic `record_return` RPC, and hardening `void` against the return×void double-restore.

**Architecture:** A return is linked to an original `outflows` row. Restock returns reverse that outflow's `fifo_deductions` oldest-batch-first (row-locked, relative updates) so stock returns to its real batch at its real age; write-off returns are logged only and touch no stock. All stock mutation is server-side and atomic, mirroring `record_order_outflows`. Void is updated to restore only the not-yet-returned remainder.

**Tech Stack:** Supabase Postgres (plpgsql, `SECURITY DEFINER` RPC), React/TS + `@supabase/supabase-js`, vitest.

## ⛔ Prerequisite gate (pinned)
**Do NOT apply any migration or start Task 1 until the pinned `data-integrity-reviewer` pass on the FIFO/returns paths is complete** (spec: `docs/superpowers/specs/2026-09-03-returns-design.md`; reminder set for 3pm Asia/Bangkok). If the review changes the void×return resolution or locking order, update Tasks 2–3 before executing. This plan encodes the spec's **preferred** resolution (void restores `deducted − already_returned`).

## Global Constraints
- Supabase project ref: `lgtixzpjbkzapecirbfj`. **All DB work is tested on a Supabase branch first** (MCP `create_branch` → test → `merge_branch`). Never test against production.
- `quantity`/`remaining_butir` hold each product's NATIVE unit (kg / butir / pcs). No kg↔butir conversion anywhere in this feature.
- Deploy order: apply the migration BEFORE shipping frontend that calls the RPC. Regenerate Supabase types after, then drop the `any` cast in `useRecordReturn.ts`.
- RPC guarantees mirror `record_order_outflows`: `SECURITY DEFINER`, `SET search_path = public`, auth check, all-or-nothing, row-locked FIFO, idempotent by client line `id`.
- i18n: any new user-facing string goes in BOTH `src/locales/en.ts` and `id.ts`.
- Branch: `feature/activities-redesign-returns` (or a fresh `feature/returns-backend` off it).

---

### Task 1: Migration — `returns` + `return_restocks` tables

**Files:**
- Create: `supabase/migrations/20260904000000_returns.sql`

**Interfaces:**
- Produces: tables `returns`, `return_restocks` with the columns consumed by Task 2's RPC and Task 5's UI.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Returns (retur): partial customer returns linked to the original outflow.
create table public.returns (
  id            uuid primary key,
  outflow_id    uuid not null references public.outflows(id),
  return_date   date not null,
  product       text not null,
  item_type_id  uuid references public.item_types(id),
  category      inventory_category not null,
  quantity      numeric not null check (quantity > 0),
  disposition   text not null check (disposition in ('restock','writeoff')),
  buyer_name    text,
  reason        text,
  user_id       uuid not null,
  created_at    timestamptz not null default now()
);
create index returns_outflow_id_idx on public.returns(outflow_id);
create index returns_return_date_idx on public.returns(return_date);

create table public.return_restocks (
  id                uuid primary key default gen_random_uuid(),
  return_id         uuid not null references public.returns(id),
  inflow_id         uuid not null references public.inflows(id),
  quantity_restored numeric not null check (quantity_restored > 0)
);
create index return_restocks_return_id_idx on public.return_restocks(return_id);
create index return_restocks_inflow_id_idx on public.return_restocks(inflow_id);

alter table public.returns enable row level security;
alter table public.return_restocks enable row level security;

-- Authenticated users may read; writes happen only through the SECURITY DEFINER RPC.
create policy returns_select on public.returns
  for select to authenticated using (true);
create policy return_restocks_select on public.return_restocks
  for select to authenticated using (true);
```

- [ ] **Step 2: Apply on a Supabase branch and verify**

Create a dev branch (MCP `create_branch`), `apply_migration` there, then `list_tables` to confirm both tables + FKs exist. Expected: `returns` and `return_restocks` present with the constraints above. Do NOT touch production yet.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260904000000_returns.sql
git commit -m "feat(returns): returns + return_restocks tables (migration)"
```

---

### Task 2: `record_return` RPC (atomic FIFO restock / write-off)

**Files:**
- Modify: `supabase/migrations/20260904000000_returns.sql` (append the function)

**Interfaces:**
- Consumes: `returns`, `return_restocks`, `outflows`, `inflows`, `fifo_deductions`.
- Produces: `record_return(p_return jsonb) returns void`. Input shape (from `useRecordReturn.ts`):
  `{ return_date, buyer_name, reason, lines: [{ id, outflow_id, product, category, quantity, disposition }] }`.
  Raises: `AUTH_REQUIRED`, `NO_ENTRIES`, `INVALID_ENTRY`, `OUTFLOW_VOIDED`, `RETURN_EXCEEDS_OUTFLOW`.

- [ ] **Step 1: Write the function SQL**

```sql
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
  v_outflow outflows%rowtype;
  v_returned numeric;
  v_remaining numeric;
  v_restore numeric;
  v_already numeric;
  v_return_date date := (p_return->>'return_date')::date;
  v_buyer text := nullif(p_return->>'buyer_name','');
  v_reason text := nullif(p_return->>'reason','');
  ded record;
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

    if v_outflow_id is null or v_qty is null or v_qty <= 0
       or v_disp not in ('restock','writeoff') then
      raise exception 'INVALID_ENTRY: outflow_id, positive quantity, valid disposition required (got % / % / %)',
        v_outflow_id, v_qty, v_disp;
    end if;

    -- Idempotency: this return line already recorded (outbox replay). Skip whole line.
    if v_id is not null and exists (select 1 from returns where id = v_id) then
      continue;
    end if;
    if v_id is null then v_id := gen_random_uuid(); end if;

    -- Lock the outflow row FIRST: serializes against concurrent void + other returns.
    select * into v_outflow from outflows where id = v_outflow_id for update;
    if not found then
      raise exception 'INVALID_ENTRY: outflow % not found', v_outflow_id;
    end if;
    if v_outflow.voided_at is not null then
      raise exception 'OUTFLOW_VOIDED: cannot return against a voided outflow %', v_outflow_id;
    end if;

    -- Cumulative cap: prior returns + this line must not exceed the outflow qty.
    select coalesce(sum(quantity),0) into v_returned from returns where outflow_id = v_outflow_id;
    if v_returned + v_qty > v_outflow.quantity_butir + 1e-9 then
      raise exception 'RETURN_EXCEEDS_OUTFLOW: % returned + % > % sold',
        v_returned, v_qty, v_outflow.quantity_butir;
    end if;

    insert into returns (id, outflow_id, return_date, product, item_type_id, category,
                         quantity, disposition, buyer_name, reason, user_id)
    values (v_id, v_outflow_id, v_return_date, v_line->>'product',
            nullif(v_line->>'item_type_id','')::uuid,
            (v_line->>'category')::inventory_category,
            v_qty, v_disp, v_buyer, v_reason, v_user);

    if v_disp = 'writeoff' then
      continue; -- logged only, no stock change
    end if;

    -- RESTOCK: reverse this outflow's deductions, OLDEST inflow first, capped per batch.
    v_remaining := v_qty;
    for ded in
      select fd.inflow_id, fd.quantity_deducted, i.remaining_butir, i.date
      from fifo_deductions fd
      join inflows i on i.id = fd.inflow_id
      where fd.outflow_id = v_outflow_id
      order by i.date asc, i.created_at asc
      for update of i
    loop
      exit when v_remaining <= 0;
      select coalesce(sum(quantity_restored),0) into v_already
        from return_restocks rr
        join returns r on r.id = rr.return_id
        where r.outflow_id = v_outflow_id and rr.inflow_id = ded.inflow_id;
      v_restore := least(v_remaining, ded.quantity_deducted - v_already);
      if v_restore <= 0 then continue; end if;

      update inflows set remaining_butir = remaining_butir + v_restore where id = ded.inflow_id;
      insert into return_restocks (return_id, inflow_id, quantity_restored)
      values (v_id, ded.inflow_id, v_restore);
      v_remaining := v_remaining - v_restore;
    end loop;

    -- Fallback: batches were voided/insufficient cap -> fresh inflow at the ORIGINAL
    -- batch date (preserve age), or return_date if no deduction rows exist at all.
    if v_remaining > 1e-9 then
      insert into inflows (id, date, product, quantity_butir, remaining_butir, category, user_id)
      values (gen_random_uuid(),
              coalesce((select min(i.date) from fifo_deductions fd join inflows i on i.id=fd.inflow_id
                        where fd.outflow_id = v_outflow_id), v_return_date),
              v_line->>'product', v_remaining, v_remaining,
              (v_line->>'category')::inventory_category, v_user);
    end if;
  end loop;
end;
$$;

grant execute on function public.record_return(jsonb) to authenticated;
```

- [ ] **Step 2: Test scenarios on the Supabase branch (SQL)**

Run these via MCP `execute_sql` on the branch, each in its own transaction with a rollback, asserting stock deltas. Expected results in comments:

```sql
-- Setup: one inflow (100), one outflow (40) consuming it via fifo_deductions.
-- A) restock 10  -> inflow.remaining +10; returns row disp=restock; return_restocks 10 on that batch.
-- B) restock 10 then 10 -> total restored 20, never exceeds the 40 deducted.
-- C) restock 41 -> RETURN_EXCEEDS_OUTFLOW.
-- D) writeoff 10 -> returns row; inflow.remaining UNCHANGED.
-- E) replay same line id -> no-op (no second returns row, no double restore).
-- F) outflow voided -> OUTFLOW_VOIDED.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260904000000_returns.sql
git commit -m "feat(returns): atomic record_return RPC (FIFO restock / writeoff)"
```

---

### Task 3: Harden `void` against the return×void double-restore

**Files:**
- Modify: `src/hooks/useVoidEntry.ts` (`voidOutflow`, ~lines 52–133)

**Interfaces:**
- Consumes: `returns`, `return_restocks`, `fifo_deductions`.
- Produces: `voidOutflow` restores only `quantity_deducted − Σ return_restocks.quantity_restored` per batch.

- [ ] **Step 1: Write the failing test (unit, pure helper)**

Extract the per-batch net-restore math into a pure helper so it's testable without the DB.

```ts
// src/lib/voidRestore.ts
export function netRestorePerBatch(
  deductions: { inflow_id: string; quantity_deducted: number }[],
  restocked: Record<string, number> // inflow_id -> already restored via returns
): { inflow_id: string; restore: number }[] {
  return deductions
    .map((d) => ({ inflow_id: d.inflow_id, restore: d.quantity_deducted - (restocked[d.inflow_id] ?? 0) }))
    .filter((r) => r.restore > 0);
}
```

```ts
// src/lib/__tests__/voidRestore.test.ts
import { describe, it, expect } from "vitest";
import { netRestorePerBatch } from "../voidRestore";
describe("netRestorePerBatch", () => {
  it("subtracts already-returned stock so void never double-restores", () => {
    const out = netRestorePerBatch(
      [{ inflow_id: "a", quantity_deducted: 40 }],
      { a: 15 }
    );
    expect(out).toEqual([{ inflow_id: "a", restore: 25 }]);
  });
  it("drops fully-returned batches", () => {
    expect(netRestorePerBatch([{ inflow_id: "a", quantity_deducted: 10 }], { a: 10 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- --run src/lib/__tests__/voidRestore.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper, then use it in `voidOutflow`**

Create `src/lib/voidRestore.ts` as above. In `voidOutflow`, before restoring, fetch `return_restocks` for the outflow (join `returns`), build the `restocked` map, and restore `netRestorePerBatch(...)` amounts instead of the raw `quantity_deducted`.

- [ ] **Step 4: Run tests + tsc**

Run: `npm test -- --run` and `npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voidRestore.ts src/lib/__tests__/voidRestore.test.ts src/hooks/useVoidEntry.ts
git commit -m "fix(void): restore only not-yet-returned stock (return×void safety)"
```

---

### Task 4: UI remaining-returnable cap helper

**Files:**
- Create: `src/lib/returnsCap.ts`
- Test: `src/lib/__tests__/returnsCap.test.ts`
- Modify: `src/components/RecordReturnDialog.tsx` (use the helper for per-line max)

**Interfaces:**
- Produces: `remainingReturnable(outflowQty: number, priorReturned: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { remainingReturnable } from "../returnsCap";
describe("remainingReturnable", () => {
  it("caps at what's left to return", () => {
    expect(remainingReturnable(40, 15)).toBe(25);
  });
  it("never negative", () => {
    expect(remainingReturnable(40, 40)).toBe(0);
    expect(remainingReturnable(40, 50)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm test -- --run src/lib/__tests__/returnsCap.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/returnsCap.ts
export function remainingReturnable(outflowQty: number, priorReturned: number): number {
  return Math.max(0, outflowQty - priorReturned);
}
```

- [ ] **Step 4: Wire into the dialog** — the per-line `max` becomes `remainingReturnable(soldQty, priorReturnedForThatOutflow)` (fetch prior returns for the shown outflows). Run tests + tsc → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/returnsCap.ts src/lib/__tests__/returnsCap.test.ts src/components/RecordReturnDialog.tsx
git commit -m "feat(returns): cap return input to remaining-returnable"
```

---

### Task 5: Go live — regenerate types, drop cast, wire real RPC

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated), `src/hooks/useRecordReturn.ts`

**Interfaces:**
- Consumes: applied migration (Task 1–2 merged to production).

- [ ] **Step 1:** After the data-integrity re-review passes, `merge_branch` the Supabase branch to production (applies the migration). Confirm with `list_migrations`.

- [ ] **Step 2:** Regenerate types (MCP `generate_typescript_types`) into `src/integrations/supabase/types.ts`.

- [ ] **Step 3:** Remove the `eslint-disable` + `(supabase.rpc as any)` cast in `useRecordReturn.ts` — the typed name now resolves.

- [ ] **Step 4:** Run `npx tsc --noEmit -p tsconfig.app.json` (clean) and `npm test -- --run` (all pass).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/types.ts src/hooks/useRecordReturn.ts
git commit -m "feat(returns): activate record_return (types + drop cast)"
```

---

### Task 6: Surface returns in the activity feed

**Files:**
- Modify: `src/hooks/useActivityLogs.ts` (or wherever logs are assembled), `src/components/GroupedActivityLog.tsx`, `src/locales/en.ts`, `id.ts`

**Interfaces:**
- Consumes: `returns` rows.
- Produces: a `return` entry type in the feed (product, qty, disposition badge, links to its order).

- [ ] **Step 1:** Decide the source: emit a `return` activity_log on RPC success (client-side log insert like inflow/outflow do), OR read `returns` directly into the feed. Prefer emitting a log row for consistency with the existing feed pipeline.
- [ ] **Step 2:** Render a return entry (distinct node color, "restock"/"write-off" badge, quantity in native unit via `useStockUnitLabel`). Add i18n keys in both locales.
- [ ] **Step 3:** Run tsc + tests → clean. **Commit.**

---

## Self-Review notes
- **Spec coverage:** tables (T1), RPC restock/writeoff/caps/idempotency/locking (T2), void×return (T3), voided-batch fallback dating (T2 fallback), UI cap (T4), go-live + type cast removal (T5), activity feed (T6). ✅
- **Deferred by design:** offline outbox for returns (spec says v1 online-only); component/RTL tests already added in the redesign branch.
- **Open decision locked:** void×return uses the "restore only remainder" resolution (T3), pending data-integrity confirmation.
