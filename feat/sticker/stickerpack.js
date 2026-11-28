/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * stickerpack.js — Buat & kirim 1 bubble Sticker Pack native WhatsApp (termasuk ekstrak visual .saudio, Pinterest, & Brat)
 */
import sharp from 'sharp'
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js'
import { proto } from 'zapo-js/proto'
import config from '../../config.js'
import {
  downloadTargetBuffer,
  downloadUrlBuffer,
  getEvent,
  getQuotedMessage,
  streamToBuffer
} from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import {
  MAX_STICKER_BYTES,
  applyStickerExif,
  gifToSticker,
  imageToSticker,
  videoToSticker
} from '../../lib/sticker.js'
import { pinSearch } from '../../scraper/PINSEARCH.js'

const PACK_TTL_MS = 15 * 60 * 1000
const MAX_PACK_STICKERS = 30
const PACK_SESSIONS = (globalThis.HITORI_STICKERPACK_MEM ??= new Map())

function getSessionKey(ctx) {
  return `${ctx.chat}::${ctx.senderNumber || ctx.sender}`
}

function getPackCart(ctx) {
  const key = getSessionKey(ctx)
  const item = PACK_SESSIONS.get(key)
  if (!item) return null
  if (Date.now() - item.updatedAt > PACK_TTL_MS) {
    PACK_SESSIONS.delete(key)
    return null
  }
  return item
}

function savePackCart(ctx, cart) {
  const key = getSessionKey(ctx)
  if (PACK_SESSIONS.size >= 80 && !PACK_SESSIONS.has(key)) {
    const oldest = PACK_SESSIONS.keys().next().value
    if (oldest) PACK_SESSIONS.delete(oldest)
  }
  cart.updatedAt = Date.now()
  PACK_SESSIONS.set(key, cart)
}

function readVarint(buf, offset) {
  let val = 0n
  let shift = 0n
  let pos = offset
  while (pos < buf.length) {
    const b = buf[pos++]
    val |= BigInt(b & 0x7f) << shift
    if ((b & 0x80) === 0) {
      return { value: Number(val), nextOffset: pos }
    }
    shift += 7n
    if (shift > 56n) break
  }
  return null
}

function extractLengthDelimitedField(buf, targetFieldNum) {
  let pos = 0
  while (pos < buf.length) {
    const tagRes = readVarint(buf, pos)
    if (!tagRes) break
    const tag = tagRes.value
    const fieldNum = tag >>> 3
    const wireType = tag & 0x07
    pos = tagRes.nextOffset

    if (wireType === 0) {
      const v = readVarint(buf, pos)
      if (!v) break
      pos = v.nextOffset
    } else if (wireType === 1) {
      pos += 8
    } else if (wireType === 2) {
      const lenRes = readVarint(buf, pos)
      if (!lenRes) break
      const end = lenRes.nextOffset + lenRes.value
      if (end > buf.length) break
      if (fieldNum === targetFieldNum) {
        return buf.subarray(lenRes.nextOffset, end)
      }
      pos = end
    } else if (wireType === 5) {
      pos += 4
    } else {
      break
    }
  }
  return null
}

function findStickerMessagePrefixLength(buf) {
  // StickerBase dimulai oleh field StickerMessage (tag 1..15/19), diikuti tag 17 (extra domain) atau tag 26 (embedded audio).
  let pos = 0
  let lastValidEnd = buf.length
  while (pos < buf.length) {
    const fieldStart = pos
    const tagRes = readVarint(buf, pos)
    if (!tagRes) break
    const fieldNum = tagRes.value >>> 3
    const wireType = tagRes.value & 0x07
    pos = tagRes.nextOffset

    if (fieldNum === 26 || fieldNum === 17) {
      lastValidEnd = fieldStart
      break
    }

    if (wireType === 0) {
      const v = readVarint(buf, pos)
      if (!v) break
      pos = v.nextOffset
    } else if (wireType === 1) {
      pos += 8
    } else if (wireType === 2) {
      const lenRes = readVarint(buf, pos)
      if (!lenRes) break
      const end = lenRes.nextOffset + lenRes.value
      if (end > buf.length) break
      pos = end
    } else if (wireType === 5) {
      pos += 4
    } else {
      break
    }
    lastValidEnd = pos
  }
  return lastValidEnd
}

