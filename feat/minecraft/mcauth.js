/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/mcauth.js — Otentikasi Microsoft/Xbox & PlayFab (Owner Only)
 */
import config from '../../config.js'
import { XboxAuth } from '../../lib/minecraft/xboxAuth.js'
import Toolcoin from '../../lib/minecraft/toolcoin.js'
import { replyQuoted } from '../../lib/minecraft/workflow.js'

export default {
  name: 'mcauth',
  aliases: ['mclogin'],
  tags: 'minecraft',
  owner: true,
  description: 'Otentikasi Microsoft/Xbox & PlayFab (Owner Only)',
  cooldown: 5000,

  async run(ctx) {
    const prefix = ctx.prefix || config.mainPrefix
    const command = ctx.command || 'mcauth'
    const query = (ctx.text || '').trim()
    const auth = new XboxAuth()

    if (!query) {
      const url = auth.getAuthUrl()
      return replyQuoted(
        ctx,
        `*OTENTIKASI XBOX & PLAYFAB (OWNER ONLY)*\n\n` +
          `*LANGKAH-LANGKAH:*\n` +
          `1. Klik tautan otentikasi di bawah:\n` +
          `${url}\n\n` +
          `2. Login menggunakan akun Microsoft / Xbox kamu.\n` +
          `3. Jika di browser muncul halaman kosong / putih, *abaikan!*\n` +
          `4. Salin seluruh URL dari bilah alamat browser tersebut.\n` +
          `5. Kirimkan kembali ke bot:\n` +
          `*${prefix}${command} <url_tersebut>*`
      )
    }

    if (query.includes('code=')) {
      await ctx.react('🕕')
      await replyQuoted(ctx, 'Sedang Memproses...\nMenghubungkan akun Xbox ke PlayFab...')

      try {
        let code
        try {
          const parsedUrl = new URL(query)
          code = parsedUrl.searchParams.get('code')
        } catch {
          const match = query.match(/code=([^&]+)/)
          code = match ? match[1] : null
        }

        if (!code) throw new Error('Parameter kode otentikasi tidak ditemukan di URL!')

        await Toolcoin.loginWithXboxCode(code)
        await ctx.react('✅')
        await replyQuoted(
          ctx,
          `*OTENTIKASI BERHASIL!*\n\n` +
            `Akun Xbox sudah berhasil terhubung dan sesi PlayFab aktif!\n` +
            `Sekarang bot siap mencari dan mengunduh addon dari Marketplace.`
        )
      } catch (err) {
        console.error('[MCAuth Error]', err)
        await ctx.react('☢')
        await replyQuoted(ctx, `Gagal Otentikasi:\n${err.message}`)
      }
    } else {
      await replyQuoted(
        ctx,
        'URL Tidak Valid! Pastikan kamu meng-copy seluruh URL yang memuat parameter `code=`.'
      )
    }
  }
}
