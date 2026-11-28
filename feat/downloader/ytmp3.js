/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ytmp3.js — Download audio (mp3) dari YouTube (yt-dlp + fallback savenow / jhx API)
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { downloadUrlBuffer, extractUrlFromCtx, getEvent } from '../../lib/media.js'
import { ytdl } from '../../scraper/YT-DL.js'

const YT_URL_RE = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i

function getInfoYtDlp(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      ...(fs.existsSync('cookies.txt') ? ['--cookies', 'cookies.txt'] : []),
      '--dump-json',
      url
    ]
    const proc = spawn('yt-dlp', args)
    let out = ''
    let err = ''
    proc.stdout.on('data', (chunk) => { out += chunk.toString() })
    proc.stderr.on('data', (chunk) => { err += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `Failed to fetch video info: ${code}`))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error('Failed to parse video info'))
      }
    })
  })
}

async function getInfoFallback(url) {
  try {
    const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (oe.ok) {
      const j = await oe.json()
      return {
        title: j.title || 'YouTube Audio',
        uploader: j.author_name || '-',
        thumbnail: j.thumbnail_url || '',
        view_count: '-',
        duration_string: '-'
      }
    }
  } catch {}
  return { title: 'YouTube Audio', uploader: '-', thumbnail: '', view_count: '-', duration_string: '-' }
}

function downloadAudioYtDlp(url) {
  return new Promise((resolve, reject) => {
    let filename = ''
    let stderr = ''
    fs.mkdirSync('tmp', { recursive: true })

    const dl = spawn('yt-dlp', [
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      ...(fs.existsSync('cookies.txt') ? ['--cookies', 'cookies.txt'] : []),
      '-f', 'bestaudio/best',
      '-x',
      '--audio-format', 'mp3',
      '--restrict-filenames',
      '--print', 'after_move:filename',
      '-o', 'tmp/%(id)s_%(epoch)s.%(ext)s',
      url
    ])

    dl.stdout.on('data', (d) => { filename += d.toString() })
    dl.stderr.on('data', (d) => { stderr += d.toString() })
    dl.on('error', reject)
    dl.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || 'Download audio failed'))
      const printed = filename.trim().split('\n').pop()
      const file = printed.replace(/\.[^./\\]+$/, '.mp3')
      const targetFile = fs.existsSync(file) ? file : printed
      if (!fs.existsSync(targetFile)) return reject(new Error('File not found'))
      resolve(targetFile)
    })
  })
}

async function downloadAudioFallbackBuffer(url) {
  // 1. Coba ytdl savenow terlebih dahulu (URL cepat ~3s)
  try {
    const dl = await Promise.race([
      ytdl.download(url, 'mp3'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('savenow timeout')), 25_000))
    ])
    if (dl?.status === 'success' && dl.download_url) {
      const buf = await downloadUrlBuffer(dl.download_url, { timeout: 180_000, maxBytes: 120 * 1024 * 1024 })
      return { buffer: buf, title: dl.title || '' }
    }
  } catch {}

  // 2. Fallback ke api.jhx.my.id
  const jhx = await fetch('https://api.jhx.my.id/yt-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://jhx.my.id/ytdl/',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
    },
    body: JSON.stringify({ url, format: 'mp3' }),
    signal: AbortSignal.timeout(30_000)
  })
  const j = await jhx.json().catch(() => null)
  if (jhx.ok && j?.Status && j?.data?.url) {
    const buf = await downloadUrlBuffer(j.data.url, { timeout: 180_000, maxBytes: 120 * 1024 * 1024 })
    return { buffer: buf, title: j.data.title || '' }
  }

  throw new Error(j?.message || 'Semua provider download MP3 gagal.')
}

export default {
  name: 'yta',
  aliases: ['ytmp3', 'ytaudio'],
  tags: 'downloader',
  description: 'Download audio (mp3) dari YouTube',

  async run(ctx) {
    const url = extractUrlFromCtx(ctx, YT_URL_RE, { stripTrailing: true }) || (ctx.text || '').trim()
    if (!url || !YT_URL_RE.test(url)) {
      return ctx.reply('*Contoh Pakai :*\n.yta https://youtu.be/xxxx')
    }

    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}
    let filePath
    await ctx.react('⏳')

    try {
      const info = await getInfoYtDlp(url).catch(() => getInfoFallback(url))
      let title = (info.title || 'YouTube Audio').replace(/[\\/:*?"<>|]/g, '')
      const caption =
        `*${title}*\n\n` +
        `*Author:* ${info.uploader || '-'}\n` +
        `*Views:* ${info.view_count || '-'}\n` +
        `*Duration:* ${info.duration_string || info.duration || '-'}\n` +
        `*Link:* ${url}\n\n` +
        `> Downloading audio...`

      if (info.thumbnail) {
        try {
          const thumbBuf = await downloadUrlBuffer(info.thumbnail, { timeout: 15_000, maxBytes: 5 * 1024 * 1024 })
          await ctx.client.message.send(
            ctx.chat,
            { type: 'image', media: thumbBuf, mimetype: 'image/jpeg', caption },
            sendOpts
          )
        } catch {}
      }

      let buffer
      try {
        filePath = await downloadAudioYtDlp(url)
        buffer = fs.readFileSync(filePath)
      } catch {
        const fb = await downloadAudioFallbackBuffer(url)
        buffer = fb.buffer
        if (fb.title && title === 'YouTube Audio') {
          title = fb.title.replace(/[\\/:*?"<>|]/g, '')
        }
      }

      const sizeMB = buffer.length / 1024 / 1024
      if (sizeMB > 100) {
        await ctx.client.message.send(
          ctx.chat,
          { type: 'document', media: buffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3` },
          sendOpts
        )
      } else {
        await ctx.client.message.send(
          ctx.chat,
          { type: 'audio', media: buffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3` },
          sendOpts
        )
      }

      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      await ctx.reply('❌ ' + String(err?.message || err).slice(0, 220))
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath) } catch {}
      }
    }
  }
}
