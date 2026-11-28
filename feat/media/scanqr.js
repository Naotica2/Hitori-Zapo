/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * scanqr.js — Baca / decode QR Code & Barcode dari gambar atau stiker
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function decodeWithZbar(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.ZBARIMG_PATH || 'zbarimg',
      ['--raw', '--quiet', filePath],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 4) return resolve([]) // exit code 4 = tidak ditemukan barcode di gambar
          return reject(err)
        }
        const items = String(stdout || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
        resolve(items)
      }
    )
  })
}

async function decodeWithQrServerApi(pngBuf) {
  const form = new FormData()
  form.append('file', new Blob([pngBuf], { type: 'image/png' }), 'qr.png')
  const res = await fetch('https://api.qrserver.com/v1/read-qr-code/', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const symbols = data?.[0]?.symbol || []
  return symbols
    .map((s) => (s?.error ? null : s?.data))
    .filter((v) => typeof v === 'string' && v.trim())
}

function formatWifiPayload(text) {
  const m = text.match(/^WIFI:(.*)$/i)
  if (!m) return null
  const fields = {}
  for (const part of m[1].split(';')) {
    const idx = part.indexOf(':')
    if (idx > 0) {
      fields[part.slice(0, idx).toUpperCase()] = part.slice(idx + 1).replace(/\\([\\;,:"'])/g, '$1')
    }
  }
  if (!fields.S) return null
  return (
    '📶 *QR Wi-Fi Terdeteksi*\n' +
    `• SSID     : *${fields.S}*\n` +
    `• Keamanan : ${fields.T || 'nopass'}\n` +
    `• Password : ${fields.P || '(tanpa password)'}`
  )
}

export default {
  name: 'scanqr',
  aliases: ['readqr', 'decodeqr', 'qrread', 'barcode'],
  tags: 'media',
  cooldown: 3000,
  description: 'Baca isi QR Code atau Barcode dari foto/stiker',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const mime = String(payload?.mimetype || '')
    const isImageLike =
      payload &&
      (payload.mediaType === 'image' || payload.mediaType === 'sticker' || mime.startsWith('image/'))

    if (!targetMessage || !isImageLike) {
      return ctx.client.message.send(
        ctx.chat,
        '🔍 *SCAN QR / BARCODE*\n\n' +
          `Kirim atau reply gambar/stiker QR Code dengan *${p}scanqr*.`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hitori-qr-'))
    try {
      const rawBuf = await downloadTargetBuffer(targetMessage)
      if (rawBuf.length > MAX_IMAGE_BYTES) throw new Error('Ukuran gambar maksimal 10 MB.')

      const pngBuf = await sharp(rawBuf, { pages: 1 })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer()

      const imgPath = path.join(tmpDir, 'qr.png')
      await fs.writeFile(imgPath, pngBuf)

      let decoded = []
      try {
        decoded = await decodeWithZbar(imgPath)
      } catch {
        decoded = await decodeWithQrServerApi(pngBuf)
      }

      if (!decoded.length) {
        await ctx.react('❎')
        return ctx.client.message.send(
          ctx.chat,
          '❌ Tidak ada QR Code / Barcode yang terbaca di gambar tersebut. Pastikan gambarnya jelas dan tidak terpotong.',
          sendOpts
        )
      }

      const wifiInfo = decoded.length === 1 ? formatWifiPayload(decoded[0]) : null
      const body = wifiInfo
        ? `${wifiInfo}\n\n📄 *Raw:*\n\`${decoded[0]}\``
        : decoded.length === 1
          ? `🔍 *HASIL SCAN QR / BARCODE*\n\n${decoded[0]}`
          : `🔍 *HASIL SCAN (${decoded.length} KODE)*\n\n` +
            decoded.map((v, i) => `*${i + 1}.* ${v}`).join('\n\n')

      await ctx.client.message.send(ctx.chat, body, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal memindai QR: ${String(err?.message || err).slice(0, 220)}`,
        sendOpts
      )
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
