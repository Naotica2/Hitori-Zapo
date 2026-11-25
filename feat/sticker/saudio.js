/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * saudio.js — Sticker Audio (gabungin stiker/gambar + audio/VN)
 */

import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Zapo from 'zapo-js'
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js'
import config from '../../config.js'
import { getEvent, getContextInfo, streamToBuffer } from '../../lib/media.js'
import { imageToSticker, gifToSticker } from '../../lib/sticker.js'

const SESSION_TTL = 5 * 60 * 1000
const SESSION_CAP = 50
const MAX_SOUND_SECONDS = 10
const MEM = (globalThis.HITORI_SAUDIO_MEM ??= new Map())
const ENCODE_HOOK = (globalThis.HITORI_SAUDIO_ENCODE_HOOK ??= {
  base: null,
  pending: new Map()
})

const HELP = (prefix = config.mainPrefix) =>
  '🔊 *STICKER AUDIO*\n\n' +
  '*Mode Sekali Tembak:*\n' +
  `• Reply audio + kirim gambar/stiker caption \`${prefix}saudio\`\n` +
  `• Reply gambar/stiker + kirim audio caption \`${prefix}saudio\`\n\n` +
  '*Mode 2 Langkah:*\n' +
  `1) Kirim/reply gambar/stiker + \`${prefix}saudio\`\n` +
  `2) Kirim/reply audio + \`${prefix}saudio\`\n\n` +
  '*Aturan Sound Sticker:*\n' +
  `• Durasi audio maks *${MAX_SOUND_SECONDS} detik* (otomatis dipotong & di-encode ke OGG Opus mono 48kHz)\n\n` +
  `\`${prefix}saudio reset\` → batalin sesi tersimpan`

async function extractMedia(message) {
  if (!message) return null
  try {
    const payload = resolveMediaPayload(message)
    if (!payload) return null
    const mime = String(payload.mimetype || '')
    const mType = String(payload.mediaType || '')
    const isAudio = mType === 'audio' || mType === 'ptt' || mime.startsWith('audio/')
    const isVisual = mType === 'image' || mType === 'sticker' || mime.startsWith('image/')
    if (!isAudio && !isVisual) return null
    const stream = await downloadMediaMessage(message)
    const buf = await streamToBuffer(stream)
    if (!buf?.length) return null
    return { kind: isAudio ? 'audio' : 'visual', buf, mime }
  } catch {
    return null
  }
}

function getSessionKeys(ctx) {
  return [...new Set([ctx.senderNumber, ctx.sender, ctx.senderLid].filter(Boolean).map(String))]
}

function getSession(ctx) {
  for (const key of getSessionKeys(ctx)) {
    const s = MEM.get(key)
    if (!s) continue
    if (Date.now() - s.ts > SESSION_TTL) {
      deleteSession(ctx)
      return null
    }
    return s
  }
  return null
}

function setSession(ctx, data) {
  deleteSession(ctx)
  if (MEM.size >= SESSION_CAP) {
    const oldest = MEM.keys().next().value
    if (oldest !== undefined) MEM.delete(oldest)
  }
  const keys = getSessionKeys(ctx)
  const record = { ...data, ts: Date.now(), keys }
  for (const key of keys) MEM.set(key, record)
}

function deleteSession(ctx) {
  for (const key of getSessionKeys(ctx)) {
    const s = MEM.get(key)
    if (s?.keys) {
      for (const boundKey of s.keys) MEM.delete(boundKey)
    } else {
      MEM.delete(key)
    }
  }
}

function varint(n) {
  let v = BigInt(n)
  const out = []
  while (v > 127n) {
    out.push(Number((v & 127n) | 128n))
    v >>= 7n
  }
  out.push(Number(v))
  return Buffer.from(out)
}

function ld(field, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  return Buffer.concat([varint((field << 3) | 2), varint(buf.length), buf])
}

function toBufStrict(val) {
  if (!val) return Buffer.alloc(0)
  if (Buffer.isBuffer(val)) return val
  if (val instanceof Uint8Array) return Buffer.from(val)
  return Buffer.from(String(val), 'base64')
}

function runFFmpeg(args, input = null) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, {
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe']
    })
    const out = []
    let err = ''
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => {
      err += d
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.slice(-400) || `ffmpeg exit ${code}`))
      resolve(Buffer.concat(out))
    })
    if (input) {
      p.stdin.on('error', () => {})
      p.stdin.end(input)
    }
  })
}

/**
 * Inspects an Ogg Opus buffer without external tools so we can reject
 * non-Opus OGG containers, enforce the 10-second cap, and populate
 * AudioMessage.seconds accurately.
 */
