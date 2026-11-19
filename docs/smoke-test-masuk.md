# Smoke test — Masuk Bentuk, Tonase, the Catalog forms editor, and the Stok Fisik tally

Ten minutes on a real phone and a real tablet. Run it after any change to the Masuk
screen, the Catalog, or Stok Fisik, because the automated tests prove the arithmetic
and prove nothing about whether a picker can be tapped.

**The app writes to the live database.** Everything in Part A is read-only — do not
press Simpan. Part B is the one write, and it uses a receipt you had to enter
anyway, so the test leaves no junk behind. Part C is look-don't-save on a preview.
Part D's write rides the genuine floor count.

**What is testable when:** Parts A and B run against production today — Bentuk and
Tonase went live on 17 Nov. Part C needs #32's preview. Part D needs #34 and its
migration.

> The form lists below are the live catalogue as of **19 Nov 2026**. They are
> configuration, not code, so they drift — if a list here disagrees with the app,
> check Catalog before filing a failure.

---

## 0. Make sure the device is on the new bundle

The PWA is `registerType: "prompt"`: the service worker will not swap in a new
version until someone taps the update toast, so a device can run a weeks-old
bundle while production is current.

- [ ] Open the app and wait for the update toast, then accept it. It checks on focus
      and every 15 minutes.
- [ ] If no toast appears and the new things below are missing, close every tab of
      the app and reopen. For a home-screen install, remove and re-add it — the
      service worker precaches the manifest.

Nothing below is meaningful until this step passes. A "missing feature" is almost
always a stale bundle.

---

## Part A — read-only, on the phone (do not press Simpan)

### Bentuk appears, and only where it should

- [ ] Masuk → add a line → pick **NEGERI BIASA**. A **Bentuk** row appears under the
      line, with a button reading **Langsung (kg)**.
- [ ] Tap the button. A grid of options opens: Langsung plus every form configured
      for the product — **Curah, Iket 10 kg, Iket 15 kg, Tonase, Tray 30**. Five, and
      no packing formats: Iketan Osave, Karton Osave and the Negeri 6's / 10's / 15's
      were removed from Masuk on 18 Nov because they are the previous day's packed
      leftovers, not arrivals.
- [ ] Each option shows its size underneath (for example `30 butir per tray`).
      Langsung shows *sudah ditimbang / diketahui*.
- [ ] Pick **Tray 30**. The button now reads Tray 30 and the size text appears
      beside it. The Jumlah field's unit word changes to **tray**.
