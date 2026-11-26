/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * audio16d.js — Pemisah vokal & instrumen + filter stereo/rotasi 16D Audio (.16d / .16audio / .16daudio)
 */
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'
import { apply16dAudio } from '../../lib/mediaConverter.js'

const MAX_MEDIA_BYTES = 45 * 1024 * 1024

function formatModeDesc(mode) {
  if (mode === 'reverse') return '🎧 *Vokal:* Kiri (Left) | *Instrumen:* Kanan (Right)'
  if (mode === '8d') return '🎧 *16D Motion:* Vokal & Instrumen berputar berlawanan arah'
  return '🎧 *Instrumen:* Kiri (Left) | *Vokal:* Kanan (Right)'
}

export default {
  name: '16d',
  aliases: ['16audio', '16daudio', 'stems16d'],
  tags: 'tools',
  cooldown: 15_000,
  description: 'Pisahkan vokal & instrumen ke kanal 16D (default, reverse, 8d motion)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawArg = String(ctx.text || '').trim()

    if (/^(help|panduan|\?)$/i.test(rawArg)) {
      return ctx.reply(
        '📌 *PANDUAN 16D AUDIO FILTER*\n\n' +
          'Memisahkan vokal & instrumen lalu menyusunnya ke kanal stereo kiri & kanan:\n\n' +
          `• \`${p}16d\` / \`${p}16audio\`\n` +
          '> Mode default (Instrumen di Kiri, Vokal di Kanan)\n\n' +
          `• \`${p}16d reverse\` / \`${p}16d balik\`\n` +
          '> Mode dibalik (Vokal di Kiri, Instrumen di Kanan)\n\n' +
          `• \`${p}16d 8d\` / \`${p}16d motion\`\n` +
          '> Mode 16D berputar (Vokal & Instrumen saling berputar)'
      )
    }

    const { event, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    const supported = new Set(['audio', 'ptt', 'video', 'gif'])
    if (!payload || !supported.has(payload.mediaType)) {
      return ctx.reply(
        '✨ *16D AUDIO FILTER*\n\n' +
          `Balas atau kirim *audio*, *voice note*, atau *video* dengan perintah *${p}16d* / *${p}16audio*.\n` +
          `Ketik \`${p}16d help\` untuk pilihan mode (*default*, *reverse*, *8d*).`
      )
    }

    if (payload.fileLength && payload.fileLength > MAX_MEDIA_BYTES) {
      return ctx.reply(
        `⚠️ Media kegedean (${(payload.fileLength / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
      )
    }

    const isVideo = payload.mediaType === 'video' || payload.mediaType === 'gif'
    await ctx.react('⏳')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      const res = await apply16dAudio(mediaBuffer, { isVideo, mode: rawArg })
      const rawEvent = getEvent(ctx)
      const sendOpts = rawEvent ? { quote: rawEvent } : {}

      const caption =
        `✨ *16D AUDIO FILTER*\n\n${formatModeDesc(res.mode)}\n\n` +
        `> Gunakan earphone/headphone untuk hasil maksimal!`

      if (isVideo) {
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'video',
            media: res.buffer,
            mimetype: 'video/mp4',
            caption
          },
          sendOpts
        )
      } else {
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'audio',
            media: res.buffer,
            mimetype: 'audio/mpeg',
            ptt: false
          },
          sendOpts
        )
        await ctx.client.message.send(ctx.chat, caption, sendOpts)
      }

      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply(
        '❌ Gagal memproses audio 16D: ' + String(err?.message || err).slice(0, 220)
      )
    }
  }
}
