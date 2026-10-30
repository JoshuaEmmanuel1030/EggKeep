# 📘 Panduan Penggunaan EggKeep

**Untuk:** Staf gudang & admin data-entry JS
**Bahasa sederhana. Baca sekali, langsung bisa dipakai.**

EggKeep adalah aplikasi stok & operasional gudang telur. Semua yang kita catat di sini dipakai untuk laporan stok, penjualan, dan utang supplier. **Data di aplikasi ini = data nyata perusahaan. Catat dengan benar dan jujur.**

> 🌐 Panduan ini memakai nama menu versi **Bahasa Indonesia**. Kalau aplikasi tampil dalam bahasa Inggris, ketuk ikon 🌐 di atas lalu pilih **Bahasa Indonesia**.

---

## 🔑 5 Aturan Emas (baca dulu ini)

1. **Catat sesuai kejadian nyata**, bukan kira-kira. Angka salah = laporan salah = uang salah.
2. **Lihat satuan di setiap kolom jumlah.** Stok NEGERI disimpan dalam **kg**, telur lain dalam **butir**, box/label/kemasan dalam **pcs**. Tapi beberapa layar meminta satuan lain — misalnya **retur** baris SKU diisi **butir** (juga untuk NEGERI), dan **Kas Tunai** untuk NEGERI awalnya **butir**. Satuan selalu tertulis di label kolom — ikuti itu.
3. **Desimal pakai KOMA, tanpa pemisah ribuan.** 9,5 kg → ketik `9,5`. 1.250 butir → ketik `1250` (jangan `1.250` — aplikasi membacanya 1,25).
4. **Urutan input itu penting.** Ikuti urutan harian di bawah supaya stok tidak kacau.
5. **Kalau ragu, tanya dulu — jangan asal input.** Salah input lebih repot dibetulkan daripada bertanya.

---

## 🧭 Menu di Aplikasi

Di **HP**, menu ada di baris ikon bagian atas (di layar kecil nama menu bisa tersembunyi — lihat ikonnya). Di **tablet** posisi mendatar, menu ada di samping kiri.

| Menu | Untuk apa |
|------|-----------|
| **Dasbor** (tablet: **Beranda**) | Ringkasan pagi: telur yang **akan kedaluwarsa** (keluarkan lebih dulu) dan stok yang perlu **segera pesan ulang** |
| **Masuk** | Catat barang datang (Instock) |
| **Pesanan** | Catat barang keluar: **Purchase Order** per pembeli, atau **Kas Tunai** |
| **Info** | Grafik stok dan tren masuk/keluar |
| **Aktivitas** | Riwayat semua entri — tempat **Catat retur**, **Ubah pesanan**, dan **Batalkan** |
| **Katalog** | Daftar SKU, telur, kotak, label, kemasan, pembeli & DC |
| **Pengguna** | Kelola akun staf (**admin saja**) |
| **Stok Fisik** | Hitungan pagi. Di HP: ikon papan klip 📋 di kanan atas. Di tablet: ada di menu samping |

> 🟠 Titik kecil di ikon **Stok Fisik** = stok fisik **belum dihitung hari ini**.

---

## ⏰ Urutan Kerja Harian (WAJIB diikuti)

Urutan ini menjaga supaya **stok fisik cocok dengan stok di aplikasi**.

```
PAGI (sebelum barang gerak)
  1. Hitung STOK FISIK dulu  ← sebelum ada truk masuk/keluar
  2. Pastikan catatan KEMARIN sudah masuk semua (Masuk, Pesanan, Retur)
     dan tidak ada antrian offline yang tertahan
  3. Simpan hitungan stok fisik

SIANG (operasional berjalan)
  4. Catat MASUK (Instock) begitu barang sampai di gudang JS
  5. Catat RETUR kalau ada barang balik dari customer

MALAM (siapkan kirim besok)
  6. Catat PESANAN saat barang di-loading ke truk
```

> ⚠️ **Jangan input transaksi hari ini SEBELUM stok fisik pagi disimpan.** Angka "perkiraan" di Stok Fisik ikut bergerak setiap ada barang masuk/keluar. Kalau transaksi hari ini sudah diinput sebelum hitungan disimpan, selisihnya jadi palsu.

---

