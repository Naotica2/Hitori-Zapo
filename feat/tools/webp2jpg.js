/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * webp2jpg.js — Konversi stiker / gambar WebP menjadi JPG atau PNG (.webp2jpg, .web2jpg, .webp2png)
 */
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'
import { webpToImage } from '../../lib/mediaConverter.js'

export default {
  name: 'webp2jpg',
  aliases: ['web2jpg', 'webptojpg', 'webp2png', 'web2png', 'webptopng'],
  tags: 'tools',
  cooldown: 5_000,
  description: 'Ubah stiker atau gambar WebP menjadi JPG / PNG',

  async run(ctx) {
    const p = config.mainPrefix
    const cmd = String(ctx.command || 'webp2jpg').toLowerCase()
    const targetFmt = cmd.includes('png') ? 'png' : 'jpg'
    const { event, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    const supported = new Set(['sticker', 'image'])
    if (!payload || !supported.has(payload.mediaType)) {
      return ctx.reply(
        `🖼️ *WEBP TO ${targetFmt.toUpperCase()}*\n\n` +
          `Balas *stiker* atau *gambar* dengan perintah \`${p}webp2jpg\`, \`${p}web2jpg\`, atau \`${p}webp2png\`.`
      )
    }

    await ctx.react('⏳')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      const res = await webpToImage(mediaBuffer, targetFmt)
      const rawEvent = getEvent(ctx)

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: res.buffer,
          mimetype: res.mimetype,
          caption: `🖼️ Hasil konversi ke *${res.format.toUpperCase()}*`
        },
        rawEvent ? { quote: rawEvent } : {}
      )

      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal konversi gambar: ' + String(err?.message || err).slice(0, 200))
    }
  }
}
