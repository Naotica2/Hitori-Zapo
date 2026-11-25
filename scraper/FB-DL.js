/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * FB-DL.js — Facebook downloader scraper (getfvido.com)
 *
 * Skrep by *JH a.k.a DHIKA - FIONY BOT* (adapted cleanly to ESM)
 */
import axios from 'axios'

const BASE_URL = 'https://getfvido.com'

const REQUEST_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'id-ID,id;q=0.9',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  'Sec-Ch-Ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
  'Sec-Ch-Ua-Mobile': '?1',
  'Sec-Ch-Ua-Platform': '"Android"',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36'
}

function extractCookies(headers) {
  const raw = headers?.['set-cookie']
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return list
    .map((entry) => String(entry).split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

function extractToken(html) {
  if (!html) return ''
  return (
    html.match(/name=["']token["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
    html.match(/value=["']([^"']+)["'][^>]*name=["']token["']/i)?.[1] ||
    html.match(/id=["']token["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
    ''
  )
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

  const homeRes = await axios.get(`${BASE_URL}/`, {
    headers: REQUEST_HEADERS,
    timeout: 20_000,
    validateStatus: () => true
  })

  if (homeRes.status >= 400) {
    throw new Error(`Halaman getfvido gagal dimuat (HTTP ${homeRes.status}).`)
  }

  const homeHtml = typeof homeRes.data === 'string' ? homeRes.data : ''
  const cookieStr = extractCookies(homeRes.headers)
  const token = extractToken(homeHtml)

  const payload = new URLSearchParams()
  payload.append('url', targetUrl)
  if (token) payload.append('token', token)

  const postHeaders = {
    ...REQUEST_HEADERS,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    ...(cookieStr ? { Cookie: cookieStr } : {})
  }

  const apiRes = await axios.post(`${BASE_URL}/wp-json/aio-dl/video-data/`, payload.toString(), {
    headers: postHeaders,
    timeout: 25_000,
    validateStatus: () => true
  })

  if (apiRes.status >= 400 || apiRes.data === undefined || apiRes.data === null) {
    const errBody = typeof apiRes.data === 'string' ? apiRes.data : JSON.stringify(apiRes.data)
    throw new Error(`HTTP ${apiRes.status}: ${String(errBody || '').slice(0, 180)}`)
  }

  const resData = typeof apiRes.data === 'string' ? JSON.parse(apiRes.data) : apiRes.data
  const rawMedias = Array.isArray(resData?.medias) ? resData.medias : []

  const media = []
  for (const item of rawMedias) {
    const mediaUrl = typeof item?.url === 'string' ? item.url.trim() : ''
    if (!mediaUrl) continue

    const hasVideo = item.videoAvailable === true
    const hasAudio = item.audioAvailable === true

    media.push({
      type: hasVideo ? 'video' : hasAudio ? 'audio' : 'media',
      quality: item.quality ? String(item.quality).trim() : 'SD',
      extension: item.extension ? String(item.extension).trim() : '',
      size: item.formattedSize ? String(item.formattedSize).trim() : '-',
      video: hasVideo,
      audio: hasAudio,
      url: mediaUrl
    })
  }

  if (media.length === 0) {
    throw new Error(resData?.error || 'Media kosong atau link Facebook private/tidak tersedia.')
  }

  const rawTitle = String(resData?.title || 'Facebook Video').trim()
  let caption = rawTitle
  let author = '-'
  if (rawTitle.includes('|')) {
    const parts = rawTitle.split('|')
    author = parts.pop().trim() || '-'
    caption = parts.join('|').trim() || rawTitle
  }

  return {
    status: true,
    author_skrep: 'JH a.k.a Dhika',
    data: {
      source: resData?.source || 'facebook',
      url: resData?.url || targetUrl,
      caption,
      author,
      duration: resData?.duration ? String(resData.duration).trim() : '',
      thumbnail: resData?.thumbnail || '',
      media
    }
  }
}

export default fbDownload
