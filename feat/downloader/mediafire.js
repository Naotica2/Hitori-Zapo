/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * mediafire.js — MediaFire Downloader Feature
 */
import config from '../../config.js'
import { downloadUrlBuffer, extractUrlFromCtx, getEvent } from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { mediafireDownload } from '../../scraper/MEDIAFIRE.js'

const MF_URL_RE = /https?:\/\/(?:www\.)?mediafire\.com\/(?:file|download)\/[^\s]+/i
const MAX_MF_BYTES = 100 * 1024 * 1024

export default {
  name: 'mediafire',
  aliases: ['mf', 'mfdl', 'mediafiredl'],
  tags: 'downloader',
  description: 'Download file dari MediaFire',

  async run(ctx) {
    const targetUrl = extractUrlFromCtx(ctx, MF_URL_RE, { stripTrailing: true })
    if (!targetUrl) {
      return ctx.reply(
        '✦ *MEDIAFIRE DOWNLOADER* ✦\n\n' +
        'Kirim link MediaFire atau reply pesan berisi link.\n' +
        '*Contoh:*\n' +
        '`.mf https://www.mediafire.com/file/xxxxx`'
      )
    }

    const rawQuote = getEvent(ctx)
    const sendOpts = rawQuote ? { quote: rawQuote } : {}
    await ctx.react('⏳')

    try {
      const res = await mediafireDownload(targetUrl)

      if (!res.status) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal: ' + res.error)
      }

      const { file_name, file_size, download_url } = res.data
      await assertSafePublicUrl(download_url)

      await ctx.reply(
        `✅ *File Ditemukan!*\n\n📄 *Nama:* ${file_name}\n⚖️ *Size:* ${file_size}\n\n_Sedang mengunduh dan mengirim file, tunggu sebentar..._`
      )

      const head = await fetch(download_url, {
        method: 'HEAD',
        headers: { Referer: 'https://www.mediafire.com/' },
        signal: AbortSignal.timeout(12_000)
      }).catch(() => null)
      const mimeType =
        (head?.headers?.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream'

      const fileBuffer = await downloadUrlBuffer(download_url, {
        timeout: 120_000,
        maxBytes: MAX_MF_BYTES,
        headers: { Referer: 'https://www.mediafire.com/' }
      })

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'document',
          media: fileBuffer,
          fileName: file_name,
          mimetype: mimeType,
          caption: `📥 *MEDIAFIRE DOWNLOADER*\n\n📄 *Nama:* ${file_name}\n⚖️ *Ukuran:* ${file_size}\n> _🤖 *Powered by ${config.botName}*_`
        },
        sendOpts
      )

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Error sistem: ' + String(error.message || error).slice(0, 180))
    }
  }
}
