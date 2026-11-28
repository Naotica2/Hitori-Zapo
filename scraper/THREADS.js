/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * THREADS.js — Threads downloader scraper (SSR JSON post extractor + Meta fallback)
 */
import * as cheerio from 'cheerio'

const DESK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

function pickHighestCandidate(candidates = []) {
  if (!Array.isArray(candidates) || !candidates.length) return null
  return candidates.reduce((best, cur) => {
    const bw = Number(best?.width || 0) * Number(best?.height || 1)
    const cw = Number(cur?.width || 0) * Number(cur?.height || 1)
    return cw > bw ? cur : best
  })
}

function findPostByCode(node, targetCode, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 30) return null

  if (
    (!targetCode || node.code === targetCode) &&
    node.user &&
    (node.video_versions || node.image_versions2 || node.carousel_media || node.caption)
  ) {
    return node
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findPostByCode(item, targetCode, depth + 1)
      if (hit) return hit
    }
    return null
  }

  for (const key of Object.keys(node)) {
    const val = node[key]
    if (val && typeof val === 'object') {
      const hit = findPostByCode(val, targetCode, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

function extractMediaFromPostNode(post) {
  const media = []
  const seen = new Set()

  const addMedia = (entry) => {
    if (!entry?.url || seen.has(entry.url)) return
    seen.add(entry.url)
    media.push(entry)
  }

  if (Array.isArray(post.carousel_media) && post.carousel_media.length) {
    for (const item of post.carousel_media) {
      const vid = pickHighestCandidate(item.video_versions)
      if (vid?.url) {
        const poster = pickHighestCandidate(item.image_versions2?.candidates)?.url || ''
        addMedia({ type: 'video', url: vid.url, thumbnail: poster })
        continue
      }
      const img = pickHighestCandidate(item.image_versions2?.candidates)
      if (img?.url) addMedia({ type: 'image', url: img.url })
    }
  } else {
    const vid = pickHighestCandidate(post.video_versions)
    if (vid?.url) {
      const poster = pickHighestCandidate(post.image_versions2?.candidates)?.url || ''
      addMedia({ type: 'video', url: vid.url, thumbnail: poster })
    } else {
      const img = pickHighestCandidate(post.image_versions2?.candidates)
      if (img?.url) addMedia({ type: 'image', url: img.url })
    }
  }

  return media
}

export async function threadsDownload(threadsUrl) {
  if (!threadsUrl || typeof threadsUrl !== 'string') {
    throw new Error('URL Threads tidak valid.')
  }
  if (!/threads\.(com|net)/i.test(threadsUrl)) {
    throw new Error('URL bukan URL Threads.')
  }

  const normalizedUrl = threadsUrl.trim().replace(/threads\.net/gi, 'threads.com')
  const codeMatch = normalizedUrl.match(/\/post\/([A-Za-z0-9_-]+)/i)
  const targetCode = codeMatch ? codeMatch[1] : null

  const res = await fetch(normalizedUrl, {
    headers: {
      'User-Agent': DESK_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Upgrade-Insecure-Requests': '1'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })

  if (!res.ok) {
    throw new Error(`Threads HTTP ${res.status}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)

  let matchedPost = null
  for (const el of $('script[type="application/json"]').get()) {
    const txt = $(el).html() || ''
    if (targetCode && !txt.includes(targetCode)) continue
    try {
      const parsed = JSON.parse(txt)
      const hit = findPostByCode(parsed, targetCode)
      if (hit) {
        matchedPost = hit
        break
      }
    } catch {}
  }

  if (matchedPost) {
    const media = extractMediaFromPostNode(matchedPost)
    if (media.length === 0) {
      throw new Error('Postingan Threads ini hanya berupa teks (tidak memiliki foto/video).')
    }
    return {
      status: true,
      data: {
        username: matchedPost.user?.username || 'Unknown',
        profile_pic: matchedPost.user?.profile_pic_url || '',
        caption: matchedPost.caption?.text || '',
        media
      }
    }
  }

  // Fallback meta tags hanya bila media valid (hindari avatar profil default)
  const ogVideo = $('meta[property="og:video"], meta[property="og:video:secure_url"]').attr('content') || ''
  const ogImage = $('meta[property="og:image"]').attr('content') || ''
  const ogTitle = $('meta[property="og:title"]').attr('content') || ''
  const ogDesc = $('meta[property="og:description"]').attr('content') || ''
  const userMatch = normalizedUrl.match(/threads\.com\/@([A-Za-z0-9._]+)/i)

  const media = []
  if (ogVideo && !/rsrc\.php/i.test(ogVideo)) {
    media.push({ type: 'video', url: ogVideo, thumbnail: ogImage || '' })
  } else if (ogImage && !/rsrc\.php|static\.cdninstagram|t51\.82787-19/i.test(ogImage)) {
    media.push({ type: 'image', url: ogImage })
  }

  if (!media.length) {
    throw new Error('Postingan Threads tidak berisi media foto/video atau bersifat privat.')
  }

  return {
    status: true,
    data: {
      username: userMatch?.[1] || ogTitle.match(/@([A-Za-z0-9._]+)/)?.[1] || 'Unknown',
      profile_pic: '',
      caption: ogDesc,
      media
    }
  }
}

export default threadsDownload
