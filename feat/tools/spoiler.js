/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * spoiler.js — Kirim pesan atau media Spoiler ketuk-untuk-buka (isSpoiler & tag 118 beta)
 */
import config from '../../config.js'
import {
  downloadTargetBuffer,
  extractTextFromMessage,
  getEvent,
  getQuotedMessage,
  resolveTargetMedia
} from '../../lib/media.js'

const MAX_MEDIA_BYTES = 20 * 1024 * 1024

export default {
  name: 'spoiler',
  aliases: ['spoil', 'blurmsg'],
  tags: 'tools',
  cooldown: 3000,
  description: 'Kirim gambar, video, atau teks berstatus Spoiler WhatsApp',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    let rawText = String(ctx.text || '')
      .trim()
      .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

    let betaWrapper = false
    rawText = rawText
      .replace(/(^|\s)--(?:beta|proto)\b/gi, (_, lead) => {
        betaWrapper = true
        return lead
      })
      .trim()

    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const quoted = getQuotedMessage(ctx)
    const quotedText = !payload ? extractTextFromMessage(quoted).trim() : ''

    if (!payload && !rawText && !quotedText) {
      return ctx.client.message.send(
        ctx.chat,
        '🙈 *WHATSAPP SPOILER*\n\n' +
          '*Media Spoiler (Blur ketuk-untuk-buka):*\n' +
          `• Kirim/reply foto atau video dengan *${p}spoiler [caption]*\n\n` +
          '*Teks Spoiler:*\n' +
          `• *${p}spoiler Akhir ceritanya ternyata dia adalah pelakunya!*\n` +
          `• Tambahkan \`--beta\` untuk membungkusnya dengan proto beta \`spoilerMessage\` (Tag 118)\n\n` +
          '_Catatan: Dukungan spoiler teks/media tergantung rollout versi WhatsApp HP penerima._',
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      if (payload && targetMessage) {
        const mediaType = payload.mediaType
        const mime = payload.mimetype || 'application/octet-stream'
        const supported = new Set(['image', 'video', 'gif', 'ptv', 'sticker'])
        if (!supported.has(mediaType)) {
          throw new Error(`Tipe media "${mediaType}" belum mendukung tag spoiler.`)
        }
        const buf = await downloadTargetBuffer(targetMessage)
        if (buf.length > MAX_MEDIA_BYTES) {
          throw new Error('Ukuran media terlalu besar (maks 20 MB).')
        }

        const sendContent = {
          type: mediaType === 'gif' ? 'video' : mediaType,
          media: buf,
          mimetype: mime,
          ...(mediaType === 'gif' ? { gifPlayback: true } : {}),
          ...(rawText && mediaType !== 'sticker' ? { caption: rawText } : {}),
          contextInfo: { isSpoiler: true }
        }

        await ctx.client.message.send(ctx.chat, sendContent, sendOpts)
        await ctx.react('✅')
        return
      }

      const textBody = rawText || quotedText
      if (betaWrapper) {
        await ctx.client.message.send(
          ctx.chat,
          {
            spoilerMessage: {
              message: {
                extendedTextMessage: {
                  text: textBody,
                  contextInfo: { isSpoiler: true }
                }
              }
            }
          },
          { ...sendOpts, additionalAttributes: { type: 'text' } }
        )
      } else {
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'text',
            text: textBody,
            contextInfo: { isSpoiler: true }
          },
          sendOpts
        )
      }
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal mengirim spoiler: ${String(err?.message || err).slice(0, 220)}`,
        sendOpts
      )
    }
  }
}
