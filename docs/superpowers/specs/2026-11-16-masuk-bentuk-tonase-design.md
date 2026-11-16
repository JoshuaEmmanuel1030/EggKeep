# Masuk: record an egg line in the form it arrived in ("Bentuk") + Tonase

Date: 2026-11-16 · Status: approved, not yet planned
Design source: `docs/superpowers/specs/design_handoff_masuk_bentuk/` (README.md)
Prerequisite shipped: Masuk tablet 7a (`design_handoff_masuk/`)

## Problem

A Masuk egg line takes one number in the product's native unit: kg for Negeri, butir for the
rest. Deliveries do not arrive that way. They arrive as iket, tray, pack, karton, curah or
tonase, and the paper form records them that way, so whoever types the entry converts in
their head or on a calculator first. Two costs follow:

- Arithmetic done off-app is arithmetic nobody can check later. The line stores the result
  and loses the count it came from.
- **Tonase** has no fixed size: each load is weighed and its kg-per-satuan differs from the
  last. The app has no way to record that weight, so the typed kg is whatever the person
  worked out, and the app's figure and the warehouse sheet's figure for the same receipt can
  disagree. The owner confirmed (2026-11-16) that the sheet is right in those cases and the
  app is wrong, "because we were never able to accommodate for those weight tweaking".

## Scope

In: a shared form catalogue, the conversion rules, and the Bentuk row on Masuk (phone and
tablet 7a), including the Tonase per-line weight.

Out, by the owner's choice (2026-11-16), each its own spec:

- **Stok Fisik count entry** (`README-stok-fisik.md` in the handoff bundle): the overview and
  count screens, per-form tallies per location, variance and Kualitas hitungan. It shares the
  catalogue and conversion built here, and it needs a tally table plus changes to the
  adjustment RPCs, so it is a project of its own.
- **Retak on arrival.** Left out "for now". Cracks are found during packing, not at Masuk
  (owner, 2026-11-06).

Not applicable: Kuning Manik. It was removed from the catalogue on 2026-09-10, so the
handoff's question about giving it forms is moot.

## Decisions

| Question | Decision | Who |
|---|---|---|
| Tonase weight: per day or per delivery? | **Per line.** Each Tonase line carries the weight its load was weighed at, prefilled from the last Tonase line entered the same day. No daily record and no Masuk to Stok Fisik shared value. | owner, 2026-11-16 |
| Where the catalogue lives | `item_types.forms` JSONB, editable in the Catalog UI, with a code dict as the offline fallback | proposed here, owner approved 2026-11-16 |
| Weight stepper and range | ±0,1 kg, accepted range 5–30 kg. Real loads sit in a narrow band well inside that range; the bound is there to catch a typo, not to police the scale. | proposed here, owner approved 2026-11-16 |
| Disputed form sizes (No'6, Negeri 6's, Iketan Osave) | Seed from the warehouse sheet; the owner edits them in the Catalog afterwards. Does not block the build. | proposed here, owner approved 2026-11-16 |

The per-line weight is what makes the drift above impossible: the number the scale gave is
stored on the line that was weighed, instead of being re-derived per receipt.

## Data

### Form catalogue

A `forms` JSONB column on `item_types`, mirroring `box_capacities`:

```json
[ { "id": "iket15", "name": "Iket 15 kg", "size": 15, "unit": "kg" },
  { "id": "tray30", "name": "Tray 30",    "size": 30, "unit": "butir" },
  { "id": "curah",  "name": "Curah",      "size": 1,  "unit": "native" },
  { "id": "tonase", "name": "Tonase",                 "unit": "weighed" } ]
```

- Array order is display order. No sort field.
- `id` is a stable slug and is what a line stores, so renaming a form does not corrupt
  history.
- `unit` is one of `kg`, `butir`, `native` (Curah: the amount as typed) or `weighed`
  (Tonase: the size comes from the line).
- Products without forms get `null`, and the Bentuk row does not render for them.
- Not a new table: `eggs_per_unit`, `box_capacities`, `labels_per_pack`, `freshness_days` and
  `low_stock_threshold` all already live on `item_types` and are edited in the Catalog UI. A
  table would add RLS, a hook and a join for nothing.
- Seed values come from the handoff's catalogue table, which is the warehouse sheet's.

### Inflow line

Three nullable columns on `inflows`:

| Column | Meaning |
|---|---|
| `form` text | catalogue `id`; null means Langsung (the amount as typed) |
| `form_count` numeric | how many of that form, as entered |
| `tonase_kg` numeric | the weight used, only for a `weighed` form |

`quantity_butir` keeps the native-unit result exactly as today, so FIFO,
`record_order_outflows`, the adjustment RPCs, Insight and the `v_recon_*` views need no
change. The new columns record how the number was reached.

### Conversion

One function in the shared module:

| Form unit | Product | Result |
|---|---|---|
| `kg` | kg product | `count × size` |
| `butir` | kg product | `count × size ÷ eggs_per_unit` |
| `butir` | butir product | `count × size` |
| `weighed` | kg product | `count × tonase_kg` |
| `native`, or Langsung | either | the amount as typed |

