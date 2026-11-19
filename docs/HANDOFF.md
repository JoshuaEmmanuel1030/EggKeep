# EggKeep — handoff for a fresh Claude session

Last reviewed **2026-11-19**. EggKeep is a live React/TS + Supabase PWA run by an
Indonesian egg-distribution warehouse. Real staff, real phones, real money.

## How to read this file

**It contains no business figures, on purpose.** Stock levels, sales, volumes and
conversion rates are never written down here. Every one of them is a query you run
against the live database, and §5 gives you the queries.

Two reasons, and both have already burned this project:

- The GitHub repo is **public**. A figure written into a doc, a test, a comment or a
  commit message is published.
- A figure written down goes stale and then reads as fact. `JS/CLAUDE.md` once
  carried an Osave conversion that drifted; every session from that tree inherited a
  wrong number and reasoned confidently from it. A smoke-test checklist in this very
  repo listed catalogue forms that had been deleted the day before, so three of its
  steps could not be followed and one would have been reported as a bug.

If you need a number, read it from the database or the catalogue. Never from prose.

---

## 1. The hard rules

These are not style preferences. Breaking one of these can corrupt stock, publish
business data, or put a wrong figure in front of a warehouse.

### 1.1 Production data is sacred

- The live Supabase project is **`lgtixzpjbkzapecirbfj`**. `.env` and
  `supabase/config.toml` may still carry the stale ref `kpszurxnzhivrvzmcded`.
  `npm run verify` runs a guard that fails on the stale ref — never bypass it.
- **Never sign in to the app as the owner.** The dev server and every Vercel preview
  point at the live database. A browser check that submits anything writes to
  production.
- **Preview deployments are production data.** Look, do not save.
- **Never run `supabase/tests/*.sql` against production.** They mutate. They are for
  an empty Supabase branch only. `supabase/checks/*.sql` is the opposite — read-only
  and safe on prod (currently `fifo_integrity.sql`).
- Any migration, any `update`/`insert`/`delete` against prod, and any edge-function
  deploy needs the owner's explicit go-ahead **for that specific change**. Approval
  of one does not carry to the next.
- Destructive or hard-to-reverse operations: say what will change, wait for a yes.

### 1.2 The repo is public

- Keep **stock, sales, volume and price figures** out of code, comments, tests,
  fixtures, commit messages, PR titles and PR bodies.
- This has been enforced retroactively once already: a branch was squashed and
  force-pushed to strip live audit figures out of test fixtures. Do not create that
  work again.
- Conversion constants that already exist in the codebase as offline fallbacks are
  fine to touch; new figures lifted from the Google Sheet or from a production query
  are not.

### 1.3 Git hygiene

- **Most of `.claude/` is NOT gitignored.** The repo ignores only
  `.claude/worktrees/` (added in July, the day four agent worktrees were committed
  by accident as nested-repo pointers and then removed). Everything else there —
  agent definitions, hooks, skills, `settings.json`, launch configs — would be
  swept in by `git add -A`, into a public repo. **Always stage explicit paths.**
- **`.env` is tracked and usually modified.** Never commit it. It carries a live key.
- Commit or push only when the owner asks.
- Worktrees live under `.claude/worktrees/`. The git stash stack is shared across
  them — never bare `git stash`/`git stash pop`.
- **The main checkout is not always on `main`.** Check before you read a file and
  assume it reflects `main`; prefer `git show origin/main:<path>`. A dialog was once
  designed against a helper that existed only on an unmerged branch.
- **Stacked PRs:** never pass `--delete-branch` when merging the *base* of a stack.
  It closes the dependent PR, which then cannot be reopened (base gone) or
  retargeted (it is closed). Recovery means pushing the base branch back from its
  SHA. Merge the base with `--merge`, not `--squash`, so the dependent branch still
  descends from what landed.

### 1.4 Deploy model

- **Frontend:** push to `main` → Vercel auto-builds production. There is no separate
  deploy step, so **merging to `main` is a production deploy**.
- **Edge Functions** (`supabase/functions/*`) deploy separately. A git push does
  **not** touch them.
- **Migrations are applied via Supabase MCP `apply_migration`**, and must land
  **before** the frontend code that depends on them.
