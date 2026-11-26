/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * audio8d.js — Efek suara berputar 8D Audio (.8d / .8audio / .8daudio / .kirikanan)
 */
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'
import { apply8dAudio } from '../../lib/mediaConverter.js'

const MAX_MEDIA_BYTES = 45 * 1024 * 1024

export default {
  name: '8d',
  aliases: ['8audio', '8daudio', 'kirikanan'],
  tags: 'tools',
  cooldown: 10_000,
  description: 'Ubah audio, voice note, atau video dengan efek 8D Audio berputar',

  async run(ctx) {
    const p = config.mainPrefix
    const { event, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    const supported = new Set(['audio', 'ptt', 'video', 'gif'])
    if (!payload || !supported.has(payload.mediaType)) {
      return ctx.reply(
        '🎧 *8D AUDIO EFFECT*\n\n' +
          `Balas atau kirim *audio*, *voice note*, atau *video* dengan perintah *${p}8d* / *${p}8audio*.\n` +
          `Opsional atur kecepatan putar (Hz): \`${p}8d 0.2\` _(default: 0.125)_`
      )
    }

    if (payload.fileLength && payload.fileLength > MAX_MEDIA_BYTES) {
      return ctx.reply(
        `⚠️ Media kegedean (${(payload.fileLength / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
      )
    }

    const isVideo = payload.mediaType === 'video' || payload.mediaType === 'gif'
    const argHz = Number.parseFloat(String(ctx.text || '').trim())
    const hz = Number.isFinite(argHz) ? argHz : 0.125

    await ctx.react('🎧')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      const res = await apply8dAudio(mediaBuffer, { isVideo, hz })
      const rawEvent = getEvent(ctx)
      const sendOpts = rawEvent ? { quote: rawEvent } : {}

      if (isVideo) {
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'video',
            media: res.buffer,
            mimetype: 'video/mp4',
            caption: `🎧 *8D Audio* (${res.hz} Hz)\n> Gunakan earphone untuk hasil maksimal!`
          },
          sendOpts
        )
      } else {
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'audio',
            media: res.buffer,
            mimetype: 'audio/mpeg',
            ptt: false
          },
          sendOpts
        )
      }

      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal memproses 8D Audio: ' + String(err?.message || err).slice(0, 200))
    }
  }
}
