# 🚀 Multi-Akun Telegram Manager

Tools ini dirancang untuk mengelola banyak akun Telegram secara bersamaan, melakukan posting otomatis ke grup, update profil massal, dan melihat analitik pengiriman pesan melalui antarmuka web yang modern.

## ✨ Fitur Utama
- **Multi-Account**: Tambah dan kelola banyak akun Telegram dalam satu tempat.
- **Kirim Pesan Massal**: Kirim pesan + gambar ke berbagai grup dengan akun berbeda secara bersamaan.
- **Auto-Join Masal**: Masukkan daftar link grup/channel dan biarkan akun bergabung otomatis dengan jeda waktu.
- **Auto Schedule Bot**: Jadwalkan pesan promosi (teks + gambar) ke banyak grup sekaligus pada jam tertentu.
- **Interactive Buttons**: Tambahkan tombol URL di bawah pesan untuk meningkatkan interaksi (input terpisah: judul & URL).
- **Manajemen Profil**: Ganti nama, username, dan foto profil banyak akun sekaligus (*Swap Profil*).
- **Media Management**: Upload gambar dan caption untuk diposting secara acak atau spesifik.
- **Analitik**: Pantau keberhasilan pengiriman pesan per akun dan grup.
- **Web UI**: Antarmuka berbasis web yang responsif, modern, dan dark mode support.
- **Background Processing**: Jalankan multiple proses tanpa saling mengganggu (non-blocking).