- The MCP stamps its own version number, so the repo filename and the recorded
  version differ. Write migrations idempotently (`add column if not exists`, guarded
  `where ... is null`) so a replay is harmless.
- **The PWA is `registerType: "prompt"`.** The service worker only swaps in a new
  bundle when the user taps the update toast. A phone can run a weeks-old bundle
  indefinitely. **Therefore every DB change must be backward-compatible** with code
  already in the field.
- Manifest changes need the full dance: accept the toast → remove the home-screen
  app → re-add it. The SW precaches the manifest.

### 1.5 kg-native stock design

The single most dangerous thing to "fix" in this codebase.

- `quantity_butir` / `remaining_butir` hold each product's **native** unit:
  **kg** for weight-sold eggs (`item_types.unit='kg'`), **butir** for count-sold,
  **pcs** for boxes/labels/packaging.
- **The column names are legacy. Do not rename them, and do not convert kg↔butir
  when storing or deducting.**
- The conversion factor is only for pack sales of kg eggs and for butir-equivalent
  estimates on aggregate displays.
- Core helpers: `src/lib/inventory.ts` (`getStockUnit`, `toStockUnits`,
  `butirEquivalent`).
- Per-product numbers display in native unit (kg gets an `(≈ N butir)`
  parenthetical). **Cross-product totals must use butir-equivalents** — never sum kg
  and butir raw.
- Load-bearing display helpers to preserve when restyling: `InventoryDashboard.tsx`
  (`isKgProduct`, `butirEstimate`, `formatStock`), `PickListDialog.tsx`
  (`formatButir`), `OrderSummaryPanel.tsx` (`eggUnit`), `GroupedActivityLog.tsx`
  (`useStockUnitLabel`).

### 1.6 Stock movement is server-side only

- **All outflows go through the Postgres RPC `record_order_outflows(p_entries
  jsonb)`** — atomic per order, row-locked FIFO with relative updates, idempotent by
  client entry UUID.
- **Never reintroduce client-side FIFO with absolute writes.** It previously caused
  silent stock inflation.
- Same rule for `correct_order`, `void_outflow`, `reconcile_inventory`,
  `recalculate_inventory_fifo`, `record_return`, `apply_stock_count_adjustment`.
- Offline outbox: network-failed orders queue in localStorage and replay on
  reconnect (`src/lib/outflowOutbox.ts`, `src/lib/returnOutbox.ts`).
  `INSUFFICIENT_STOCK` is never queued.
- **Known limitation:** the FIFO `ORDER BY date, created_at` has no deterministic
  tiebreak, and production contains many batches saved in the same transaction that
  tie to the microsecond. Adding `, id asc` was **considered and declined** — see §3.

### 1.7 Returns (retur)

- All returns go through `record_return(p_return jsonb)` — atomic, SECURITY DEFINER,
  idempotent by client line id, with a cumulative cap per `outflow_id`.
- A change means a full `create or replace` of the whole function body; the latest
  definition is in the newest `supabase/migrations/*retakan*|*returns*` file.
- Three dispositions, and one line can split across all three: **restock** (back
  into the original FIFO batches), **retakan** (a fresh inflow on the tagged child
  `"<PRODUCT> (RETAKAN)"`), **writeoff** (logged only).
- Eggs pool **per egg product**, so returns key by `outflow_id`; `returns.sku_code`
  is a display label only.
- Return entry is per order line **in pieces**; `src/lib/returnsCap.ts` converts at a
  flat `NEGERI_PIECES_PER_KG`, **not** the catalogue `eggs_per_unit`.
- Feed codes **O/R/H** (OK/Retak/Hancur) are fixed and never translated.

### 1.8 Catalogue is the source of truth

- Conversions live in the database and are edited in the Catalog UI:
  `item_types.forms` / `count_forms` / `eggs_per_unit` / `box_capacities` /
  `labels_per_pack` / `freshness_days` / `low_stock_threshold`, and
  `pack_skus.eggs_per_pack` / `eggs_per_kg`.
- `CONVERSION_DICT` and `BOX_CAPACITIES` in code are **offline fallbacks only** —
  never the source of truth, never the place to change a number.
- Do not hardcode a figure lifted from the Google Sheet. Derive it from EggKeep's own
  catalogue or history.

