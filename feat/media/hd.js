/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * hd.js — Fitur Pembuat Foto Menjadi Lebih HD
 */
import config from '../../config.js'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'
import { upscaleImage } from '../../scraper/UPSCALER.js'

export default {
  name: 'hd',
  aliases: ['upscale', 'remini', 'hdimage'],
  tags: 'media',
  description: 'Meningkatkan resolusi dan kualitas gambar (HD)',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    if (!payload?.mimetype?.includes('image')) {
      return ctx.reply(
        '✦ *HD UPSCALER* ✦\n\n' +
        'Kirim gambar dengan caption `.hd` atau reply gambar dengan perintah `.hd`'
      )
    }

    await ctx.react('⏳')

    try {
      const imgBuffer = await downloadTargetBuffer(targetMessage)
      const result = await upscaleImage(imgBuffer)

      if (!result.status || !result.data?.buffer) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal memproses gambar: ' + (result.error || 'Terjadi kesalahan dari server API.'))
      }

      const caption = [
        '┌───「 🪄 *HD UPSCALER* 」───┐',
        '',
        'Ini dia hasilnya, Kak!',
        '',
        '└──────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: result.data.buffer,
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
