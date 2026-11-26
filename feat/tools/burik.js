/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * burik.js — Turunkan resolusi & kualitas gambar, stiker, atau video (.burik / .burikkan)
 */
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'
import { burikImage, burikVideo } from '../../lib/mediaConverter.js'

const MAX_MEDIA_BYTES = 35 * 1024 * 1024

export default {
  name: 'burik',
  aliases: ['burikkan'],
  tags: 'tools',
  cooldown: 8_000,
  description: 'Membuat gambar, stiker, atau video menjadi burik / low-res',

  async run(ctx) {
    const p = config.mainPrefix
    const { event, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    const supported = new Set(['image', 'sticker', 'video', 'gif'])
    if (!payload || !supported.has(payload.mediaType)) {
      return ctx.reply(
        '📉 *MEDIA BURIK*\n\n' +
          `Balas atau kirim *gambar*, *stiker*, atau *video* dengan perintah *${p}burik [lebar_px]*\n` +
          `Contoh: \`${p}burik\` atau \`${p}burik 64\``
      )
    }

    if (payload.fileLength && payload.fileLength > MAX_MEDIA_BYTES) {
      return ctx.reply(
        `⚠️ Media kegedean (${(payload.fileLength / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
      )
    }

    const isVideo = payload.mediaType === 'video' || payload.mediaType === 'gif'
    const requestedWidth = Number.parseInt(String(ctx.text || '').trim(), 10)
    const width = Number.isFinite(requestedWidth) ? requestedWidth : isVideo ? 96 : 50

    await ctx.react('⏳')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      const rawEvent = getEvent(ctx)
      const sendOpts = rawEvent ? { quote: rawEvent } : {}

      if (isVideo) {
        const res = await burikVideo(mediaBuffer, { width })
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'video',
            media: res.buffer,
            mimetype: 'video/mp4',
            caption: `📉 *Video Burik* (${res.width}px)`
          },
          sendOpts
        )
      } else {
        const res = await burikImage(mediaBuffer, { width })
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'image',
            media: res.buffer,
            mimetype: 'image/jpeg',
            caption: `📉 *Gambar Burik* (${res.width}px)`
          },
          sendOpts
        )
      }

      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal memproses media burik: ' + String(err?.message || err).slice(0, 200))
    }
  }
}
