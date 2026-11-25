/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * fb.js — Facebook Downloader
 */
import config from '../../config.js'
import { extractUrlFromCtx, downloadUrlBuffer } from '../../lib/media.js'
import { fbDownload } from '../../scraper/FB-DL.js'

const FB_URL_REGEX =
  /https?:\/\/(?:www\.|m\.|mbasic\.|web\.|l\.|business\.)?(?:facebook\.com|fb\.watch)\/[^\s]+/i

function cleanText(value, fallback = '-') {
  if (!value) return fallback
  return String(value).replace(/\s+/g, ' ').trim()
}

function pickBestMedia(mediaList = []) {
  const videosWithAudio = mediaList.filter((m) => m.video !== false && m.audio !== false)
  const allVideos = mediaList.filter((m) => m.video !== false)
  const pool = videosWithAudio.length ? videosWithAudio : allVideos.length ? allVideos : mediaList

  return (
    pool.find((m) => /^hd$/i.test(m.quality) || /\b(1080|720|hd)\b/i.test(String(m.quality || ''))) ||
    pool[0]
  )
}

function formatCaption(data, media, url) {
  const caption = cleanText(data.caption)
  const author = cleanText(data.author)
  const duration = cleanText(data.duration, '')

  const contentInfo = [
    `- *Caption:* _${caption}_`,
    ...(author !== '-' ? [`- *Author:* _${author}_`] : []),
    ...(duration ? [`- *Duration:* _${duration}_`] : []),
    `- *Quality:* _${media.quality}${media.size && media.size !== '-' ? ` (${media.size})` : ''}_`,
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
    const url = extractUrlFromCtx(ctx, FB_URL_REGEX, { stripTrailing: true })

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

    if (!result?.status || !result?.data?.media?.length) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal download: ' + (result?.error || 'Media tidak ditemukan'))
    }

    const data = result.data
    const primary = pickBestMedia(data.media)
    const fallback = data.media.find((m) => m !== primary && m.video !== false && m.url)
    const candidates = [primary, fallback].filter(Boolean)

    let lastErr = null
    for (const candidate of candidates) {
      try {
        const videoBuffer = await downloadUrlBuffer(candidate.url, {
          timeout: 120_000,
          maxBytes: 99 * 1024 * 1024
        })
        await ctx.client.message.send(ctx.chat, {
          type: 'video',
          media: videoBuffer,
          mimetype: 'video/mp4',
          caption: formatCaption(data, candidate, url)
        })
        await ctx.react('✅')
        return
      } catch (e) {
        lastErr = e
      }
    }

    await ctx.react('❎')
    return ctx.reply('❌ Error: ' + String(lastErr?.message || lastErr || 'Gagal mengunduh video').slice(0, 250))
  }
}
