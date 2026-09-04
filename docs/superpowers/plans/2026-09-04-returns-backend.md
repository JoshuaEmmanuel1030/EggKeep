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
  v_total_deducted numeric;
  v_total_restored numeric;
  v_eps constant numeric := 1e-9;  -- single tolerance for all qty comparisons (kg decimals)
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
    if v_returned + v_qty > v_outflow.quantity_butir + v_eps then
      raise exception 'RETURN_EXCEEDS_OUTFLOW: % returned + % > % sold',
        v_returned, v_qty, v_outflow.quantity_butir;
    end if;

    -- item_type_id resolved by name (returns table isn't covered by the Stage-A
    -- resolver trigger); client payload doesn't send it. Names are still the key.
    insert into returns (id, outflow_id, return_date, product, item_type_id, category,
                         quantity, disposition, buyer_name, reason, user_id)
    values (v_id, v_outflow_id, v_return_date, v_line->>'product',
            (select id from item_types where name = v_line->>'product' limit 1),
            (v_line->>'category')::inventory_category,
            v_qty, v_disp, v_buyer, v_reason, v_user);

    if v_disp = 'writeoff' then
      continue; -- logged only, no stock change
    end if;

    -- RESTOCK. Bound the WHOLE restock by what actually left surviving batches:
    -- Σ deducted − Σ already-restored (across ALL prior returns of this outflow).
    -- This single up-front cap is the anti-inflation guarantee; the per-batch caps
    -- below only decide WHERE the (already-bounded) amount lands. No phantom inflow.
    select coalesce(sum(fd.quantity_deducted),0) into v_total_deducted
      from fifo_deductions fd where fd.outflow_id = v_outflow_id;
    select coalesce(sum(rr.quantity_restored),0) into v_total_restored
      from return_restocks rr join returns r on r.id = rr.return_id
      where r.outflow_id = v_outflow_id;   -- includes THIS line's row? No: inserted below, none yet
    if v_qty > (v_total_deducted - v_total_restored) + v_eps then
      raise exception 'RESTOCK_EXCEEDS_DEDUCTED: % > deductible % (deducted % − restored %)',
        v_qty, v_total_deducted - v_total_restored, v_total_deducted, v_total_restored;
    end if;

    -- Distribute OLDEST-first over LIVE deducted batches, capped per batch at
    -- (deducted − already-restored to THAT batch). Every return_restocks row now
    -- points at a real deducted batch, so the per-batch subquery is complete.
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

    -- Defensive: leftover can only occur if a DEDUCTED batch was voided (rare —
    -- voidInflow blocks voiding a consumed inflow). Fail loud; NEVER mint a phantom
    -- inflow to absorb it (that was a silent-inflation vector). Operator handles manually.
    if v_remaining > v_eps then
      raise exception 'RESTOCK_UNALLOCATED: % butir has no live batch to restore to (voided batch?)', v_remaining;
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
-- C) restock 41 -> RETURN_EXCEEDS_OUTFLOW (cumulative cap fires first, since Σdeducted
--    always == outflow qty for all-or-nothing outflows). RESTOCK_EXCEEDS_DEDUCTED is a
--    defensive guard that only triggers on data anomalies (e.g. a deducted batch voided).
-- C2) return-qty 41 total (any disposition) -> RETURN_EXCEEDS_OUTFLOW (cumulative cap).
-- D) writeoff 10 -> returns row; inflow.remaining UNCHANGED; consumes cumulative headroom.
-- E) replay same line id -> no-op (no second returns row, no double restore).
-- F) outflow voided -> OUTFLOW_VOIDED.
-- G) multi-batch outflow (30 from old batch + 10 from new): restock 35 lands 30 on old
--    then 5 on new (oldest-first, per-batch capped); neither batch exceeds its deducted.
-- H) [needs Task 3] restock 15, then void the outflow -> total stock restored == 40 exactly
--    (void restores 40 − 15 = 25); NOT 55. No double-restore.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260904000000_returns.sql
git commit -m "feat(returns): atomic record_return RPC (FIFO restock / writeoff)"
```

---

### Task 3: Move void server-side (`void_outflow` RPC) + return×void safety

**Why an RPC (not the client helper):** the review found that the current `voidOutflow`
in `useVoidEntry.ts:59-110` is a client-side read-modify-write with **absolute** writes
(`remaining_butir: newRemaining`) and no lock. Once `record_return` (atomic, locking)
can also raise `remaining_butir`, the client void will interleave and **clobber** the
return's increment — a lost update, the exact silent-inflation anti-pattern CLAUDE.md
forbids. Changing only the math (a pure JS helper) does NOT fix this; it just writes a
different wrong number. Void must be atomic, with the SAME lock order as `record_return`.

**Files:**
- Modify: `supabase/migrations/20260904000000_returns.sql` (append `void_outflow`)
- Modify: `src/hooks/useVoidEntry.ts` (`voidOutflow` calls the RPC; delete the absolute-write loop)

**Interfaces:**
- Produces: `void_outflow(p_outflow_id uuid, p_reason text) returns void`. Raises
  `AUTH_REQUIRED`, `OUTFLOW_NOT_FOUND`, `ALREADY_VOIDED`.
- Consumes: `outflows`, `inflows`, `fifo_deductions`, `return_restocks`, `returns`.

- [ ] **Step 1: Write the `void_outflow` function SQL**

```sql
create or replace function public.void_outflow(p_outflow_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_outflow outflows%rowtype;
  v_already numeric;
  v_restore numeric;
  v_eps constant numeric := 1e-9;
  ded record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: must be signed in to void';
  end if;

  -- Same lock order as record_return: outflow row first, then inflow rows.
  select * into v_outflow from outflows where id = p_outflow_id for update;
  if not found then raise exception 'OUTFLOW_NOT_FOUND: %', p_outflow_id; end if;
  if v_outflow.voided_at is not null then
    raise exception 'ALREADY_VOIDED: %', p_outflow_id;
  end if;

  for ded in
    select fd.inflow_id, fd.quantity_deducted
    from fifo_deductions fd
    join inflows i on i.id = fd.inflow_id
    where fd.outflow_id = p_outflow_id and i.voided_at is null
    order by i.date asc, i.created_at asc   -- identical order → no deadlock vs record_return
    for update of i
  loop
    -- Restore only the NOT-yet-returned remainder of this batch (return×void safety).
    select coalesce(sum(rr.quantity_restored),0) into v_already
      from return_restocks rr
      join returns r on r.id = rr.return_id
      where r.outflow_id = p_outflow_id and rr.inflow_id = ded.inflow_id;
    v_restore := ded.quantity_deducted - v_already;
    if v_restore <= v_eps then continue; end if;
    update inflows set remaining_butir = remaining_butir + v_restore where id = ded.inflow_id;  -- relative
  end loop;

  update outflows set voided_at = now(), void_reason = p_reason where id = p_outflow_id;
end;
$$;

grant execute on function public.void_outflow(uuid, text) to authenticated;
```

- [ ] **Step 2: Test on the Supabase branch (SQL)**

```sql
-- Using the record_return setup (inflow 100, outflow 40):
-- A) void with no returns -> inflow.remaining +40; outflow.voided_at set.
-- B) restock 15 then void -> inflow.remaining net +40 total (15 by return + 25 by void), NOT +55.
-- C) writeoff 15 then void -> inflow.remaining +40 (writeoff restored nothing).
-- D) void twice -> ALREADY_VOIDED on the 2nd.
```

- [ ] **Step 3: Point `voidOutflow` at the RPC**

In `src/hooks/useVoidEntry.ts`, replace the fetch-deductions + per-batch read-modify-write
block (`:58-96`) with a single `supabase.rpc('void_outflow', { p_outflow_id, p_reason: reason })`
call. Keep the activity-log void update (`:98-124`). Delete the absolute-write JS path entirely.
(Cast the RPC name until types regenerate, same pattern as `useRecordReturn.ts`.)

- [ ] **Step 4: Run tsc + tests**

Run: `npx tsc --noEmit -p tsconfig.app.json` and `npm test -- --run`
Expected: exit 0, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904000000_returns.sql src/hooks/useVoidEntry.ts
git commit -m "fix(void): atomic void_outflow RPC, return×void safe (no client absolute writes)"
```

