# Returns (Retur) — Design Spec

**Date:** 2026-09-03
**Status:** Approved data model; RPC + UI in progress
**Branch:** `feature/activities-redesign-returns`

## Problem

Customers return part of an order (usually partial, mostly broken eggs) 1–2 days
after delivery. EggKeep has no way to record this today — only `inflows`,
`outflows`, and a `void` mechanism. Unrecorded returns are one source of drift
between the ledger and the physical stock count.

## Confirmed requirements (from brainstorming)

1. A return is **linked to the specific original order** (an `outflows` row).
2. Returned eggs have a **per-return disposition**:
   - `restock` — good eggs go back into sellable stock.
   - `writeoff` — broken/scrapped; **logged only, no stock change**.
3. `restock` returns stock to the **original FIFO batch(es)** at their real age
   (returns arrive 1–2 days later; freshness must not reset).
4. Outflows are recorded **at loading** (the night before delivery). A return is
   therefore a later, separate event — never edits the original outflow row.
5. Entry point: **the order cards on the Activities page** ("Record return").

## Data model

New table `returns` (sibling of `inflows`/`outflows`/`fifo_deductions`, same
Supabase project `lgtixzpjbkzapecirbfj`):

```sql
create table public.returns (
  id            uuid primary key,              -- client-generated -> idempotent replay
  outflow_id    uuid not null references outflows(id),
  return_date   date not null,
  product       text not null,                 -- name snapshot (activity_logs convention)
  item_type_id  uuid references item_types(id),
  category      inventory_category not null,
  quantity      numeric not null check (quantity > 0),  -- native unit (kg / butir)
  disposition   text not null check (disposition in ('restock','writeoff')),
  buyer_name    text,                           -- denormalized for retur-per-customer reporting
  reason        text,
  user_id       uuid not null,
  created_at    timestamptz not null default now()
);

create table public.return_restocks (
  id          uuid primary key default gen_random_uuid(),
  return_id   uuid not null references returns(id),
  inflow_id   uuid not null references inflows(id),
  quantity_restored numeric not null check (quantity_restored > 0)
);
```

`return_restocks` records which batches got stock back, so a restock is auditable
and itself reversible if mis-entered.

## RPC: `record_return(p_return jsonb)`

Mirrors `record_order_outflows` guarantees: `SECURITY DEFINER`, auth check,
all-or-nothing, row-locked, idempotent by client line `id`.

Per line:
1. Idempotency guard: skip entirely if the line `id` already exists in `returns`.
2. Validate the `outflow_id` exists and is not voided.
3. Validate cumulative returns (existing + this) do **not** exceed the outflow's
   `quantity_butir` → else `RAISE EXCEPTION 'RETURN_EXCEEDS_OUTFLOW'`.
4. Insert the `returns` row.
5. If `disposition = 'restock'`: reverse the outflow's `fifo_deductions`
   **oldest inflow first** (`ORDER BY inflows.date ASC, created_at ASC`,
   `FOR UPDATE`), restoring `min(remaining_to_return, deducted − already_restored)`
   to each `inflows.remaining_butir` via a relative update, and insert a
   `return_restocks` row per batch touched. Keeps returned (older) eggs FIFO-first.
6. If `disposition = 'writeoff'`: no stock change.

Emits a `return` activity-log entry for the feed.

### Edge cases
- Original inflow batch voided since the sale → skip it, allocate to the next
  batch in the outflow's deductions; if none remain, fall back to a fresh inflow
  dated `return_date` (documented, rare).
- Cumulative-return cap is enforced server-side, not just in the UI.
- Offline: returns may reuse the outflow-outbox pattern later; v1 can be
  online-only (INSUFFICIENT-style errors are never queued).

## UI / flow (Activities page)

- Each order card (`BuyerOrderCard`, and manual outflow entries) gains a
  **"Record return"** action.
- Opens a dialog listing the order's **egg lines** with: returned-qty input
  (native unit), a **restock / write-off** toggle per line, and a reason.
- On confirm → `useRecordReturn` → `record_return` RPC → refresh inventory + logs.
- Cap each input to the line's not-yet-returned remainder.
- i18n: all strings in both `en.ts` and `id.ts`.

## Client contract

- `src/types/returns.ts` — `ReturnDisposition`, `ReturnLineInput`,
  `RecordReturnInput`, `ReturnRecord`.
- `src/hooks/useRecordReturn.ts` — `recordReturn(input)` calling the RPC
  (cast until types regenerate post-migration).

## Testing

- Pure allocation helper (oldest-first split across deductions, cap logic) → unit
  tests, mirroring `stockCount.test.ts`.
- RPC behavior: restock restores exact batches; writeoff no-ops on stock;
  cumulative cap rejects; idempotent replay is a no-op.
- `data-integrity-reviewer` pass before merge (touches FIFO/stock).

## Deploy order

DB migration (`returns`, `return_restocks`, `record_return`) applied via Supabase
MCP **before** the frontend that calls it (per EggKeep deploy rules). Regenerate
Supabase types afterward and drop the `any` cast in `useRecordReturn`.
