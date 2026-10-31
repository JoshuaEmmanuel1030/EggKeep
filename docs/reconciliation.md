# JS Online stock reconciliation — context for EggKeep

Purpose: build a reconciliation agent that compares three stock records per SKU per day and surfaces only the rows a human needs to look at. This file carries what was learned in the JS Management chat so the EggKeep session can build the `reconcile/` module without re-deriving it.

## The three sources

| Source | What it is | Unit truth | Reliability notes |
|---|---|---|---|
| EggKeep (Supabase) | App ledger: `inflows`, `outflows`, `returns`, `item_types`, `pack_skus` | Native per product: kg for Negeri, butir for everything else | Cleanest identity. Has a UTC-date default bug (see gotchas). |
| Monitoring Stock sheet | Google Sheet `[JS Online] Monitoring Stock`, id `19peOPJpfHjM0NPsOLDJITXGIon_TZymESxiCoK47HHc` | Mixed; Negeri rows are sometimes butir estimates, sometimes kg | Hand-maintained daily roll. Closing stock is computed but not trusted — every day restarts from a fresh physical count. |
| P3 (Peachtree) | Accounting system, manually re-keyed from invoices. No integration with EggKeep. | Whatever the operator typed | Transactions posted 1–2 days late. Running qty goes deeply negative (opening balance missing or purchases posted late). |

Related: `[JS Online] Daily Monitoring Stock` (id `15zAlXtVaSLQowo4Gruc1JQD7R0xQcCJ4jt2HMdwxaS0`) exists but has not been examined yet.

## Sheet structure (`[JS Online] Monitoring Stock`)

- **Final Check** — one block per date, 8 SKU rows each. Columns: `TGL, Item, FISIK, INSTOCK, OUTSTOCK PO, OUTSTOCK CASH, CLOSING STOCK, SELISIH, Total Outstock, (blank), akumulasi`. `SELISIH` and `akumulasi` only populated from 15 Sep 2026 — method changed mid-month. 13 Sep (Sunday) has no FISIK.
- **P3 SEP'26 KOMPARE** — transaction-level export from Peachtree. Columns: `Item ID, Item Description, Date, Barang Masuk, Barang Keluar, Barang Keluar Plus, Cash Tunai, Remaining Qty, Total Barang Keluar`. `Barang Keluar` has inconsistent sign (some rows negative, some positive); `Barang Keluar Plus` is the operator's absolute-value fix. Date format m/d/yyyy. Item IDs: `A101` = Telur Negeri.
- **Compare** — 21–23 Sep only. Left block instock (Actual vs P3 vs Selisih), right block outstock. Date format dd/mm/yyyy.
- **PV Compare 21-23 Sep** — earlier attempt at the same comparison.
- **Form Instock dan Outstock** — empty. Intended intake form, never built.

SKU names in the sheet vs EggKeep catalog:

| Sheet | EggKeep catalog | Unit |
|---|---|---|
| Telur Negeri | `NEGERI BIASA` | kg |
| Telur Negeri Omega | `NEGERI OMEGA` | kg |
| Telur Kampung Pucat | `KAMPUNG BIASA` | butir |
| Telur Kampung Merah | `KAMPUNG MERAH` | butir |
| Telur Bebek Tawar | `BEBEK TAWAR` | butir |
| Telur Asin Matang | `ASIN MATENG` | butir |
| Telur Asin Mentah | `ASIN MENTAH` | butir |
| Telur Puyuh | `PUYUH` | butir |
| (no row) | `KUNING MANIK` | butir |
| (no row) | `<PRODUCT> (RETAKAN)` children | parent's unit |

## Number formats in the sheet

Three conventions coexist, and at least some cells are stored as text:

- Indonesian thousands: `6.105` (Final Check, Actual columns of Compare)
- No separator: `1960`, `10811` (P3 columns of Compare, pasted from Peachtree)
- Decimal comma: `7164,39` (Negeri kg with fractions — a genuine decimal, the output of per-line `Math.round(eggs/15.5, 2)` summed)

Normalize by column rule in code; do not rely on sheet locale. `7164,39` for Negeri is correct; round-thousand Negeri figures in the sheet are the suspicious ones (counted in butir, never converted).

## Observed problems (September 2026 data)

1. **Daily chain doesn't close.** Closing(D) ≠ FISIK(D+1) almost every day. Example: Negeri 7 Sep closes 6.917, 8 Sep opens 13.981.
2. **Negative closing stock** on several days (Bebek Tawar −526, Asin Matang −847, Kampung Pucat −2.975 on 11 Sep). Timing, not loss — instock recorded late or outstock on the wrong day.
3. **P3 date offset.** Compare, Negeri outstock: 22 Sep actual 8.865 vs P3 177; 23 Sep actual 7.332 vs P3 14.209. Same invoice posted a day late. Summed over the window the gap is ~1.800.
4. **Purchases missing from P3 entirely.** Compare instock: Negeri +4.145, Omega +2.165, Kampung Pucat 6.000 vs 0.
5. **Small residuals on Kampung and Puyuh** (−6, −247, −50, +120, +75) — likely cash sales not keyed or tray rounding.

