/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * removebg.js — Background Remover Feature
 */
import config from '../../config.js'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'
import { removeBg } from '../../scraper/RMBG.js'

export default {
  name: 'removebg',
  aliases: ['rbg', 'hapusbg', 'nobg'],
  tags: 'media',
  description: 'Menghapus background gambar secara otomatis',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    if (!payload?.mimetype?.includes('image')) {
      return ctx.reply(
        '✦ *BACKGROUND REMOVER* ✦\n\n' +
        'Kirim gambar dengan caption `.removebg` atau reply gambar dengan perintah `.removebg` untuk menghapus background pada gambar.'
      )
    }

    await ctx.react('⏳')

    try {
      const imgBuffer = await downloadTargetBuffer(targetMessage)
      const result = await removeBg(imgBuffer, payload.mimetype)

      if (!result.status || !result.data?.buffer) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal memproses gambar: ' + (result.error || 'Terjadi kesalahan sistem.'))
      }

      const caption = [
        '┌───「 ✂️ *REMOVE BG* 」───┐',
        '',
        'Background berhasil dihapus, Kak!',
        '',
        '└────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: result.data.buffer,
          mimetype: 'image/png',
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
