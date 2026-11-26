/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * swgc.js — Posting Group Status WhatsApp V2 (groupStatusMessageV2) untuk Teks, Gambar, Stiker, Video, Audio/VN.
 */
import sharp from 'sharp'
import { createMediaProcessor } from '@zapo-js/media-utils'
import {
  downloadTargetBuffer,
  extractTextFromMessage,
  getEvent,
  resolveTargetMedia
} from '../../lib/media.js'

const MAX_TEXT = 700
const MAX_MEDIA_BYTES = 25 * 1024 * 1024
const mediaProcessor = createMediaProcessor()

const FONTS = {
  sistem: { id: 0, label: 'Sistem (default)' },
  script: { id: 2, label: 'Script / tulisan tangan' },
  bold: { id: 6, label: 'Sistem Bold' },
  norican: { id: 7, label: 'Norican (kursif)' },
  calistoga: { id: 8, label: 'Calistoga (serif tebal)' },
  exo: { id: 9, label: 'Exo 2 (futuristik)' },
  courier: { id: 10, label: 'Courier Prime Bold (mesin ketik)' }
}

const COLORS = {
  merah: '#E53935', red: '#E53935',
  biru: '#1E88E5', blue: '#1E88E5',
  hijau: '#43A047', green: '#43A047',
  kuning: '#FDD835', yellow: '#FDD835',
  oranye: '#FB8C00', orange: '#FB8C00',
  ungu: '#8E24AA', purple: '#8E24AA',
  pink: '#EC407A',
  tosca: '#00ACC1', teal: '#00ACC1',
  hitam: '#121212', black: '#121212',
  putih: '#FFFFFF', white: '#FFFFFF',
  abu: '#616161', gray: '#616161',
  coklat: '#6D4C41', brown: '#6D4C41',
  navy: '#0D1B2A',
  emas: '#FFB300', gold: '#FFB300'
}

const TEMPLATES = {
  hitori: { bg: '#E91E63', text: '#FFFFFF', font: 'script', label: 'Pink manis ala Hitori' },
  midnight: { bg: '#0D1B2A', text: '#E0E1DD', font: 'bold', label: 'Biru malam' },
  ocean: { bg: '#0077B6', text: '#FFFFFF', font: 'sistem', label: 'Biru laut' },
  sunset: { bg: '#FF6B35', text: '#FFF3E0', font: 'bold', label: 'Jingga senja' },
  forest: { bg: '#1B4332', text: '#D8F3DC', font: 'exo', label: 'Hijau hutan' },
  royal: { bg: '#4A148C', text: '#FFD54F', font: 'calistoga', label: 'Ungu kerajaan' },
  mono: { bg: '#212121', text: '#FFFFFF', font: 'courier', label: 'Monokrom mesin ketik' },
  gold: { bg: '#FFB300', text: '#212121', font: 'bold', label: 'Emas' }
}

const DEFAULT_STYLE = { bg: '#1E88E5', text: '#FFFFFF', font: 'sistem' }

const HELP =
  '📸 *SWGC — Status Grup WhatsApp*\n\n' +
  '*Teks:*\n`.swgc Halo semua!`\n' +
  '`.swgc Halo semua! --tpl hitori`\n' +
  '`.swgc Halo --bg biru --color putih --font script`\n\n' +
  '*Gambar / Stiker / Video / Audio / VN:*\n' +
  'Reply media lalu `.swgc [caption]`,\n' +
  'atau kirim gambar/video dengan caption `.swgc [caption]`\n\n' +
  '*Reply teks:* reply sebuah pesan teks pake `.swgc`\n\n' +
  '`.swgc list` → daftar template, warna & font\n' +
  '`--to <id@g.us>` → pilih grup target (kalo di luar grup)'

function listText() {
  const tpl = Object.entries(TEMPLATES)
    .map(([k, v]) => `• *${k}* — ${v.label}`)
    .join('\n')
  const fonts = Object.entries(FONTS)
    .map(([k, v]) => `• *${k}* — ${v.label}`)
    .join('\n')
  const colors = [...new Set(Object.keys(COLORS))].join(', ')
  return (
    '🎨 *TEMPLATE* (`--tpl nama`)\n' +
    tpl +
    '\n\n🔤 *FONT* (`--font nama`)\n' +
    fonts +
    '\n\n🖌️ *WARNA* (`--bg` / `--color`)\n' +
    colors +
    '\nAtau hex: `#FF5722`'
  )
}

function toArgb(input) {
  if (!input) return null
  const v = String(input).trim().toLowerCase()
  const hex = (COLORS[v] ?? v).replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  return (0xff000000 | parseInt(hex, 16)) >>> 0
}

