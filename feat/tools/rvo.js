/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * rvo.js — Fitur Pembuka/Pembaca View Once
 */
import config from '../../config.js'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'

function extractCaption(msg) {
  if (!msg) return ''
  const vo2 = msg.viewOnceMessageV2?.message
  const vo = msg.viewOnceMessage?.message

  return (
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    vo2?.imageMessage?.caption ||
    vo2?.videoMessage?.caption ||
    vo?.imageMessage?.caption ||
    vo?.videoMessage?.caption ||
    ''
  )
}

export default {
  name: 'rvo',
  aliases: ['readviewonce', 'getvo'],
  tags: 'tools',
  description: 'Membuka dan mengirim ulang pesan View Once (Sekali Lihat)',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx, {
      preferQuoted: true,
      includeSelf: false
    })
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    if (!targetMessage) {
      return ctx.reply(
        '✦ *READ VIEW ONCE* ✦\n\n' +
        'Reply pesan View Once (gambar/video/audio) dengan perintah `.rvo`'
      )
    }

    if (!payload?.mimetype) {
      return ctx.reply('Pesan yang di-reply tidak mengandung media yang bisa dibuka.')
    }

    await ctx.react('⏳')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)

      let mediaType = 'document'
      if (payload.mimetype.includes('image')) mediaType = 'image'
      else if (payload.mimetype.includes('video')) mediaType = 'video'
      else if (payload.mimetype.includes('audio')) mediaType = 'audio'

      const originalCaption = payload.caption || extractCaption(targetMessage)
      const textCaption = originalCaption ? `*Caption Asli:*\n${originalCaption}\n\n` : ''
      const caption = `┌───「 👁️ *READ VIEW ONCE* 」───┐\n\n${textCaption}└──────────────────────────┘\n\n> ✨ _*Powered by ${config.botName}*_`

      const sendOptions = {
        type: mediaType,
        media: mediaBuffer,
        mimetype: payload.mimetype
      }

      if (mediaType === 'image' || mediaType === 'video') {
        sendOptions.caption = caption
      } else if (mediaType === 'audio' && payload.ptt) {
        sendOptions.ptt = true
      }

      await ctx.client.message.send(ctx.chat, sendOptions, { quote: rawMessage })
      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal membuka View Once: ' + String(error.message || error).slice(0, 250))
    }
  }
}