## 🛠️ Persyaratan Sistem
1. **Python 3.8+** sudah terinstal.
2. **API ID & API Hash** dari [my.telegram.org](https://my.telegram.org).
3. Koneksi internet yang stabil.
4. **Git** (optional, untuk version control).

## 🚀 Cara Instalasi

### Metode 1: Menggunakan run.bat (Windows)
1. **Clone atau Download** repository ini ke komputer Anda.
2. Buka folder project.
3. Double-click file `run.bat`.
4. Buka browser dan akses: `http://127.0.0.1:8374`

### Metode 2: Menggunakan Terminal/PowerShell
```bash
cd d:\Multi-Akun-Telegram
pip install -r requirements.txt
python main.py
```

Kemudian buka browser: `http://127.0.0.1:8374`

## 📂 Struktur Folder
```
Multi-Akun-Telegram/
├── main.py                 # Backend FastAPI
├── requirements.txt        # Dependencies
├── run.bat                 # Quick run script (Windows)
├── README.md               # Dokumentasi
├── .gitignore              # Git ignore file
├── accounts.json           # Data akun (sensitive)
├── accounts.sample.json    # Contoh format akun
├── posted.json             # Riwayat pesan terkirim
├── analytics.json          # Data analitik
├── bot_settings.json       # Pengaturan bot
├── schedules.json          # Jadwal otomatis
│
├── static/                 # Frontend files
│   ├── index.html          # Main UI
│   ├── script.js           # JavaScript logic
│   └── style.css           # Styling & theme
│
├── sessions/               # Telegram session files (SENSITIVE)
│   ├── account1.session
│   ├── account2.session
│   └── ...
│
├── media/                  # Gambar untuk diposting
├── mark-posted/            # Gambar yang sudah diposting
├── captions/               # Folder captions
│   └── captions.txt        # Daftar caption (satu per baris)
│
└── __pycache__/            # Python cache (auto-generated)
```

## 📋 Konfigurasi Awal

### 1. Dapatkan API ID & API Hash
1. Buka [https://my.telegram.org](https://my.telegram.org)
2. Login dengan nomor Telegram Anda
3. Klik "API development tools"
4. Create new application
5. Copy **API ID** dan **API Hash**

### 2. Format File `accounts.json`
```json
[
  {
    "id": "account1",
    "phone": "+6281234567890",
    "api_id": "123456",
    "api_hash": "abcdef123456...",
    "is_active": true
  }
]
```

### 3. Format File `captions.txt`
```
Caption 1 untuk gambar
Caption 2 untuk gambar
Caption 3 untuk gambar
...
```

## 🎮 Panduan Penggunaan

### Dashboard
- Lihat statistik: Total akun, post berhasil, gagal, dan jadwal aktif
- Monitor semua aktivitas dalam satu tempat

### 📱 Menu Kirim Pesan
1. **Pengaturan Pengiriman**: Tentukan grup tujuan (utama & kedua opsional)
2. **Strategi Pemilihan**: Random atau spesifik per akun
3. **Jeda Kirim**: Atur delay antar pengiriman (untuk hindari Flood Wait)
4. **Upload Media & Caption**: Pilih gambar dan caption
5. **Preview Penugasan**: Lihat akun mana kirim kemana sebelum eksekusi
6. **Kirim Semua**: Mulai proses pengiriman
   - Modal akan muncul menunjukkan **progress real-time**
   - Bisa di-**minimize** untuk tetap background
   - Ada **tombol untuk buka modal lagi** dari header indicator
   - Saat selesai: Tampilkan ✅ **"Pengiriman Selesai"**
   - Klik **"Selesai"** untuk close modal

### 🔗 Menu Auto-Join
1. Masukkan daftar link grup (satu per baris)
2. Pilih akun yang ingin join
3. Klik "Join Sekarang"
4. Sistem otomatis join ke semua grup dengan delay

### ⏰ Menu Auto Schedule Bot
1. **Tentukan Target**: Username grup atau ID grup
2. **Waktu Kirim**: Jam berapa (WIB) pesan harus dikirim
3. **Ulangi Harian**: Setiap hari atau sekali saja
4. **Upload Gambar**: Pilih file gambar
5. **Tulis Caption**: Pesan promosi
6. **Tombol URL**: 
   - Input **Judul Tombol** (contoh: "Klik Disini")
   - Input **URL** (contoh: "https://google.com")
   - Bisa tambah lebih dari 1 tombol dengan tombol "+ Tambah Tombol"
7. **Bot Token**: Setup bot dari @BotFather untuk kirim via bot
8. **Test Kirim**: Kirim sekali sebelum activate
9. **Aktifkan Jadwal**: Simpan dan bot akan berjalan

### 👤 Menu Profil & Swap
- Ganti nama, username, dan foto profil banyak akun sekaligus
- Pilih akun, input data baru, submit

### 📊 Menu Analytics
- Filter hasil pengiriman per grup
- Lihat success/failed rate per akun
- Export data untuk analisis lebih lanjut

## ⚙️ Pengaturan & Tips

### Cara Mengatasi Error "Flood Wait"
Telegram membatasi aktivitas akun jika terlalu sering request. Solusi:
- Tingkatkan **Jeda Kirim** dalam menu Kirim Pesan
- Kurangi jumlah akun per sesi
- Tunggu beberapa jam sebelum coba lagi

## 🐛 Troubleshooting

| Error | Solusi |
|-------|--------|
| **Port 8374 sudah dipakai** | Ganti port di `main.py` atau stop aplikasi lain |
| **Akun tidak bisa login** | Cek API ID/Hash, pastikan nomor HP format internasional |
| **Flood Wait error** | Tunggu beberapa jam, tingkatkan jeda pengiriman |
| **File media tidak ditemukan** | Pastikan gambar sudah di-upload ke folder `media/` |
| **Schedule tidak jalan** | Pastikan jam dalam format 24-jam (contoh: "14:30") |

## 📞 Support & Kontribusi
Jika ada bug atau request fitur, silakan buat issue atau kontribusi langsung.

## 📄 Lisensi
Project ini untuk penggunaan personal. Gunakan dengan bijak sesuai ToS Telegram.

---

**Last Updated**: January 6, 2026  
**Version**: 2.0  
**Developer**: GPA PROJECT


### ⚠️ Keamanan
Jangan pernah membagikan isi folder `sessions/` atau file `accounts.json` kepada siapa pun, karena itu berisi akses langsung ke akun Telegram Anda.

---
*Dibuat untuk memudahkan manajemen komunitas Telegram.*