export function parseOggOpus(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
  if (b.length < 47 || b.toString('ascii', 0, 4) !== 'OggS') {
    return { isOpus: false, channels: 0, preSkip: 0, durationSec: 0 }
  }

  let offset = 0
  let pageIndex = 0
  let isOpus = false
  let channels = 0
  let preSkip = 0
  let lastGranule = null

  while (offset + 27 <= b.length) {
    if (b.toString('ascii', offset, offset + 4) !== 'OggS') break
    const granule = b.readBigInt64LE(offset + 6)
    const segCount = b[offset + 26]
    const tableEnd = offset + 27 + segCount
    if (tableEnd > b.length) break

    let payloadLen = 0
    for (let i = 0; i < segCount; i++) payloadLen += b[offset + 27 + i]
    const payloadEnd = tableEnd + payloadLen
    if (payloadEnd > b.length) break

    if (pageIndex === 0) {
      if (payloadLen < 19 || b.toString('ascii', tableEnd, tableEnd + 8) !== 'OpusHead') {
        return { isOpus: false, channels: 0, preSkip: 0, durationSec: 0 }
      }
      isOpus = true
      channels = b[tableEnd + 9]
      preSkip = b.readUInt16LE(tableEnd + 10)
    } else if (granule >= 0n) {
      lastGranule = granule
    }

    offset = payloadEnd
    pageIndex += 1
  }

  if (!isOpus || lastGranule === null) {
    return { isOpus: false, channels, preSkip, durationSec: 0 }
  }

  const totalSamples = lastGranule > BigInt(preSkip) ? Number(lastGranule - BigInt(preSkip)) : 0
  const durationSec = Math.max(0, totalSamples / 48000)
  return { isOpus: true, channels, preSkip, durationSec }
}

function clampSoundSeconds(durationSec) {
  return Math.max(1, Math.min(MAX_SOUND_SECONDS, Math.round(durationSec)))
}

async function toOpus(input) {
  const inInfo = parseOggOpus(input)
  if (
    inInfo.isOpus &&
    inInfo.channels === 1 &&
    inInfo.durationSec > 0.05 &&
    inInfo.durationSec <= MAX_SOUND_SECONDS
  ) {
    return {
      buf: input,
      mimetype: 'audio/ogg; codecs=opus',
      seconds: clampSoundSeconds(inInfo.durationSec),
      durationSec: inInfo.durationSec
    }
  }

  const tmpIn = join(tmpdir(), `hitori-saudio-${Date.now()}-${randomBytes(4).toString('hex')}`)
  await writeFile(tmpIn, input)
  try {
    const buf = await runFFmpeg([
      '-hide_banner',
      '-v', 'error',
      '-i', tmpIn,
      '-t', String(MAX_SOUND_SECONDS),
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      '-application', 'audio',
      '-frame_duration', '20',
      '-avoid_negative_ts', 'make_zero',
      '-map_metadata', '-1',
      '-f', 'ogg',
      'pipe:1'
    ])

    const outInfo = parseOggOpus(buf)
    if (!outInfo.isOpus || outInfo.durationSec <= 0.05 || buf.length < 64) {
      throw new Error('Audio kosong atau gagal dikonversi ke OGG Opus.')
    }

    return {
      buf,
      mimetype: 'audio/ogg; codecs=opus',
      seconds: clampSoundSeconds(outInfo.durationSec),
      durationSec: outInfo.durationSec
    }
  } catch (err) {
    if (
      err?.code === 'ENOENT' &&
      inInfo.isOpus &&
      inInfo.durationSec > MAX_SOUND_SECONDS
    ) {
      throw new Error(`SOUND_TOO_LONG_NO_FFMPEG:${inInfo.durationSec.toFixed(1)}`)
    }
    throw err
  } finally {
    await unlink(tmpIn).catch(() => undefined)
  }
}

async function toWebp(input, mime = '') {
  if (
    input.length >= 30 &&
    input.toString('ascii', 0, 4) === 'RIFF' &&
    input.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return input
  }

  try {
    if (/gif/i.test(mime)) {
      return await gifToSticker(input)
    }
    return await imageToSticker(input)
  } catch {
    return runFFmpeg(
      [
        '-v', 'error',
        '-i', 'pipe:0',
        '-frames:v', '1',
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
        '-c:v', 'libwebp',
        '-f', 'webp',
        'pipe:1'
      ],
      input
    )
  }
}

