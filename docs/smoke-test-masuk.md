# Smoke test — Masuk Bentuk, Tonase, and the Catalog forms editor

Ten minutes on a real phone and a real tablet. Run it after any change to the Masuk
screen or the Catalog, because the automated tests prove the arithmetic and prove
nothing about whether a picker can be tapped.

**The app writes to the live database.** Everything in Part A is read-only — do not
press Simpan. Part B is the one write, and it uses a receipt you had to enter
anyway, so the test leaves no junk behind.

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
      for the product — Curah, Iket 10 kg, Iket 15 kg, Iketan Osave, Karton Osave,
      Negeri 6's / 10's / 15's, Tonase, Tray 30.
- [ ] Each option shows its size underneath (for example `150 butir per iket`).
      Langsung shows *sudah ditimbang / diketahui*.
- [ ] Pick **Iketan Osave**. The button now reads Iketan Osave and the size text
      appears beside it. The Jumlah field's unit word changes to **iket**.
- [ ] Change the product to **KAMPUNG MERAH**. The Bentuk resets to Langsung, the
      options change (Iket 300, Tray 30, Pack 6's / 10's, Curah) and there is **no**
      Tonase — it only exists on kg products.
- [ ] Change the product to a packaging or box item. **No Bentuk row at all.**
- [ ] Pick **KUNING MANIK**. No Bentuk row — that product has no forms configured.

### The Tonase weight control

- [ ] Back on NEGERI BIASA, pick **Tonase**. A **Berat per satuan** panel appears
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
- [ ] Each row shows what one unit books. For Iketan Osave as butir 150 it reads
      `1 iket = 9,68 kg (150 butir ÷ 15,5)`.
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

A real save belongs in a separate, deliberate session once #32 is merged — and the
first one to make is the Iketan Osave decision, which is a judgement about how the
warehouse packs, not a test.

---

## If something fails

Note which step, which device, and what you saw instead. A failure in Part A is a
layout or wiring bug and is cheap to fix. A failure in Part B touched the database,
so say so immediately — the receipt may need voiding before it compounds.
