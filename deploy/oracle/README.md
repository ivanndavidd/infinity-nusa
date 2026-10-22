# Deploy ke Oracle Cloud (Always Free)

nusa. jalan di VM gratis Oracle (region Singapura), lengkap dengan PostgreSQL. Alamatnya lewat Tailscale
(`https://nusa.<tailnet>.ts.net`), jadi hanya perangkat yang login ke akun Tailscale-mu yang bisa membukanya.
Tidak ada port web yang dibuka ke internet, dan PC tidak perlu nyala lagi.

| File | Isi |
|---|---|
| `push.ps1` | Dijalankan di PC: membungkus app (dan database + `.env` saat pertama kali), upload, lalu menjalankan `setup.sh` |
| `setup.sh` | Dijalankan di VM: memasang Node 22, PostgreSQL, Tailscale, service `nusa`, dan backup harian |
| `nusa.service` | Service systemd: app nyala otomatis dan restart sendiri kalau mati |
| `backup.sh` | Backup database harian ke `/var/backups/nusa` (disimpan 14 hari) |

## 1. Buat VM

1. Di console Oracle: menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name:** `nusa`.
3. **Image and shape:**
   - Shape: **Ampere** → `VM.Standard.A1.Flex`, **1 OCPU**, **6 GB** memory (ada label *Always Free-eligible*).
   - Image: **Canonical Ubuntu 24.04** (console memakai build ARM-nya sendiri saat shape Ampere dipilih). Kalau A1
     tidak bisa dipilih dengan image itu, pakai **Canonical Ubuntu 24.04 Minimal aarch64**.
   - Kalau muncul *Out of capacity*: coba *Availability domain* lain, atau pilih shape **AMD** →
     `VM.Standard.E2.1.Micro` (1 GB RAM, juga cukup; `setup.sh` otomatis menambah swap).
4. **Networking:** biarkan default (VCN baru, subnet publik), pastikan *Automatically assign public IPv4 address* aktif.
5. **Add SSH keys:** pilih *Generate a key pair for me* → **Download private key**. Simpan, misalnya ke
   `C:\Users\<kamu>\.ssh\nusa-oracle.key`. Tanpa file ini kamu tidak bisa masuk ke VM.
6. **Create**. Tunggu status *Running*, lalu salin **Public IP address**.

Disarankan: upgrade akun ke **Pay As You Go** (menu Billing → Upgrade). Selama pemakaian masih di batas Always Free
tetap Rp0, tapi VM tidak akan diambil kembali oleh Oracle karena dianggap nganggur. Pasang juga **Budget** (Billing →
Budgets) dengan alert di US$1.

## 2. Deploy pertama

Pastikan **MagicDNS** dan **HTTPS Certificates** di Tailscale admin console (menu **DNS**) sudah aktif; di akun
Tailscale baru, HTTPS belum aktif. HP yang dipakai membuka nusa. harus login ke akun Tailscale yang sama.

Di PowerShell, dari folder `D:\spending-monitoring`:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\oracle\push.ps1 -Server ubuntu@<PUBLIC IP> -Key C:\Users\<kamu>\.ssh\nusa-oracle.key -Migrate
```

Yang terjadi:

1. Database lokal diekspor dan ikut di-upload bersama `.env` (`-Migrate`). Posisi sync Gmail ikut terbawa, jadi VM
   melanjutkan dari email terakhir tanpa mengimpor ulang.
2. VM memasang semuanya (5–10 menit pertama kali).
3. Muncul link login Tailscale: buka di browser dan setujui server `nusa`.
4. Di akhir tercetak alamatnya, misalnya `https://nusa.tail1234.ts.net`, plus redirect URI untuk Google.

Saat pertama kali tersambung, SSH bisa bertanya soal *host key*: itu normal.

## 3. Daftarkan alamat baru di Google

Google Cloud Console → **APIs & Services** → **Credentials** → OAuth client yang dipakai nusa. → **Authorized redirect
URIs** → tambah `https://nusa.<tailnet>.ts.net/auth/callback` (persis seperti yang dicetak `setup.sh`) → **Save**.
Perubahan di Google bisa butuh beberapa menit.

Lalu buka alamat itu di HP dan login.

## 4. Matikan app di PC

Setelah yang di VM jalan, matikan yang di PC supaya tidak ada dua app yang sync:

```powershell
Disable-ScheduledTask -TaskName 'Spending Monitor'
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

Kalau dulu PC juga membagikan nusa. lewat Tailscale, matikan juga dengan `tailscale serve reset`.

## Domain sendiri (Cloudflare Tunnel)

Supaya nusa. bisa dibuka dari browser mana saja tanpa Tailscale, misalnya di `https://infinitynusa.my.id`. Cloudflare
melayani HTTPS dan meneruskan ke app lewat koneksi keluar dari VM, jadi VM tetap tidak membuka port apa pun.

