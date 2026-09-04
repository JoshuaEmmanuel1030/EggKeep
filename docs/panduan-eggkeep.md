# 📘 Panduan Penggunaan EggKeep

**Untuk:** Staf gudang & admin data-entry JS
**Bahasa sederhana. Baca sekali, langsung bisa dipakai.**

EggKeep adalah aplikasi stok & operasional gudang telur. Semua yang kita catat di sini dipakai untuk laporan stok, penjualan, dan utang supplier. **Data di aplikasi ini = data nyata perusahaan. Catat dengan benar dan jujur.**

---

## 🔑 5 Aturan Emas (baca dulu ini)

1. **Catat sesuai kejadian nyata**, bukan kira-kira. Angka salah = laporan salah = uang salah.
2. **Satu barang, satu satuan.** NEGERI ditimbang **kg**. Telur lain dihitung **butir**. Jangan tertukar.
3. **Titik desimal pakai KOMA.** Contoh 9,5 kg → ketik `9,5` (bukan `9.5`).
4. **Urutan input itu penting.** Ikuti urutan harian di bawah supaya stok tidak kacau.
5. **Kalau ragu, tanya dulu — jangan asal input.** Salah input lebih repot dibetulkan daripada bertanya.

---

## ⏰ Urutan Kerja Harian (WAJIB diikuti)

Urutan ini menjaga supaya **stok fisik cocok dengan stok di aplikasi**.

```
PAGI (sebelum barang gerak)
  1. Hitung STOK FISIK dulu  ← sebelum ada truk masuk/keluar
  2. Pastikan catatan KEMARIN sudah masuk semua (barang masuk & keluar)
  3. Simpan stok fisik

SIANG (operasional berjalan)
  4. Catat BARANG MASUK begitu barang sampai di gudang JS
  5. Catat RETUR kalau ada barang balik dari customer

MALAM (siapkan kirim besok)
  6. Catat BARANG KELUAR saat barang di-loading ke truk
```

> ⚠️ **Jangan input transaksi hari ini SEBELUM stok fisik pagi disimpan.** Kalau barang keluar/masuk hari ini sudah diinput sebelum hitung fisik, angka "expected" akan bergeser dan selisih jadi palsu.

---

## 1️⃣ Barang Masuk (Stok Datang / Instock)

**Kapan dicatat:** saat barang **sudah sampai fisik di gudang JS**.

> 🚚 **Barang lewat TST dulu (Malindo, Lampung, dll):** JANGAN dicatat pas masih di TST. Baru catat **instock setelah barang pindah dan sampai di JS.** Kalau dicatat pas masih di TST, aplikasi mengira stok JS lebih banyak dari kenyataan → nanti hitungan fisik kelihatan kurang padahal tidak.

**Cara input:**
1. Buka menu **Barang Masuk**.
2. Pilih produk (NEGERI OMEGA, KAMPUNG BIASA, dll).
3. Isi jumlah **dalam satuan produk itu**:
   - NEGERI → **kg** (boleh koma, contoh `15,5`)
   - Telur lain → **butir**
4. Isi **tanggal** barang masuk dan **supplier/invoice**.
5. Simpan.

✅ **Benar:** NEGERI BIASA `310,5` kg
❌ **Salah:** NEGERI BIASA `310.5` (titik) atau memasukkan jumlah butir ke kolom kg.

---

## 2️⃣ Barang Keluar (Order / Pengiriman)

**Kapan dicatat:** saat barang **di-loading ke truk** (malam sebelum kirim). Inilah aturan kita — begitu di-loading, langsung dicatat keluar.

**Cara input (Quick Outflow / order per customer):**
1. Buka menu **Barang Keluar**.
2. Pilih **customer** (OSAVE, SBOX, SEGARI, dll).
3. Masukkan baris order:
   - Pilih **SKU/pack** dan jumlah pack, **atau**
   - Pilih telur satuan (loose) dan jumlah butir/kg.
4. Periksa ringkasan bahan (telur, pack, box) sudah benar.
5. Simpan.

> 💡 Karena barang keluar dicatat **saat loading**, maka pagi harinya barang yang sudah di truk **sudah tidak dihitung** sebagai stok gudang. Ini penting untuk stok fisik (lihat bawah).

---

## 3️⃣ Stok Fisik (Hitung Stok Pagi) — bagian paling penting

Tujuan: memastikan **stok nyata di gudang JS = stok di aplikasi**. Selisih (deviasi) menandakan ada salah catat, kehilangan, atau salah hitung.

### Kapan menghitung
**Pagi hari, sebelum truk masuk atau keluar.** Ini "garis potong" (cut-off). Kalau ada truk bergerak sebelum selesai hitung, catat dulu apakah barang itu sudah masuk hitungan atau belum.

### Tiga kolom — apa artinya
| Kolom | Isi apa | Dibandingkan ke aplikasi? |
|-------|---------|---------------------------|
| **JS** | Stok fisik yang ada **di gudang JS** | ✅ **YA** — ini yang dipakai untuk akurasi/deviasi |
| **TST** | Barang yang masih **di gudang TST** (belum pindah ke JS) | ❌ Tidak — hanya catatan |
| **Loaded** | Barang order kemarin yang **sudah di truk**, belum dikirim | ❌ Tidak — hanya catatan silang |