export function parseWebp(b) {
  if (
    b.length < 30 ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('Invalid WebP')
  }
  const c = b.toString('ascii', 12, 16)
  if (c === 'VP8 ') {
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
      isAnimated: false
    }
  }
  if (c === 'VP8L') {
    return {
      width: 1 + (b[21] | ((b[22] & 0x3f) << 8)),
      height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)),
      isAnimated: false
    }
  }
  if (c === 'VP8X') {
    let firstFrameLength
    const isAnimated = (b[20] & 2) !== 0
    if (isAnimated) {
      let off = 30
      while (off + 8 <= b.length) {
        const tag = b.toString('ascii', off, off + 4)
        let size = b.readUInt32LE(off + 4)
        if (size % 2 !== 0) size += 1
        const nextOff = off + 8 + size
        if (nextOff <= off || nextOff > b.length) break
        if (tag === 'ANMF') {
          firstFrameLength = nextOff
          break
        }
        off = nextOff
      }
    }
    return {
      width: 1 + b.readUIntLE(24, 3),
      height: 1 + b.readUIntLE(27, 3),
      isAnimated,
      firstFrameLength
    }
  }
  throw new Error('Unsupported WebP chunk')
}

function mediaDomainInfo(keyBuf) {
  return ld(74, Buffer.concat([Buffer.from([0x08, 0x01]), ld(2, keyBuf)]))
}

function attachFutureProofHook(MessageProto, secretHex, futureProofBody, rawField134) {
  ENCODE_HOOK.pending.set(secretHex, { futureProofBody, rawField134 })
  if (ENCODE_HOOK.base) return

  ENCODE_HOOK.base = MessageProto.encode
  MessageProto.encode = function (msg, w) {
    const msgSecret = msg?.messageContextInfo?.messageSecret
    const keyHex = msgSecret ? toBufStrict(msgSecret).toString('hex') : ''
    const hook = keyHex ? ENCODE_HOOK.pending.get(keyHex) : null

    if (hook) {
      const cleanMsg = { messageContextInfo: msg.messageContextInfo }
      const out = ENCODE_HOOK.base.call(this, cleanMsg, w)
      if (out && typeof out.uint32 === 'function') {
        out.uint32((134 << 3) | 2).bytes(hook.futureProofBody)
        return out
      }
      if (out instanceof Uint8Array) {
        return Buffer.concat([Buffer.from(out), hook.rawField134])
      }
      return out
    }
    return ENCODE_HOOK.base.call(this, msg, w)
  }
}

function detachFutureProofHook(MessageProto, secretHex) {
  ENCODE_HOOK.pending.delete(secretHex)
  if (ENCODE_HOOK.pending.size === 0 && ENCODE_HOOK.base) {
    MessageProto.encode = ENCODE_HOOK.base
    ENCODE_HOOK.base = null
  }
}