/**
 * Ekstrak visual WebP dari pesan normal (image/sticker/video/gif) maupun pesan `.saudio` (field 134 unknown).
 */
export function extractSaudioStickerProto(message) {
  if (!message || typeof message !== 'object') return null
  const unknowns = Array.isArray(message.$unknowns) ? message.$unknowns : []
  for (const rawChunk of unknowns) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk || [])
    if (!chunk.length) continue
    const f134 = extractLengthDelimitedField(chunk, 134) || (chunk[0] === 0x0a ? chunk : null)
    if (!f134) continue
    const f1 = extractLengthDelimitedField(f134, 1) || f134
    const f26 = extractLengthDelimitedField(f1, 26)
    if (!f26?.length) continue
    const stickerSliceLen = findStickerMessagePrefixLength(f26)
    if (stickerSliceLen <= 0) continue
    try {
      const decoded = proto.Message.StickerMessage.decode(f26.subarray(0, stickerSliceLen))
      if (decoded?.directPath && decoded?.mediaKey) return decoded
    } catch {}
  }
  return null
}

async function resolveStickerItemFromMessage(message, { packName, author }) {
  if (!message) return null
  const payload = resolveMediaPayload(message)
  let rawBuf = null
  let kind = null
  let mime = ''
  let fromSaudio = false

  if (payload) {
    mime = String(payload.mimetype || '')
    kind = String(payload.mediaType || '')
    const supported = ['sticker', 'image', 'video', 'gif', 'ptv']
    if (!supported.includes(kind)) {
      throw new Error(`Tipe media "${kind}" tidak bisa dimasukkan ke Sticker Pack.`)
    }
    rawBuf = await downloadTargetBuffer(message)
  } else {
    const saudioSticker = extractSaudioStickerProto(message)
    if (!saudioSticker) return null
    fromSaudio = true
    kind = 'sticker'
    mime = saudioSticker.mimetype || 'image/webp'
    const stream = await downloadMediaMessage({ stickerMessage: saudioSticker })
    rawBuf = await streamToBuffer(stream)
  }

  if (!rawBuf?.length) throw new Error('Media kosong saat diunduh.')

  let webpBuf
  if (kind === 'sticker' && rawBuf.toString('ascii', 0, 4) === 'RIFF') {
    webpBuf = rawBuf
  } else if (kind === 'video' || kind === 'ptv' || mime.startsWith('video/')) {
    webpBuf = await videoToSticker(rawBuf, 8)
  } else if (kind === 'gif' || /gif/i.test(mime)) {
    webpBuf = await gifToSticker(rawBuf)
  } else {
    webpBuf = await imageToSticker(rawBuf)
  }

  if (webpBuf.length > MAX_STICKER_BYTES) {
    throw new Error(`Ukuran stiker melebihi batas WhatsApp (${(webpBuf.length / 1024).toFixed(0)} KB).`)
  }

  webpBuf = applyStickerExif(webpBuf, { packName, author })
  let isAnimated = false
  try {
    const meta = await sharp(webpBuf, { animated: true }).metadata()
    isAnimated = (meta?.pages || 1) > 1
  } catch {
    isAnimated = Boolean(kind === 'video' || kind === 'ptv' || kind === 'gif')
  }

  return { buffer: webpBuf, isAnimated, fromSaudio }
}

