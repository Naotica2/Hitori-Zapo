/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * MUSIXMATCH.js — Musixmatch Search & Synced Lyrics Client (ESM, zero-dep, session-cached token)
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SESSION_DIR = path.join(ROOT, 'session')

const BASE = 'https://apic-appmobile.musixmatch.com/ws/1.1'
const APP_ID = 'android-player-v1.0'
const UA = 'Musixmatch/8.5.0 (Android 13; Pixel 7)'
const DEFAULT_TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 3_000

const getTokenFilePath = () =>
  process.env.MUSIXMATCH_TOKEN_FILE || path.join(SESSION_DIR, 'musixmatch_token.json')

const NORM = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const NOISE =
  /(^|\s|\()(cover|tribute|karaoke|remix|acoustic|piano|instrumental|reprise|sampler|edit)(\s|\)|$)|(^|-|\()\s*(live|demo)\b/i

let cachedToken = null
let pendingTokenPromise = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readTokenFile(filePath = getTokenFilePath()) {
  if (!existsSync(filePath)) return null
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'))
    if (data?.token && typeof data.token === 'string' && !/^0+$/.test(data.token)) {
      return data
    }
  } catch {}
  return null
}

export function loadToken(filePath = getTokenFilePath()) {
  if (cachedToken && !/^0+$/.test(cachedToken)) return cachedToken
  const saved = readTokenFile(filePath)
  if (saved?.token) {
    cachedToken = saved.token
    return cachedToken
  }
  const envToken = String(process.env.MUSIXMATCH_TOKEN || '').trim()
  if (envToken && !/^0+$/.test(envToken)) {
    cachedToken = envToken
    return cachedToken
  }
  return null
}

export function saveToken(token, filePath = getTokenFilePath()) {
  if (!token || typeof token !== 'string' || /^0+$/.test(token)) return
  cachedToken = token
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify({ token, updatedAt: Date.now() }, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function clearToken(filePath = getTokenFilePath()) {
  cachedToken = null
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {}
}

async function parseJsonResponse(res, label) {
  const raw = await res.text()
  const contentType = String(res.headers?.get('content-type') || '').toLowerCase()
  const trimmed = raw.trim()

  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error(`musixmatch: ${label} membalas non-JSON (HTTP ${res.status}${contentType ? `, ${contentType}` : ''})`)
  }

  let json
  try {
    json = JSON.parse(trimmed)
  } catch {
    throw new Error(`musixmatch: respons ${label} tidak valid (HTTP ${res.status}): ${trimmed.slice(0, 120)}`)
  }

  if (!res.ok && !json?.message?.header) {
    throw new Error(`musixmatch: ${label} HTTP ${res.status}`)
  }
  return json
}

async function fetchFreshToken(attempts = 2) {
  let hint = ''
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(RETRY_DELAY_MS)
    const qs = new URLSearchParams({ app_id: APP_ID, format: 'json' })
    const res = await fetch(`${BASE}/token.get?${qs}`, {
      headers: {
        'user-agent': UA,
        'x-requested-with': 'com.musixmatch.android.lyrify'
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    })
    const json = await parseJsonResponse(res, 'token.get')
    const header = json?.message?.header || {}
    const value = json?.message?.body?.user_token

    if (value && !/^0+$/.test(value)) {
      saveToken(value)
      return value
    }

    hint = header.hint || `status ${header.status_code || res.status}`
    if (String(hint).toLowerCase().includes('captcha')) {
      break
    }
  }

  throw new Error(
    `musixmatch: gagal mengambil token (${hint || 'unknown'}) — IP mungkin sedang kena limit sementara, coba lagi nanti atau set MUSIXMATCH_TOKEN`
  )
}

async function getToken({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const existing = loadToken()
    if (existing) return existing
  } else {
    clearToken()
  }

  if (!pendingTokenPromise) {
    pendingTokenPromise = fetchFreshToken().finally(() => {
      pendingTokenPromise = null
    })
  }
  return pendingTokenPromise
}

export async function request(apiPath, params = {}, retry = true) {
  const token = await getToken()
  const qs = new URLSearchParams({ app_id: APP_ID, usertoken: token, format: 'json', ...params })
  const res = await fetch(`${BASE}/${apiPath}?${qs}`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  })
  const json = await parseJsonResponse(res, apiPath)
  const header = json?.message?.header || {}

  if (retry && (header.status_code === 401 || header.status_code === 403)) {
    await getToken({ forceRefresh: true })
    return request(apiPath, params, false)
  }

  if (header.status_code !== 200) {
    throw new Error(`musixmatch: ${apiPath} ${header.status_code} ${header.hint || ''}`.trim())
  }
  return json.message.body
}

