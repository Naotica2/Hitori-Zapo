/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ssweb.js — Screenshot halaman web dengan Puppeteer & proteksi SSRF URL/IP lokal
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer'
import config from '../../config.js'
import { extractUrlFromCtx, getEvent } from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].filter(Boolean)

function resolveSystemChromePath() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return undefined
}

async function fetchRemoteScreenshotFallback(targetUrl, { mobile = false, fullPage = false, dark = false } = {}) {
  const width = mobile ? 390 : 1280

  // 1. Microlink Screenshot API (dukung mobile viewport, fullPage, dan dark mode tanpa Chromium lokal)
  try {
    const mlParams = new URLSearchParams({
      url: targetUrl,
      screenshot: 'true',
      ...(fullPage ? { 'screenshot.fullPage': 'true' } : {}),
      ...(mobile ? { 'viewport.isMobile': 'true', 'viewport.width': '390', 'viewport.height': '844' } : {}),
      ...(dark ? { colorScheme: 'dark' } : {})
    })
    const mlRes = await fetch(`https://api.microlink.io/?${mlParams.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(25_000)
    })
    if (mlRes.ok) {
      const mlJson = await mlRes.json()
      const shotUrl = mlJson?.data?.screenshot?.url
      if (shotUrl) {
        await assertSafePublicUrl(shotUrl)
        const imgRes = await fetch(shotUrl, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
        const ct = String(imgRes.headers.get('content-type') || '').toLowerCase()
        if (imgRes.ok && ct.startsWith('image/')) {
          const buf = Buffer.from(await imgRes.arrayBuffer())
          if (buf.length > 4000) {
            return {
              buffer: buf,
              mimetype: ct.includes('png') ? 'image/png' : 'image/jpeg',
              title: mlJson?.data?.title || ''
            }
          }
        }
      }
    }
  } catch {}

  // 2. Fallback thum.io
  const thumUrl = fullPage
    ? `https://image.thum.io/get/width/${width}/fullpage/noanimate/${targetUrl}`
    : `https://image.thum.io/get/width/${width}/crop/900/noanimate/${targetUrl}`
  const res = await fetch(thumUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000)
  })
  const ct = String(res.headers.get('content-type') || '').toLowerCase()
  if (res.ok && ct.startsWith('image/')) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4000) {
      return {
        buffer: buf,
        mimetype: ct.includes('png') ? 'image/png' : 'image/jpeg',
        title: ''
      }
    }
  }
  throw new Error('Gagal meluncurkan Chrome (missing shared libs/binary) dan fallback screenshot juga gagal.')
}

const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i