function parseArgs(raw) {
  const opts = {}
  const text = raw
    .replace(/--(bg|color|font|tpl|to)(?:=|\s+)(\S+)/gi, (_, k, v) => {
      opts[k.toLowerCase()] = v
      return ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { text, opts }
}

async function normalizeStickerToJpeg(buffer) {
  return sharp(buffer, { pages: 1 })
    .flatten({ background: '#121212' })
    .jpeg({ quality: 92 })
    .toBuffer()
}

export async function buildGroupStatusMediaInner(client, payload, rawBuffer, caption) {
  const kind = payload.mediaType

  if (kind === 'image' || kind === 'sticker') {
    const imgBuffer = kind === 'sticker' ? await normalizeStickerToJpeg(rawBuffer) : rawBuffer
    const mimetype =
      kind === 'sticker'
        ? 'image/jpeg'
        : String(payload.mimetype || 'image/jpeg').split(';')[0].trim() || 'image/jpeg'

    const [uploaded, meta, thumb] = await Promise.all([
      client.message.upload(imgBuffer, { type: 'image', mimetype }),
      sharp(imgBuffer).metadata().catch(() => null),
      mediaProcessor.generateImageThumbnail?.(imgBuffer, 100).catch(() => null)
    ])

    const width = meta?.width ?? thumb?.width
    const height = meta?.height ?? thumb?.height

    return {
      imageMessage: {
        url: uploaded.url,
        directPath: uploaded.directPath,
        mediaKey: uploaded.mediaKey,
        fileSha256: uploaded.fileSha256,
        fileEncSha256: uploaded.fileEncSha256,
        fileLength: uploaded.fileLength,
        mediaKeyTimestamp: uploaded.mediaKeyTimestamp,
        mimetype,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(thumb?.jpegThumbnail ? { jpegThumbnail: thumb.jpegThumbnail } : {}),
        ...(caption ? { caption } : {}),
        contextInfo: { isGroupStatus: true }
      }
    }
  }

  if (kind === 'video' || kind === 'gif') {
    const isGif = kind === 'gif'
    const mimetype = String(payload.mimetype || 'video/mp4').split(';')[0].trim() || 'video/mp4'

    const [uploaded, probe, thumb] = await Promise.all([
      client.message.upload(rawBuffer, { type: isGif ? 'gif' : 'video', mimetype }),
      mediaProcessor.probeMedia?.(rawBuffer).catch(() => null),
      mediaProcessor.generateVideoThumbnail?.(rawBuffer, 100).catch(() => null)
    ])

    const seconds = probe?.durationSeconds ? Math.floor(probe.durationSeconds) : undefined
    const width = probe?.width
    const height = probe?.height

    return {
      videoMessage: {
        url: uploaded.url,
        directPath: uploaded.directPath,
        mediaKey: uploaded.mediaKey,
        fileSha256: uploaded.fileSha256,
        fileEncSha256: uploaded.fileEncSha256,
        fileLength: uploaded.fileLength,
        mediaKeyTimestamp: uploaded.mediaKeyTimestamp,
        mimetype,
        ...(isGif ? { gifPlayback: true } : {}),
        ...(seconds ? { seconds } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(thumb?.jpegThumbnail ? { jpegThumbnail: thumb.jpegThumbnail } : {}),
        ...(uploaded.streamingSidecar ? { streamingSidecar: uploaded.streamingSidecar } : {}),
        ...(uploaded.metadataUrl ? { metadataUrl: uploaded.metadataUrl } : {}),
        ...(caption ? { caption } : {}),
        contextInfo: { isGroupStatus: true }
      }
    }
  }

  if (kind === 'audio' || kind === 'ptt') {
    const isPtt = kind === 'ptt'
    const mimetype = payload.mimetype || (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mpeg')

    const [uploaded, probe, wave] = await Promise.all([
      client.message.upload(rawBuffer, { type: isPtt ? 'ptt' : 'audio', mimetype }),
      mediaProcessor.probeMedia?.(rawBuffer).catch(() => null),
      isPtt ? mediaProcessor.computeWaveform?.(rawBuffer).catch(() => null) : Promise.resolve(null)
    ])

    const seconds = probe?.durationSeconds
      ? Math.floor(probe.durationSeconds)
      : wave?.durationSeconds
        ? Math.floor(wave.durationSeconds)
        : undefined

    return {
      audioMessage: {
        url: uploaded.url,
        directPath: uploaded.directPath,
        mediaKey: uploaded.mediaKey,
        fileSha256: uploaded.fileSha256,
        fileEncSha256: uploaded.fileEncSha256,
        fileLength: uploaded.fileLength,
        mediaKeyTimestamp: uploaded.mediaKeyTimestamp,
        mimetype,
        ptt: Boolean(isPtt),
        ...(seconds ? { seconds } : {}),
        ...(wave?.waveform ? { waveform: wave.waveform } : {}),
        ...(uploaded.streamingSidecar ? { streamingSidecar: uploaded.streamingSidecar } : {}),
        contextInfo: { isGroupStatus: true }
      }
    }
  }

  throw new Error(`Tipe media '${kind}' belum didukung untuk SWGC.`)
}

export default {
  name: 'swgc',
  aliases: ['upswgc', 'swgrup', 'swgroup', 'groupstatus'],
  tags: 'group',
  owner: true,
  description: 'Posting status WA grup (teks, gambar, stiker, video, audio/VN) via groupStatusMessageV2',
  cooldown: 30_000,

  async run(ctx) {
    const raw = (ctx.text || '').trim()
    if (/^(list|template|templates|help)$/i.test(raw)) {
      return ctx.reply(/^help$/i.test(raw) ? HELP : listText())
    }

    const { text: argText, opts } = parseArgs(raw)
    const groupJid = opts.to || (ctx.chat?.endsWith('@g.us') ? ctx.chat : null)
    if (!groupJid || !groupJid.endsWith('@g.us')) {
      return ctx.reply('⚠️ Pake di dalam grup, atau tambahin `--to <id@g.us>`.\n\n' + HELP)
    }

    const { quoted, targetMessage: mediaSource, payload } = resolveTargetMedia(ctx)
    const quotedText = extractTextFromMessage(quoted)
    const supportedMedia = new Set(['image', 'video', 'gif', 'sticker', 'audio', 'ptt'])
    const hasMedia = Boolean(payload && supportedMedia.has(payload.mediaType))

    if (payload && !hasMedia) {
      return ctx.reply('⚠️ Cuma dukung gambar, stiker, video, audio/VN, atau teks buat status grup.')
    }

    const text = argText || (!hasMedia ? quotedText : '')
    if (!hasMedia && !text) return ctx.reply(HELP)

    if (!hasMedia && text.length > MAX_TEXT) {
      return ctx.reply(`⚠️ Teks status kepanjangan (${text.length}/${MAX_TEXT} karakter).`)
    }

    if (hasMedia && payload.fileLength && payload.fileLength > MAX_MEDIA_BYTES) {
      return ctx.reply(
        `⚠️ Media kegedean (${(payload.fileLength / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
      )
    }

    await ctx.react('⏳')

    try {
      let insideMessage

      if (hasMedia) {
        const mediaBuffer = await downloadTargetBuffer(mediaSource)
        if (mediaBuffer.length > MAX_MEDIA_BYTES) {
          await ctx.react('❎')
          return ctx.reply(
            `⚠️ Media kegedean (${(mediaBuffer.length / 1024 / 1024).toFixed(1)} MB, maks ${MAX_MEDIA_BYTES / 1024 / 1024} MB).`
          )
        }
        insideMessage = await buildGroupStatusMediaInner(ctx.client, payload, mediaBuffer, text)
      } else {
        const tpl = opts.tpl ? TEMPLATES[opts.tpl.toLowerCase()] : null
        if (opts.tpl && !tpl) {
          await ctx.react('❎')
          return ctx.reply(`⚠️ Template *${opts.tpl}* gak ada. Cek *.swgc list*.`)
        }
        const base = tpl ?? DEFAULT_STYLE

        const bg = opts.bg ? toArgb(opts.bg) : toArgb(base.bg)
        const fg = opts.color ? toArgb(opts.color) : toArgb(base.text)
        if (opts.bg && bg === null) {
          await ctx.react('❎')
          return ctx.reply(`⚠️ Warna latar *${opts.bg}* gak valid. Cek *.swgc list*.`)
        }
        if (opts.color && fg === null) {
          await ctx.react('❎')
          return ctx.reply(`⚠️ Warna teks *${opts.color}* gak valid. Cek *.swgc list*.`)
        }

        const fontKey = (opts.font ?? base.font).toLowerCase()
        const font = FONTS[fontKey]
        if (!font) {
          await ctx.react('❎')
          return ctx.reply(`⚠️ Font *${fontKey}* gak ada. Cek *.swgc list*.`)
        }

        insideMessage = {
          extendedTextMessage: {
            text,
            backgroundArgb: bg,
            textArgb: fg,
            font: font.id,
            contextInfo: { isGroupStatus: true }
          }
        }
      }

      const groupStatusProto = {
        groupStatusMessageV2: {
          message: insideMessage
        }
      }

      await ctx.client.message.send(groupJid, groupStatusProto, {
        disableGroupEphemeralAutoInject: true
      })

      await ctx.react('✅')
      const rawEvent = getEvent(ctx)
      const label = hasMedia ? `${payload.mediaType}${text ? ` • "${text.slice(0, 60)}"` : ''}` : 'teks'
      return ctx.client.message.send(
        ctx.chat,
        `✅ Berhasil membuat status grup (${label})!`,
        rawEvent ? { quote: rawEvent } : {}
      )
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal posting status grup: ' + String(e?.message || e).slice(0, 220))
    }
  }
}
