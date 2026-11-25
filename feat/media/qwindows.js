/**
 * Quote-windows
 * Creator: JavraaSaturn
 * Base: JavraTools
 * Saluran: https://whatsapp.com/channel/0029VbDYdp55fM5hFodFIX1a
 * Note: boleh kalian modifikasi tapi jangan klaim buatan kalian 100% dan jangan hilangin creator dan channel wa ya wok.
 */

import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { extractTextFromMessage, getQuotedMessage } from '../../lib/media.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const CACHE_DIR = path.join(ROOT, 'cache', 'qwindows')
const LEGACY_ASSETS_DIR = path.join(ROOT, 'assets', 'qwindows')
const LEGACY_DATA_DIR = path.join(ROOT, 'data', 'qwindows')
const FALLBACK_FONT = path.join(ROOT, 'assets', 'fonts', 'LiberationSans-Bold.ttf')

const TEMPLATE_URL = process.env.QW_TEMPLATE_URL || 'https://files.catbox.moe/7otzp2.jpg'
const TEMPLATE_W = 1123
const TEMPLATE_H = 1401

// Ukuran & posisi teks dari gambar asli (1123x1401)
const BASE = { size: 148, inkW: 451, baseline: 715, cx: 351, color: 'rgb(28,29,33)' }
const BOX = { maxW: 500, top: 390, bottom: 1010 }
const MIN_SIZE = 34
const MAX_LINES = 6

const MAX_CHARS = Math.max(10, Number(process.env.QWINDOWS_MAX) || 120)
const COOLDOWN_MS = Math.max(
  0,
  (process.env.QWINDOWS_COOLDOWN === undefined ? 5 : Number(process.env.QWINDOWS_COOLDOWN) || 0) * 1000
)

const INTER_URLS = [
  'https://cdn.jsdelivr.net/gh/rsms/inter@v3.19/docs/font-files/Inter-Bold.otf',
  'https://raw.githubusercontent.com/rsms/inter/v3.19/docs/font-files/Inter-Bold.otf',
  'https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-Bold.otf'
]

const busyUsers = new Set()

const isFontBuf = (buf) =>
  buf &&
  buf.length > 20_000 &&
  ['\x00\x01\x00\x00', 'OTTO', 'true'].includes(buf.toString('latin1', 0, 4))

function findExistingFont() {
  const candidates = [
    path.join(CACHE_DIR, 'Inter-Bold.otf'),
    path.join(CACHE_DIR, 'Inter-Bold.ttf'),
    path.join(LEGACY_ASSETS_DIR, 'Inter-Bold.otf'),
    path.join(LEGACY_ASSETS_DIR, 'Inter-Bold.ttf')
  ]
  return candidates.find((p) => fs.existsSync(p))
}

let fallbackRegistered = false
let interRegistered = false
let interFailAt = 0

async function ensureFont() {
  const register = (filePath, alias) => {
    try {
      return (
        fs.existsSync(filePath) &&
        (Boolean(GlobalFonts.registerFromPath(filePath, alias)) || GlobalFonts.has(alias))
      )
    } catch {
      return false
    }
  }

  if (!fallbackRegistered) {
    fallbackRegistered = true
    register(FALLBACK_FONT, 'QWFallback')
  }
  if (interRegistered) return

  let fontPath = findExistingFont()
  if (!fontPath && Date.now() - interFailAt > 10 * 60 * 1000) {
    interFailAt = Date.now()
    for (const url of INTER_URLS) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(25_000)
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (!isFontBuf(buf)) throw new Error('bukan file font')

        fs.mkdirSync(CACHE_DIR, { recursive: true })
        const dest = path.join(CACHE_DIR, 'Inter-Bold.otf')
        fs.writeFileSync(`${dest}.tmp`, buf)
        fs.renameSync(`${dest}.tmp`, dest)
        fontPath = dest
        break
      } catch (err) {
        logger.warn({ err: err.message, host: url.split('/')[2] }, '[qwindows] gagal unduh Inter-Bold')
      }
    }
  }

  if (fontPath && register(fontPath, 'QWInter')) {
    interRegistered = true
  }
}

