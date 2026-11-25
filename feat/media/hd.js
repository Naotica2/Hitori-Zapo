/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * hd.js — Fitur Pembuat Foto Menjadi Lebih HD (Experimental-Bell + BigJPG + ImgUpscaler)
 */
import config from '../../config.js'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'
import { TERMAI_ENHANCE_TYPES, upscaleImage } from '../../scraper/UPSCALER.js'

const MODE_HINTS = new Set([
  'auto',
  'enhance',
  'remini',
  'bigjpg',
  'anime',
  'imgupscaler',
  'v1',
  'old',
  ...TERMAI_ENHANCE_TYPES
])

export default {
  name: 'hd',
  aliases: ['upscale', 'remini', 'hdimage', 'enhance'],
  tags: 'media',
  description: 'Meningkatkan resolusi dan kualitas gambar (HD) multi-engine',

  async run(ctx) {
    const arg = (ctx.text || '').trim().toLowerCase()

    if (arg === 'list' || arg === 'help') {
      return ctx.reply(
        '✦ *HD UPSCALER* ✦\n\n' +
          'Kirim / reply gambar dengan:\n' +
          '• `.hd` _(auto: Experimental-Bell → BigJPG → ImgUpscaler)_\n' +
          '• `.hd remini` _(khusus Remini)_\n' +
          '• `.hd bigjpg` / `.hd anime` _(pakai BigJPG)_\n' +
          '• `.hd phox4` / `.hd anix4` / `.hd stdx4` / `.hd cf` / `.hd text`'
      )
    }

    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    if (!payload?.mimetype?.includes('image')) {
      return ctx.reply(
        '✦ *HD UPSCALER* ✦\n\n' +
          'Kirim gambar dengan caption `.hd` atau reply gambar dengan perintah `.hd`\n' +
          '_Ketik `.hd list` untuk melihat opsi mode._'
      )
    }

    const mode = MODE_HINTS.has(arg) ? arg : 'auto'
    await ctx.react('⏳')

    try {
      const imgBuffer = await downloadTargetBuffer(targetMessage)
      const result = await upscaleImage(imgBuffer, { mode })

      if (!result.status || !result.data?.buffer) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal memproses gambar: ' + (result.error || 'Terjadi kesalahan dari server API.'))
      }

      const dims =
        result.data.width && result.data.height ? `${result.data.width}×${result.data.height}` : '-'
      const caption = [
        '┌───「 🪄 *HD UPSCALER* 」───┐',
        '',
        `• Engine : ${result.data.engine || 'HD AI'}`,
        `• Resolusi : ${dims}`,
        '',
        '└──────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: result.data.buffer,
          mimetype: result.data.mime || 'image/jpeg',
          caption
        },
        { quote: rawMessage }
      )

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Error sistem: ' + String(error.message || error).slice(0, 250))
    }
  }
}
