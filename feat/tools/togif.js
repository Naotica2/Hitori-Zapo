/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * togif.js — Ubah stiker (statis/animasi) atau video menjadi GIF / MP4 (.togif, .tomp4, .tovideo)
 */
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'
import { mediaToMp4 } from '../../lib/mediaConverter.js'

const MAX_MEDIA_BYTES = 35 * 1024 * 1024

export default {
  name: 'togif',
  aliases: ['tomp4', 'tovideo'],
  tags: 'tools',
  cooldown: 8_000,
  description: 'Ubah stiker atau video menjadi GIF (.togif) atau MP4 (.tomp4 / .tovideo)',

  async run(ctx) {
    const p = config.mainPrefix
    const asGif = String(ctx.command || 'togif').toLowerCase() === 'togif'
    const { event, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    const supported = new Set(['sticker', 'video', 'gif'])
    if (!payload || !supported.has(payload.mediaType)) {
      return ctx.reply(
        `🎞️ *STICKER / VIDEO TO ${asGif ? 'GIF' : 'MP4'}*\n\n` +
          `Balas *stiker* atau *video* dengan perintah:\n` +
          `• \`${p}togif\` — jadikan GIF WhatsApp (auto-loop, tanpa suara)\n` +
          `• \`${p}tomp4\` / \`${p}tovideo\` — jadikan video MP4`
      )
    }

    if (payload.fileLength && payload.fileLength > MAX_MEDIA_BYTES) {
      return ctx.reply(
        `⚠️ Media kegedean (${(payload.fileLength / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
      )
    }

    const isVideo = payload.mediaType === 'video' || payload.mediaType === 'gif'
    await ctx.react('⏳')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      const res = await mediaToMp4(mediaBuffer, { isVideo, asGif })
      const rawEvent = getEvent(ctx)

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'video',
          media: res.buffer,
          mimetype: res.mimetype,
          gifPlayback: asGif
        },
        rawEvent ? { quote: rawEvent } : {}
      )

      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply(
        `❌ Gagal mengonversi ke ${asGif ? 'GIF' : 'MP4'}: ` + String(err?.message || err).slice(0, 200)
      )
    }
  }
}