function imgKind(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.length > 12 && buf.toString('latin1', 1, 4) === 'PNG') return 'png'
  if (
    buf.length > 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

function findCachedTemplate() {
  const candidates = [
    ...['jpg', 'png', 'webp'].map((ext) => path.join(CACHE_DIR, `template.${ext}`)),
    ...['jpg', 'png', 'webp'].map((ext) => path.join(LEGACY_DATA_DIR, `template.${ext}`)),
    path.join(LEGACY_ASSETS_DIR, 'template.png')
  ]
  return candidates.find((p) => fs.existsSync(p))
}

let tplInflight = null
let tplFailAt = 0

function downloadCatboxTemplate(url) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return reject(new Error('URL template tidak valid'))
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'files.catbox.moe') {
      return reject(new Error('URL template harus https://files.catbox.moe/...'))
    }

    const req = https.get(parsed, { timeout: 25_000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`Catbox HTTP ${res.statusCode}`))
      }
      const chunks = []
      let total = 0
      res.on('data', (chunk) => {
        total += chunk.length
        if (total > 8 * 1024 * 1024) {
          res.destroy()
          reject(new Error('template > 8 MB'))
        } else {
          chunks.push(chunk)
        }
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })

    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Catbox timeout')))
  })
}

async function getTemplateBuffer() {
  const cached = findCachedTemplate()
  if (cached) return fs.readFileSync(cached)

  if (!tplInflight && Date.now() - tplFailAt > 60 * 1000) {
    tplInflight = (async () => {
      const buf = await downloadCatboxTemplate(TEMPLATE_URL)
      const ext = imgKind(buf)
      if (!ext) throw new Error('isi template bukan gambar')

      fs.mkdirSync(CACHE_DIR, { recursive: true })
      const dest = path.join(CACHE_DIR, `template.${ext}`)
      fs.writeFileSync(`${dest}.tmp`, buf)
      fs.renameSync(`${dest}.tmp`, dest)
      logger.info(`[qwindows] template disimpan ke ${dest}`)
      return buf
    })()
      .catch((err) => {
        tplFailAt = Date.now()
        throw err
      })
      .finally(() => {
        tplInflight = null
      })
  }

  if (tplInflight) {
    try {
      return await tplInflight
    } catch (err) {
      throw new Error(`Template belum bisa diambil dari Catbox (${err.message}). Coba lagi sebentar.`)
    }
  }

  throw new Error('Template belum tersedia (Catbox baru saja gagal). Coba lagi sebentar.')
}

const fontStr = (px) => `${px}px "QWInter", "QWFallback", sans-serif`

/** Lebar tinta aktual (ink width) agar sesuai kalibrasi template asli. */
function measureInkWidth(c, text) {
  const m = c.measureText(text)
  const l = m.actualBoundingBoxLeft
  const r = m.actualBoundingBoxRight
  return Number.isFinite(l) && Number.isFinite(r) && l + r > 0 ? l + r : m.width
}

function wrapText(c, text, maxW) {
  const out = []
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (measureInkWidth(c, test) <= maxW) {
        line = test
        continue
      }
      if (line) {
        out.push(line)
        line = ''
      }
      if (measureInkWidth(c, word) <= maxW) {
        line = word
        continue
      }
      let part = ''
      for (const ch of Array.from(word)) {
        if (part && measureInkWidth(c, part + ch) > maxW) {
          out.push(part)
          part = ch
        } else {
          part += ch
        }
      }
      line = part
    }
    if (line) out.push(line)
  }
  return out
}