## Reconciliation identity (from EggKeep)

```
on_hand(product, t) = Σ inflows(≤t) − Σ outflows(≤t) + Σ returns(disposition=restock, ≤t)
```
Exclude rows with `voided_at` set. `retakan` returns create a new inflow on the `(RETAKAN)` child product, not the parent. `writeoff` has no stock effect.

## Unit rules (from EggKeep code — prefer live `item_types` / `pack_skus` over hardcoding)

- `eggs_per_unit = 15.5` eggs/kg for both Negeri products. Catalog-level, editable in UI, not snapshotted on historical rows.
- Returns use a separate hardcoded `NEGERI_PIECES_PER_KG = 15.5` in `returnsCap.ts`. If the catalog value ever changes, sales and returns diverge. Agent should alert on mismatch.
- butir → kg rounding: `Math.round(n / 15.5 * 100) / 100` per line, then re-rounded to 2 dp per product per order (`aggregateOrderMaterials`).
- Tray = 30 eggs, logistics only, never stored.
- Inflows stored exactly as typed, no rounding.
- Pack and box expansions: `pack_skus.eggs_per_pack`, `item_types.box_capacities` (fallback `BOX_CAPACITIES` in `outflowCalculator.ts`).

## Gotchas the agent must handle

- **UTC default date.** `InflowForm.tsx:47`, `OutflowForm.tsx:51`, `QuickOutflowBuilder.tsx:92` default `date` to the UTC day. Between 00:00 and 06:59 WIB the form pre-fills yesterday. Returns, stock counts and the activity log use local date. Flag any row where `created_at` (converted to UTC+7) day ≠ `date`. Fixing the three forms removes this bucket at source.
- **RETAKAN child products** (since 14 Sep 2026) hold stock the sheet has no row for.
- **Seed drift.** `pack_skus` seed points `BK4AMTG`/`BK4AMTH` at `BEBEK ASIN MATANG`/`BEBEK ASIN MENTAH` and `KP10O`/`KP6O` at `KAMPUNG OMEGA` — names not in the egg catalog. If ever sold, their deductions went to products no sheet tracks.
- **Production data starts 2026-07-07** (opening balances "Stok Fisik"). Wipe/restore on 2026-07-20. One outflow dated `2025-07-11` (typo year) in the restore snapshot — filter.
- **Kg-native cutover 2026-07-03.** No pre-cutover rows should exist in live DB; verify.
- **No day cutoff.** Business date is whatever the user left in the field.

## Agent design

Steps 1–5 are deterministic Python. The LLM runs only in step 6, only on unresolved rows, and must cite the rows it used.

1. **Ingest** — EggKeep tables via Supabase, sheet tabs via Sheets API, P3 export, plus `rulebook.md` (plain Indonesian, admin-editable).
2. **Normalize** — numbers by column rule, units to native, dates to ISO, P3 sign to absolute.
3. **Derive daily roll from EggKeep** — the baseline. Sheet and P3 are claims to check against it.
4. **Match with ±2-day rolling window** — collapses late-post noise before comparing.
5. **Classify each SKU-day gap** into buckets:
   - auto-resolved: timing offset, UTC-date shift, RETAKAN, orphan SKU, P3 late-post
   - needs human: unposted transaction (in sheet or EggKeep, absent from P3), sheet butir-in-kg-row, unexplained
6. **Explain** — LLM writes a one-line hypothesis in Bahasa for needs-human rows, citing row ids.
7. **Write exceptions tab** into the Monitoring Stock sheet.
8. **Human review** — admin corrections become new rulebook lines; next run has fewer exceptions.

### Output table

One row per SKU × day:

```
date | sku | ek_in | sheet_in | p3_in | ek_out | sheet_out | p3_out
     | ek_close | sheet_close | p3_close | fisik
     | agree (EK=sheet | EK=P3 | sheet=P3 | all | none) | bucket | hypothesis | needs_human
```

Two derived views: per-SKU monthly count of which source was the odd one out (tells you which system to trust by product), and the `none` rows (the admin's worklist).

### Tolerance

Start loose: 2% of daily outstock per SKU, or 30 butir for count products. Tighten as the exception count falls.

### Open decision

Whether FISIK (physical count from the sheet) is a fourth source or the tiebreaker. Leaning: tiebreaker on count days, ignored otherwise — depends on how carefully the counts are done.

## First run scope

September 2026 only. EggKeep daily roll vs Final Check vs P3 KOMPARE, exceptions tab written back to the sheet. Run on known data first so the admin can see what the agent will do before anything is scheduled.

## Related work in the same business

- PO intake automation: Google Sheet checklist filled by Apps Script every 10 min via the Claude API, so staff stop copying buyer POs from email/WhatsApp. EggKeep link planned.
- Receivables agent (next after reconciliation): aged receivables export → scored list → drafted WhatsApp reminders in a review sheet.
