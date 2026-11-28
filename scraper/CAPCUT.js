/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * CAPCUT.js — Scraper template/video CapCut tanpa watermark via __MODERN_ROUTER_DATA__
 */
import * as cheerio from 'cheerio'
import { assertSafePublicUrl } from '../lib/security.js'

const DESK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function resolveFinalCapcutUrl(rawUrl) {
  let current = String(rawUrl || '').trim()
  for (let hop = 0; hop < 5; hop++) {
    await assertSafePublicUrl(current)
    const parsed = new URL(current)
    if (!/(^|\.)capcut\.com$/i.test(parsed.hostname)) {
      throw new Error('Link harus berasal dari domain capcut.com.')
    }
    const res = await fetch(current, {
      headers: {
        'User-Agent': DESK_UA,
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) break
      current = new URL(loc, current).toString()
      continue
    }

    if (!res.ok) throw new Error(`CapCut HTTP ${res.status}`)
    return { finalUrl: current, html: await res.text() }
  }
  throw new Error('Terlalu banyak redirect pada link CapCut.')
}

export async function capcutDownload(url) {
  const { finalUrl, html } = await resolveFinalCapcutUrl(url)
  const $ = cheerio.load(html)
  const rawRouter = $('#__MODERN_ROUTER_DATA__').text()
  if (!rawRouter) {
    throw new Error('Gagal membaca metadata template dari halaman CapCut.')
  }

  let parsed
  try {
    parsed = JSON.parse(rawRouter)
  } catch {
    throw new Error('Data JSON halaman CapCut tidak valid.')
  }

  const loaderRoot = parsed?.loaderData?.['$'] || Object.values(parsed?.loaderData || {}).find((v) => v?.templateDetail) || null
  const td = loaderRoot?.templateDetail || null
  if (!td?.videoUrl) {
    throw new Error('Template CapCut tidak ditemukan atau tidak memiliki video preview.')
  }

  return {
    templateId: td.templateId || loaderRoot?.templateId || '-',
    title: td.title || td.desc || 'CapCut Template',
    desc: td.desc || '',
    videoUrl: td.videoUrl,
    coverUrl: td.coverUrl || null,
    durationMs: Number(td.templateDuration || 0),
    width: Number(td.videoWidth || 0),
    height: Number(td.videoHeight || 0),
    usageAmount: Number(td.usageAmount || 0),
    playAmount: Number(td.playAmount || 0),
    likeAmount: Number(td.likeAmount || 0),
    authorName: td.author?.name || '-',
    url: finalUrl
  }
}
