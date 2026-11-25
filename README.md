# Hitori-MD

Bot WhatsApp modular berbasis [Zapo-JS](https://github.com/vinikjkkj/zapo)
(`zapo-js`) — plain JavaScript (ESM), feature-based, dengan dukungan
**richMessage** (`interactiveMessage` / `nativeFlowMessage` buttons & list),
downloader multi-platform, sticker engine, AI tools, manajemen grup, mini-games,
dan RPG Nusantara Wilds.

Bot berjalan sebagai *companion device* (setara WhatsApp Web/Desktop): pairing
cukup sekali lewat QR atau pairing code, kredensial tersimpan di SQLite, dan
sesi otomatis dipakai ulang pada run berikutnya tanpa pairing ulang.

---

## Fitur Utama & Arsitektur

- **QR Banner + PNG Export.** QR tampil di terminal dengan banner kustom dan
  opsi simpan otomatis ke `session/qr.png`.

- **Interactive `richMessage` & AI Rich UI.** Menggunakan `interactiveMessage`
  + `nativeFlowMessage` (`quick_reply`, `single_select`, carousel cards) serta
  pembaca respons tap lintas klien (termasuk `templateButtonReplyMessage`).

- **Custom Pairing Code.** Mendukung pairing code 8 karakter yang dapat diatur di
  `config.js` (charset resmi WhatsApp `1-9` dan `A-Z` tanpa `I, O, U, 0`),
  baik mode interaktif di terminal maupun non-interaktif untuk PM2.

- **Resolusi Identitas LID ↔ Nomor.** Membaca `participantAlt` /
  `remoteJidAlt` dan memetakan LID via `getLidsByPhoneNumbers` agar sistem role
  owner/admin dan mention tetap akurat meski pengirim memakai `@lid`.

- **Struktur Modular + Hot Reload.** File di `feat/` dimuat secara rekursif
  dan dipantau otomatis oleh `chokidar`, sehingga perubahan command aktif tanpa
  perlu restart proses bot.

- **Sticker Engine & EXIF RIFF.** Konversi gambar, GIF, video pendek, `brat`,
  dan `smeme` menjadi WebP dengan metadata pack EXIF (`config.sticker`).

- **Keandalan & Keamanan.** Reconnect dengan exponential backoff, centralized
  error handler, graceful `SIGINT` shutdown, anti-spam flood, per-command
  cooldown, antilink per grup berbasis SQLite, serta proteksi permission owner/admin.

---

## Sorotan Zapo-JS

| Aspek | Penjelasan |
| --- | --- |
| Companion device | Terhubung seperti WhatsApp Web; kredensial Noise tersimpan persisten. |
| Coordinator API | Domain terpisah dan jelas: `client.auth`, `client.message`, `client.group`, `client.profile`, `client.presence`, `client.newsletter`, dll. |
| Typed events | Event `message`, `receipt`, `group`, `connection`, `newsletter`, dan `message_addon`. |
| SQLite store | Penyimpanan session, auth, Signal keys, dan chat metadata via `@zapo-js/store-sqlite`. |
| Media streaming | Upload/download media terenkripsi, view-once unwrap, dan dekripsi addon. |

---

## Struktur Folder

```
Hitori-MD/
├── app.js                 # Entry point: auth, store, WS proxy, event wiring
├── config.js              # Konfigurasi terpusat Hitori-MD (botName, staff, sticker, channel)
├── auth/                  # QR handler, pairing code, connection manager
├── core/                  # Logger, SQLite database, RPG engine, cooldown, staff, context, hot-reload
├── lib/                   # Media helpers, sticker engine, richMessage, richHtml, aiRich, games
├── handlers/              # Message router, group events, antilink, menfess, game session, error handler
├── scraper/               # Scraper downloader & AI media tools
├── feat/                  # Fitur command per kategori (ai, downloader, game, general, group, interactive, media, owner, rpg, sticker, tools)
├── src/                   # Data statis RPG, reward schema, dan WebSocket media server
└── session/               # Kredensial WA & database SQLite (gitignored)
```

---

## Persyaratan

- **Node.js** `>= 20.9.0`
- **FFmpeg** — dibutuhkan oleh sticker video, `bratvideo`, `gabungimg`, dan `tomp3`
  (`apt install -y ffmpeg` di Debian/Ubuntu)
- **yt-dlp** *(opsional)* — dibutuhkan oleh fitur `.yta` dan `.ytv`

---

## Instalasi & Konfigurasi Awal

1. Clone atau masuk ke direktori project, lalu install dependencies:

```bash
cd Hitori-MD
npm install
```

2. Sesuaikan `config.js`:
   - `staff`: masukkan nomor/LID WhatsApp kamu dengan `role: 'owner'`.
   - `sticker`: atur `packName` dan `author` sesuai keinginan (`Hitori-MD`).
   - `reactChannel`: isi `dedicatedChannelUrl` dengan link saluran WhatsApp milikmu
     dan set `enabled: true` jika ingin mengaktifkan auto-react channel.
   - *(Opsional untuk `.ai`)*: buat `config/ai/orca.js` yang mengekspor
     `orca`, `HITORI_PERSONA`, `ORCA_CONFIG`, dan `jina`.

3. Jalankan bot:

```bash
node app.js
```

---

## Autentikasi

### Interaktif (terminal)

Jalankan `node app.js` lalu pilih metode:

1. **QR Code** — scan QR dari *WhatsApp → Perangkat tertaut*.
2. **Pairing Code** — masukkan nomor WhatsApp target (contoh `628xxx`), lalu
   masukkan kode 8 karakter dari terminal ke *Tautkan dengan nomor telepon*.

Catatan operasional:
- Pairing code hanya direquest **sekali** setelah socket aktif agar tidak terkena
  pembatasan anti-abuse WhatsApp.

### Non-interaktif (PM2 / server)

Atur di `config.js`:

```js
auth: {
  method: 'pairing',
  customCode: 'H1TR1MD8',
  useCustomCode: true,
  pairingNumber: '628xxxxxxxxxx',
}
```

---

## Deploy dengan PM2

```bash
npm install -g pm2
pm2 start app.js --name hitori-md
pm2 logs hitori-md
pm2 save && pm2 startup
```

Perintah harian: `pm2 status`, `pm2 restart hitori-md`, `pm2 stop hitori-md`.

---

## Menambah Fitur

Buat file `.js` baru di dalam subfolder `feat/` (dimuat otomatis saat startup
maupun lewat hot-reload):

```js
export default {
  name: 'halo',
  aliases: ['hi'],
  tags: 'general',
  description: 'Contoh fitur',
  async run(ctx) {
    await ctx.reply('Halo dari Hitori-MD!')
  }
}
```

Lihat [core/context.js](./core/context.js) untuk properti dan helper `ctx` lengkap
(`chat`, `sender`, `senderNumber`, `isGroup`, `isOwner`, `isAdmin`, `mentioned`,
`reply()`, `react()`, `replyButtons()`, `replyList()`).

---

## Kredit

- [zapo-js](https://github.com/vinikjkkj/zapo) — implementasi protokol WhatsApp Web
- [sharp](https://sharp.pixelplumbing.com) — pemrosesan gambar
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — database SQLite
- [pino](https://getpino.io) — logging
- [qrcode](https://github.com/soldair/node-qrcode) — render QR
- `@napi-rs/canvas` — canvas rendering (`smeme`, `brat`, `iqc`)
- Upstream base: *BotZapo* (MIT License, © 2026 JamvanHax0r)

---

## Lisensi

Dilisensikan di bawah **MIT License** — lihat file [LICENSE](./LICENSE).
Hak cipta base asli tetap dicantumkan sesuai ketentuan MIT (`© 2026 JamvanHax0r`),
sedangkan modifikasi dan pengembangan lanjutan berada di bawah `Hitori-MD`.
