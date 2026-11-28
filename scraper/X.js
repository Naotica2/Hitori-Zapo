/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * X.js — Scraper Twitter/X Downloader (FxTwitter API + fallback x2twitter)
 */

async function fetchViaFxTwitter(targetUrl) {
  const match = String(targetUrl || '').match(/https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/i)
  if (!match) return null

  const user = match[1]
  const id = match[2]
  const endpoint = `https://api.fxtwitter.com/${encodeURIComponent(user)}/status/${id}`

  const res = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'User-Agent': 'Hitori-MD/1.0' },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) return null

  const json = await res.json().catch(() => null)
  const tweet = json?.tweet
  if (!tweet) return null

  const videos = []
  const images = []

  for (const v of tweet.media?.videos || []) {
    if (!v?.url) continue
    const q = v.width && v.height ? `${v.width}x${v.height}` : 'HD'
    videos.push({
      quality: q,
      url: v.url,
      thumbnail: v.thumbnail_url || ''
    })
  }

  for (const p of tweet.media?.photos || []) {
    if (!p?.url) continue
    images.push({ url: p.url })
  }

  if (!videos.length && !images.length && Array.isArray(tweet.media?.all)) {
    for (const item of tweet.media.all) {
      if ((item.type === 'video' || item.type === 'gif') && item.url) {
        videos.push({ quality: 'HD', url: item.url, thumbnail: item.thumbnail_url || '' })
      } else if (item.type === 'photo' && item.url) {
        images.push({ url: item.url })
      }
    }
  }

  if (!videos.length && !images.length) {
    throw new Error('Tweet ini cuma teks atau tidak berisi media foto/video.')
  }

  return {
    title: String(tweet.text || '').trim(),
    videos,
    images
  }
}

export async function twitterDownload(targetUrl) {
  const axios = (await import('axios')).default
  const baseRes = { status: true, author: 'Hitori-MD', data: { title: '', videos: [], images: [] } }

  try {
    const fx = await fetchViaFxTwitter(targetUrl).catch((e) => {
      if (/cuma teks/i.test(String(e?.message))) throw e
      return null
    })
    if (fx) {
      return { ...baseRes, data: fx }
    }

    const { data: taskData } = await axios.post(
      'https://cap.jhx.my.id/api/createTask',
      {
        url: 'https://x2twitter.com/en4',
        type: 'turnstile-min',
        sitekey: '0x4AAAAAAA4XPM1s-KWsI2rm'
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 }
    )

    if (!taskData?.success || !taskData?.jobId) {
      throw new Error('Gagal membuat antrean bypass Turnstile.')
    }

    let cfToken = ''
    let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const { data: resData } = await axios.post(
        'https://cap.jhx.my.id/api/getResult',
        { jobId: taskData.jobId },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 }
      )

      if (resData?.status === 'ready' && resData?.solution) {
        cfToken = resData.solution.token
        ua = resData.solution.userAgent || ua
        break
      } else if (resData?.status === 'failed' || resData?.error) {
        throw new Error(resData.error || 'Gagal bypass Turnstile.')
      }
    }

    if (!cfToken) throw new Error('Timeout saat menunggu token.')

    const payload = new URLSearchParams()
    payload.append('q', targetUrl)
    payload.append('lang', 'en')
    payload.append('cftoken', cfToken)

    const { data: xData } = await axios.post('https://x2twitter.com/api/ajaxSearch', payload.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': ua,
        Referer: 'https://x2twitter.com/en4'
      },
      timeout: 20_000
    })

    if (xData?.status !== 'ok' || !xData?.data) {
      throw new Error('Gagal mendapatkan response valid dari server.')
    }

    const html = xData.data
    const titleMatch = html.match(/<h3>(.*?)<\/h3>/)
    if (titleMatch) {
      baseRes.data.title = titleMatch[1].replace(/&#x[0-9A-F]+;/gi, '').trim()
    }

    const thumbMatch = html.match(/<img src="([^"]+)">/)
    const thumbnail = thumbMatch ? thumbMatch[1] : ''

    const vidRegex = /href="([^"]+)".*?Download MP4 \(([^)]+)\)/g
    let matchV
    while ((matchV = vidRegex.exec(html)) !== null) {
      baseRes.data.videos.push({
        quality: matchV[2],
        url: matchV[1],
        thumbnail
      })
    }

    const imgRegex = /href="([^"]+)".*?Download Photo/g
    let matchI
    while ((matchI = imgRegex.exec(html)) !== null) {
      baseRes.data.images.push({ url: matchI[1] })
    }

    if (!baseRes.data.videos.length && !baseRes.data.images.length) {
      throw new Error('Tweet ini cuma teks atau media gagal diekstrak.')
    }

    return baseRes
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message
    return { ...baseRes, status: false, error: errMsg }
  }
}
