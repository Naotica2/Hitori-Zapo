/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * bratvideo.js — Bikin stiker animated gaya "brat" (efek bounce + highlight)
 */
import config from '../../config.js'
import { generateBratAnimatedSticker, parseBratArgs } from '../../lib/bratGenerator.js'

export default {
  name: 'bratvideo',
  aliases: ['bratv', 'bratvid'],
  tags: 'sticker',
  description: 'Bikin sticker brat-style animated (efek bounce jalan)',

  async run(ctx) {
    const raw = (ctx.text || '').trim()
    if (!raw) {
      return ctx.reply(
        '✦ *BRAT ANIMATED STICKER* ✦\n\n' +
        'Cara pake:\n*.bratvideo <teks>*\n' +
        'Pilih tema: *.bratvideo <white/black/green>|<teks>*\n\n' +
        'Contoh:\n.bratvideo Halo Dunia\n.bratvideo black|Gelap Tapi Estetik\n\n' +
        '(mau versi statis aja? pake *.brat <teks>*)'
      )
    }

    const { theme, text } = parseBratArgs(raw)

    await ctx.react('⏳')
    try {
      const webpBuffer = await generateBratAnimatedSticker({
        text,
        theme,
        packName: config.sticker.packName,
        packAuthor: config.sticker.author
      })

      await ctx.client.message.send(ctx.chat, {
        type: 'sticker',
        media: webpBuffer,
        mimetype: 'image/webp'
      })

      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('Gagal bikin sticker brat animated: ' + (e.message || e))
    }
  }
}
