/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * pindl.js — Pinterest Downloader Feature
 */
import config from '../../config.js'
import { extractUrlFromCtx, downloadUrlBuffer } from '../../lib/media.js'
import { pinDownload } from '../../scraper/PINDL.js'

const PIN_URL_REGEX = /https?:\/\/(?:www\.)?pinterest\.com\/pin\/\d+|https?:\/\/pin\.it\/\w+/i

export default {
  name: 'pindl',
  aliases: ['pinterestdl', 'pindownload'],
  tags: 'downloader',
  description: 'Download Video atau Image dari Pinterest',

  async run(ctx) {
    const url = extractUrlFromCtx(ctx, PIN_URL_REGEX)

    if (!url) {
      return ctx.reply(
        '📌 *PINTEREST DOWNLOADER*\n\n' +
        'Kirim link Pinterest atau reply pesan yang berisi link.\n\n' +
        '*Contoh:*\n' +
        '`.pindl https://pin.it/6I5d6PLZn`'
      )
    }

    await ctx.react('⏳')

    let result
    try {
      result = await pinDownload(url)
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal scrape: ' + String(e.message || e).slice(0, 200))
    }

    if (!result.status) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal download: ' + (result.error || 'Unknown error'))
    }

    const data = result.data

    try {
      const mediaBuffer = await downloadUrlBuffer(data.media_url, { timeout: 120_000 })
      const formatType = data.type === 'video' ? `Video ${data.quality || 'HD'}` : 'Image'

      const caption = [
        '┌───「 📌 *PINTEREST DL* 」───┐',
        '',
        `- *Judul:* _${data.title}_`,
        `- *Tipe:* _${formatType}_`,
        '',
        '└──────────────────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(ctx.chat, {
        type: data.type === 'video' ? 'video' : 'image',
        media: mediaBuffer,
        mimetype: data.type === 'video' ? 'video/mp4' : 'image/jpeg',
        caption
      })

      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Error mengirim media: ' + String(e.message || e).slice(0, 250))
    }
  }
}
