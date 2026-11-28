/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * SPOTIFY.js — Scraper Spotify Searcher + Downloader (Puppeteer + HTTP & YouTube fallback)
 */
import fs from 'node:fs'
import axios from 'axios'
import FormData from 'form-data'
import puppeteer from 'puppeteer'
import { ytdl } from './YT-DL.js'
import { searchYouTubeMusic } from './YT-Search.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

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

function deepFindByUriPrefix(obj, prefix, found = new Map(), depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 20) return found
  if (typeof obj.uri === 'string' && obj.uri.startsWith(prefix) && obj.name) {
    if (!found.has(obj.uri)) found.set(obj.uri, obj)
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (val && typeof val === 'object') deepFindByUriPrefix(val, prefix, found, depth + 1)
  }
  return found
}

function extractFromBodies(bodies, prefix) {
  const merged = new Map()
  for (const text of bodies) {
    try {
      const parsed = JSON.parse(text)
      deepFindByUriPrefix(parsed, prefix, merged)
    } catch {}
  }
  return [...merged.values()]
}

function mapTrack(t) {
  const tryExtract = () => {
    if (Array.isArray(t.artists?.items)) return t.artists.items.map((a) => a.profile?.name || a.name).filter(Boolean)
    if (Array.isArray(t.artists)) return t.artists.map((a) => a.profile?.name || a.name).filter(Boolean)
    if (Array.isArray(t.firstArtist?.items)) return t.firstArtist.items.map((a) => a.profile?.name || a.name).filter(Boolean)
    if (t.artist?.name) return [t.artist.name]
    return []
  }
  const artistsList = tryExtract()

  return {
    id: t.uri?.split(':')[2],
    uri: t.uri,
    name: t.name,
    artists: artistsList.join(', ') || undefined,
    album: t.albumOfTrack?.name || t.album?.name,
    duration_ms: t.duration?.totalMilliseconds || t.duration_ms,
    cover: t.albumOfTrack?.coverArt?.sources?.[0]?.url || t.album?.images?.[0]?.url,
    preview_url: t.previewUrl || t.preview_url || null,
    spotify_url: `https://open.spotify.com/track/${t.uri?.split(':')[2]}`
  }
}

async function searchHttpFallback(query) {
  // 1. Deezer public search API
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000)
    })
    if (res.ok) {
      const json = await res.json()
      const items = Array.isArray(json?.data) ? json.data : []
      if (items.length) {
        return items.slice(0, 6).map((d) => ({
          id: String(d.id || ''),
          uri: `deezer:track:${d.id}`,
          name: d.title || query,
          artists: d.artist?.name || 'Unknown',
          album: d.album?.title || 'Single',
          duration_ms: Number(d.duration || 0) * 1000,
          cover: d.album?.cover_big || d.album?.cover_medium || '',
          preview_url: d.preview || null,
          spotify_url: `ytsearch://${encodeURIComponent(`${d.artist?.name || ''} - ${d.title || ''}`.trim())}`
        }))
      }
    }
  } catch {}

  // 2. iTunes public search API
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=6`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (res.ok) {
      const json = await res.json()
      const items = Array.isArray(json?.results) ? json.results : []
      if (items.length) {
        return items.map((d) => ({
          id: String(d.trackId || ''),
          uri: `itunes:track:${d.trackId}`,
          name: d.trackName || query,
          artists: d.artistName || 'Unknown',
          album: d.collectionName || 'Single',
          duration_ms: Number(d.trackTimeMillis || 0),
          cover: (d.artworkUrl100 || '').replace('100x100', '600x600'),
          preview_url: d.previewUrl || null,
          spotify_url: `ytsearch://${encodeURIComponent(`${d.artistName || ''} - ${d.trackName || ''}`.trim())}`
        }))
      }
    }
  } catch {}

  // 3. YouTube Music search
  const ytItems = await searchYouTubeMusic(query, 5).catch(() => [])
  return ytItems.map((v) => ({
    id: v.videoId || '',
    uri: `ytm:track:${v.videoId}`,
    name: v.title || query,
    artists: v.artist || v.channel || 'Unknown',
    album: 'YouTube Music',
    duration_ms: 0,
    cover: v.thumbnail || '',
    preview_url: null,
    spotify_url: `ytsearch://${encodeURIComponent(`${v.artist || ''} - ${v.title || ''}`.trim())}`
  }))
}