## 1️⃣ Masuk (Stok Datang / Instock)

**Kapan dicatat:** saat barang **sudah sampai fisik di gudang JS**.

> 🚚 **Barang lewat TST dulu (Malindo, Lampung, dll):** JANGAN dicatat pas masih di TST. Baru catat **instock setelah barang pindah dan sampai di JS.** Kalau dicatat pas masih di TST, aplikasi mengira stok JS lebih banyak dari kenyataan → nanti hitungan fisik kelihatan kurang padahal tidak.

**Cara input:**
1. Buka menu **Masuk** (judul kartu: **Catat Instock**).
2. Isi **Tanggal** barang masuk.
3. Di **Pilih Kategori**, centang jenis barangnya: **Telur**, **Kotak**, **Label**, atau **Kemasan**. Boleh lebih dari satu.
4. Untuk tiap barang:
   - **Jenis** → pilih produk (NEGERI OMEGA, KAMPUNG BIASA, dll).
   - **Jumlah** → dalam satuan yang tertulis di label kolom: **kg** untuk NEGERI (boleh koma, contoh `15,5`), **butir** untuk telur lain, **pcs** untuk box/label/kemasan.
   - **Faktur/Pemasok** → nomor faktur atau nama supplier.
5. Barang lain? Tekan **Tambah Item**.
6. Tekan **Tambah ke Inventaris**. Muncul pesan **Stok Ditambahkan**.

✅ **Benar:** NEGERI BIASA `310,5` kg
❌ **Salah:** memasukkan jumlah **butir** ke kolom **kg**, atau `1.250` untuk seribu dua ratus lima puluh.

> 📶 Masuk **butuh internet**. Kalau muncul **Gagal menyimpan**, isian tidak hilang — tunggu sinyal, lalu tekan **Tambah ke Inventaris** lagi.

---

## 2️⃣ Pesanan (Barang Keluar)

**Kapan dicatat:** saat barang **di-loading ke truk** (malam sebelum kirim). Inilah aturan kita — begitu di-loading, langsung dicatat keluar.

> 💡 Karena barang keluar dicatat **saat loading**, maka pagi harinya barang yang sudah di truk **sudah tidak dihitung** sebagai stok gudang (lihat kolom **Muat** di Stok Fisik).

### A. Purchase Order (order per pembeli)

1. Buka menu **Pesanan** (judul kartu: **Pembuat Purchase Order**).
2. **Pembeli** → pilih customer (OSAVE, SBOX, SEGARI, dll). Bisa diketik untuk mencari.
3. **Tanggal** → tanggal barang keluar (otomatis hari ini, ubah kalau perlu).
4. **Faktur/Referensi** → nomor PO/faktur (opsional, tapi sebaiknya diisi).
5. **DC (Pusat Distribusi)** → **wajib dipilih** kalau pembeli punya DC. Kalau pembeli hanya punya satu DC, langsung terpilih otomatis.
   - Muncul *"Belum ada DC untuk pembeli ini"* → pesanan tetap bisa disimpan, tapi minta admin menambah DC di **Katalog → Pembeli**.
6. Tekan **Tambah Baris**, lalu pilih jenis baris:
   - **SKU Paket** → pilih SKU, isi **Jumlah (paket)**. SKU utama pembeli ini muncul paling atas; sisanya di **SKU lainnya**.
   - **SKU tipe Box** → kolom berubah jadi **Jumlah (box)**. Isi jumlah **box**, bukan pack — aplikasi menghitung pack, telur, dan box sendiri.
   - **Telur Lepas** → pilih **Jenis Telur**, isi **Jumlah**, lalu pilih **Satuan**: **Butir (pcs)** atau **Kilogram**. NEGERI yang ditimbang → pilih **Kilogram**.
   - **Label (Opsional)** → pilih label kalau pack memakai label. Kalau tidak, biarkan **Tanpa label**.
7. Di bawah tiap baris ada hitungan otomatis (→ kg/butir telur, pcs kemasan, label, box). **Cek angka ini** — inilah yang akan dikurangi dari stok.
8. Periksa **Ringkasan Pesanan** (total bahan dan kekurangan stok).
9. Tekan **Simpan Pesanan**. Muncul pesan **Pesanan Tercatat**.