async function processAudioSticker(ctx, audioBuf, visualBuf, visualMime = '') {
  await ctx.react('⏳').catch(() => {})

  try {
    const MessageProto = Zapo.proto?.Message
    if (!MessageProto?.AudioMessage || !MessageProto?.StickerMessage) {
      await ctx.react('❎').catch(() => {})
      return ctx.reply('⚠️ Encoder AudioMessage/StickerMessage tidak ditemukan di `zapo-js`.')
    }

    const [opus, stickerBuf] = await Promise.all([
      toOpus(audioBuf),
      toWebp(visualBuf, visualMime)
    ])
    const webp = parseWebp(stickerBuf)

    const [a, s] = await Promise.all([
      ctx.client.message.upload(opus.buf, { type: 'audio', mimetype: opus.mimetype }),
      ctx.client.message.upload(stickerBuf, {
        type: 'sticker',
        mimetype: 'image/webp',
        ...(webp.firstFrameLength ? { firstFrameLength: webp.firstFrameLength } : {})
      })
    ])

    const aKey = toBufStrict(a.mediaKey)
    const sKey = toBufStrict(s.mediaKey)
    const sidecarBuf = a.streamingSidecar?.length ? toBufStrict(a.streamingSidecar) : null

    const audioBytes = Buffer.concat([
      Buffer.from(
        MessageProto.AudioMessage.encode({
          url: a.url,
          mimetype: opus.mimetype,
          fileSha256: toBufStrict(a.fileSha256),
          fileEncSha256: toBufStrict(a.fileEncSha256),
          fileLength: a.fileLength ?? opus.buf.length,
          seconds: opus.seconds,
          mediaKey: aKey,
          directPath: a.directPath,
          mediaKeyTimestamp: a.mediaKeyTimestamp || Math.floor(Date.now() / 1000),
          ...(sidecarBuf ? { streamingSidecar: sidecarBuf } : {})
        }).finish()
      ),
      ld(17, mediaDomainInfo(aKey))
    ])

    const stickerBase = Buffer.concat([
      Buffer.from(
        MessageProto.StickerMessage.encode({
          url: s.url,
          fileSha256: toBufStrict(s.fileSha256),
          fileEncSha256: toBufStrict(s.fileEncSha256),
          mediaKey: sKey,
          mimetype: 'image/webp',
          height: webp.height,
          width: webp.width,
          directPath: s.directPath,
          fileLength: s.fileLength ?? stickerBuf.length,
          mediaKeyTimestamp: s.mediaKeyTimestamp || Math.floor(Date.now() / 1000),
          ...(webp.firstFrameLength ? { firstFrameLength: webp.firstFrameLength } : {}),
          ...(s.firstFrameSidecar?.length ? { firstFrameSidecar: toBufStrict(s.firstFrameSidecar) } : {}),
          isAnimated: webp.isAnimated,
          stickerSentTs: Date.now()
        }).finish()
      ),
      ld(17, Buffer.concat([mediaDomainInfo(sKey), ld(82, varint(13001))]))
    ])

    const futureProofBody = ld(1, ld(26, Buffer.concat([stickerBase, ld(26, audioBytes)])))
    const secret = randomBytes(32)
    const secretHex = secret.toString('hex')
    const rawField134 = ld(134, futureProofBody)

    const payload = {
      extendedTextMessage: { text: ' ' },
      messageContextInfo: {
        messageSecret: secret
      }
    }

    attachFutureProofHook(MessageProto, secretHex, futureProofBody, rawField134)
    try {
      await ctx.client.message.send(ctx.chat, payload, {
        additionalAttributes: { type: 'text' }
      })
    } finally {
      detachFutureProofHook(MessageProto, secretHex)
    }

    await ctx.react('✅').catch(() => {})
  } catch (e) {
    await ctx.react('❎').catch(() => {})
    const msg = String(e?.message || e)
    if (msg.startsWith('SOUND_TOO_LONG_NO_FFMPEG:')) {
      const sec = msg.split(':')[1] || '>10'
      return ctx.reply(
        `⏱️ Durasi audio/VN (${sec} detik) melebihi batas maksimal WhatsApp *${MAX_SOUND_SECONDS} detik*, dan \`ffmpeg\` belum terpasang di server untuk memotongnya otomatis.`
      )
    }
    if (/ffmpeg|ENOENT/i.test(msg)) {
      return ctx.reply(
        `🎬 \`ffmpeg\` belum terpasang di server untuk mengonversi/memotong audio ke OGG Opus (maks ${MAX_SOUND_SECONDS} detik). Install \`ffmpeg\` terlebih dahulu.`
      )
    }
    return ctx.reply('❌ Gagal bikin Sticker Audio:\n' + msg.slice(0, 300))
  }
}

export default {
  name: 'saudio',
  aliases: ['stickeraudio', 'sa'],
  tags: 'sticker',
  cooldown: 5000,
  description: 'Gabungin stiker/gambar + audio jadi Sticker Audio',

  async run(ctx) {
    const prefix = ctx.prefix || config.mainPrefix
    const raw = (ctx.text || '').trim().toLowerCase()
    if (/^(reset|del|hapus|cancel|batal)$/.test(raw)) {
      deleteSession(ctx)
      return ctx.reply('🗑️ Sesi Sticker Audio dibuang.')
    }

    const event = getEvent(ctx)
    const rawMessage = event?.message ?? event
    const quoted = getContextInfo(rawMessage)?.quotedMessage ?? null

    const [qMedia, aMedia] = await Promise.all([
      extractMedia(quoted),
      extractMedia(rawMessage)
    ])

    let audioBuf = null
    let visualBuf = null
    let visualMime = ''

    for (const item of [qMedia, aMedia]) {
      if (!item) continue
      if (item.kind === 'audio' && !audioBuf) audioBuf = item.buf
      if (item.kind === 'visual' && !visualBuf) {
        visualBuf = item.buf
        visualMime = item.mime || ''
      }
    }

    const saved = getSession(ctx) || { audioBuf: null, visualBuf: null, visualMime: '' }
    if (audioBuf) saved.audioBuf = audioBuf
    if (visualBuf) {
      saved.visualBuf = visualBuf
      saved.visualMime = visualMime
    }

    if (saved.audioBuf && saved.visualBuf) {
      deleteSession(ctx)
      return processAudioSticker(ctx, saved.audioBuf, saved.visualBuf, saved.visualMime)
    }

    if (saved.audioBuf || saved.visualBuf) {
      setSession(ctx, saved)
      if (saved.audioBuf) {
        return ctx.reply(
          `✅ Audio tersimpan. Sekarang kirim/reply *gambar atau stiker* dengan \`${prefix}saudio\`.\n⏳ Sesi berlaku 5 menit.`
        )
      }
      return ctx.reply(
        `✅ Gambar/stiker tersimpan. Sekarang kirim/reply *audio/VN* dengan \`${prefix}saudio\`.\n⏳ Sesi berlaku 5 menit.`
      )
    }

    return ctx.reply(HELP(prefix))
  }
}