function computeLayout(c, text, baseSize) {
  const paras = String(text).split('\n')
  for (let size = baseSize; size >= Math.round(baseSize * 0.5); size -= 2) {
    c.font = fontStr(size)
    if (paras.every((p) => measureInkWidth(c, p.trim()) <= BOX.maxW)) {
      const lh = Math.round(size * 1.16)
      const n = paras.length
      const firstTop = BASE.baseline - ((n - 1) / 2) * lh - size * 0.74
      const lastBottom = BASE.baseline + ((n - 1) / 2) * lh + size * 0.22
      if (n <= MAX_LINES && firstTop >= BOX.top && lastBottom <= BOX.bottom) {
        return { size, lines: paras.map((p) => p.trim()), lh }
      }
    }
  }

  for (let size = baseSize; size >= MIN_SIZE; size -= 2) {
    c.font = fontStr(size)
    const lines = wrapText(c, text, BOX.maxW)
    const lh = Math.round(size * 1.16)
    const n = lines.length
    if (n > MAX_LINES) continue
    const firstTop = BASE.baseline - ((n - 1) / 2) * lh - size * 0.74
    const lastBottom = BASE.baseline + ((n - 1) / 2) * lh + size * 0.22
    if (firstTop >= BOX.top && lastBottom <= BOX.bottom) {
      return { size, lines, lh }
    }
  }

  c.font = fontStr(MIN_SIZE)
  return {
    size: MIN_SIZE,
    lines: wrapText(c, text, BOX.maxW).slice(0, MAX_LINES),
    lh: Math.round(MIN_SIZE * 1.16)
  }
}

/**
 * Render meme Quote Windows Media Player (PNG 1123x1401).
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
export async function renderQWindows(text) {
  await ensureFont()
  const cleanText = String(text || '').replace(/\r/g, '').trim()
  if (!cleanText) throw new Error('Teks kosong')

  const tpl = await loadImage(await getTemplateBuffer())
  const canvas = createCanvas(TEMPLATE_W, TEMPLATE_H)
  const c = canvas.getContext('2d')
  c.drawImage(tpl, 0, 0, TEMPLATE_W, TEMPLATE_H)

  c.font = fontStr(BASE.size)
  const k = Math.max(0.8, Math.min(1.15, BASE.inkW / measureInkWidth(c, 'whaty')))
  const baseSize = Math.round(BASE.size * k)

  const { size, lines, lh } = computeLayout(c, cleanText, baseSize)
  c.fillStyle = BASE.color
  c.textAlign = 'center'
  c.textBaseline = 'alphabetic'
  c.font = fontStr(size)

  const n = lines.length
  lines.forEach((line, idx) => {
    const y = Math.round(BASE.baseline + (idx - (n - 1) / 2) * lh)
    c.fillText(line, BASE.cx, y)
  })

  return canvas.toBuffer('image/png')
}

export default {
  name: 'qwindows',
  aliases: ['qwin', 'quotewindows'],
  tags: 'media',
  cooldown: COOLDOWN_MS,
  description: 'Meme Quote Windows Media Player XP (ganti teks kiri pakai canvas)',

  async run(ctx) {
    const p = config.mainPrefix
    const quotedText = extractTextFromMessage(getQuotedMessage(ctx))
    const text = (ctx.text || quotedText || '').trim()

    if (!text || /^(help|bantuan|\?)$/i.test(text)) {
      return ctx.reply(
        `🪟 *Windows Media Player Meme*\n\n` +
          `• *${p}qwindows <teks>*\n` +
          `• Atau reply pesan teks lalu ketik *${p}qwindows*\n\n` +
          `Teks otomatis mengecil & wrap (maks *${MAX_CHARS}* karakter).`
      )
    }

    const len = Array.from(text).length
    if (len > MAX_CHARS) {
      return ctx.reply(`❌ Teksnya kepanjangan (maks ${MAX_CHARS} karakter, punyamu ${len}).`)
    }

    const uid = ctx.sender || ctx.senderNumber || ctx.chat
    if (busyUsers.has(uid)) {
      return ctx.reply('⏳ Permintaan kamu sebelumnya masih diproses, tunggu bentar ya.')
    }

    busyUsers.add(uid)
    await ctx.react('⏳')

    const sendOpts = ctx.event ? { quote: ctx.event } : {}
    try {
      const buffer = await renderQWindows(text)

      try {
        await ctx.client.message.send(
          ctx.chat,
          { type: 'image', media: buffer, mimetype: 'image/png' },
          sendOpts
        )
      } catch {
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'document',
            media: buffer,
            mimetype: 'image/png',
            fileName: 'qwindows.png'
          },
          sendOpts
        )
      }

      await ctx.react('✅')
    } catch (err) {
      logger.warn({ err: err.message }, '[qwindows] render gagal')
      await ctx.react('❎')
      await ctx.reply(`❌ Gagal: ${String(err.message || err).slice(0, 200)}`)
    } finally {
      busyUsers.delete(uid)
    }
  }
}
