/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ptv.js — Konversi video / GIF menjadi Video Note bulat native WhatsApp (ptvMessage)
 */
import config from '../../config.js'
import {
  downloadTargetBuffer,
  getEvent,
  resolveTargetMedia
} from '../../lib/media.js'
import { mediaToMp4, videoToSquarePtv } from '../../lib/mediaConverter.js'

const MAX_INPUT_BYTES = 25 * 1024 * 1024

export default {
  name: 'ptv',
  aliases: ['vnote', 'videonote', 'toptv'],
  tags: 'media',
  cooldown: 5000,
  description: 'Ubah video atau GIF menjadi Video Note bulat (PTV) WhatsApp',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const mime = String(payload?.mimetype || '')
    const mType = String(payload?.mediaType || '')
    const isGif = mType === 'gif' || /gif/i.test(mime)
    const isVideoLike = mType === 'video' || mType === 'ptv' || isGif || mime.startsWith('video/')

    if (!payload || !targetMessage || !isVideoLike) {
      return ctx.client.message.send(
        ctx.chat,
        '⭕ *VIDEO NOTE (PTV)*\n\n' +
          'Kirim atau reply *video / GIF* lalu ketik perintah ini untuk mengubahnya menjadi lingkaran Video Note WhatsApp.\n\n' +
          '*Contoh:*\n' +
          `• Reply video dengan *${p}ptv*\n` +
          `• Reply video dengan *${p}vnote* _(otomatis di-crop 1:1, maks 60 detik)_`,
        sendOpts
      )
    }

    if (payload.fileLength && payload.fileLength > MAX_INPUT_BYTES) {
      return ctx.client.message.send(
        ctx.chat,
        `⚠️ Ukuran video terlalu besar (${(payload.fileLength / 1024 / 1024).toFixed(1)} MB, maks 25 MB).`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      let buf = await downloadTargetBuffer(targetMessage)
      if (buf.length > MAX_INPUT_BYTES) {
        throw new Error('Ukuran video melebihi batas 25 MB.')
      }

      if (isGif && !mime.includes('mp4')) {
        const mp4 = await mediaToMp4(buf, { isVideo: false, asGif: true })
        buf = mp4.buffer
      }

      const ptvBuf = await videoToSquarePtv(buf, { maxSeconds: 60, size: 480 })

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'ptv',
          media: ptvBuf,
          mimetype: 'video/mp4'
        },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      const msg = String(err?.message || err)
      if (/ffmpeg|ENOENT/i.test(msg)) {
        return ctx.client.message.send(
          ctx.chat,
          '🎬 `ffmpeg` belum terpasang di server untuk memproses Video Note PTV.',
          sendOpts
        )
      }
      return ctx.client.message.send(ctx.chat, `❌ Gagal membuat PTV: ${msg.slice(0, 220)}`, sendOpts)
    }
  }
}