A `weighed` form is only valid on a kg product: Tonase is on Negeri Biasa alone. The
catalogue must not put one on a butir product, and `eggForms` should treat that as a
misconfiguration rather than guess a unit.

## Screen

### Bentuk row

Under every egg line whose product has forms, below the
`# · Jenis · Jumlah · Faktur/Pemasok · hapus` row and above the conversion line. Layout,
type, colour and states are in the handoff README and are final.

- Label, form button showing the current form (or `Langsung (kg)` / `Langsung (butir)`), and
  the size after it.
- The picker opens inline under the row and pushes content down; it is not a popover. One
  line's picker open at a time. Langsung first, then catalogue order.
- **Changing the form clears the quantity**, so 10 kg is never read back as 10 iket.
- Changing the line's product resets the form to Langsung.

### Quantity field

The unit label inside the field follows the form (`iket`, `ikat`, `tray`, `pack`, `karton`,
`satuan`, or the product's native unit for Langsung and Curah). Whether decimals are accepted
follows the unit the number is in, not the form: a count of iket, tray or satuan is an
integer, while Langsung and Curah on a kg product take comma decimals through the existing
`parseQtyInput`, which already handles the thousands-dot convention. The Tonase weight field
takes decimals whatever the quantity field does.

### Conversion line

Shows the working, per the handoff's examples. This changes an existing rule: today the
tablet row renders the line only for kg products, because a butir product's conversion is 1:1
and "its line would just repeat the number" (`src/components/InflowForm.tsx`, the tablet
row's conversion block). With a form chosen there is real working to show, so the condition
becomes **kg product, or a form other than Langsung is chosen**. Langsung on a butir product
stays bare, as now.

### Tonase weight

When the chosen form's unit is `weighed`, a full-width control appears under the Bentuk row:
a label, a typeable field, and − / + buttons stepping 0,1 kg. The field takes comma decimals,
selects its value on focus, and returns to the last valid weight on blur if given something
outside 5–30 kg. Changing it recalculates that line's conversion and its Ringkasan row
immediately.

It prefills, in order: the last weight typed on another Tonase line in the form being filled
in; failing that, the weight on the most recently created saved inflow for that date; failing
that, empty, which blocks submit until it is filled. Every line stays editable, because two
loads weighed on one day can differ. Switching a line away from a weighed form drops its
weight; switching into one prefills by the same order.

The handoff's "Belum ditetapkan · kemarin {n} kg" state and its "Pakai {n} kg" button are
dropped: they belonged to the daily shared value, which the owner replaced with the per-line
weight.

### Ringkasan

Each line keeps `+{amount} {native unit}` and gains a note under it:
`{form} × {count} · {faktur} · Stok {before} → {after} {unit}`. A Tonase line reads
`Tonase × {count} ({weight} kg)`.

`Stok before → after` must **run down the lines per product**: a second line of the same
product starts from the first line's "after". Today it does not — the panel reads live stock
for every line, so two lines of one product both show the same "before"
(`src/components/InflowForm.tsx`, the `InflowSummaryGroup` build). Fixing that is part of
this work.

## Code

`InflowForm.tsx` is 786 lines and holds both the phone row and the tablet row. Adding the
Bentuk row, the picker and the weight control inline would push it past a thousand, so,
mirroring the prototype's own split into `masuk-bentuk.js`:

- **`src/lib/eggForms.ts`** — reads the catalogue off `item_types`, converts to the native
  unit, and builds the conversion-line parts. Pure functions, no React.
- **`src/components/inflow/BentukRow.tsx`** — the label, button, inline picker and the Tonase
  weight control. One component, used by both row layouts.
- `InflowForm` keeps the item state and the submit payload. The row reports
  `{ form, formCount, tonaseKg }` back through the existing `onUpdate` path.

`useItemTypes` gains `forms` on the item type it already returns.

## Validation

A form chosen with no count, or a Tonase line with no weight, is the existing
typed-but-invalid state: the amber note appears and submit is blocked. That path already
exists as `isBrokenItem` and the panel's `brokenNote`, so it needs no new mechanism.

## Locale strings

`id.ts` and `en.ts`, per the handoff: `inflow.form`, `inflow.formDirect`,
`inflow.formDirectHint`, `inflow.qtyPlaceholderForm`, `tonase.weightToday`,
`tonase.sizeLine`. The handoff's `tonase.notSet`, `tonase.set` and `tonase.useYesterday` are
not needed, since the daily value is gone.

## Tests

- `eggForms`: each of the five conversion rules, across a kg product and a butir product;
  Tonase with a weight; Curah; a product with no forms.
- Clearing the quantity when the form changes, and the reset to Langsung when the product
  changes.
- The submit payload carries `form`, `form_count` and `tonase_kg`, and `quantity_butir` still
  holds the native-unit result.
- Ringkasan chains `before → after` across two lines of one product.
- The conversion line appears for a butir product once a form is chosen, and not under
  Langsung.

## Non-goals

Stok Fisik count entry. Retak at Masuk. A Catalog editor for forms beyond what the existing
`item_types` editing gives. Changing how stock is stored, deducted or displayed.