async function buildAndSendPack(ctx, { stickers, packName, publisher, description = '' }, sendOpts) {
  if (!stickers.length) throw new Error('Minimal butuh 1 stiker untuk membuat Sticker Pack.')

  const firstBuf = stickers[0].buffer
  const [trayIconBuf, coverBuf] = await Promise.all([
    sharp(firstBuf, { pages: 1 })
      .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
    sharp(firstBuf, { pages: 1 })
      .flatten({ background: '#111111' })
      .resize(252, 252, { fit: 'contain', background: '#111111' })
      .jpeg({ quality: 88 })
      .toBuffer()
  ])

  const stickerEntries = stickers.map((item, idx) => ({
    media: item.buffer,
    fileName: `${String(idx + 1).padStart(2, '0')}.webp`,
    emojis: ['✨'],
    isAnimated: Boolean(item.isAnimated),
    mimetype: 'image/webp'
  }))

  await ctx.client.message.send(
    ctx.chat,
    {
      type: 'sticker-pack',
      stickerPackId: `hitori-pack-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: packName.slice(0, 64),
      publisher: publisher.slice(0, 64),
      ...(description ? { packDescription: description.slice(0, 128) } : {}),
      stickers: stickerEntries,
      trayIcon: {
        media: trayIconBuf,
        fileName: 'tray.png'
      },
      coverThumbnail: coverBuf,
      thumbnailWidth: 252,
      thumbnailHeight: 252
    },
    sendOpts
  )
}

export default {
  name: 'stickerpack',
  aliases: ['spack', 'pack', 'stikerpack'],
  tags: 'sticker',
  cooldown: 5000,
  description: 'Buat 1 bubble Sticker Pack native WhatsApp dari stiker/foto/video/Pinterest/Brat',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const defaultName = config.sticker?.packName || `${config.botName} Pack`
    const defaultAuthor = config.sticker?.author || config.botName || 'Hitori-MD'

    const raw = String(ctx.text || '').trim()
    const sub = String(ctx.args[0] || '').toLowerCase()
    const rest = raw.slice((ctx.args[0] || '').length).trim()

    if (/^(help|\?)$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '📦 *STICKER PACK NATIVE WHATSAPP*\n\n' +
          '*1. Mode Kumpul (Multi-Stiker 1–30 item):*\n' +
          `• Reply stiker/foto/video/GIF dengan *${p}spack add*\n` +
          `• *${p}spack list* — lihat isi keranjang\n` +
          `• *${p}spack del <no>* / *${p}spack reset*\n` +
          `• *${p}spack send [Nama Pack | Author]* — kirim jadi 1 bubble pack!\n\n` +
          '*2. Mode Instan 1 Perintah:*\n' +
          `• *${p}spack pin <query> [| Nama Pack]* — bikin pack otomatis dari Pinterest\n` +
          `• *${p}spack brat teks 1 | teks 2 | teks 3* — bikin pack stiker Brat\n` +
          `• Reply media langsung dengan *${p}spack Nama | Author*\n\n` +
          '_Catatan .saudio: Format Sticker Pack ZIP WhatsApp hanya menyimpan file WebP tanpa audio track, namun jika kamu me-reply pesan .saudio, bot otomatis mengekstrak stiker visualnya ke dalam pack!_',
        sendOpts
      )
    }

    if (sub === 'reset' || sub === 'clear' || sub === 'batal') {
      PACK_SESSIONS.delete(getSessionKey(ctx))
      return ctx.client.message.send(ctx.chat, '🗑️ Keranjang Sticker Pack dikosongkan.', sendOpts)
    }

    if (sub === 'list' || sub === 'cek') {
      const cart = getPackCart(ctx)
      if (!cart?.stickers?.length) {
        return ctx.client.message.send(
          ctx.chat,
          `📭 Keranjang Sticker Pack kosong. Reply stiker/gambar/video dengan *${p}spack add* untuk mulai mengumpulkan.`,
          sendOpts
        )
      }
      const list = cart.stickers
        .map((s, i) => `• #${i + 1} — ${s.isAnimated ? '🎬 Animasi' : '🖼️ Statis'} (${(s.buffer.length / 1024).toFixed(0)} KB)`)
        .join('\n')
      return ctx.client.message.send(
        ctx.chat,
        `📦 *KERANJANG STICKER PACK (${cart.stickers.length}/${MAX_PACK_STICKERS})*\n\n${list}\n\nKetik *${p}spack send [Nama | Author]* untuk mengirim!`,
        sendOpts
      )
    }

    if (sub === 'del' || sub === 'hapus' || sub === 'rm') {
      const cart = getPackCart(ctx)
      const idx = Number.parseInt(ctx.args[1], 10) - 1
      if (!cart?.stickers?.length) {
        return ctx.client.message.send(ctx.chat, '📭 Keranjang kosong.', sendOpts)
      }
      if (!Number.isInteger(idx) || idx < 0 || idx >= cart.stickers.length) {
        return ctx.client.message.send(ctx.chat, `❌ Nomor stiker tidak valid (1..${cart.stickers.length}).`, sendOpts)
      }
      cart.stickers.splice(idx, 1)
      savePackCart(ctx, cart)
      return ctx.client.message.send(
        ctx.chat,
        `✅ Stiker #${idx + 1} dihapus. Sisa *${cart.stickers.length}* stiker.`,
        sendOpts
      )
    }

    // Mode Instan: Pinterest -> Sticker Pack
    if (sub === 'pin' || sub === 'pinterest') {
      const [qPart, customPack] = rest.split('|').map((s) => s.trim())
      if (!qPart) {
        return ctx.client.message.send(ctx.chat, `Contoh: *${p}spack pin bocchi the rock meme | Bocchi Pack*`, sendOpts)
      }
      await ctx.react('⏳')
      try {
        const res = await pinSearch(qPart, 8)
        if (!res?.status || !res?.data?.images?.length) {
          throw new Error(res?.error || 'Tidak ada gambar ditemukan di Pinterest.')
        }
        const packName = customPack || `Pin: ${qPart}`.slice(0, 48)
        const stickers = []
        for (const url of res.data.images.slice(0, 6)) {
          try {
            await assertSafePublicUrl(url)
            const imgBuf = await downloadUrlBuffer(url, { timeout: 15_000, maxBytes: 5 * 1024 * 1024 })
            let webp = await imageToSticker(imgBuf)
            webp = applyStickerExif(webp, { packName, author: defaultAuthor })
            stickers.push({ buffer: webp, isAnimated: false })
          } catch {}
        }
        if (!stickers.length) throw new Error('Semua gambar Pinterest gagal dikonversi.')
        await buildAndSendPack(ctx, {
          stickers,
          packName,
          publisher: defaultAuthor,
          description: `Generated by ${config.botName}`
        }, sendOpts)
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ Gagal bikin pack Pinterest: ${String(err?.message || err).slice(0, 220)}`, sendOpts)
      }
      return
    }

    // Mode Instan: Brat -> Sticker Pack
    if (sub === 'brat') {
      const items = rest
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 12)
      if (!items.length) {
        return ctx.client.message.send(ctx.chat, `Contoh: *${p}spack brat halo guys | apa kabar | wkwk*`, sendOpts)
      }
      await ctx.react('⏳')
      try {
        const { generateBratSticker } = await import('../../lib/bratGenerator.js')
        const packName = `${config.botName} Brat Pack`
        const stickers = []
        for (const textItem of items) {
          const webp = await generateBratSticker({
            text: textItem,
            packName,
            packAuthor: defaultAuthor
          })
          stickers.push({ buffer: webp, isAnimated: false })
        }
        await buildAndSendPack(ctx, {
          stickers,
          packName,
          publisher: defaultAuthor
        }, sendOpts)
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ Gagal bikin pack Brat: ${String(err?.message || err).slice(0, 220)}`, sendOpts)
      }
      return
    }

    // Mode Kirim keranjang (send / build / done)
    if (['send', 'build', 'done', 'kirim'].includes(sub)) {
      const cart = getPackCart(ctx)
      if (!cart?.stickers?.length) {
        return ctx.client.message.send(
          ctx.chat,
          `📭 Keranjang masih kosong. Reply stiker/foto/video dengan *${p}spack add* dulu!`,
          sendOpts
        )
      }
      const [packPart, authorPart] = rest.split('|').map((s) => s.trim())
      const packName = packPart || defaultName
      const publisher = authorPart || defaultAuthor

      await ctx.react('⏳')
      try {
        await buildAndSendPack(ctx, { stickers: cart.stickers, packName, publisher }, sendOpts)
        PACK_SESSIONS.delete(getSessionKey(ctx))
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ Gagal mengirim Sticker Pack: ${String(err?.message || err).slice(0, 220)}`, sendOpts)
      }
      return
    }

    // Cek media di pesan ini atau quoted
    const quoted = getQuotedMessage(ctx)
    const selfMsg = rawEvent?.message ?? null
    const mediaTarget = quoted || selfMsg

    if (sub === 'add' || sub === 'tambah') {
      await ctx.react('⏳')
      try {
        const item = await resolveStickerItemFromMessage(mediaTarget, { packName: defaultName, author: defaultAuthor })
        if (!item) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `❌ Reply stiker, gambar, video, GIF, atau pesan .saudio lalu ketik *${p}spack add*.`, sendOpts)
        }
        const cart = getPackCart(ctx) || { stickers: [] }
        if (cart.stickers.length >= MAX_PACK_STICKERS) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `⚠️ Keranjang penuh (${MAX_PACK_STICKERS}/${MAX_PACK_STICKERS}). Kirim dulu via *${p}spack send*.`, sendOpts)
        }
        cart.stickers.push({ buffer: item.buffer, isAnimated: item.isAnimated })
        savePackCart(ctx, cart)
        await ctx.react('✅')
        const saudioNote = item.fromSaudio
          ? '\n_(Info: stiker visual dari .saudio diekstrak; suara tidak ikut karena batas format ZIP Sticker Pack WA)_'
          : ''
        return ctx.client.message.send(
          ctx.chat,
          `✅ Ditambahkan ke keranjang! Total: *${cart.stickers.length}/${MAX_PACK_STICKERS}* stiker.${saudioNote}\n\nTambah lagi atau ketik *${p}spack send [Nama | Author]*`,
          sendOpts
        )
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
      }
    }

    // Default: kalau ada keranjang dan tanpa teks/media baru -> kirim; kalau ada media langsung -> pack instan!
    const existingCart = getPackCart(ctx)
    let singleItem = null
    try {
      singleItem = await resolveStickerItemFromMessage(mediaTarget, { packName: defaultName, author: defaultAuthor })
    } catch (err) {
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }

    if (singleItem) {
      const [packPart, authorPart] = raw.split('|').map((s) => s.trim())
      const packName = packPart || defaultName
      const publisher = authorPart || defaultAuthor
      const stickers = [...(existingCart?.stickers || []), { buffer: singleItem.buffer, isAnimated: singleItem.isAnimated }]

      await ctx.react('⏳')
      try {
        await buildAndSendPack(ctx, { stickers, packName, publisher }, sendOpts)
        if (existingCart) PACK_SESSIONS.delete(getSessionKey(ctx))
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ Gagal mengirim Sticker Pack: ${String(err?.message || err).slice(0, 220)}`, sendOpts)
      }
      return
    }

    if (existingCart?.stickers?.length) {
      const [packPart, authorPart] = raw.split('|').map((s) => s.trim())
      await ctx.react('⏳')
      try {
        await buildAndSendPack(ctx, {
          stickers: existingCart.stickers,
          packName: packPart || defaultName,
          publisher: authorPart || defaultAuthor
        }, sendOpts)
        PACK_SESSIONS.delete(getSessionKey(ctx))
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ Gagal mengirim Sticker Pack: ${String(err?.message || err).slice(0, 220)}`, sendOpts)
      }
      return
    }

    return ctx.client.message.send(
      ctx.chat,
      `📦 Ketik *${p}spack help* untuk panduan lengkap membuat Sticker Pack (${p}spack add / ${p}spack pin / ${p}spack brat).`,
      sendOpts
    )
  }
}
