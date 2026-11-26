/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * whatmusic.js — Tebak judul & penyanyi lagu dari audio, voice note, atau video (.whatmusic)
 */
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'
import { recognizeMusic } from '../../scraper/WHATMUSIC.js'

const MAX_MEDIA_BYTES = 45 * 1024 * 1024

function detectMediaKind(payload) {
  if (!payload) return { supported: false, isVideo: false }

  if (payload.mediaType === 'audio' || payload.mediaType === 'ptt') {
    return { supported: true, isVideo: false }
  }
  if (payload.mediaType === 'video' || payload.mediaType === 'gif') {
    return { supported: true, isVideo: true }
  }
  if (payload.mediaType === 'document') {
    const mime = String(payload.mimetype || '').toLowerCase()
    if (mime.startsWith('video/')) return { supported: true, isVideo: true }
    if (mime.startsWith('audio/')) return { supported: true, isVideo: false }
  }

  return { supported: false, isVideo: false }
}

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return null
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default {
  name: 'whatmusic',
  aliases: ['musixsearch', 'searchmusic', 'searchsong', 'musicrecognition', 'shazam', 'laguapa'],
  tags: 'tools',
  cooldown: 10_000,
  description: 'Tebak judul & artis lagu dari audio, voice note, atau video',

  async run(ctx) {
    const p = config.mainPrefix
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    const kind = detectMediaKind(payload)
    if (!kind.supported) {
      return ctx.reply(
        '🎧 *TEBAK LAGU (WHATMUSIC)*\n\n' +
          'Reply atau kirim media berikut dengan perintah *' + p + 'whatmusic*:\n' +
          '• *Audio / MP3* atau *Voice Note*\n' +
          '• *Video / Reels / TikTok* _(otomatis ekstrak audionya)_\n' +
          '• *Dokumen* audio/video'
      )
    }

    if (payload.fileLength && payload.fileLength > MAX_MEDIA_BYTES) {
      return ctx.reply(
        `⚠️ File kegedean (${(payload.fileLength / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
      )
    }

    await ctx.react('⏳')

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      if (mediaBuffer.length > MAX_MEDIA_BYTES) {
        await ctx.react('❎')
        return ctx.reply(
          `⚠️ File kegedean (${(mediaBuffer.length / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
        )
      }

      const result = await recognizeMusic(mediaBuffer, {
        isVideo: kind.isVideo,
        mimetype: payload.mimetype
      })

      const rawEvent = getEvent(ctx)
      const sendOpts = rawEvent ? { quote: rawEvent } : {}

      if (!result.found || !result.match) {
        await ctx.react('ℹ️')
        return ctx.client.message.send(
          ctx.chat,
          '🎵 *Lagu belum terdeteksi*\n\n' +
            'Sistem tidak menemukan kecocokan lagu di cuplikan ini.\n' +
            '_Tips: pastikan musik terdengar jelas minimal beberapa detik dan tidak terlalu tertutup suara bicara/efek._',
          sendOpts
        )
      }

      const { match, youtube } = result
      const lines = [
        '🎵 *LAGU TERDETEKSI*',
        '',
        `• Judul : *${match.title}*`,
        `• Artis : *${match.artists || 'Tidak diketahui'}*`
      ]

      if (match.album) lines.push(`• Album : ${match.album}`)
      if (match.releaseDate) lines.push(`• Rilis : ${match.releaseDate}`)

      const durText = formatDuration(result.durationSeconds)
      const sourceLabel = result.extractedFromVideo ? 'Video → ekstrak audio MP3' : 'Audio'
      lines.push(`• Sumber : ${sourceLabel}${durText ? ` (${durText})` : ''}`)

      if (youtube?.url) {
        lines.push('', `▶️ *YouTube:* ${youtube.url}`)
      }

      const queryHint = match.artists ? `${match.title} | ${match.artists}` : match.title
      const playHint = match.artists ? `${match.artists} - ${match.title}` : match.title
      lines.push(
        '',
        `💡 Cari lirik: \`${p}lirik ${queryHint}\``,
        `💡 Download audio: \`${p}play ${playHint}\``,
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      )

      await ctx.client.message.send(ctx.chat, lines.join('\n'), sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      const msg = String(err?.message || err).slice(0, 220)
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal mengenali lagu: ${msg}`,
        rawMessage ? { quote: getEvent(ctx) } : {}
      )
    }
  }
}
