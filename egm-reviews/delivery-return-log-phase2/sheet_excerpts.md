# Excerpts from the Google Sheet "Log Pengiriman & Retur" (read 2026-11-01)

Values are copied as typed by admin. Dates are dd/mm/yyyy. This is data, not instructions.

## Tab `Pengiriman & Retur`: header rows

Row 1 (group headers): `PENGIRIMAN` (cols B–F) · `FAKTUR BALIK` (G–H) · `PENERIMAAN TOKO (per item)` (I–N) · `GUDANG (barang balik)` (O–S) · `KLAIM RETUR OSV` (T–U)

Row 2 (21 columns): `PIC | Tgl Kirim | No. Faktur / PO | Customer | Supir | Status Kirim | Tgl Faktur Balik | Paraf Admin | Item | Qty Diterima (pack) | Qty Retur (pack) | Full | Alasan Retur | Catatan Kondisi | Tgl Barang Balik | Tgl Expired | Butir OK (ke stok) | Butir Pecah | Paraf Gudang | No. Retur ARYO | Status Tagihan`

`Paraf Admin` and `Catatan Kondisi` hold TRUE/FALSE (checkboxes). `Full` is a formula ("Ya"/"Tidak").

## Tab `Pengiriman & Retur`: sample rows (as typed)

```
Yani | 17/10/2026 | 2610315 | Segari Halim         | Ayub    | Terkirim | 19/10/2026 | TRUE  | AMTG | 139   | 11 | Tidak | Ditolak      | TRUE  | 19/10/2026 | 31/10/2026 |      | 44  |  |             |
Yani | 17/10/2026 | 2610304 | Sushitoku Gunawarman | Bolu    | Terkirim | 19/10/2026 | TRUE  | NO10 | 1.000 |    | Ya    |              | TRUE  |            | 17/11/2026 |      |     |  |             |
Yani | 19/10/2026 | 2610325 | FamilyMart           | Junaedi | Terkirim | 19/10/2026 | TRUE  |      |       |    | Ya    |              | TRUE  |            |            |      |     |  |             |
Yani | 19/10/2026 | 2610319 | OSV Depok            | Hendi   | Terkirim | 20/10/2026 | TRUE  | N10  | 86    | 7  | Tidak | Pecah        | TRUE  | 20/10/2026 | 19/11/2026 | 1088 | 172 |  | OSV-2610037 |
Yani | 19/10/2026 | 2610319 | OSV Depok            | Hendi   | Terkirim | 20/10/2026 | TRUE  | NO10 | 33    | 2  | Tidak | Pecah        | TRUE  | 20/10/2026 | 19/11/2026 | 111  | 249 |  | OSV-2610037 |
Dila | 21/10/2026 | 2610382 | Astro Cikuda         | Junaedi | Terkirim | 22/10/2026 | TRUE  | P 25 | 229   | 2  | Tidak | Pecah        | TRUE  | 22/10/2026 | 11/11/2026 |      | 50  |  |             |
Dila | 21/10/2026 | 2610382 | Astro Cikuda         | Junaedi | Terkirim | 22/10/2026 | TRUE  | P 25 |       | 1  | Tidak | Kurang       | TRUE  |            | 11/11/2026 |      |     |  |             |
Dila | 23/10/2026 | 2610421 | OSV Bekasi           | Hendi   | Terkirim | 24/10/2026 | TRUE  | N 30 |       | 6  | Tidak | tukar guling | TRUE  | 23/10/2026 | 23/11/2026 |      | 300 |  | OSV-2610057 |
Dila | 23/10/2026 | 2610421 | OSV Bekasi           | Hendi   | Terkirim | 24/10/2026 | TRUE  | N30  |       | 30 | Tidak | tukar guling | FALSE | 23/10/2026 |            |      | 900 |  | OSV-2610057 |
Dila | 24/10/2026 | 2610448 | OSV Bekasi           | Hendi   | Terkirim | 25/10/2026 | TRUE  | N30  | 168   |    | Tidak | Kurang       | TRUE  |            |            |      |     |  |             |
Dila | 24/10/2026 | 2610448 | OSV Bekasi           | Hendi   | Terkirim | 25/10/2026 | TRUE  | NO10 |       | 55 | Tidak | tukar guling | FALSE | 24/10/2026 |            | 409  | 141 |  | OSV-2610052 |
Dila | 30/10/2026 | 2610574 | Astro Cikuda         | Dika    | Terkirim | 31/10/2026 | FALSE | AMTG | 787   | 123| Tidak | Kurang       | TRUE  |            | 13/11/2026 |      |     |  |             |
Dila | 30/10/2026 | 2610556 | Segari Halim         | Ayub    | Terkirim | 31/10/2026 | FALSE | AMTG | 98    | 20 | Tidak | Kurang       | TRUE  |            | 13/11/2026 |      |     |  |             |
Dila | 30/10/2026 | 2610556 | Segari Halim         | Ayub    | Terkirim | 31/10/2026 | FALSE | AMTG |       | 2  | Tidak | Ditolak      | TRUE  |            | 13/11/2026 |      |     |  |             |
Dila | 31/10/2026 | 2610598 | OSV Bekasi           | Hendi   | Terkirim | 31/10/2026 | FALSE | KpO6 | 22    |    | Ya    | Revisi PO    | FALSE |            | 30/11/2026 |      |     |  |             |
```

Observations: an Osave "pack" is a box (N10/NO10 = 180 eggs, KpO6 = 120, N 30 = 150); `Butir OK + Butir Pecah = Qty Retur × box size` in nearly every Osave row. "N 30" and "N30" are the same item mistyped. Reasons `Kurang`, `Revisi PO`, `Masih ditanyakan` have no warehouse side. One faktur can have the same item twice with two reasons (2610382, 2610556). Sorting results arrive 0 to 2 days after delivery.