### 1.9 Code conventions

- **i18n: every user-facing string goes in BOTH `src/locales/en.ts` and `id.ts`.**
  A PR that adds one and not the other is incomplete.
- The repo compiles with `strict: false` — discriminated-union narrowing does not
  work. Do not rely on it.
- Eggs and packaging are named ALL CAPS. `activity_logs.product` and
  `invoice_supplier` are name snapshots by design.
- **UUID migration is half-done** (`docs/uuid-migration/PLAN.md`). Stage A is
  applied; **names are still the operational key** until Stage C. Renaming a
  catalogue item does **not** cascade to `pack_skus` name pointers, and box names
  must equal the `BoxModeType` union — **do not rename boxes.**
- Decimal input: `parseQtyInput(raw, unit)` / `qtyInputText(n)` in
  `src/lib/stockCount.ts`. Comma is the decimal separator; **a dot is a thousands
  separator** (`1.500` kg means 1500 kg). Every quantity input must go through it —
  a mistyped dot once threatened to wipe stock.

### 1.10 The verify gate

- **`npm run verify` before every push.** It chains the Supabase ref guard,
  `tsc --noEmit -p tsconfig.app.json`, and the full vitest run.
- Single file: `npm test -- --run src/path/to.test.ts` · by name:
  `npm test -- --run -t "cap tightens"`.
- vitest flakes/OOMs on long sessions (workers exit, `tests 0ms`, hangs). Rerun with
  `NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <path> --pool=forks --no-file-parallelism`.
  A hang at `tests 0ms` on a **component** file usually means an infinite render
  loop (an effect/memo on an unstable object identity), not the environment.
- vitest excludes `.claude/**` — keep it that way, agent worktrees live there.
- Component tests need `// @vitest-environment jsdom` as **line 1**, plus
  `import "@testing-library/jest-dom/vitest"` and an explicit `afterEach(cleanup)` —
  there is no `setupFiles`.

---

## 2. Merged is not working

This project's most common failure is not a bug. It is believing a feature works
because the pipeline was green.

The chain has four links, and **green only proves the first**:

| link | proves | how it fails |
|---|---|---|
| tests + tsc pass | the arithmetic | a pure-function test cannot see a payload wired into INSERT and forgotten in UPDATE |
| merged to `main` | it is in the repo | — |
| Vercel build green | it compiled and deployed | — |
| a human watched it render | **it works** | nobody looked |

Two real examples from this repo:

- A forms payload was wired into the `item_types` INSERT and forgotten in the
  UPDATE, so editing a product silently dropped the forms — the only path that
  matters, since products are edited, not re-created. Every test passed. Ten seconds
  in the dialog would have caught it.
- A feature was reported as shipped, and the owner replied *"Where is the frontend? I
  gave you a handoff and the deliverable is nowhere to be seen."* The cause was a
  stale PWA bundle — but it exposed that UI had been shipped that nobody had seen.

**So:** do not write "done", "working", or "verified" for anything rendered in a
browser unless a human has looked at it. Say "merged and deployed, not yet seen".
`docs/smoke-test-masuk.md` is the checklist for the Masuk / Catalog / Stok Fisik
surfaces; extend it rather than inventing a new one.

**Previews cannot be put on a phone without extra work.** Branch preview URLs are
behind Vercel Deployment Protection: they 403 and redirect to a Vercel login, which a
warehouse phone is not signed into. The fix is the **Share** button on the deployment
page, which yields a `_vercel_share` URL that opens anywhere for ~23 h. Do not
suggest disabling Deployment Protection — previews point at the live database. The
Vercel MCP tools 403 on this account and the `authorize_team_access` grant has not
stuck; do not spend turns on it.

---

## 3. Decisions already made — do not redo these

Every item here was proposed, considered, and **declined or deferred by the owner**.
Several look like obvious free wins, which is exactly why they keep getting
re-suggested. Do not act on any of them unasked.