function shapeTrack(t) {
  return {
    id: t.track_id,
    title: t.track_name,
    artist: t.artist_name,
    album: t.album_name,
    cover: t.album_coverart_500x500 || t.album_coverart_350x350 || t.album_coverart_100x100 || null,
    rating: t.track_rating,
    favourites: t.num_favourite || 0,
    released: t.first_release_date || null,
    hasLyrics: !!t.has_lyrics,
    hasSynced: !!t.has_subtitles,
    instrumental: !!t.instrumental,
    language: t.lyrics_language || null,
    spotifyId: t.track_spotify_id || null,
    shareUrl: t.track_share_url || null
  }
}

export async function searchTracks({
  q,
  track,
  artist,
  album,
  lyrics,
  limit = 10,
  sort = 'desc',
  preferOriginal = false
} = {}) {
  if (!q && !track && !artist && !album && !lyrics) {
    throw new Error('musixmatch: masukkan judul, artis, album, atau potongan lirik')
  }

  const body = await request('track.search', {
    ...(track || q ? { q_track: track || q } : {}),
    ...(artist ? { q_artist: artist } : {}),
    ...(album ? { q_album: album } : {}),
    ...(lyrics ? { q_lyrics: lyrics } : {}),
    page: 1,
    page_size: Math.max(limit, 10),
    f_has_lyrics: 1,
    s_track_rating: sort,
    quorum_factor: 1
  })

  const list = (body?.track_list || []).map((x) => shapeTrack(x.track))
  const clean = list.filter((x) => !NOISE.test(x.title))
  const ranked = clean.length ? clean : list

  ranked.sort(
    (a, b) =>
      b.rating - a.rating ||
      b.favourites - a.favourites ||
      String(a.released || '').localeCompare(String(b.released || ''))
  )

  if (!preferOriginal || (!track && !q)) return ranked.slice(0, limit)

  const want = NORM(track || q)
  const base = ` ${want} `
  const og = ranked
    .filter((x) => x.title)
    .filter((x) => ` ${NORM(x.title)} `.startsWith(base))
    .sort(
      (a, b) =>
        String(a.released || '9999').localeCompare(String(b.released || '9999')) ||
        Number(b.hasSynced) - Number(a.hasSynced)
    )

  return (og.length ? og : ranked).slice(0, limit)
}

function parseSyncedLines(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((x) => ({ time: x.time?.total ?? 0, text: String(x.text || '') }))
  } catch {
    return []
  }
}

function formatLrcStamp(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(Math.floor(s % 60)).padStart(2, '0')
  const cs = String(Math.min(99, Math.round((s % 1) * 100))).padStart(2, '0')
  return `${mm}:${ss}.${cs}`
}

function toLrc(list) {
  return list
    .filter((line) => line.text.trim())
    .map((line) => `[${formatLrcStamp(line.time)}]${line.text}`)
    .join('\n')
}

export async function getLyrics({ trackId, track, artist, q, preferOriginal = false } = {}) {
  if (!trackId && !track && !q) {
    throw new Error('musixmatch: masukkan trackId, track, atau q')
  }

  let resolvedId = trackId || null
  if (!resolvedId && (!track || !artist)) {
    const hits = await searchTracks({ track: track || q, artist, limit: 1, preferOriginal })
    resolvedId = hits[0]?.id || null
    if (!resolvedId) throw new Error('musixmatch: lagu tidak ditemukan')
  }

  let body = await request('macro.subtitles.get', {
    namespace: 'lyrics_synched',
    subtitle_format: 'mxm',
    ...(resolvedId
      ? { track_id: resolvedId }
      : { ...(track ? { q_track: track } : {}), ...(artist ? { q_artist: artist } : {}) })
  })

  let calls = body?.macro_calls || {}
  let t = calls['matcher.track.get']?.message?.body?.track

  if ((!t || !t.track_id) && !resolvedId && track && artist) {
    const fallbackHits = await searchTracks({ track, artist, limit: 1, preferOriginal })
    if (fallbackHits[0]?.id) {
      body = await request('macro.subtitles.get', {
        namespace: 'lyrics_synched',
        subtitle_format: 'mxm',
        track_id: fallbackHits[0].id
      })
      calls = body?.macro_calls || {}
      t = calls['matcher.track.get']?.message?.body?.track
    }
  }

  if (!t || !t.track_id) throw new Error('musixmatch: lagu tidak ditemukan')

  const plain = calls['track.lyrics.get']?.message?.body?.lyrics || {}
  const subs = calls['track.subtitles.get']?.message?.body?.subtitle_list || []
  const synced = subs.length ? parseSyncedLines(subs[0].subtitle?.subtitle_body) : []

  return {
    ...shapeTrack(t),
    language: plain.lyrics_language || t.lyrics_language || null,
    lyricId: plain.lyrics_id || null,
    lyrics: plain.lyrics_body || '',
    synced,
    lrc: synced.length ? toLrc(synced) : '',
    copyright: plain.lyrics_copyright || subs[0]?.subtitle?.lyrics_copyright || '',
    updatedAt: plain.updated_time || null
  }
}

export default { searchTracks, getLyrics, request, loadToken, saveToken }
