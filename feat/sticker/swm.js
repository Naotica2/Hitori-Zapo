/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * swm.js — Ubah watermark stiker dengan packname/author pilihanmu
 */
import config from '../../config.js'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'
import { applyStickerExif } from '../../lib/sticker.js'

export default {
  name: 'swm',
  aliases: ['wm', 'stickerwm', 'stikerwm', 'take'],
  tags: 'sticker',
  description: 'Ubah watermark stiker (.swm packname | author)',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx, {
      preferQuoted: true,
      includeSelf: false
    })
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    if (!targetMessage) {
      return ctx.reply(
        '✦ *STICKER WATERMARK* ✦\n\n' +
        'Reply stiker yang mau diubah watermark-nya.\n\n' +
        '*Format:*\n' +
        '`.swm Nama Pack | Nama Author`\n' +
        '`.swm Nama Pack`\n' +
        '`.swm | Nama Author`'
      )
    }

    if (!payload?.mimetype?.includes('webp')) {
      return ctx.reply('⚠️ Yang di-reply harus berupa stiker, Kak!')
    }

    const text = (ctx.text || '').trim()
    if (!text) {
      return ctx.reply(`Teks watermarknya mana? Contoh: *.swm ${config.sticker.packName} | ${config.botName}*`)
    }

    let packName = ''
    let author = ''
    if (text.includes('|')) {
      const parts = text.split('|')
      packName = parts[0].trim()
      author = parts.slice(1).join('|').trim()
    } else {
      packName = text
    }

    await ctx.react('⏳')

    try {
      const stickerBuffer = await downloadTargetBuffer(targetMessage)
      const finalSticker = applyStickerExif(stickerBuffer, {
        packName,
        author,
        packId: 'hitori-swm',
        emojis: ['✨']
      })

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'sticker',
          media: finalSticker,
          mimetype: 'image/webp'
        },
        { quote: rawMessage }
      )

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal merubah watermark stiker: ' + String(error.message || error).slice(0, 250))
    }
  }
}