> ⚠️ **Angka akurasi hanya membandingkan kolom JS dengan versi aplikasi.** Jadi pastikan kolom **JS diisi dengan teliti**. Kolom TST & Loaded berguna untuk pengecekan, tapi tidak masuk hitungan akurasi.

### Cara membaca deviasi
- **DEV positif (+)** → stok fisik **lebih banyak** dari aplikasi. Biasanya ada **barang masuk yang belum dicatat**. → Cek penerimaan.
- **DEV negatif (−)** → stok fisik **lebih sedikit** dari aplikasi. Biasanya ada **barang keluar belum dicatat**, atau ada susut/hilang. → Cek pengiriman.
- **Cocok (0)** → mantap. ✅

### Disiplin cut-off (supaya deviasi tidak palsu)
1. Sebelum menghitung, pastikan **semua transaksi KEMARIN sudah masuk** (barang masuk & keluar).
2. **Jangan** dulu input transaksi hari ini sampai stok fisik disimpan.
3. Baru setelah simpan, lanjut operasional hari ini.

---

## 4️⃣ Retur (Barang Balik dari Customer)

Retur biasanya **sebagian** dari order (sering telur pecah/rusak), datang **1–2 hari** setelah kirim. Retur **selalu dihubungkan ke order aslinya**.

**Cara input:**
1. Buka halaman **Aktivitas**.
2. Cari **order aslinya** (kartu order customer tersebut).
3. Tekan tombol **Catat Retur** di kartu order itu.
4. Untuk tiap barang yang balik, isi **jumlah** yang diretur.
5. Pilih **jenis retur** per barang:
   - **Restock (masuk lagi)** → telur **masih bagus**, dikembalikan ke stok jual.
   - **Write-off (dibuang)** → telur **rusak/pecah**, tidak dijual lagi. (Hanya dicatat, stok tidak berubah.)
6. Isi **tanggal retur** (boleh tanggal kemarin kalau baliknya kemarin) dan alasan.
7. Simpan.

> ✅ **Restock** otomatis mengembalikan telur ke batch aslinya (umur telur tetap benar, dijual lebih dulu).
> ✅ **Write-off** tidak mengubah stok — memang telurnya sudah tidak ada.
> ⚠️ Jumlah retur **tidak boleh melebihi** jumlah yang dulu dijual di order itu.

---

## 5️⃣ Membatalkan / Membetulkan Entri (Void)

Kalau salah input:
1. Buka halaman **Aktivitas**, cari entri yang salah.
2. Tekan tombol **edit/void** (ikon pensil), isi **alasan**, konfirmasi.
3. Stok otomatis dikembalikan dengan benar.

> ⏱️ Batas waktu: pemilik entri bisa membatalkan dalam **48 jam**. Admin bisa kapan saja.
> ⚠️ Untuk membatalkan **satu order penuh**, gunakan tombol **Batalkan Pesanan** — akan minta konfirmasi dulu.

---

## ✅ Praktik Terbaik (Best Practices)

- **Input sesegera mungkin** setelah kejadian, jangan ditumpuk. Makin lama makin gampang lupa/salah.
- **Cek ulang satuan** sebelum simpan (kg vs butir). Ini penyebab error paling sering.
- **Pakai koma untuk desimal** (`9,5`), jangan titik.
- **Selesaikan catatan kemarin** sebelum hitung stok fisik pagi.
- **Jangan catat barang TST sebagai stok JS** — tunggu sampai fisik di JS.
- Kalau **deviasi besar**, jangan langsung panik — cek dulu: apakah ada barang masuk/keluar belum dicatat? Baru curiga susut.
- **Kalau ragu, tanya.** Lebih baik bertanya daripada salah input.

---

## 📏 Referensi Satuan & Konversi

| Produk | Satuan jual |
|--------|-------------|
| NEGERI (Omega/Merah = O, Biasa = B) | **kg** |
| KAMPUNG, KP6, Puyuh, Asin, Bebek, dll | **butir** |

**Konversi bundel:**
- Iketan 15 kg = 15 kg Negeri
- Iketan 10 kg = 10 kg Negeri
- Box Osave = 18 pack Negeri
- Box Kecil = 20 KP6
- Iketan Osave = 1,9 × 5 = 9,5 kg Negeri

---

## 🔌 Kalau Internet Mati (Offline)

- Order yang gagal terkirim karena internet **otomatis masuk antrian** dan terkirim ulang saat online lagi. Tidak hilang.
- Kalau muncul peringatan **stok tidak cukup**, order itu **tidak** diantrikan — cek dulu stoknya.
- Setelah online, pastikan entri sudah **tersinkron** (ikon awan hijau).

---

## ❓ Kalau Ada Masalah

1. Catat **apa yang terjadi** dan **produk/jumlah** yang bersangkutan.
2. Jangan input ulang berkali-kali kalau tidak yakin — bisa dobel.
3. Laporkan ke admin/atasan dengan detail di atas.

---

*Panduan ini bisa diperbarui. Kalau ada langkah yang berbeda di lapangan atau fitur baru, beri tahu admin supaya panduan ikut diperbarui.*
