/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/mchelp.js — Panduan lengkap penggunaan fitur Minecraft Marketplace & CurseForge
 */
import config from '../../config.js'
import { replyQuoted } from '../../lib/minecraft/workflow.js'

export default {
  name: 'mchelp',
  aliases: ['mc', 'minecraft', 'cfhelp', 'curseforgehelp', 'mcguide', 'cfguide'],
  tags: 'minecraft',
  description: 'Panduan lengkap penggunaan fitur Minecraft Marketplace & CurseForge',
  cooldown: 5000,

  async run(ctx) {
    const prefix = ctx.prefix || config.mainPrefix
    const guideText =
      `*PANDUAN MINECRAFT BEDROCK (MARKETPLACE & CURSEFORGE)*\n\n` +
      `🏪 *MINECRAFT MARKETPLACE*\n` +
      `1. *${prefix}mcsearch <kata kunci>*\n` +
      `   Mencari addon, skin, atau world di katalog resmi Marketplace.\n` +
      `   Contoh: \`${prefix}mcsearch car\`\n` +
      `   👉 *Cukup balas pesan hasilnya dengan angka (1 - 20) untuk download!*\n\n` +
      `2. *${prefix}mctrend*\n` +
      `   Melihat katalog 20 addon Marketplace terbaru & terpopuler.\n\n` +
      `🌐 *CURSEFORGE BEDROCK EDITION*\n` +
      `3. *${prefix}cf <kata kunci / nama addon>*\n` +
      `   Mencari ribuan mod, addon, world, dan texture pack gratis di CurseForge Bedrock.\n` +
      `   Contoh: \`${prefix}cf Better on Bedrock\`, \`${prefix}cf furniture\`\n` +
      `   👉 *Bisa langsung balas/quote pesan hasilnya dengan angka untuk download!*\n\n` +
      `4. *${prefix}cftrend*\n` +
      `   Melihat katalog addon CurseForge Bedrock yang paling banyak diunduh.\n\n` +
      `⚡ *DOWNLOADER UNIVERSAL & BYPASS DRM (MCDL)*\n` +
      `5. *${prefix}mcdl <link / ID / UUID / nama addon / angka>*\n` +
      `   Pengunduh universal untuk semua konten Bedrock:\n` +
      `   • *Link CurseForge Bedrock:* \`${prefix}mcdl https://www.curseforge.com/...\`\n` +
      `   • *Link Marketplace:* \`${prefix}mcdl https://www.minecraft.net/...\`\n` +
      `   • *CurseForge Project ID:* \`${prefix}mcdl 1057117\`\n` +
      `   • *UUID Marketplace:* \`${prefix}mcdl 16151822-0370-4844-bd7c-3aea5dc6c44e\`\n` +
      `   • *Nama Addon Langsung:* \`${prefix}mcdl Realism VFX\`\n` +
      `   • *Angka Balasan:* Balas pesan hasil pencarian dengan angka 1 sampai 20\n\n` +
      `6. *${prefix}mcdisclaimer*\n` +
      `   Melihat penafian hak cipta & ketentuan penggunaan bot.\n\n` +
      `👑 *FITUR OWNER / DEVELOPER*\n` +
      `7. *${prefix}mcauth* : Login / koneksi ulang akun Xbox ke PlayFab.\n` +
      `8. *${prefix}mckeys* : Lihat total kunci dekripsi atau perbarui database kunci dari URL.\n\n` +
      `💡 *Tips Cepat:*\n` +
      `• File di bawah 100 MB akan otomatis dikirim langsung berupa dokumen di WhatsApp.\n` +
      `• File di atas 100 MB otomatis diunggah ke GoFile (High-Speed) dengan tautan langsung.`

    await replyQuoted(ctx, guideText)
  }
}
