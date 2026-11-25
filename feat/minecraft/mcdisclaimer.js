/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/mcdisclaimer.js — Penafian hak cipta & ketentuan penggunaan fitur Minecraft
 */
import { replyQuoted } from '../../lib/minecraft/workflow.js'

export default {
  name: 'mcdisclaimer',
  aliases: ['mctos', 'mclegal'],
  tags: 'minecraft',
  description: 'Penafian hak cipta & ketentuan penggunaan fitur Minecraft',
  cooldown: 5000,

  async run(ctx) {
    const disclaimerText =
      `*DISCLAIMER & KETENTUAN PENGGUNAAN*\n\n` +
      `1. *Layanan Pihak Ketiga Independen*\n` +
      `Fitur ini dikembangkan secara independen oleh komunitas dan *TIDAK berafiliasi, disponsori, atau disetujui* oleh Mojang Studios, Microsoft, atau kreator Marketplace manapun.\n\n` +
      `2. *Kebijakan Non-Hosting (Tidak Menyimpan Berkas)*\n` +
      `Server bot ini *tidak menyimpan atau meng-host berkas game secara permanen*. Bot hanya bertindak sebagai alat bantu pengindeksan publik via API publik dan engine pihak ketiga. Seluruh berkas sementara langsung dihapus otomatis dari server setelah proses pengiriman selesai.\n\n` +
      `3. *Hak Cipta & Merek Dagang*\n` +
      `Seluruh nama dagang, aset, dan merek Minecraft adalah milik penuh *Mojang Studios & Microsoft*. Konten Add-Ons, Worlds, dan Texture Packs adalah hak cipta dari masing-masing kreator aslinya.\n\n` +
      `4. *Batasan Tanggung Jawab (Use at Your Own Risk)*\n` +
      `Layanan ini disediakan untuk tujuan pengujian teknis, edukasi, dan arsip pribadi. Penggunaan fitur ini sepenuhnya merupakan risiko dan tanggung jawab masing-masing pengguna.`

    await replyQuoted(ctx, disclaimerText)
  }
}