export async function spotifySearch(query) {
  const baseRes = { status: true, author: 'Hitori-MD', data: {} }
  let browser

  try {
    const executablePath = resolveSystemChromePath()
    browser = await puppeteer.launch({
      headless: 'new',
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })

    const page = await browser.newPage()
    await page.setUserAgent(UA)
    await page.setViewport({ width: 1366, height: 900 })

    const capturedBodies = []
    page.on('response', async (res) => {
      try {
        const ct = res.headers()['content-type'] || ''
        if (ct.includes('application/json')) {
          const text = await res.text()
          if (text && text.length < 3_000_000) capturedBodies.push(text)
        }
      } catch {}
    })

    const searchUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 35_000 })
    await new Promise((r) => setTimeout(r, 1500))

    if (capturedBodies.length) {
      const tracks = extractFromBodies(capturedBodies, 'spotify:track:').map(mapTrack)
      if (tracks.length) {
        baseRes.data = { tracks: tracks.slice(0, 5) }
        return baseRes
      }
    }
  } catch {
    // Fallback otomatis ke Deezer/iTunes/YTMusic bila Chrome/libnspr4.so tidak tersedia atau Spotify membatasi
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  try {
    const fallbackTracks = await searchHttpFallback(query)
    if (!fallbackTracks.length) {
      return { ...baseRes, status: false, error: 'Tidak ditemukan hasil lagu untuk query tersebut.' }
    }
    baseRes.data = { tracks: fallbackTracks.slice(0, 5) }
    return baseRes
  } catch (err) {
    return { ...baseRes, status: false, error: err?.message || String(err) }
  }
}

async function resolveSpotifyTrackTitle(targetUrl) {
  try {
    const oe = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`, {
      signal: AbortSignal.timeout(8000)
    })
    if (oe.ok) {
      const j = await oe.json()
      if (j?.title) return { title: j.title, artist: '' }
    }
  } catch {}

  try {
    const html = await fetch(targetUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000)
    }).then((r) => r.text())
    const titleMatch = html.match(/<title>(.*?)<\/title>/i)?.[1] || ''
    const clean = titleMatch.replace(' - song and lyrics by ', ' - ').split(' | ')[0].trim()
    if (clean) {
      const [title, artist = ''] = clean.split(' - ')
      return { title: title.trim(), artist: artist.trim() }
    }
  } catch {}

  return null
}

async function downloadViaYouTubeFallback(searchQuery, baseRes) {
  const tracks = await searchYouTubeMusic(searchQuery, 4)
  if (!tracks.length) throw new Error(`Lagu "${searchQuery}" tidak ditemukan di fallback YouTube Music.`)
  const pick = tracks[0]

  const dl = await Promise.race([
    ytdl.download(pick.url, 'mp3'),
    new Promise((_, rej) => setTimeout(() => rej(new Error('savenow timeout')), 25_000))
  ]).catch(() => null)
  if (dl?.status === 'success' && dl.download_url) {
    baseRes.data = {
      title: pick.title || dl.title || searchQuery,
      artist: pick.artist || 'Unknown',
      download_url: dl.download_url
    }
    return baseRes
  }

  const jhx = await fetch('https://api.jhx.my.id/yt-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://jhx.my.id/ytdl/', 'User-Agent': UA },
    body: JSON.stringify({ url: pick.url, format: 'mp3' }),
    signal: AbortSignal.timeout(30_000)
  }).then((r) => r.json()).catch(() => null)

  if (jhx?.Status && jhx?.data?.url) {
    baseRes.data = {
      title: pick.title || jhx.data.title || searchQuery,
      artist: pick.artist || 'Unknown',
      download_url: jhx.data.url
    }
    return baseRes
  }

  throw new Error('Gagal mengunduh audio lagu dari fallback YouTube.')
}

export async function spotifyDownload(targetUrl) {
  const baseRes = { status: true, author: 'Hitori-MD', data: {} }

  if (String(targetUrl || '').startsWith('ytsearch://')) {
    try {
      const q = decodeURIComponent(targetUrl.slice('ytsearch://'.length))
      return await downloadViaYouTubeFallback(q, baseRes)
    } catch (err) {
      return { ...baseRes, status: false, error: err?.message || String(err) }
    }
  }

  const reqHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    'user-agent': UA,
    referer: 'https://www.spotify-downloads.com/'
  }

  try {
    const initReq = await axios.post(
      'https://www.spotify-downloads.com/api/download',
      { url: targetUrl, quality: '320k' },
      { headers: reqHeaders, timeout: 15_000 }
    )

    if (!initReq.data?.job_id) {
      throw new Error('Gagal membuat antrean download di server.')
    }

    const jobId = initReq.data.job_id
    let finalData = null

    for (let i = 0; i < 16; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const checkReq = await axios.get(`https://www.spotify-downloads.com/api/status/${jobId}`, {
        headers: reqHeaders,
        timeout: 12_000
      })
      if (checkReq.data?.status === 'ready') {
        finalData = checkReq.data
        break
      }
      if (checkReq.data?.error) {
        throw new Error(checkReq.data.error)
      }
    }

    if (!finalData) throw new Error('Waktu tunggu habis, proses download gagal.')

    const firstTrack = finalData.songs?.[0] || {}
    baseRes.data = {
      job_id: finalData.job_id,
      title: finalData.name || firstTrack.name,
      artist: finalData.artist || firstTrack.artist,
      track_id: firstTrack.track_id || '',
      download_url: `https://www.spotify-downloads.com/api/file/${finalData.job_id}`
    }
    return baseRes
  } catch (error) {
    const rawErr = error.response?.data?.error || error.response?.data?.message || error.response?.data || error.message
    const errStr = typeof rawErr === 'object' ? JSON.stringify(rawErr) : String(rawErr)
    return { ...baseRes, status: false, error: errStr }
  }
}

