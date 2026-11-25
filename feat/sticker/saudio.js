/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * saudio.js — Sticker Audio (gabungin stiker/gambar + audio/VN)
 */

import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import * as Zapo from 'zapo-js'
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js'
import config from '../../config.js'
import { getEvent, getContextInfo, streamToBuffer } from '../../lib/media.js'
import { imageToSticker, gifToSticker } from '../../lib/sticker.js'

const SESSION_TTL = 5 * 60 * 1000
const SESSION_CAP = 50
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
  `\`${prefix}saudio reset\` → batalin sesi tersimpan`

async function extractMedia(message) {
  if (!message) return null
  try {
    const payload = resolveMediaPayload(message)
    if (!payload) return null
    const mime = String(payload.mimetype || '')
    const mType = String(payload.mediaType || '')
    const isAudio = mType === 'audio' || mime.startsWith('audio/')
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

function runFFmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
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
    p.stdin.on('error', () => {})
    p.stdin.end(input)
  })
}

async function toOpus(input) {
  if (input.length >= 4 && input.subarray(0, 4).toString('ascii') === 'OggS') {
    return { buf: input, mimetype: 'audio/ogg; codecs=opus' }
  }
  const buf = await runFFmpeg(
    [
      '-v', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-map_metadata', '-1',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      '-f', 'ogg',
      'pipe:1'
    ],
    input
  )
  return { buf, mimetype: 'audio/ogg; codecs=opus' }
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
    return {
      width: 1 + b.readUIntLE(24, 3),
      height: 1 + b.readUIntLE(27, 3),
      isAnimated: (b[20] & 2) !== 0
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
      ctx.client.message.upload(stickerBuf, { type: 'sticker', mimetype: 'image/webp' })
    ])

    const aKey = toBufStrict(a.mediaKey)
    const sKey = toBufStrict(s.mediaKey)

    const audioBytes = Buffer.concat([
      Buffer.from(
        MessageProto.AudioMessage.encode({
          url: a.url,
          mimetype: opus.mimetype,
          fileSha256: toBufStrict(a.fileSha256),
          fileEncSha256: toBufStrict(a.fileEncSha256),
          fileLength: a.fileLength ?? opus.buf.length,
          mediaKey: aKey,
          directPath: a.directPath,
          mediaKeyTimestamp: a.mediaKeyTimestamp || Math.floor(Date.now() / 1000)
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
    if (/ffmpeg|ENOENT/i.test(String(e?.message || e))) {
      return ctx.reply(
        '🎬 `ffmpeg` belum terpasang di server untuk mengonversi audio non-OGG. Install `ffmpeg` terlebih dahulu atau kirim Voice Note (`.ogg`).'
      )
    }
    return ctx.reply('❌ Gagal bikin Sticker Audio:\n' + String(e?.message || e).slice(0, 300))
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
