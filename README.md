# Bot WhatsApp – Backup Nomor Member Grup

Mengambil nomor **member** grup WhatsApp (admin & pembuat grup **tidak** ikut) lalu mengirim hasilnya sebagai file
`nomor-member-(namagrup).txt` berisi:

```
08xxx
08xxx
08xxx
```

## Cara pakai

1. Install Node.js (versi 20+), lalu di folder ini jalankan:
   ```
   npm install
   npm start
   ```
2. Scan QR yang muncul di terminal: WhatsApp di HP → **Perangkat tertaut** → **Tautkan perangkat**.
   - Kalau susah scan, login pakai kode pairing: `npm start -- 628123456789` (nomor WA kamu), lalu di HP pilih
     **Tautkan dengan nomor telepon** dan masukkan kodenya.
3. Di WhatsApp, buka chat **ke nomor sendiri** ("Message yourself"), lalu ketik perintah:

| Perintah | Fungsi |
|---|---|
| `.menu` | Bantuan |
| `.grup` | Daftar semua grup (bernomor) |
| `.cari alumni` | Cari grup berdasarkan nama |
| `.backup 3` | Backup grup nomor 3 |
| `.backup 1,4,7` | Backup beberapa grup |
| `.backup semua` | Backup semua grup |

File `.txt` dikirim ke chat kamu, dan salinannya disimpan di folder `hasil/`.

## Catatan
- Perintah **hanya** diproses di chat ke diri sendiri, jadi daftar nomor tidak akan terkirim ke grup/orang lain.
- Nomor Indonesia (62…) diubah jadi 08…; nomor luar negeri ditulis dengan `+kodenegara`.
- Beberapa grup memakai privasi nomor (LID) dari WhatsApp; nomor yang benar-benar disembunyikan tidak bisa diambil, jumlahnya akan diberitahukan di caption.
- Folder `auth/` berisi sesi login – jangan dibagikan. Hapus folder itu untuk logout/ganti akun.
- Bot ini memakai library tidak resmi (Baileys). Pakai secukupnya untuk keperluan pribadi.