function parseSsArgs(raw) {
  let text = String(raw || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let fullPage = false
  let mobile = false
  let dark = false
  let delayMs = 1200

  text = text.replace(/(^|\s)--full\b/gi, (_, lead) => {
    fullPage = true
    return lead
  })
  text = text.replace(/(^|\s)--(?:mobile|hp|phone)\b/gi, (_, lead) => {
    mobile = true
    return lead
  })
  text = text.replace(/(^|\s)--dark\b/gi, (_, lead) => {
    dark = true
    return lead
  })
  text = text.replace(/(^|\s)--delay(?:=|\s+)(\d+)\b/gi, (_, lead, sec) => {
    const n = Number.parseInt(sec, 10)
    if (Number.isFinite(n)) delayMs = Math.max(0, Math.min(n, 8)) * 1000
    return lead
  })

  return { fullPage, mobile, dark, delayMs, cleaned: text.trim() }
}

export default {
  name: 'ssweb',
  aliases: ['ss', 'webshot', 'screenshot'],
  tags: 'media',
  cooldown: 8000,
  description: 'Ambil screenshot website (dukung mode fullpage, HP, dan dark mode)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const rawText = String(ctx.text || '').trim()
    const { fullPage, mobile, dark, delayMs, cleaned } = parseSsArgs(rawText)

    let target = cleaned ? cleaned.match(URL_RE)?.[0] : null
    if (!target) {
      target = extractUrlFromCtx({ ...ctx, text: cleaned }, /https?:\/\/[^\s]+/i, { stripTrailing: true })
    }

    if (!target || /^help$/i.test(rawText)) {
      return ctx.client.message.send(
        ctx.chat,
        '🌐 *SCREENSHOT WEBSITE*\n\n' +
          '*Contoh:*\n' +
          `• *${p}ssweb https://github.com*\n` +
          `• *${p}ssweb --full https://wikipedia.org*\n` +
          `• *${p}ssweb --hp --dark https://youtube.com*\n\n` +
          '*Opsi:* `--full`, `--hp` / `--mobile`, `--dark`, `--delay <0-8 detik>`',
        sendOpts
      )
    }

    if (!/^https?:\/\//i.test(target)) target = `https://${target}`

    await ctx.react('⏳')
    let browser = null
    try {
      const safeUrl = await assertSafePublicUrl(target)
      const executablePath = resolveSystemChromePath()

      try {
        browser = await puppeteer.launch({
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run'
          ]
        })
      } catch {
        // Fallback otomatis saat Chrome gagal launch (mis. belum terpasang atau kurang shared lib libnspr4.so di VPS minimal)
        const fallback = await fetchRemoteScreenshotFallback(safeUrl.toString(), { mobile, fullPage, dark })
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'image',
            media: fallback.buffer,
            mimetype: fallback.mimetype,
            caption: [
              '🌐 *SCREENSHOT WEB*',
              ...(fallback.title ? [`• Judul : ${fallback.title.slice(0, 100)}`] : []),
              `• URL   : ${safeUrl.toString()}`,
              `• Mode  : ${mobile ? 'Mobile' : 'Desktop'}${fullPage ? ' • Fullpage' : ''}${dark ? ' • Dark' : ''}`
            ].join('\n')
          },
          sendOpts
        )
        await ctx.react('✅')
        return
      }

      const page = await browser.newPage()
      await page.setViewport(
        mobile
          ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
          : { width: 1366, height: 768, deviceScaleFactor: 1 }
      )
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        const u = req.url()
        if (/^(data|blob):/i.test(u)) return req.continue()
        assertSafePublicUrl(u)
          .then(() => req.continue())
          .catch(() => req.abort('blockedbyclient'))
      })

      if (dark) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
      }
      await page.setUserAgent(
        mobile
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      )

      await page.goto(safeUrl.toString(), { waitUntil: 'networkidle2', timeout: 25_000 }).catch(() =>
        page.goto(safeUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 })
      )

      const finalUrl = page.url()
      if (/^https?:/i.test(finalUrl)) {
        await assertSafePublicUrl(finalUrl)
      }

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs))
      }

      const title = (await page.title().catch(() => '')) || safeUrl.hostname
      let shotBuf
      if (fullPage) {
        const docHeight = await page.evaluate(() => Math.min(document.body?.scrollHeight || 768, 6000))
        shotBuf = await page.screenshot({
          type: 'jpeg',
          quality: 88,
          clip: { x: 0, y: 0, width: mobile ? 390 : 1366, height: Math.max(mobile ? 844 : 768, docHeight) }
        })
      } else {
        shotBuf = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: false })
      }

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: Buffer.from(shotBuf),
          mimetype: 'image/jpeg',
          caption:
            `🌐 *SCREENSHOT WEB*\n` +
            `• Judul : ${title.slice(0, 100)}\n` +
            `• URL   : ${finalUrl}\n` +
            `• Mode  : ${mobile ? 'Mobile' : 'Desktop'}${fullPage ? ' • Fullpage' : ''}${dark ? ' • Dark' : ''}`
        },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal mengambil screenshot: ${String(err?.message || err).slice(0, 220)}`,
        sendOpts
      )
    } finally {
      if (browser) await browser.close().catch(() => {})
    }
  }
}
