/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * unwm.js — Bersihkan Watermark Dari Gambar
 */
import config from '../../config.js'
import { resolveTargetMedia, downloadTargetBuffer, downloadUrlBuffer } from '../../lib/media.js'
import { removeWatermark } from '../../scraper/UNWM.js'

export default {
  name: 'unwm',
  aliases: ['unwatermark', 'hapuswm', 'delwm', 'clean'],
  tags: 'media',
  description: 'Membersihkan gambar dari coretan atau watermark',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    if (!payload?.mimetype?.includes('image')) {
      return ctx.reply(
        '✦ *IMAGE CLEANER* ✦\n\n' +
        'Kirim gambar dengan caption `.unwm` atau reply gambar dengan perintah `.unwm` untuk membersihkan watermark yang ada.'
      )
    }

    await ctx.react('⏳')

    try {
      const imgBuffer = await downloadTargetBuffer(targetMessage)
      const result = await removeWatermark(imgBuffer, payload.mimetype)

      if (!result.status || !result.data?.url) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal memproses gambar: ' + (result.error || 'Terjadi kesalahan server.'))
      }

      const resultBuffer = await downloadUrlBuffer(result.data.url, { timeout: 60_000 })

      const caption = [
        '┌───「 🪄 *IMAGE CLEANER* 」───┐',
        '',
        'Gambar berhasil dibersihkan, Kak!',
        '',
        '└───────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: resultBuffer,
          mimetype: 'image/jpeg',
          caption
        },
        { quote: rawMessage }
      )

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Error sistem: ' + String(error.message || error).slice(0, 250))
    }
  }
}