- [ ] Change the product to **KAMPUNG MERAH**. The Bentuk resets to Langsung, the
      options change (Iket 300, Tray 30, Pack 6's / 10's / 15's, Curah) and there is
      **no** Tonase — it only exists on kg products.
- [ ] Change the product to a packaging or box item. **No Bentuk row at all.**
- [ ] Pick **NEGERI BIASA (RETAKAN)**. No Bentuk row — that product has no forms
      configured.

### The Tonase weight control

- [ ] Still on NEGERI BIASA, pick **Tonase**. A **Berat per satuan** panel appears
      with − and + buttons around a weight field.
- [ ] Tap **+** and **−**. The weight moves in steps of 0,1.
- [ ] Clear the field and tap **+** once. It must land on the *lightest* weight in
      the range, not the heaviest.
- [ ] Type `12,5` with a comma. It is accepted, and the line beneath updates.
- [ ] Type something impossible (`999`, or letters) and tap elsewhere. The field
      falls back to the last good weight rather than keeping nonsense.
- [ ] Type a count in Jumlah. The quantity that will be recorded is count × weight.

### Does it fit the screen

- [ ] On the phone: nothing is cut off, the picker grid does not overflow, the
      weight field and its buttons are all tappable with a thumb.
- [ ] Switch to the **tablet** and repeat the Bentuk row and the Tonase panel. The
      tablet uses a different row layout, so it is a genuinely separate check.
- [ ] On the tablet, scroll to **Ringkasan** and confirm it is readable — it has
      never been viewed above 1024px.

### Then stop

- [ ] Leave the screen without pressing Simpan. Part A writes nothing.

---

## Part B — the one write, using a real receipt

Do this as part of entering a genuine intake from the backlog, not with made-up
numbers. Pick a receipt that actually arrived as bulk weighed stock.

- [ ] Enter the real receipt: supplier, date, product, **Tonase**, the weight per
      satuan from the scale, and the count.
- [ ] Check the quantity shown before saving matches count × weight.
- [ ] Press Simpan. It succeeds.
- [ ] **Reload that same date.** The saved line comes back with its Bentuk still set
      to Tonase and **the weight prefilled**. This is the step that has never been
      observed, and it is the only proof the weight survives a round trip to the
      database.
- [ ] Check Aktivitas shows the receipt with the expected quantity.

If the weight comes back empty, stop and report it — the line saved, but
`tonase_kg` did not.

---

## Part C — the Catalog forms editor (PR #32)

Until #32 is merged, do this on **its Vercel preview deployment**. The preview
points at the same live database, so **look, do not save**.

- [ ] Catalog → NEGERI BIASA → edit. A **Bentuk** section lists one row per form:
      name, unit, size, unit word.
- [ ] Each row shows what one unit books. For Tray 30 as butir 30 it reads
      `1 tray = 1,94 kg (30 butir ÷ 15,5)`.
- [ ] Change the product's **Telur/kg** field above. Every preview weight moves with
      it. Put it back.
- [ ] Change a row's unit to **kg each** and type `9,25`. The preview becomes
      `1 iket = 9,25 kg` and the `÷` disappears — a weight per bundle ignores the
      product rate.
- [ ] Clear a row's name. The preview is replaced by an error and **Simpan is
      disabled**. A broken row must block the save, never be dropped silently.
- [ ] Add a row, then delete it with the bin icon.
- [ ] **Leave without saving.** Saving here changes production catalogue data.
- [ ] Open a non-egg item. No Bentuk section.

A real save belongs in a separate, deliberate session once #32 is merged.

---

## Part D — the Stok Fisik bundle tally (PR #34)

**This part needs the `count_forms` migration applied first.** Without it the
calculator still opens, but it lists only the arrival forms — the packed leftovers
live in the new column, so Iketan Osave, Karton Osave and the Negeri 6's / 10's /
15's will be missing, and the tally will be short. Worse, on a #34 preview **saving
any egg product in Catalog fails** until the migration runs, because the save sends
`count_forms`. Reads degrade quietly; that one write does not.

### The calculator appears where it should

- [ ] Stok Fisik, **with the date set to today**, → the **NEGERI BIASA** row. A
      calculator icon sits in the product cell.
- [ ] Set the date to **yesterday**. The icon disappears from every row — the
      calculator is only offered on today's count. Set it back to today.
- [ ] Open a product with no countable bundle — a `(RETAKAN)` child, or anything in
      packaging. **No icon.** The button is only there when there is something to tally.

### The tally

- [ ] Tap the icon. A dialog opens, titled with the product name.
- [ ] Three location buttons across the top. The one whose cell you tapped from is
      already selected.
- [ ] One row per bundle. **Tonase is not listed** — its size is a delivery's scale
      reading, not a property of a bundle on a shelf.
- [ ] Each row shows its size until you type into it (`30 butir / tray`), then
      switches to what it books (`3 tray → 5,81 kg`).
- [ ] **Curah** shows *as typed in kg* and accepts a decimal comma (`12,5`).
- [ ] Type `2,5` into a bundle row. It must not count half a bundle — bundles are
      whole things.
- [ ] The **Total** at the bottom moves as you type.
- [ ] Count a real rack: a few iket, a few iketan, the loose kilos. Check the total
      against the paper you would otherwise have summed by hand. **This is the whole
      point of the feature** — if the two disagree, work out which is wrong before
      going further.

### Handing the number back

- [ ] The apply button is **disabled** until something is counted. Nothing counted
      must write nothing — a zero would read as "counted, and there is none", which
      shows as a full-stock variance.
- [ ] The button names its destination: *Masukkan ke JS* (the three labels are
      **JS**, **TST** and **Muat**).
- [ ] Tap a different location button. The apply button's label follows it.
- [ ] Apply. The dialog closes and the total appears in that location's cell.
- [ ] **Reopen the calculator. It is blank, and applying again REPLACES the cell —
      it does not add to it.** So count everything for one product and one location
      in a single sitting. If you tally a second rack separately and apply, the first
      rack's count is gone, silently.

That last step is a sharp edge, not a bug to report: it is how the dialog is built
today. It is also the one thing most likely to put a wrong number into a stock
adjustment, so read it twice before trusting a tally done in two passes.

### The write

- [ ] Do not press Simpan with test numbers. Stok Fisik's save writes a stock
      adjustment against the live book.
- [ ] Do the real write as part of the **genuine floor count** — the one that has to
      happen anyway, and which should come last, after both backlogs are entered.
      Use the calculator for it, and keep the paper tally so the two can be compared
      afterwards.

### The decision this unblocks

Iketan Osave's count form is still `butir 150`, so it converts through the product
average (150 ÷ 15,5 = 9,68 kg). Osave bundles hold smaller eggs, so that average
reads them heavier than they are. Declaring the form as a weight per bundle instead
— `kg`, with the figure the owner settles on — makes it exact and independent of the
product rate. That is a judgement about how the warehouse packs, not a test; make it
deliberately in Catalog once #32 and #34 are merged.

---

## If something fails

Note which step, which device, and what you saw instead. A failure in Part A is a
layout or wiring bug and is cheap to fix. A failure in Part B touched the database,
so say so immediately — the receipt may need voiding before it compounds.
