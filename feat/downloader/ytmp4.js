/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ytmp4.js — Download video YouTube (yt-dlp + fallback savenow / jhx API), pilih kualitas lewat tombol.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import config from '../../config.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import { downloadUrlBuffer, extractUrlFromCtx, getEvent } from '../../lib/media.js'
import { normalizeMp4ForWhatsApp } from '../../lib/mediaConverter.js'
import { ytdl } from '../../scraper/YT-DL.js'

const SESSIONS = (globalThis.HITORI_YTV_SESSIONS ??= new Map())
const PER_PAGE = 2
const YT_URL_RE = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i

const QUALITY_TIERS = [
  { height: 1080, label: '1080p Full HD' },
  { height: 720, label: '720p HD' },
  { height: 480, label: '480p SD' },
  { height: 360, label: '360p' },
  { height: 240, label: '240p' }
]

const LINE = '━━━━━━━━━━━━━━━━━━━━'

function fetchInfoYtDlp(url) {
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    const p = spawn('yt-dlp', ['-J', '--no-warnings', url])
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `yt-dlp exit ${code}`))
      try {
        resolve(JSON.parse(out))
      } catch (e) {
        reject(e)
      }
    })
  })
}

async function fetchInfoFallback(url) {
  try {
    const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (oe.ok) {
      const j = await oe.json()
      return {
        title: j.title || 'YouTube Video',
        duration: 0,
        formats: [{ height: 720 }, { height: 480 }, { height: 360 }]
      }
    }
  } catch {}
  return { title: 'YouTube Video', duration: 0, formats: [{ height: 720 }, { height: 480 }, { height: 360 }] }
}

function fmtDuration(sec) {
  if (!sec) return '-:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function detectAvailableTiers(formats) {
  const heights = new Set(
    (formats || [])
      .filter((f) => f.height)
      .map((f) => f.height)
  )
  if (!heights.size) return [{ height: 720, label: '720p HD' }, { height: 480, label: '480p SD' }, { height: 360, label: '360p' }]

  const maxHeight = Math.max(...heights)
  const available = QUALITY_TIERS.filter((t) => t.height <= maxHeight)
  return available.length ? available : [{ height: maxHeight, label: `${maxHeight}p` }]
}

export function downloadYT(url, height) {
  return new Promise((resolve, reject) => {
    let filename = ''
    let stderr = ''

    fs.mkdirSync('tmp', { recursive: true })

    const formatSelector = height
      ? `bestvideo[height<=${height}][vcodec^=avc1][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]/best[height<=${height}][vcodec^=avc1][ext=mp4]/bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]`
      : 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]/best[vcodec^=avc1][ext=mp4]/best[ext=mp4]/best'

    const ytdlp = spawn('yt-dlp', [
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      ...(fs.existsSync('cookies.txt') ? ['--cookies', 'cookies.txt'] : []),
      '-f', formatSelector,
      '--merge-output-format', 'mp4',
      '--restrict-filenames',
      '--print', 'after_move:filename',
      '-o', 'tmp/%(id)s_%(epoch)s.%(ext)s',
      url
    ])

    ytdlp.stdout.on('data', (data) => { filename += data.toString() })
    ytdlp.stderr.on('data', (data) => { stderr += data.toString() })
    ytdlp.on('error', reject)
    ytdlp.on('close', (code) => {
      if (code === 0) {
        const file = filename.trim().split('\n').pop()
        if (!file || !fs.existsSync(file)) {
          return reject(new Error('Downloaded video file not found'))
        }
        return resolve(file)
      }
      reject(new Error(stderr || `Download failed, code: ${code}`))
    })
  })
}

async function downloadVideoFallbackBuffer(url, height) {
  const fmt = String(height || 720)
  try {
    const dl = await Promise.race([
      ytdl.download(url, fmt),
      new Promise((_, rej) => setTimeout(() => rej(new Error('savenow timeout')), 25_000))
    ])
    if (dl?.status === 'success' && dl.download_url) {
      return await downloadUrlBuffer(dl.download_url, { timeout: 180_000, maxBytes: 120 * 1024 * 1024 })
    }
  } catch {}

  const jhx = await fetch('https://api.jhx.my.id/yt-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://jhx.my.id/ytdl/',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
    },
    body: JSON.stringify({ url, format: fmt }),
    signal: AbortSignal.timeout(30_000)
  })
  const j = await jhx.json().catch(() => null)
  if (jhx.ok && j?.Status && j?.data?.url) {
    return downloadUrlBuffer(j.data.url, { timeout: 180_000, maxBytes: 120 * 1024 * 1024 })
  }

  throw new Error(j?.message || 'Semua provider download video gagal.')
}