> ⚠️ Muncul *"SKU box ini belum punya isi pack per box"* → pesanan ditahan. Minta admin mengisi **Pack per box** di **Katalog → Kotak**.

**Beberapa pembeli sekaligus (antrian):**
1. Setelah satu pembeli selesai diisi, tekan **Tambah ke Antrian**. Form kosong lagi untuk pembeli berikutnya.
2. Pesanan yang menunggu tampil di **Pesanan dalam Antrian** — ✏️ untuk mengubah, 🗑️ untuk menghapus.
3. Setelah semua siap, tekan **Kirim Semua (N)**.
4. Kalau ada yang gagal, hanya pesanan yang **gagal** yang tetap di antrian. Yang sudah tercatat tidak akan tercatat dua kali.

**Peringatan yang mungkin muncul saat menyimpan:**

| Peringatan | Artinya | Yang harus dilakukan |
|------------|---------|----------------------|
| **Kemungkinan pesanan ganda** | Pesanan yang **sama** (pembeli, DC, tanggal, dan isi sama) sudah dicatat dalam **15 menit** terakhir | Biasanya tekan **Batal**. Tekan **Tetap catat** hanya kalau ini **benar-benar pesanan terpisah** |
| **Peringatan: Beberapa item stoknya tidak cukup** | Stok di aplikasi kurang dari yang dibutuhkan | Tekan **Batal**, cek dulu: ada barang **Masuk** yang belum dicatat? Kalau ditekan **Tetap lanjutkan** dan stok memang kurang, pesanan **ditolak** dan tetap di antrian |

### B. Daftar Ambil (untuk loading)

Muncul kalau ada pesanan di **Pesanan dalam Antrian**.

1. Masukkan pesanan-pesanan ke antrian (**Tambah ke Antrian**).
2. Tekan **Daftar Ambil** di kotak antrian.
3. Daftar menampilkan total telur per produk, dan **batch mana yang diambil duluan** (FIFO: supplier/faktur + tanggal masuk), plus kemasan, label, dan box.
   - ⚠ = batch **berisiko** (sudah lama) — ambil ini dulu.
   - **Kurang** = stok tidak cukup untuk produk itu.
4. Tekan **WhatsApp** untuk kirim daftar, atau **Cetak** untuk dicetak.

> Daftar Ambil hanya menghitung pesanan **di antrian**, bukan yang masih di form.

### C. Kas Tunai (tanpa pembeli/PO)

Untuk barang keluar yang **tidak lewat Purchase Order**.

1. Di menu **Pesanan**, gulir ke bawah, tekan tombol **Kas Tunai** (judul kartu: **Catat Kas Tunai**).
2. Isi **Tanggal**, lalu centang kategori di **Pilih Kategori**.
3. Untuk tiap barang: **Jenis**, **Jumlah**, **Faktur/Pemasok**.
4. **NEGERI:** ada tombol geser **Butir ↔ Kg**. Awalnya **Butir** — geser ke **Kg** kalau ditimbang. Aplikasi menampilkan perkiraannya (≈).
5. Aplikasi menampilkan **Tersedia** (stok sekarang). Kalau jumlah lebih besar, muncul *"Melebihi stok tersedia sebanyak …"* dan tidak bisa disimpan.
6. Tekan **Hapus dari Inventaris**. Muncul pesan **Stok Dihapus**.

> ⚠️ Kas Tunai **tidak** punya peringatan pesanan ganda. Cek dulu di **Aktivitas** sebelum input ulang.

---

## 3️⃣ Stok Fisik (Hitung Stok Pagi) — bagian paling penting

Tujuan: memastikan **stok nyata di gudang JS = stok di aplikasi**. Selisih (deviasi) menandakan ada salah catat, kehilangan, atau salah hitung.

### Kapan menghitung
**Pagi hari, sebelum truk masuk atau keluar.** Ini "garis potong" (cut-off). Kalau ada truk bergerak sebelum selesai hitung, catat dulu apakah barang itu sudah masuk hitungan atau belum.

