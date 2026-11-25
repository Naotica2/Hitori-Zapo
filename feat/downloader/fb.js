/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * fb.js — Facebook Downloader
 */
import config from '../../config.js'
import { extractUrlFromCtx, downloadUrlBuffer } from '../../lib/media.js'
import { fbDownload } from '../../scraper/FB-DL.js'

const FB_URL_REGEX = /https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.watch)\/[^\s]+/i

function cleanText(value, fallback = '-') {
  if (!value) return fallback
  return String(value).replace(/\s+/g, ' ').trim()
}

function formatCaption(data, media, url) {
  const caption = cleanText(data.caption)
  const author = cleanText(data.author)

  const contentInfo = [
    `- *Caption:* _${caption}_`,
    `- *Author:* _${author}_`,
    `- *Quality:* _${media.quality} (${media.size})_`,
    `- *Link:* _${url}_`
  ]

  return [
    '┌───「 📘 *FACEBOOK DOWNLOADER* 」───┐',
    '',
    ...contentInfo,
    '',
    '└──────────────────────────────────────┘',
    '',
    '🎬 *Video Facebook siap didownload.*',
    '',
    `> ✨ _*Powered by ${config.botName}*_`
  ].join('\n')
}

export default {
  name: 'fb',
  aliases: ['facebook', 'fbdl'],
  tags: 'downloader',
  description: 'Download Facebook video (HD quality)',

  async run(ctx) {
    const url = extractUrlFromCtx(ctx, FB_URL_REGEX)

    if (!url) {
      return ctx.reply(
        '📘 *FACEBOOK DOWNLOADER*\n\n' +
        'Kirim link Facebook atau reply pesan yang berisi link.\n\n' +
        '*Contoh:*\n' +
        '`.fb https://www.facebook.com/share/r/14oEQHEA7pF/`'
      )
    }

    await ctx.react('⏳')

    let result
    try {
      result = await fbDownload(url)
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal scrape: ' + String(e.message || e).slice(0, 200))
    }

    if (!result.status) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal download: ' + (result.error || 'Unknown error'))
    }

    const data = result.data
    const hdMedia = data.media.find((m) => m.quality === 'HD') || data.media[0]

    try {
      const videoBuffer = await downloadUrlBuffer(hdMedia.url, { timeout: 120_000 })
      await ctx.client.message.send(ctx.chat, {
        type: 'video',
        media: videoBuffer,
        mimetype: 'video/mp4',
        caption: formatCaption(data, hdMedia, url)
      })
      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Error: ' + String(e.message || e).slice(0, 250))
    }
  }
}