1. Di dash.cloudflare.com: **Add a domain** → nama domain → paket **Free**. Cloudflare memberi 2 nameserver.
2. Di panel registrar domain: matikan **DNSSEC** kalau aktif, lalu ganti nameserver ke 2 alamat dari Cloudflare.
   Tunggu sampai Cloudflare menandai domainnya **Active** (beberapa menit sampai 24 jam).
3. Dari PC (sekali `push.ps1` dulu kalau `tunnel.sh` belum ada di VM):

   ```powershell
   ssh -t -i C:\Users\<kamu>\.ssh\nusa-oracle.key ubuntu@<PUBLIC IP> sudo bash /opt/nusa/deploy/oracle/tunnel.sh <domain>
   ```

   Muncul link login Cloudflare: buka, pilih domainnya, klik **Authorize**. Skrip membuat tunnel `nusa`, record DNS,
   dan service `cloudflared`, lalu memindahkan `PUBLIC_URL` ke domain itu.
4. Tambahkan `https://<domain>/auth/callback` ke redirect URI OAuth client di Google (seperti langkah 3 di atas).

Setelah ini app hanya menjawab di domain itu; alamat `ts.net` berhenti dipakai (Tailscale tetap terpasang). Disarankan:
pasang **Cloudflare Access** (Zero Trust → Access → Applications) dengan aturan hanya email-mu, supaya orang lain bahkan
tidak sampai ke halaman login.

## Auto-deploy dari GitHub (CI/CD)

Setiap push ke `main` di `ivanndavidd/infinity-nusa` menjalankan `.github/workflows/ci.yml`: tes dulu, dan kalau
lulus, branch `deploy` dipindah ke commit itu. VM mengecek branch `deploy` tiap menit (`nusa-deploy.timer` →
`pull-deploy.sh`), mengunduh commit baru, lalu memasangnya dengan `setup.sh`. Kalau versi baru gagal jalan, versi
sebelumnya dipasang lagi. GitHub tidak memegang kunci apa pun ke server; VM yang mengambil sendiri.

| Perlu | Perintah di VM |
|---|---|
| Lihat deploy terakhir | `journalctl -u nusa-deploy -n 30` |
| Commit yang sedang jalan | `sudo cat /var/lib/nusa-deploy/deployed` |
| Paksa cek sekarang | `sudo systemctl start nusa-deploy` |

Repo-nya publik, jadi jangan pernah commit `.env`, dump database, atau contoh email asli (sudah di `.gitignore`).

## Update app manual (tanpa GitHub)

Jalankan perintah yang sama **tanpa** `-Migrate`. Kode diganti dan service di-restart; `.env` dan database di VM
tidak disentuh.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\oracle\push.ps1 -Server ubuntu@<PUBLIC IP> -Key C:\Users\<kamu>\.ssh\nusa-oracle.key
```

## Sehari-hari

Masuk ke VM: `ssh -i C:\Users\<kamu>\.ssh\nusa-oracle.key ubuntu@<PUBLIC IP>`, lalu:

| Perlu | Perintah |
|---|---|
| Status app | `systemctl status nusa` |
| Log (live) | `journalctl -u nusa -f` |
| Restart | `sudo systemctl restart nusa` |
| Ubah `.env` | `sudo nano /opt/nusa/.env` lalu `sudo systemctl restart nusa` |
| Daftar backup | `sudo ls -lh /var/backups/nusa` |

Backup ada di VM yang sama, jadi sesekali salin ke PC (kalau VM hilang, backup ikut hilang):

```powershell
ssh -i C:\Users\<kamu>\.ssh\nusa-oracle.key ubuntu@<PUBLIC IP> "sudo cp /var/backups/nusa/*.dump /tmp/ && sudo chown ubuntu /tmp/*.dump"
scp -i C:\Users\<kamu>\.ssh\nusa-oracle.key "ubuntu@<PUBLIC IP>:/tmp/*.dump" .
```

## Kalau ada masalah

- **`Permission denied (publickey)`**: user harus `ubuntu`, dan `-Key` harus file private key yang di-download saat
  membuat VM.
- **`Connection timed out`**: VM belum *Running*, atau IP-nya salah.
- **Halaman `Forbidden host`**: buka lewat alamat `ts.net` yang dicetak `setup.sh`, bukan lewat IP.
- **Login Google gagal (`redirect_uri_mismatch`)**: redirect URI di langkah 3 belum ditambahkan atau beda satu huruf.
- **Setup berhenti di tengah**: perbaiki penyebabnya lalu jalankan `push.ps1` lagi. Kalau gagal sebelum database
  terisi, ulangi dengan `-Migrate`.