### Cara input
1. Buka **Stok Fisik** (HP: ikon 📋 di kanan atas · tablet: menu samping).
2. Tekan **Tambah baris barang**, pilih produk telur. Ulangi untuk tiap produk yang dihitung.
3. Tiap baris menampilkan satuan dan **perk.** (perkiraan = stok menurut aplikasi).
4. Isi kolom **JS**, **TST**, dan **Muat** dalam satuan produk itu (**kg** untuk NEGERI, **butir** untuk lainnya).
5. Tekan **Simpan hitungan**. Muncul pesan **Hitungan disimpan**.

> ✏️ Hitungan hari ini masih bisa dibetulkan lalu disimpan ulang. Tanggal yang sudah lewat **hanya bisa dilihat**.
> ⚠️ Kolom yang **dikosongkan** = **belum dihitung**, bukan nol. Kalau barangnya memang habis, ketik `0`.

### Tiga kolom — apa artinya
| Kolom | Isi apa | Dibandingkan ke aplikasi? |
|-------|---------|---------------------------|
| **JS** | Stok fisik yang ada **di gudang JS** | ✅ **YA** — ini yang dipakai untuk akurasi/deviasi |
| **TST** | Barang yang masih **di gudang TST** (belum pindah ke JS) | ❌ Tidak — hanya catatan |
| **Muat** | Barang order kemarin yang **sudah di truk**, belum dikirim | ❌ Tidak — hanya catatan silang |

> ⚠️ **Angka akurasi hanya membandingkan kolom JS dengan aplikasi.** Jadi pastikan kolom **JS diisi dengan teliti**.

### Cara membaca hasil
- Kolom **Dev.** = JS dikurangi perkiraan, plus persennya.
  - **DEV positif (+)** → stok fisik **lebih banyak** dari aplikasi. Biasanya ada **barang masuk yang belum dicatat**. → Cek penerimaan.
  - **DEV negatif (−)** → stok fisik **lebih sedikit** dari aplikasi. Biasanya ada **barang keluar belum dicatat**, atau ada susut/hilang. → Cek pengiriman.
- Warna:
  - 🟢 **cocok** — sama persis.
  - 🟡 **dalam toleransi** — selisih kecil, masih wajar.
  - 🔴 **di luar toleransi** — **perlu hitung ulang**.
- **Toleransi:** NEGERI (kg) boleh selisih sampai **1 kg** (selisih timbangan). Telur butir harus **tepat**. Admin bisa mengubahnya per produk di Katalog (**Toleransi kecocokan hitungan**).
- **Akurasi inventaris** → target **≥ 95%**. Hijau = tercapai, kuning = 90–95%, merah = di bawah 90%. Ada juga perbandingan dengan **hitungan lalu**.
- **Bias bersih** → kecenderungan semua produk: *"Cenderung kurang — cek susut"* atau *"Cenderung lebih — cek penerimaan"*.
- **Deviasi terbesar** → produk dengan selisih paling besar. Cek ini dulu.

### Disiplin cut-off (supaya deviasi tidak palsu)
1. Sebelum menghitung, pastikan **semua transaksi KEMARIN sudah masuk** (Masuk, Pesanan, Retur).
2. **Jangan** dulu input transaksi hari ini sampai stok fisik disimpan.
3. Baru setelah simpan, lanjut operasional hari ini.

> 📶 Stok Fisik **butuh internet** untuk menyimpan. Kalau muncul *"Gagal menyimpan — coba lagi"*, tunggu sinyal lalu tekan **Simpan hitungan** lagi.

---

## 4️⃣ Retur (Barang Balik dari Customer)

Retur biasanya **sebagian** dari order (sering telur pecah/rusak), datang **1–2 hari** setelah kirim. Retur **selalu dihubungkan ke order aslinya**.

**Cara input:**
1. Buka menu **Aktivitas**.
2. Cari **order aslinya** (pakai **Filter** pembeli/tanggal atau kolom cari).
3. Tekan **Catat retur** di kartu order itu (Purchase Order atau Kas Tunai).
4. Untuk tiap baris, isi jumlah yang balik ke **tiga kolom** — boleh dibagi sekaligus:
   - **OK** → telur **masih bagus**, kembali ke stok jual.
   - **Retak** → telur **retak/damas** tapi masih bisa dijual sebagai kelas lain. Masuk ke stok **<NAMA PRODUK> (RETAKAN)**.
   - **Hancur** → telur **pecah/rusak**, dibuang. Hanya dicatat, stok tidak berubah.
