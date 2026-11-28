/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * PINSEARCH.js — Scraper Pinterest Search (Header preload + Bing Images Pinterest fallback)
 */
import * as cheerio from 'cheerio'

const DESK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

async function tryPinterestHead(query, limit) {
  try {
    const encoded = encodeURIComponent(JSON.stringify({ options: { query } }))
    const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?data=${encoded}`
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'screen-dpr': '4',
        'x-pinterest-pws-handler': 'www/search/[scope].js',
        'user-agent': DESK_UA,
        'accept-language': 'en-US,en;q=0.9',
        referer: 'https://www.pinterest.com/'
      },
      signal: AbortSignal.timeout(10_000)
    })
    const linkHeader = res.headers.get('link') || ''
    const regex = /<\s*(https:\/\/i\.pinimg\.com\/[^>]+)\s*>\s*;\s*rel=preload;\s*as=image/gi
    return [...new Set([...linkHeader.matchAll(regex)].map((v) => v[1]))].slice(0, limit)
  } catch {
    return []
  }
}

async function fetchBingPinterestImages(query, limit) {
  const results = []
  const seen = new Set()

  const queries = [`${query} pinterest`, `site:pinterest.com/pin ${query}`]
  for (const q of queries) {
    if (results.length >= limit) break
    try {
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&first=1`
      const res = await fetch(url, {
        headers: {
          'User-Agent': DESK_UA,
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(12_000)
      })
      if (!res.ok) continue
      const html = await res.text()
      const $ = cheerio.load(html)

      const pinimgUrls = []
      const otherUrls = []

      $('a.iusc').each((_, el) => {
        try {
          const meta = JSON.parse($(el).attr('m') || '{}')
          const img = meta.murl
          if (!img || !/^https?:\/\//i.test(img) || seen.has(img)) return
          if (/i\.pinimg\.com/i.test(img)) pinimgUrls.push(img)
          else otherUrls.push(img)
        } catch {}
      })

      for (const u of [...pinimgUrls, ...otherUrls]) {
        if (seen.has(u)) continue
        seen.add(u)
        results.push(u)
        if (results.length >= limit) break
      }
    } catch {}
  }

  return results.slice(0, limit)
}

export async function pinSearch(query = 'Anime Aesthetic', limit = 10) {
  const baseRes = {
    status: true,
    author: 'Hitori-MD',
    data: {}
  }

  const cleanQuery = String(query || '').trim() || 'Anime Aesthetic'
  const cap = Math.max(1, Math.min(Number(limit) || 10, 30))

  try {
    let images = await tryPinterestHead(cleanQuery, cap)
    if (images.length < Math.min(3, cap)) {
      const bingImages = await fetchBingPinterestImages(cleanQuery, cap)
      images = [...new Set([...images, ...bingImages])].slice(0, cap)
    }

    if (images.length === 0) {
      return { ...baseRes, status: false, error: 'Tidak menemukan gambar dari Pinterest untuk kata kunci tersebut.' }
    }

    baseRes.data = {
      query: cleanQuery,
      total: images.length,
      images
    }

    return baseRes
  } catch (error) {
    return {
      ...baseRes,
      status: false,
      error: error?.message || String(error)
    }
  }
}

export default pinSearch
