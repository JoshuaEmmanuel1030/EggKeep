# In-App Assistant: Tool-Use Upgrade — Design Spec

**Date:** 2026-09-06
**Status:** Approved design
**Component:** `supabase/functions/inventory-assistant`

## Problem

The in-app assistant can't answer date-specific or order-level questions
("how many orders on Sep 5?"). Root cause: the edge function pre-computes a
**static snapshot** (current stock, 3-month averages, last 20 activity rows) and
pastes it into the system prompt before the model sees the question. Anything
outside that snapshot — a specific past date, an order count, a per-buyer
breakdown — is unanswerable by construction. There is also no "order" concept in
the fetched data (an order is a frontend grouping of outflow rows).

## Approach (approved)

Convert the single-shot call into a **bounded agentic tool-use loop** on the same
model (Haiku 4.5). Keep a small always-on snapshot for common questions; add a
tight set of **read-only, parameterized tools** for date/order/history questions.
No free SQL, no writes.

## Decisions (locked)
- **Order definition:** same as the Activity page — `activity_logs` rows with
  `metadata.orderType = 'quick_outflow'`, grouped by
  `buyerName + JSON(orderLines) + outflowDate + floor(recorded_at / 30s)`
  (mirrors `src/lib/activityGrouping.ts:orderBucketKey`).
- **Model:** `claude-haiku-4-5-20251001` (unchanged).
- **Safety:** read-only bounded tools only.

## Architecture

```
request → auth check (unchanged)
        → build SMALL static snapshot (current stock + at-risk + today's totals)
        → Anthropic call with tools[]
        → LOOP (max 5 iterations):
            if response has tool_use blocks:
              run each bounded query, append tool_result, call again
            else:
              return text answer
```

- Service-role key stays server-side (as today). The model can only trigger the
  fixed tools; it never sees credentials or issues raw SQL.
- Loop cap = 5 iterations → bounded latency/cost. On cap, return the model's best
  text so far with a note.

## Data sources
- **Order-level questions →** `activity_logs` (buyer lives only in
  `metadata.buyerName`; `outflows` has no buyer column).
- **Quantity/date/movement questions →** `outflows` / `inflows` (native units).
- **Returns →** `returns` table.
- **Current stock/at-risk →** `inflows` with `remaining_butir > 0` (existing logic).

## Tools (read-only, parameterized)

All quantities in each product's NATIVE unit (kg-native design). All tools clamp
inputs (see Safety).

1. `count_orders({ date?, date_from?, date_to?, buyer? })`
   - Counts distinct orders (Activity-page grouping) in the range. Returns
     `{ total, byBuyer: [{buyer, orders}], byDay: [{date, orders}] }`.
2. `list_transactions({ date?, date_from?, date_to?, action_type?, product?, category?, limit? })`
   - Raw inflow/outflow rows. Returns `[{date, action_type, product, category, quantity, unit, buyer_or_supplier}]`.
3. `sum_movements({ date?, date_from?, date_to?, action_type, product?, group_by })`
   - `group_by` ∈ `day | product | buyer`. Returns aggregated totals in native units.
4. `get_returns({ date?, date_from?, date_to?, product?, disposition? })`
   - From `returns`. Returns rows + totals by disposition (restock/writeoff).
5. `get_stock({ product? })`
   - Current stock, at-risk (>freshness days), and up to 5 oldest batches for the
     product(s). Mirrors the existing snapshot logic, on demand.

## Safety & bounds
- `limit` clamped to ≤ 200 (default 50).
- Date range clamped to ≤ 92 days; `date` shorthand expands to that single day.
- Unknown/missing params → tool returns a structured `{ error }` the model reports
  honestly; never throws to a 500.
- `action_type` validated ∈ `inflow|outflow`; `group_by`/`disposition` validated
  against their enums.
- Voided rows excluded by default (they're not real movements), matching the app.

## Order-grouping helper (ported to Deno)
`supabase/functions/inventory-assistant/orders.ts` — a small pure module mirroring
`src/lib/activityGrouping.ts`:
- `orderBucketKey(row): string` — `${buyer}_${JSON(orderLines)}_${outflowDate}_${bucket}`.
- `countOrders(rows): { total, byBuyer, byDay }`.
Deno can't import from `src/`, so this is a parallel copy; a vitest test pins the
key format to match `activityGrouping.ts` so they can't silently diverge.

## Error handling
- Each tool wrapped so a query error returns `{ error: "..." }` (logged) instead of
  aborting the loop.
- If Anthropic returns non-200, keep the existing 429 / generic handling.
- Loop-cap reached → return partial text + `"(stopped after N lookups)"`.

## Testing
- **Unit (vitest, in repo):** `orders.ts` grouping (bucket boundaries, buyer/day
  breakdown), date-clamp, param validation. Test that `orderBucketKey` output
  equals `src/lib/activityGrouping.ts` for identical input (anti-divergence).
- **Live smoke (post-deploy):** "how many orders on Sep 5", "which outbound
  movements on Sep 5", "how much NEGERI went out last week", "current stock NEGERI
  OMEGA", "any returns yesterday". Confirm numbers against direct SQL.

## Deploy
- Edge function only (Supabase MCP `deploy_edge_function`) — independent of the
  frontend; the chat UI is unchanged. No migration. Low blast radius.

## Out of scope (YAGNI)
- Free-form SQL, writes, multi-turn chat memory across messages, streaming.
- New UI. The existing `InventoryAssistant.tsx` chat box is reused as-is.
