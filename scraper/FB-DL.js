/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * FB-DL.js — Facebook downloader scraper (getmyfb.com + direct Facebook HTML fallback)
 */
import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://getmyfb.com'

const REQUEST_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
}

function unescapeFbJsonUrl(raw) {
  if (!raw) return ''
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return String(raw).replace(/\\\//g, '/').replace(/\\u0025/g, '%')
  }
}

async function scrapeViaGetMyFb(targetUrl) {
  const res = await axios.post(
    `${BASE_URL}/process`,
    new URLSearchParams({ id: targetUrl, locale: 'en' }).toString(),
    {
      headers: {
        ...REQUEST_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 25_000,
      validateStatus: () => true
    }
  )

  if (res.status >= 400 || !res.data || typeof res.data !== 'string') {
    throw new Error(`getmyfb HTTP ${res.status}`)
  }

  const $ = cheerio.load(res.data)
  const rawTitle = $('.results-item-text, .video-title, h4, h3').first().text().replace(/\s+/g, ' ').trim()
  const thumb = $('img').first().attr('src') || ''

  const media = []
  $('li.results-list-item').each((_, el) => {
    if ($(el).hasClass('results-list-item--app')) return
    const href = $(el).find('a[href]').first().attr('href')?.trim()
    if (!href || !/^https?:\/\//i.test(href) || /play\.google\.com/i.test(href)) return

    const rowText = $(el).text().replace(/\s+/g, ' ').trim()
    const isAudio = /\b(mp3|audio)\b/i.test(rowText)
    const qualityMatch = rowText.match(/\b(1080p|720p|480p|360p|HD|SD|MP3)\b/i)
    const quality = qualityMatch ? qualityMatch[1].toUpperCase() : isAudio ? 'MP3' : 'SD'

    media.push({
      type: isAudio ? 'audio' : 'video',
      quality,
      extension: isAudio ? 'mp3' : 'mp4',
      size: '-',
      video: !isAudio,
      audio: true,
      url: href
    })
  })

  if (!media.length) {
    throw new Error('getmyfb tidak menemukan link unduhan.')
  }

  return {
    source: 'getmyfb',
    url: targetUrl,
    caption: rawTitle || 'Facebook Video',
    author: '-',
    duration: '',
    thumbnail: thumb,
    media
  }
}

async function scrapeDirectFacebook(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`Facebook HTTP ${res.status}`)

  const html = await res.text()
  const hdRaw =
    html.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"playable_url_quality_hd"\s*:\s*"([^"]+)"/)?.[1] ||
    ''
  const sdRaw =
    html.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"playable_url"\s*:\s*"([^"]+)"/)?.[1] ||
    ''

  const media = []
  const hdUrl = unescapeFbJsonUrl(hdRaw)
  const sdUrl = unescapeFbJsonUrl(sdRaw)

  if (/^https?:\/\//i.test(hdUrl)) {
    media.push({ type: 'video', quality: 'HD', extension: 'mp4', size: '-', video: true, audio: true, url: hdUrl })
  }
  if (/^https?:\/\//i.test(sdUrl) && sdUrl !== hdUrl) {
    media.push({ type: 'video', quality: 'SD', extension: 'mp4', size: '-', video: true, audio: true, url: sdUrl })
  }

  if (!media.length) {
    throw new Error('Media kosong atau link Facebook private/tidak tersedia.')
  }

  const $ = cheerio.load(html)
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text() ||
    'Facebook Video'

  return {
    source: 'facebook-direct',
    url: targetUrl,
    caption: String(title).replace(/\s*\|\s*Facebook$/i, '').trim() || 'Facebook Video',
    author: '-',
    duration: '',
    thumbnail: $('meta[property="og:image"]').attr('content') || '',
    media
  }
}

export async function fbDownload(fbUrl) {
  const rawInput = typeof fbUrl === 'string' ? fbUrl.trim() : ''
  const targetUrl = rawInput.match(/https?:\/\/[^\s]+/i)?.[0] || ''

  if (!targetUrl) {
    throw new Error('URL Facebook tidak valid.')
  }
  if (!/facebook\.com|fb\.watch/i.test(targetUrl)) {
    throw new Error('URL bukan URL Facebook.')
  }

  let lastErr = null
  for (const runner of [scrapeViaGetMyFb, scrapeDirectFacebook]) {
    try {
      const data = await runner(targetUrl)
      if (data?.media?.length) {
        return { status: true, author_skrep: 'Hitori-MD', data }
      }
    } catch (err) {
      lastErr = err
    }
  }

  throw lastErr || new Error('Media kosong atau link Facebook private/tidak tersedia.')
}

export default fbDownload