| thing | status |
|---|---|
| Rename `AST30NB` → `ASTN30B` so the order line resolves | **Declined 2026-11-17.** It was verified safe first (no references in `pack_skus.base_pack_code`, `delivery_lines` or `returns`), so it will look tempting. Leave both codes. |
| Add `, id asc` to the FIFO `ORDER BY` for a deterministic tiebreak | **Declined.** Many tied groups exist in production; the owner chose not to change draw order. |
| Clean up the leftover `Pack N's` forms on Kampung / Asin / Bebek / Puyuh | **"Leave them", 2026-11-18.** Only the two Negeri products were cleaned. |
| Re-declare the Iketan Osave Masuk form in kg | **Declined.** It is a count-only form now; the kg question is §4. |
| A `suppliers` table, a Suppliers tab, or a Pemasok screen | **Deferred 2026-11-06.** Cracks are found during packing, not at Masuk. |
| Correct the historical Osave over-deduction order by order | **Established unnecessary 2026-11-17.** A physical count sets book = reality and absorbs all prior drift; correcting afterwards double-counts. |
| Stock-correct NEGERI BIASA orders dated 9 Nov 2026 or earlier | **Forbidden.** Their errors are already absorbed in a manual opening correction applied 2026-11-13. |
| Apply the 2026-10-31 stock count's variances | **No.** Three weeks of trade have passed; only a fresh count is valid. |
| Hardcode any conversion lifted from the Google Sheet | **No.** See §1.8. |

---

## 4. Open questions that are the owner's to answer

Do not decide these yourself; they are judgements about how the warehouse works.

- **Iketan Osave's count form** is declared as a butir count, so it converts through
  the product average. Osave bundles hold smaller eggs, so that average reads them
  heavier than they are. Declaring it as a weight per bundle instead would be exact
  and rate-independent. The owner sets the figure.
- **NEGERI OMEGA's count forms contain two entries of the same size** (`No'6` and
  `Pack 6's`). Faithful to what was there before, but confusing in the tally dialog.
- **The Stok Fisik tally dialog replaces the cell** and reopens blank, so a count
  done in two passes silently loses the first. A one-line "cell currently holds X,
  applying replaces it" would blunt it. Offered, not built.
- **Why the book drifts so far on PUYUH and both KAMPUNG products.** Suspects on
  record: unentered orders, duplicates, unrecorded Kas Tunai. The owner chose "just
  count" on 2026-11-19 rather than a root-cause dig.

---

## 5. How to find the real state

Run these. Do not quote their output into a file.

**Is the data current, and how far behind is each side?**
```sql
select 'inflow' as side, max(date) as last_business_date, max(created_at)::text as last_typed
from public.inflows where voided_at is null
union all
select 'outflow', max(date), max(created_at)::text
from public.outflows where voided_at is null;
```
`inflows.date` and `outflows.date` are **text**, so cast with `date::date` before
comparing to a date. Business date is the `date` column — never `created_at`, which
is when someone typed it. Backdated entry is normal and legitimate here.

**Current book balance per product (FIFO remainders):**
```sql
select it.name, it.unit, sum(i.remaining_butir) as book, count(*) as open_batches
from public.inflows i join public.item_types it on it.id = i.item_type_id
where i.voided_at is null and i.remaining_butir > 0 and it.category = 'egg'
group by it.name, it.unit order by 3 desc;
```
Remember the book reads **high** whenever deliveries are entered further behind than
intake. A book balance is not stock.

**Last physical count, and whether anything was ever applied:**
```sql
select count_date, location, product, quantity, system_qty, counted_by
from public.stock_counts
where count_date = (select max(count_date) from public.stock_counts);

select 'adjustments applied' as what, count(*) from public.inflows
where voided_at is null and stock_adjustment_id is not null;
```
`stock_counts.system_qty` is **null for `loaded` and `tst_warehouse`** — the book
tracks one pool, so only the JS warehouse line yields a real variance. A null is not
a zero-variance match.

**Catalogue conversions in force:**
```sql
select name, unit, eggs_per_unit, forms, count_forms
from public.item_types where category = 'egg' and deleted_at is null order by name;

select code, egg_product, eggs_per_pack, eggs_per_kg from public.pack_skus order by code;
```
When aggregating `forms` for display, **`coalesce` every field** — a `weighed` form
(Tonase) carries no `size`, and a NULL inside a string concat silently drops the
whole row from `string_agg`. That artifact once read as "Tonase has been deleted".

**FIFO health:** run `supabase/checks/fifo_integrity.sql`. Read-only, safe on prod.