---

### Task 4: UI remaining-returnable cap helper

**Files:**
- Create: `src/lib/returnsCap.ts`
- Test: `src/lib/__tests__/returnsCap.test.ts`
- Modify: `src/components/RecordReturnDialog.tsx` (use the helper for per-line max)

**Interfaces:**
- Produces: `remainingReturnable(outflowQty: number, priorReturned: number): number`.
- **`priorReturned` MUST be `Σ returns.quantity` for the outflow across BOTH dispositions**
  (restock + writeoff), so the UI cap matches the server's cumulative cap
  (`record_return` counts all dispositions). The dialog fetches all `returns` for the
  shown outflows, not just restock ones.

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
- **Spec coverage:** tables (T1), RPC restock/writeoff/caps/idempotency/locking (T2), server-side atomic void + void×return safety (T3), UI cap (T4), go-live + type cast removal (T5), activity feed (T6). ✅
- **Deferred by design:** offline outbox for returns (spec says v1 online-only); component/RTL tests already added in the redesign branch.

## Data-integrity review corrections applied (2026-09-04)
Folded in after the `data-integrity-reviewer` pass. Outflow FIFO was confirmed sound; the following fixed the planned returns work:
- **No phantom fallback inflow.** The old fallback could mint stock that never left and created anonymous no-supplier lots. Removed. Total restock is now capped up front at `Σ deducted − Σ restored` (all prior returns of the outflow), and any unallocatable remainder **raises `RESTOCK_UNALLOCATED`** instead of minting. (Blockers 1 & 2.)
- **Voided batches skipped** in the restock loop (`i.voided_at is null`); the near-impossible voided-consumed-batch case fails loud, not silently.
- **Void moved server-side** into an atomic `void_outflow` RPC with the SAME lock order as `record_return` (outflow row → inflows `FOR UPDATE OF i ORDER BY date, created_at`), relative updates, restoring `deducted − already_restored` per batch. The client-side absolute-write path is deleted. (Should-fix 1 & 2.)
- **Single epsilon constant** (`v_eps = 1e-9`) across all quantity comparisons. (Nit.)
- **UI cap sums all dispositions**; `item_type_id` resolved by name in the RPC (client doesn't send it). (Should-fix 3, Nit.)
- **Remaining watch-item:** `get_advisors(security)` will list `record_return` + `void_outflow` as SECURITY DEFINER — expected (auth check is inside each function), same pattern as `record_order_outflows`.