async function sendVideoBuffer(ctx, rawBuf, fileName = 'youtube.mp4') {
  let buffer = rawBuf
  try {
    const norm = await normalizeMp4ForWhatsApp(rawBuf)
    buffer = norm.buffer
  } catch {}

  const sizeMB = buffer.length / 1024 / 1024
  const rawEvent = getEvent(ctx)
  const sendOpts = rawEvent ? { quote: rawEvent } : {}

  if (sizeMB > 100) {
    await ctx.client.message.send(
      ctx.chat,
      { type: 'document', media: buffer, mimetype: 'video/mp4', fileName },
      sendOpts
    )
  } else {
    await ctx.client.message.send(
      ctx.chat,
      { type: 'video', media: buffer, mimetype: 'video/mp4' },
      sendOpts
    )
  }
}

async function downloadAndSend(ctx, idx) {
  const sess = SESSIONS.get(ctx.sender)
  if (!sess) return ctx.reply('Sesi habis. Ketik *.ytv <url>* lagi.')
  const tier = sess.tiers[idx]
  if (!tier) return ctx.reply('Pilihan gak valid.')

  await ctx.react('⏳')
  let filePath
  try {
    let buffer
    try {
      filePath = await downloadYT(sess.url, tier.height)
      buffer = fs.readFileSync(filePath)
    } catch {
      buffer = await downloadVideoFallbackBuffer(sess.url, tier.height)
    }
    await sendVideoBuffer(ctx, buffer, `${sess.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'youtube'}.mp4`)
    await ctx.react('✅')
  } catch (e) {
    await ctx.react('❎')
    await ctx.reply('*Maaf Error:* ' + String(e?.message || e).slice(0, 220))
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath) } catch {}
    }
  }
}

async function sendPage(ctx, page) {
  const sess = SESSIONS.get(ctx.sender)
  if (!sess) return ctx.reply('Sesi habis. Ketik *.ytv <url>* lagi.')

  const { tiers, title, duration } = sess
  const totalPages = Math.ceil(tiers.length / PER_PAGE)
  page = Math.max(0, Math.min(page, totalPages - 1))

  const start = page * PER_PAGE
  const items = tiers.slice(start, start + PER_PAGE)

  let text = `✦ ──『 🎬 YT VIDEO 』── ⚝\n\n`
  text += `🎞 Judul : *${title}*\n`
  text += `⏱ Durasi : ${fmtDuration(duration)}\n`
  text += `📄 Page  : ${page + 1}/${totalPages}\n\n`
  text += LINE + '\n'

  items.forEach((t, i) => {
    text += `\n${start + i + 1} ─ ${t.label}`
  })

  text += '\n\n' + LINE + '\n\n'
  text += `Tap tombol angka buat\nlangsung download kualitasnya 🎬`

  const buttons = items.map((t, i) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: String(start + i + 1),
      id: `ytv:${ctx.sender}:pick:${start + i}`
    })
  }))

  if (page > 0) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: '◀ Prev',
        id: `ytv:${ctx.sender}:prev:${page - 1}`
      })
    })
  }
  if (page < totalPages - 1) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: 'Next ▶',
        id: `ytv:${ctx.sender}:next:${page + 1}`
      })
    })
  }

  items.forEach((t, i) => {
    onRichReply(`ytv:${ctx.sender}:pick:${start + i}`, async (c2) => {
      await downloadAndSend(c2, start + i)
    })
  })
  if (page > 0) {
    onRichReply(`ytv:${ctx.sender}:prev:${page - 1}`, async (c2) => {
      await sendPage(c2, page - 1)
    })
  }
  if (page < totalPages - 1) {
    onRichReply(`ytv:${ctx.sender}:next:${page + 1}`, async (c2) => {
      await sendPage(c2, page + 1)
    })
  }

  await ctx.client.message.send(ctx.chat, {
    interactiveMessage: {
      body: { text },
      footer: { text: `🎬 ${config.botName} • YouTube Downloader` },
      nativeFlowMessage: { buttons, messageVersion: 1 }
    }
  })
}

export default {
  name: 'ytv',
  aliases: ['ytmp4'],
  tags: 'downloader',
  description: 'Download video YouTube, pilih kualitas lewat tombol',

  async run(ctx) {
    const url = extractUrlFromCtx(ctx, YT_URL_RE, { stripTrailing: true }) || (ctx.text || '').trim()
    if (!url || !YT_URL_RE.test(url)) {
      return ctx.reply('*Contoh Pakai :*\n.ytv https://youtube.com/watch?v=xxxx')
    }

    await ctx.react('⏳')
    try {
      const info = await fetchInfoYtDlp(url).catch(() => fetchInfoFallback(url))
      const tiers = detectAvailableTiers(info.formats)

      if (SESSIONS.size >= 150) {
        const oldest = SESSIONS.keys().next().value
        if (oldest) SESSIONS.delete(oldest)
      }
      SESSIONS.set(ctx.sender, {
        url,
        title: info.title || 'Tanpa judul',
        duration: info.duration,
        tiers
      })

      await sendPage(ctx, 0)
      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      await ctx.reply('*Maaf Error:* ' + String(e?.message || e).slice(0, 220))
    }
  }
}