5. **Satuan retur** — lihat tulisan **Terjual: … butir/kg** di baris itu:
   - Baris **SKU** (pack/box) → isi **butir**, **juga untuk NEGERI**. Aplikasi mengubahnya ke kg (**15,5 butir = 1 kg**).
   - Baris telur lepas / Kas Tunai → isi dalam satuan aslinya (**kg** untuk NEGERI).
6. Isi **Tanggal retur** (boleh tanggal kemarin, tidak boleh tanggal besok) dan **Alasan** (contoh: pecah di jalan, kelas salah).
7. Tekan **Catat retur**. Muncul pesan **Retur dicatat**.

**Contoh:** 50 butir balik dari satu baris SKU → OK `12`, Retak `13`, Hancur `25`.

> ✅ **OK** otomatis mengembalikan telur ke batch aslinya (umur telur tetap benar, dijual lebih dulu).
> ✅ **Retak** masuk sebagai stok baru di produk **(RETAKAN)**, tidak mencampur stok produk aslinya.
> ✅ **Hancur** tidak mengubah stok — memang telurnya sudah tidak ada.
> ⚠️ Total retur **tidak bisa melebihi** jumlah yang terjual di order itu (dikurangi retur sebelumnya). Kalau terlalu besar, aplikasi otomatis membatasinya: *"Hanya … yang terjual — dibatasi."*

**Cara membaca retur di Aktivitas:**
**450** butir ~~semula 500~~ (50 retur · 12O 13R 25H)
→ yang benar-benar terkirim 450; **O** = OK, **R** = Retak, **H** = Hancur.

---

## 5️⃣ Membetulkan Entri: Ubah atau Batalkan

Kalau salah input, buka **Aktivitas** dan cari entrinya. Ada dua cara:

| | **Ubah pesanan** / **Ubah entri** (ikon ✏️) | **Batalkan pesanan** / **Batalkan Entri** (tulisan merah) |
|---|---|---|
| **Untuk** | Purchase Order (**Ubah pesanan**) dan Kas Tunai (**Ubah entri**) | Purchase Order, Kas Tunai, dan Instock |
| **Batas waktu** | **1 jam** sejak pertama dicatat (mengubah tidak mengulang jam) | Pembuat entri: **48 jam**. Admin: kapan saja |
| **Siapa** | Yang mencatat, atau admin | Yang mencatat, atau admin |
| **Yang bisa diubah** | Faktur/Referensi, DC, tanggal, jumlah per baris, hapus baris | Seluruh entri/pesanan dibatalkan |
| **Hasil** | Stok disesuaikan otomatis, kartu bertanda **Diubah** | Stok dikembalikan, entri masuk tab **Dibatalkan** |

### Ubah pesanan (dalam 1 jam)
1. Tekan **Ubah pesanan** (atau **Ubah entri** untuk Kas Tunai).
2. Betulkan Faktur/Referensi, DC, tanggal, atau jumlah. Baris yang salah bisa dihapus (**Hapus baris**).
3. Tekan **Simpan perubahan**. Muncul pesan **Pesanan diperbarui**.

Tombol **Ubah** **tidak muncul** kalau:
- sudah lewat **1 jam**,
- pesanan **sudah ada retur**,
- pesanan **masih di antrian offline** (belum tersinkron),
- Anda **bukan yang mencatat** (dan bukan admin).

Mengubah juga **butuh internet**. Pembeli atau produk **tidak bisa** diubah → batalkan, lalu catat ulang.

### Batalkan
1. Tekan **Batalkan pesanan** (Purchase Order) atau **Batalkan Entri** (Kas Tunai/Instock).
2. Untuk pesanan dengan beberapa baris, muncul konfirmasi *"Batalkan seluruh pesanan ini?"* → tekan **Batalkan pesanan**.
3. Isi **Alasan pembatalan** (wajib), lalu tekan **Konfirmasi Pembatalan**.
4. Stok otomatis dikembalikan dengan benar.

> ⚠️ Instock yang stoknya **sudah terpakai** pesanan tidak bisa dibatalkan (muncul *"Cannot void: Some stock has already been used"*). Laporkan ke admin.

