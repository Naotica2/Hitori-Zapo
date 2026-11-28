/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * capcut.js — Download video/template CapCut tanpa watermark
 */
import config from '../../config.js'
import { downloadUrlBuffer, extractUrlFromCtx, getEvent } from '../../lib/media.js'
import { normalizeMp4ForWhatsApp } from '../../lib/mediaConverter.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { capcutDownload } from '../../scraper/CAPCUT.js'

const CAPCUT_RE = /https?:\/\/(?:www\.)?capcut\.com\/[^\s]+/i
const MAX_VIDEO_BYTES = 40 * 1024 * 1024

function fmtNum(n) {
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('id-ID') : '0'
}

export default {
  name: 'capcut',
  aliases: ['cc', 'ccdl', 'capcutdl'],
  tags: 'downloader',
  cooldown: 5000,
  description: 'Download video template CapCut tanpa watermark',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const url = extractUrlFromCtx(ctx, CAPCUT_RE, { stripTrailing: true })
    if (!url) {
      return ctx.client.message.send(
        ctx.chat,
        '🎬 *CAPCUT TEMPLATE DOWNLOADER*\n\n' +
          'Kirim link template CapCut (`capcut.com/template-detail/...` atau `capcut.com/t/...`).\n' +
          `*Contoh:* *${p}capcut https://www.capcut.com/template-detail/7590725074756373813*`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      const data = await capcutDownload(url)
      await assertSafePublicUrl(data.videoUrl)

      const rawVidBuf = await downloadUrlBuffer(data.videoUrl, {
        timeout: 90_000,
        maxBytes: MAX_VIDEO_BYTES
      })

      let vidBuf = rawVidBuf
      try {
        const norm = await normalizeMp4ForWhatsApp(rawVidBuf)
        vidBuf = norm.buffer
      } catch {}

      const durSec = data.durationMs ? `${(data.durationMs / 1000).toFixed(1)}s` : '-'
      const caption = [
        '┌───「 🎬 *CAPCUT DOWNLOADER* 」───┐',
        '',
        `• Judul   : *${data.title.slice(0, 120)}*`,
        `• Kreator : ${data.authorName}`,
        `• Durasi  : ${durSec}`,
        `• Dipakai : ${fmtNum(data.usageAmount)}x • ❤️ ${fmtNum(data.likeAmount)}`,
        '',
        '└─────────────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(
        ctx.chat,
        { type: 'video', media: vidBuf, mimetype: 'video/mp4', caption },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
