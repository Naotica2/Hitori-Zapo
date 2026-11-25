/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * faceswap.js — Face Swap AI
 */
import { getEvent, getContextInfo, tryDownloadImageBuffer, downloadUrlBuffer } from '../../lib/media.js'
import { faceSwap } from '../../scraper/FACESWAP.js'

const MAX_BUF = 10 * 1024 * 1024
const SESSION_TTL = 5 * 60 * 1000
const SESSION_CAP = 10
const MEM = (globalThis.HITORI_FACESWAP_MEM ??= new Map())

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

function getSession(sender) {
  const s = MEM.get(sender)
  if (!s) return null
  if (Date.now() - s.ts > SESSION_TTL) {
    MEM.delete(sender)
    return null
  }
  return s
}

function setSession(sender, buf) {
  if (MEM.size >= SESSION_CAP) {
    const oldest = MEM.keys().next().value
    MEM.delete(oldest)
  }
  MEM.set(sender, { buf, ts: Date.now() })
}

async function processSwap(ctx, target, swap) {
  await ctx.react('⏳')

  let resultUrl
  try {
    const res = await faceSwap({ target, swap })
    resultUrl = res.resultUrl
  } catch (e) {
    console.log('[FaceSwap] engine error:', String(e.message || e).slice(0, 300))
    await ctx.react('❎')
    return ctx.reply('❌ Gagal proses Face Swap. Coba lagi dengan foto wajah yang jelas (close-up, tidak tertutup).')
  }

  try {
    const buf = await downloadUrlBuffer(resultUrl, { timeout: 60_000, maxBytes: MAX_BUF })

    await ctx.client.message.send(ctx.chat, {
      type: 'image',
      media: buf,
      mimetype: detectMime(buf),
      caption: 'Ini dia hasil Face Swap-nya, Kak!'
    })
    await ctx.react('✅')
  } catch (e) {
    console.log('[FaceSwap] send error:', String(e.message || e).slice(0, 200))
    await ctx.react('❎')
    return ctx.reply('❌ Gagal kirim hasil Face Swap.')
  }
}

const HELP =
  '🎭 *FACE SWAP — AI*\n\n' +
  '*Mode 2 langkah:*\n' +
  '1) Reply/kirim foto + `.faceswap` → foto 1 tersimpan\n' +
  '2) Kirim/reply foto kedua + `.faceswap` → hasil!\n\n' +
  '*Mode sekali tembak:*\n' +
  '• Reply foto + kirim foto caption `.faceswap`\n' +
  '• Reply foto + `.faceswap <url>`\n' +
  '• Kirim foto caption `.faceswap <url>`\n' +
  '• `.faceswap <url1> <url2>`\n\n' +
  '`.faceswap reset` → buang foto 1 tersimpan\n' +
  'Tips: foto wajah close-up & tidak tertutup biar hasil maksimal.'

export default {
  name: 'faceswap',
  aliases: ['swap', 'fs'],
  tags: 'ai',
  description: 'Face Swap AI — tukar wajah dua foto (mode sesi & one-shot)',

  async run(ctx) {
    const text = (ctx.text || '').trim()
    const firstWord = (text.split(/\s+/)[0] || '').toLowerCase()

    if (/^(reset|del|hapus|cancel|batal)$/.test(firstWord)) {
      MEM.delete(ctx.sender)
      return ctx.reply('🗑️ Session Face Swap dibuang.')
    }

    const urls = (text.match(/https?:\/\/[^\s]+/gi) || []).slice(0, 2)

    const event = getEvent(ctx)
    const rawMessage = event?.message ?? event
    const ctxInfo = getContextInfo(rawMessage)
    const quoted = ctxInfo?.quotedMessage ?? null

    const quotedBuf = await tryDownloadImageBuffer(quoted)
    const attachedBuf = await tryDownloadImageBuffer(rawMessage)

    const sourcesNow = []
    if (quotedBuf) sourcesNow.push(quotedBuf)
    if (attachedBuf) sourcesNow.push(attachedBuf)
    for (const u of urls) sourcesNow.push(u)

    if (sourcesNow.length >= 2) {
      MEM.delete(ctx.sender)
      return processSwap(ctx, sourcesNow[0], sourcesNow[1])
    }

    if (sourcesNow.length === 1) {
      const saved = getSession(ctx.sender)
      if (saved) {
        MEM.delete(ctx.sender)
        return processSwap(ctx, saved.buf, sourcesNow[0])
      }
      setSession(ctx.sender, sourcesNow[0])
      return ctx.reply(
        '✅ Foto pertama sukses terupload.\n' +
        'Silahkan upload foto kedua untuk memulai proses Face Swap.\n\n' +
        'Kirim foto kedua caption `.faceswap` (atau reply foto kedua dengan `.faceswap`).\n' +
        '⏳ Foto pertama berlaku 5 menit • `.faceswap reset` buat batal.'
      )
    }

    const saved = getSession(ctx.sender)
    if (saved) {
      return ctx.reply(
        '⏳ Foto pertama kamu masih tersimpan.\n' +
        'Kirim foto kedua caption `.faceswap` untuk mulai proses.\n' +
        '`.faceswap reset` buat buang foto pertama.'
      )
    }
    return ctx.reply(HELP)
  }
}