> 💡 Salah kecil (jumlah, faktur, DC, tanggal) dan masih dalam 1 jam → pakai **Ubah**. Salah pembeli/produk, atau sudah lewat 1 jam → **Batalkan**, lalu catat ulang.

---

## 6️⃣ Katalog, Pembeli & DC

**Semua staf bisa melihat Katalog. Hanya admin yang bisa menambah atau mengubah.**

Tab di Katalog: **SKU**, **Telur**, **Kotak**, **Label**, **Kemasan**, **Pembeli**.

**Profil pembeli** (tab **Pembeli** → ketuk nama pembeli):
- **Perencanaan** — pola order per hari kirim: berapa SKU biasanya disiapkan (**Siapkan (SKU)**) dan telur yang perlu dibeli (**Beli (telur)**). Makin akurat setelah ~8 minggu riwayat.
- **SKU** — **SKU utama** pembeli ini. SKU utama muncul paling atas saat memilih SKU di **Pesanan**. Admin bisa mencentang sendiri atau pakai **Sarankan dari riwayat**.
- **DC** — daftar DC pembeli. Hanya DC ini yang ditawarkan di **Pesanan**. Admin: **Kelola DC** → isi nama (contoh `BKS – Bekasi`) → **Tambah DC**.

**Untuk admin:**
- **Telur:** **Satuan Ukur** (*Dijual per berat (kg)* atau *Dihitung per butir*), **Butir per kg** (kalibrasi: timbang sampel, mis. 3 tray, lalu bagi jumlah butir dengan total kg — perbarui berkala), **Batas kesegaran (hari)** (default 5), **Batas peringatan stok rendah**, **Toleransi kecocokan hitungan**.
- **Kotak:** **Pack per box** untuk tiap SKU — wajib diisi supaya SKU tipe Box bisa dipakai.
- **Hapus** hanya menyembunyikan barang dari entri baru. Riwayat lama tetap ada.
- ⚠️ **Jangan ganti nama barang yang sudah dipakai** — riwayat lama memakai nama lama dan akan terputus (aplikasi menampilkan peringatan *"Ganti nama yang dipakai"*). **Nama kotak jangan diganti sama sekali.**
- **Cek Integritas Stok** → hanya memeriksa, tidak mengubah apa pun. Aman dipakai.
- **Hitung Ulang Inventaris** → membangun ulang **semua** stok dari awal. Jalankan **hanya atas arahan atasan**.

---

## 🤖 Asisten Inventori (AI)

1. Tekan tombol bulat 💬 di **kanan bawah** → terbuka **Asisten Inventori**.
2. Tanya pakai bahasa biasa, misalnya: *"Stok telur hari ini?"*, *"Telur mana yang hampir kadaluarsa?"*, *"Ringkasan inventori"*.

> ⚠️ Asisten **hanya membaca** data — tidak bisa mencatat, mengubah, atau membatalkan apa pun.
> ⚠️ Jawabannya bisa keliru. Untuk keputusan penting, cek lagi di **Dasbor** atau **Aktivitas**.
> 📶 Butuh internet.

---

## 👥 Akun & Pengguna

**Staf baru:**
1. Buka aplikasi → tab **Daftar**.
2. Isi **Email** dan **Kata Sandi** (minimal 6 karakter) → tekan **Buat Akun**.
3. Kembali ke tab **Masuk** dan masuk dengan akun tadi.

> 🔐 **Satu orang, satu akun. Jangan pinjam akun teman.** Aktivitas mencatat siapa yang menginput, dan tombol **Ubah/Batalkan** hanya muncul untuk yang mencatat.

**Admin (menu Pengguna):**
- **Jadikan Admin** → memberi akses penuh (Katalog, pengguna, batalkan kapan saja).
- **Hapus Admin** → kembali jadi pengguna biasa.
- **Hapus** → menghapus akun **permanen**, tidak bisa dibatalkan.
- Akun Anda sendiri bertanda **(Anda)**.

---

## ✅ Praktik Terbaik (Best Practices)

