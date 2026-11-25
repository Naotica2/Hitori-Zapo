/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * brat.js — Bikin stiker statis gaya "brat"
 */
import config from '../../config.js'
import { generateBratSticker, parseBratArgs } from '../../lib/bratGenerator.js'

export default {
  name: 'brat',
  aliases: ['bratstiker', 'bratsticker'],
  tags: 'sticker',
  description: 'Bikin sticker brat-style statis',

  async run(ctx) {
    const raw = (ctx.text || '').trim()
    if (!raw) {
      return ctx.reply(
        '✦ *BRAT STICKER* ✦\n\n' +
        'Cara pake:\n*.brat <teks>*\n' +
        'Pilih tema: *.brat <white/black/green>|<teks>*\n\n' +
        'Contoh:\n.brat Halo Dunia\n.brat black|Gelap Tapi Estetik\n\n' +
        '(mau versi gerak/animated? pake *.bratvideo <teks>*)'
      )
    }

    const { theme, text } = parseBratArgs(raw)

    await ctx.react('⏳')
    try {
      const webpBuffer = await generateBratSticker({
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
      ctx.reply('Gagal bikin sticker brat: ' + (e.message || e))
    }
  }
}