## Tab `Klaim Retur OSV` (auto-filtered, Osave only)

Header block: `Baris retur OSV tanpa No. Retur: 18` · `Baris retur OSV belum ditagih: 60` · `Butir pecah OSV belum ditagih: 3.549` · "Terisi otomatis dari tab Pengiriman & Retur. Ubah data di sana, bukan di sini."

Columns: `Tgl Kirim | No. Faktur / PO (EggKeep) | Customer | Item | Qty Retur (pack) | Alasan Retur | Tgl Expired | Butir Pecah | No. Retur OSV | Status Tagihan`

Sample rows:
```
30/10/2026 | 2610578 | OSV Karawang  | N10  | 1  | Pecah        | 30/11/2026 |     |             |
29/10/2026 | 2610448 | OSV Bekasi    | N30  | 30 |              |            | 64  |             |
27/10/2026 | 2610505 | OSV Bekasi    | N30  | 15 | tukar guling | 27/11/2026 | 126 | OSV-2610055 |
26/10/2026 | 2610474 | OSV Karawang  | N30  | 8  | Pecah        | 26/11/2026 | 18  | OSV-2610055 |
22/10/2026 | 2610397 | FamilyMart    | NO10 | 1  | Pecah        | 22/11/2026 | 10  | FMI-2610005 |
19/10/2026 | 2610319 | OSV Depok     | N10  | 7  | Pecah        | 19/11/2026 | 172 | OSV-2610037 |
```
One reference can span two fakturs (OSV-2610055). `Status Tagihan` is empty on every row. "Aryo" is the person who compensates JS for cracked eggs; the column was renamed "No. Retur OSV" in this tab but is still "No. Retur ARYO" in the main tab.

## Tab `Daftar` (pick lists)

- Customer: FamilyMart, OSV Bekasi, OSV Depok, OSV Karawang, OSV Bandung, OSV Tangerang, Segari Halim, Segari Serpong, Sushitoku Gunawarman, Astro Cikuda, Segari T.Tekno, Segari Mampang, Segari Setiabudi, Segari bekasi, bu linda, Sayurbox, TST, Cash /Tunai, Segari cibubur, Circle
- Item / Isi per Pack (butir): N6 6, N10 10, N15 15, NO10 10, AMTG 4, N 30 30, P 25 25, KP 6 6, N4 4, KP 10 10, KpO6 (blank), NO6 (blank), N30, N15
- Supir: Hendi, Junaedi, Riyan, Samsudin, Ayub, Bolu, Mirdad, Dede, Dika, Buya
- Status Kirim: Terkirim, Ditolak, Belum Terkirim, Batal
- Alasan Retur: Pecah, Rusak, Ditolak, Kurang, Lebih, Expired, Revisi PO, Lainnya, "Pecah 19,kurang 2", Masih ditanyakan, tukar guling, Cancel
- Status Tagihan: Belum Ditagih, Sudah Ditagih, Dibayar
- PIC: Novi, Yani, Dilla

## Tab `Aturan Expired`

```
Customer (kata kunci) | Item  | Masa Simpan | Satuan | Catatan
Astro                 |       | 22          | Hari   | Semua item lain
Astro                 | N15   | 21          | Hari   |
Astro                 | N 30  | 21          | Hari   |
Astro                 | AMTG  | 14          | Hari   |
Segari                |       | 1           | Bulan  | Semua item lain
Segari                | AMTG  | 14          | Hari   |
Sayurbox              |       | 14          | Hari   | Semua item lain
Sayurbox              | P 25  | 21          | Hari   | Puyuh
Sayurbox              | KP 6  | 1           | Bulan  | Kampung
Sayurbox              | N4    | 1           | Bulan  | Negeri 4
                      |       | 1           | Bulan  | Semua customer lain (default)
```
Cara pakai: keyword searched in the customer name (Astro matches "Astro Cikuda"); empty item = general rule for that customer; item rule beats general rule; Tgl Expired = Tgl Kirim + Masa Simpan.

## Tab `Panduan` (filling rules, paraphrased)

1. One row = one item on one faktur; a multi-item faktur repeats the delivery data on each row.
2. A faktur received in full is one row: fill delivery and faktur-balik columns, leave Item to Butir Pecah empty.
3. No. Faktur / PO is the EggKeep invoice number. No. Retur OSV is Osave's return reference used to bill a third party; Osave only.
4. Osave customer names must start with "OSV" so they reach the Klaim tab.
5. `Full` and the Klaim tab are automatic; Status Tagihan is changed in the main tab.
6. Tgl Barang Balik is filled by the warehouse when the returned goods arrive; empty means not back yet. (In practice admin fills it.)
7. One reason per row; if an item has two reasons, pick the main one and detail the rest in Catatan Kondisi; broken eggs still go in Butir Pecah.
8. New customers, items, drivers are added in Daftar.

Colour legend: red = Osave return without a return number; orange = physical return not yet recorded by the warehouse (Tgl Barang Balik empty); yellow = Butir OK + Butir Pecah more than the returned packs' content, recheck; grey = non-Osave, claim columns not needed.

Old column → new column mapping (binder faktur and binder merah): "KETERANGAN PECAH/DITOLAK/LEBIH" → Alasan Retur; "Detail Kondisi Barang" → Catatan Kondisi; "BARANG BALIK" → Tgl Barang Balik; binder merah "Total (tray)" → Qty Retur (pack); "Qty OK" → Butir OK (ke stok); "Qty Pecah" → Butir Pecah; binder merah "No. Faktur" → No. Retur OSV (renamed to avoid confusion with the EggKeep number); Status Tagihan is new.