- **Input sesegera mungkin** setelah kejadian, jangan ditumpuk. Makin lama makin gampang lupa/salah.
- **Cek ulang satuan** sebelum simpan (kg vs butir, pack vs box). Ini penyebab error paling sering.
- **Pakai koma untuk desimal** (`9,5`), dan **jangan pakai pemisah ribuan**.
- **Cek hitungan otomatis** di bawah tiap baris pesanan sebelum simpan.
- **Selesaikan catatan kemarin** sebelum hitung stok fisik pagi.
- **Jangan catat barang TST sebagai stok JS** — tunggu sampai fisik di JS.
- **Muncul peringatan pesanan ganda? Anggap dobel** sampai terbukti bukan.
- Kalau **deviasi besar**, jangan langsung panik — cek dulu: apakah ada barang masuk/keluar belum dicatat? Baru curiga susut.
- **Kalau ragu, tanya.** Lebih baik bertanya daripada salah input.

---

## 📏 Referensi Satuan & Konversi

| Produk | Satuan stok |
|--------|-------------|
| NEGERI (Omega/Merah = O, Biasa = B) | **kg** |
| KAMPUNG, KP6, Puyuh, Asin, Bebek, dll | **butir** |
| Box, label, kemasan | **pcs** |

**Konversi bundel:**
- Iketan 15 kg = 15 kg Negeri
- Iketan 10 kg = 10 kg Negeri
- Box Osave = 18 pack Negeri
- Box Kecil = 20 KP6
- Iketan Osave = 1,9 × 5 = 9,5 kg Negeri

**Retur NEGERI:** 15,5 butir = 1 kg (angka tetap untuk retur).

---

## 🔌 Kalau Internet Mati (Offline)

**Yang otomatis masuk antrian (tidak hilang):**
- **Pesanan** (Purchase Order & Kas Tunai) → muncul pesan **Disimpan Offline**.
- **Retur** → muncul pesan **Retur disimpan offline**.
- Semua terkirim otomatis saat online lagi.

**Banner antrian pesanan:**
1. Di atas layar muncul *"N pesanan keluar menunggu sinkronisasi"*. Tekan **Lihat**.
2. Tiap pesanan berstatus **Menunggu sinkronisasi** atau **Sinkronisasi gagal**.
3. **Sinkronisasi gagal** menahan seluruh antrian. Betulkan stoknya dulu (mis. catat **Masuk** yang belum, atau batalkan entri yang salah), lalu tekan **Coba Lagi**.
4. **Buang** = pesanan **TIDAK** dicatat sama sekali. Pakai hanya kalau yakin pesanan itu salah.

**Retur antrean ditolak** → retur itu **tidak tercatat** (mis. melebihi jumlah terjual, atau pesanannya sudah dibatalkan). Cek, lalu catat ulang kalau perlu.

**Yang TIDAK diantrikan — butuh internet:** **Masuk**, **Stok Fisik**, **Ubah pesanan**, **Batalkan**, dan **Asisten**. Pesanan yang ditolak karena **stok tidak cukup** juga tidak diantrikan — cek dulu stoknya.

> ⚠️ Antrian tersimpan **di HP itu saja**. Selama masih ada antrian: jangan hapus data browser, jangan hapus aplikasi, dan **jangan input ulang pesanan yang sama dari HP lain** — nanti dobel.
> ✅ Di **Aktivitas**: ikon awan hijau = sudah tersinkron. Awan dicoret kuning / **Tertunda** = belum terkirim.

---

## ❓ Kalau Ada Masalah

1. Catat **apa yang terjadi** dan **produk/jumlah** yang bersangkutan.
2. Jangan input ulang berkali-kali kalau tidak yakin — cek dulu di **Aktivitas** dan di banner antrian. Bisa jadi sudah tercatat.
3. Aplikasi terasa aneh atau versi lama:
   - Muncul **Pembaruan tersedia** → tekan **Muat ulang**.
   - Atau ⚙️ **Pengaturan** → **Perbarui aplikasi**.
4. Belum pasang aplikasi di HP? ⚙️ **Pengaturan** → **Instal Aplikasi** untuk langkah-langkahnya.
5. Laporkan ke admin/atasan dengan detail di atas.

---

*Terakhir diperbarui: 28 Oktober 2026. Panduan ini bisa diperbarui. Kalau ada langkah yang berbeda di lapangan atau fitur baru, beri tahu admin supaya panduan ikut diperbarui.*