**What is actually open on GitHub:** `gh pr list --state open` and
`gh issue list --state open`. Do not trust a session summary for this.

---

## 6. State as of 2026-11-19

Point-in-time. Re-derive with §5 before relying on any of it.

**Open on GitHub:** nothing. PRs #32, #33, #34 and #35 all merged on 2026-11-19.

**Seen working in the app, 2026-11-19:** the Catalog forms editor (#32), the Stok
Fisik bundle tally (#34) and the Masuk retakan filter (#35) were all driven in a
browser against a preview, and behave as specified — row previews compute, the tally
sums across arrival and count-only bundles with Tonase correctly absent, and the
retakan filter applies to Masuk alone. Nothing was saved during that check.

**#35 is worth reading as a worked example of §1.6.** Its first version filtered
`(RETAKAN)` products out of `eggProductNames` — the list shared by Masuk *and* the
sales pickers — which would have made a retakan cash sale impossible to record, and
retakan eggs do sell. The fix puts the filter at the one caller that wants it
(`src/lib/masukProducts.ts`, used only by `InflowForm`), leaving the shared list
alone. A filter wanted by one caller belongs at that caller, not in the shared
helper. Three independent retakan filters now exist — Masuk, the radial wheel
(`eggRingItems`) and Insight — so check which one you are looking at before
concluding anything about where retakan is visible.

**Never exercised:** the Stok Fisik "Penyesuaian" (adjustment) button. Its SQL tests
were never run, and it has never been pressed. **Preview the adjustment and compare
it to the paper count before the first Apply.**

**Live risk:** the last physical count is weeks old and its variances were never
applied, because the adjustment button shipped after that count. The book therefore
carries real uncorrected drift, largest on PUYUH and both KAMPUNG products. A fresh
count will show large negatives — that is expected, not a new fault.

**Also outstanding:** the phone order wheel (PR #21) has never been run on live data
or a real device. The delivery log's claims-and-billing phase has no spec. The UUID
migration stages B and C are unplanned.

**The owner's operational queue needs no code at all:** enter the day's intake and
deliveries, then count, then apply the adjustment carefully.

---

## 7. Where knowledge actually lives

- **`JS/CLAUDE.md`** — company context: the business, the group structure, the
  product catalogue in prose, and a table of where each conversion is configured.
  Inherited by sessions in this repo.
- **`EggKeep/CLAUDE.md`** — the code guardrails, condensed.
- **`JS/Knowledge/`** — the durable company brain (Business / Process / Product),
  plain markdown with `[[wikilinks]]`. **Durable conclusions belong here, not just in
  chat.** Write atomic notes, one topic per file.
- **`JS/.claude/agents/`** — three expert hats: `business-strategist`,
  `process-engineer`, `ocr-rnd`. **These are only available when Claude is launched
  from `JS/`, not from `JS/EggKeep/`.** If the question is about warehouse process or
  company structure rather than code, launch from `JS/`.
- **`JS/Labs/`** — OCR and document-digitalization R&D, deliberately outside the app
  repo.
- **`docs/`** in this repo — `OPERATIONS.md`, `reconciliation.md`,
  `smoke-test-masuk.md`, `spec-export-rekonsiliasi.md`, `panduan-eggkeep.md`,
  `uuid-migration/PLAN.md`, and specs under `superpowers/specs/`.
- **The session memory directory** holds ~30 atomic notes keyed by `MEMORY.md`:
  what shipped when, what was declined, and why. **A session transcript is not a
  substitute** — transcripts hold the reasoning, memory holds the conclusion.

---

## 8. Working style the owner expects

- **Reply in short, concise bullet points.** Not paragraphs. Written deliverables
  stay full length; chat does not.
- **Be blunt.** The owner has explicitly asked for no sycophancy. If something is
  broken, badly designed, or unverified, say so plainly and say what you do not know.
- **Do not claim verification you did not perform.** "Tests pass" and "it works" are
  different sentences.
- **Check before asserting a fact about live state.** Facts established earlier in a
  session go stale — staff enter data between sessions. Re-query.
- **Pass `model: "opus"` on every `Agent` call**, not the cheaper default.
- Finish the whole task. If part is blocked, do the rest and say exactly what was
  left and why.