export async function spotiDownFallback(targetUrl) {
  const baseRes = { status: true, author: 'Hitori-MD', data: {} }

  if (String(targetUrl || '').startsWith('ytsearch://')) {
    try {
      const q = decodeURIComponent(targetUrl.slice('ytsearch://'.length))
      return await downloadViaYouTubeFallback(q, baseRes)
    } catch (err) {
      return { ...baseRes, status: false, error: err?.message || String(err) }
    }
  }

  try {
    const meta = await resolveSpotifyTrackTitle(targetUrl)
    if (meta?.title) {
      const q = meta.artist ? `${meta.artist} - ${meta.title}` : meta.title
      return await downloadViaYouTubeFallback(q, baseRes)
    }

    const spoHtml = await axios.get(targetUrl, { timeout: 10_000 })
    const titleMatch = spoHtml.data.match(/<title>(.*?)<\/title>/i)?.[1] || 'Spotify Track'
    const cleanTitle = titleMatch.replace(' - song and lyrics by ', ' - ').split(' | ')[0]
    const [song_name, artist] = cleanTitle.includes(' - ') ? cleanTitle.split(' - ') : [cleanTitle, 'Unknown']

    const form = new FormData()
    form.append('post_id', '2')
    form.append('form_id', '394636d')
    form.append('referer_title', 'Spotify Music Downloader - Convert Spotify to MP3 Online Free')
    form.append('queried_id', '2')
    form.append('form_fields[music_url]', targetUrl)
    form.append('action', 'elementor_pro_forms_send_form')
    form.append('referrer', 'https://spotidown.net/en/')

    const req1 = await axios.post('https://spotidown.net/en/wp-admin/admin-ajax.php', form, {
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        referer: 'https://spotidown.net/en/',
        ...form.getHeaders()
      },
      timeout: 15_000
    })

    const cookie = req1.headers['set-cookie']
      ? req1.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ')
      : ''

    const step2Encoded = Buffer.from(
      JSON.stringify({ song_name: song_name.trim(), artist: artist.trim(), link: targetUrl })
    ).toString('base64')

    const req2 = await axios.get(
      `https://spotidown.net/en/wp-admin/admin-ajax.php?action=check_download_status&data=${step2Encoded}`,
      {
        headers: {
          accept: '*/*',
          'x-requested-with': 'XMLHttpRequest',
          referer: 'https://spotidown.net/en/downloads/',
          cookie
        },
        timeout: 15_000
      }
    )

    if (!req2.data?.success || !req2.data?.data?.download_id) {
      throw new Error('Gagal inisiasi download ID Spotidown.')
    }

    const downloadId = req2.data.data.download_id
    let finalData = null
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const req3 = await axios.get(
        `https://spotidown.net/en/wp-admin/admin-ajax.php?action=get_download_status&download_id=${downloadId}`,
        {
          headers: {
            accept: '*/*',
            'x-requested-with': 'XMLHttpRequest',
            referer: 'https://spotidown.net/en/downloads/',
            cookie
          },
          timeout: 12_000
        }
      )
      if (req3.data?.success && req3.data?.data?.status === 'ready') {
        finalData = req3.data.data
        break
      }
    }

    if (!finalData) throw new Error('Timeout saat menunggu status download.')
    baseRes.data = finalData
    return baseRes
  } catch (error) {
    const raw = error.response?.data?.message || error.message || error
    return { ...baseRes, status: false, error: typeof raw === 'object' ? JSON.stringify(raw) : String(raw) }
  }
}
