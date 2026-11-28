/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * unblur.js — Fitur Penjernih Foto Menggunakan AI
 */
import config from '../../config.js'
import { resolveTargetMedia, downloadTargetBuffer, downloadUrlBuffer } from '../../lib/media.js'
import { unblurImage } from '../../scraper/UNBLUR.js'

export default {
  name: 'unblur',
  aliases: ['unblurry', 'unblurimage', 'unblurimg'],
  tags: 'ai',
  description: 'Perbaiki dan jernihkan foto buram dengan AI',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event message.')

    if (!payload?.mimetype?.startsWith('image/')) {
      return ctx.reply(
        `✦ *${config.botName.toUpperCase()} AI UNBLUR* ✦\n\n` +
        'Kirim atau balas gambar buram dengan perintah.\n' +
        '*Contoh:*\n' +
        '`.unblur`'
      )
    }

    await ctx.react('⏳')
    await ctx.reply('_Proses menjernihkan gambar, harap tunggu..._')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      const res = await unblurImage(mediaBuffer)

      if (!res.status || (!res.data?.buffer && !res.data?.result_url)) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal: ' + (res.error || 'Tidak ada output dari server AI.'))
      }

      const imgBuffer = Buffer.isBuffer(res.data?.buffer)
        ? res.data.buffer
        : await downloadUrlBuffer(res.data.result_url, { timeout: 120_000 })

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: imgBuffer,
          mimetype: 'image/jpeg',
          caption: `✨ *${config.botName} AI Enhancer*\n\nGambar berhasil dijernihkan, Kak!`
        },
        { quote: rawMessage }
      )

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Error sistem: ' + String(error.message || error).slice(0, 150))
    }
  }
}
