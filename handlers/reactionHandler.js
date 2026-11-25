/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * reactionHandler.js — Listener react emoji musik (🎵/🎶/🎧/▶️) buat search & play lagu dari YouTube.
 */
import { proto } from 'zapo-js'
import config from '../config.js'
import { logger } from '../core/logger.js'
import { checkCooldown, checkFlood } from '../core/cooldown.js'
import { getUser } from '../core/database.js'
import { getStaffEntry } from '../core/staff.js'
import { sendTyping } from '../core/presence.js'
import { downloadUrlBuffer, extractTextFromMessage } from '../lib/media.js'
import { searchYouTube, searchYouTubeMusic } from '../scraper/YT-Search.js'
import { ytdl } from '../scraper/YT-DL.js'

const MUSIC_EMOJIS = new Set(['🎵', '🎶', '🎧', '▶'])
const YT_URL_RE = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i
const LIVE_INTENT_RE =
  /\b(video|mv|official\s+video|live|concert|konser|cover|remix|slowed|sped\s*up|karaoke|lirik|lyric|acoustic)\b/i

const MAX_RECENT_MESSAGES = 1500
const DEDUPE_WINDOW_MS = 8000
const COOLDOWN_MS = 5000

const normalizeEmoji = (emoji) => String(emoji ?? '').replace(/\uFE0F/g, '').trim()

const digitsOf = (jid) => String(jid ?? '').split('@')[0].split(':')[0]

function unwrapMessage(message) {
  let current = message
  for (let i = 0; i < 10 && current && typeof current === 'object'; i += 1) {
    const inner =
      current.ephemeralMessage?.message ??
      current.groupMentionedMessage?.message ??
      current.botInvokeMessage?.message ??
      current.deviceSentMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message
    if (!inner) return current
    current = inner
  }
  return current
}

/** Extracts text or caption from standard and rich/interactive WhatsApp messages. */
export function extractReactedText(message) {
  if (!message) return ''
  const msg = unwrapMessage(message)
  const baseText = extractTextFromMessage(msg)
  if (baseText) return String(baseText).trim()

  const fallback =
    msg?.buttonsMessage?.contentText ??
    msg?.listMessage?.description ??
    msg?.listMessage?.title ??
    msg?.interactiveMessage?.body?.text ??
    msg?.interactiveMessage?.header?.title ??
    msg?.templateMessage?.hydratedTemplate?.hydratedContentText ??
    msg?.templateMessage?.hydratedFourRowTemplate?.hydratedContentText ??
    (msg?.protocolMessage?.editedMessage
      ? extractReactedText(msg.protocolMessage.editedMessage)
      : '')

  return String(fallback ?? '').trim()
}

function cacheMessage(cache, id, entry) {
  if (!id || !entry?.message) return
  if (cache.has(id)) cache.delete(id)
  cache.set(id, entry)
  if (cache.size > MAX_RECENT_MESSAGES) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

async function resolveTargetMessage(cache, store, sessionId, chatJid, reaction) {
  const targetId = reaction?.key?.id
  if (!targetId) return null

  const cached = cache.get(targetId)
  if (cached) return cached

  // Zapo writeBehind queues SQLite flushes asynchronously, so DB acts as persistence fallback
  try {
    const record = await store?.session?.(sessionId)?.messages?.getById?.(targetId)
    if (record?.messageBytes) {
      const decoded = proto.Message.decode(record.messageBytes)
      const key = {
        remoteJid: record.threadJid || chatJid,
        fromMe: Boolean(record.fromMe),
        id: record.id,
        ...(record.participantJid ? { participant: record.participantJid } : {})
      }
      const resolved = { key, message: decoded }
      cacheMessage(cache, targetId, resolved)
      return resolved
    }
  } catch (err) {
    logger.debug({ err: err.message, targetId }, 'lookup target reaction message gagal')
  }

  return {
    key: {
      remoteJid: reaction?.key?.remoteJid || chatJid,
      fromMe: Boolean(reaction?.key?.fromMe),
      id: targetId,
      ...(reaction?.key?.participant ? { participant: reaction.key.participant } : {})
    },
    message: null
  }
}

function resolveReactorIdentity(key) {
  const primary = key?.participant ?? key?.remoteJid
  const alt = key?.participantAlt ?? key?.remoteJidAlt
  const pnJid = primary?.endsWith('@lid') ? (alt ?? primary) : primary
  const lidJid = primary?.endsWith('@lid') ? primary : alt?.endsWith('@lid') ? alt : undefined
  const senderNumber = digitsOf(pnJid)
  const isStaff = Boolean(getStaffEntry(senderNumber, lidJid))
  return { pnJid, lidJid, senderNumber, isStaff }
}

function parseQueryTarget(rawText) {
  const urlMatch = rawText.match(YT_URL_RE)
  if (urlMatch) {
    return {
      url: urlMatch[0].replace(/[),.!?]+$/, ''),
      query: ''
    }
  }
  return {
    url: '',
    query: rawText.replace(/\s+/g, ' ').trim().slice(0, 140)
  }
}

function pickBestMusicResult(results, query) {
  if (!Array.isArray(results) || results.length === 0) return null
  if (!LIVE_INTENT_RE.test(query)) {
    const studioSong = results.slice(0, 4).find((r) => /^(lagu|song)$/i.test(r.type || ''))
    if (studioSong) return studioSong
  }
  return results[0]
}

async function searchMusicTrack(query) {
  try {
    const musicResults = await searchYouTubeMusic(query, 6)
    const picked = pickBestMusicResult(musicResults, query)
    if (picked) return picked
  } catch (err) {
    logger.debug({ err: err.message, query }, 'searchYouTubeMusic gagal, fallback HTML')
  }

  try {
    const ytResults = await searchYouTube(query, 5)
    if (ytResults.length > 0) return ytResults[0]
  } catch (err) {
    logger.debug({ err: err.message, query }, 'searchYouTube gagal, fallback jhx API')
  }

  try {
    const res = await fetch('https://api.jhx.my.id/yt-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        Referer: 'https://jhx.my.id/ytdl/'
      },
      body: JSON.stringify({ q: query }),
      signal: AbortSignal.timeout(12_000)
    })
    const json = await res.json().catch(() => null)
    const first = Array.isArray(json?.data) ? json.data[0] : null
    if (first?.url) return first
  } catch (err) {
    logger.debug({ err: err.message, query }, 'jhx yt-search fallback gagal')
  }

  return null
}

async function fetchAudioDownload(videoUrl) {
  try {
    const dl = await ytdl.download(videoUrl, 'mp3')
    if (dl?.status === 'success' && dl.download_url) {
      return { downloadUrl: dl.download_url, title: dl.title || '' }
    }
  } catch (err) {
    logger.debug({ err: err.message, videoUrl }, 'ytdl savenow gagal, coba fallback jhx')
  }

  const res = await fetch('https://api.jhx.my.id/yt-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      Referer: 'https://jhx.my.id/ytdl/'
    },
    body: JSON.stringify({ url: videoUrl, format: 'mp3' }),
    signal: AbortSignal.timeout(60_000)
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.Status || !json?.data?.url) {
    throw new Error('Gagal mengambil audio dari semua provider YouTube.')
  }
  return { downloadUrl: json.data.url, title: json.data.title || '' }
}

async function safeReactTarget(client, chatJid, targetKey, emoji) {
  if (!chatJid || !targetKey?.id) return
  try {
    await client.message.send(chatJid, { type: 'reaction', emoji, target: targetKey })
  } catch {}
}

function isDuplicateRecent(recentEvents, key) {
  const now = Date.now()
  for (const [k, ts] of recentEvents) {
    if (now - ts > DEDUPE_WINDOW_MS) recentEvents.delete(k)
  }
  if (recentEvents.has(key)) return true
  recentEvents.set(key, now)
  return false
}

/**
 * Attaches message caching and reaction-triggered YouTube audio playback to a Zapo client.
 * @param {import('zapo-js').WaClient} client
 * @param {import('zapo-js').WaStore} store
 * @param {object} [opts]
 */
export function setupReactionHandler(client, store, opts = {}) {
  const sessionId = opts.sessionId ?? 'default'
  const searchTrack = opts.searchMusicTrack ?? searchMusicTrack
  const downloadAudio = opts.fetchAudioDownload ?? fetchAudioDownload
  const downloadBuffer = opts.downloadUrlBuffer ?? downloadUrlBuffer

  // Cache lives per-client so concurrent bot restarts/tests remain isolated
  const recentMessages = new Map()
  const recentEvents = new Map()
  const activeJobs = new Set()

  async function processMusicReaction({ chatJid, reactorKey, reaction, fromMe }) {
    if (fromMe) return

    const emoji = normalizeEmoji(reaction?.text)
    if (!emoji || !MUSIC_EMOJIS.has(emoji)) return

    const targetId = reaction?.key?.id
    if (!chatJid || !targetId) return

    const { pnJid, lidJid, senderNumber, isStaff } = resolveReactorIdentity(reactorKey)
    if (!isStaff) {
      const rowPn = pnJid ? getUser(pnJid) : undefined
      const rowLid = lidJid ? getUser(lidJid) : undefined
      if (rowPn?.banned || rowLid?.banned) return
    }

    const dedupeKey = `${chatJid}:${pnJid || senderNumber}:${targetId}:${emoji}`
    if (isDuplicateRecent(recentEvents, dedupeKey)) return

    const jobKey = `${chatJid}:${targetId}`
    if (activeJobs.has(jobKey)) return

    const target = await resolveTargetMessage(recentMessages, store, sessionId, chatJid, reaction)
    const targetKey = target?.key
    const quoteRef = target?.message ? { key: targetKey, message: target.message } : targetKey
    const sendOpts = quoteRef ? { quote: quoteRef } : {}

    if (!isStaff && config.antiSpam?.enabled) {
      const flood = checkFlood(pnJid || senderNumber, config.antiSpam)
      if (flood.flooded) return
    }

    if (!isStaff) {
      const cd = checkCooldown(pnJid || senderNumber, 'reaction_music', COOLDOWN_MS)
      if (cd.onCooldown) {
        await client.message
          .send(chatJid, `⏳ Tunggu ${(cd.remainingMs / 1000).toFixed(1)} detik sebelum react lagu lagi.`, sendOpts)
          .catch(() => {})
        return
      }
    }

    const rawText = extractReactedText(target?.message)
    if (!rawText) {
      await client.message
        .send(
          chatJid,
          '🎵 Untuk memutar lagu lewat react, beri react emoji musik (🎵/🎶/🎧/▶️) ke pesan yang berisi *judul lagu* atau *link YouTube*.',
          sendOpts
        )
        .catch(() => {})
      return
    }

    const { url, query } = parseQueryTarget(rawText)
    if (!url && !query) return

    activeJobs.add(jobKey)
    try {
      await safeReactTarget(client, chatJid, targetKey, '⏳')
      if (config.typingPresence) void sendTyping(client, chatJid)

      let videoUrl = url
      let title = ''
      if (!videoUrl) {
        const track = await searchTrack(query)
        if (!track?.url) {
          await safeReactTarget(client, chatJid, targetKey, '❎')
          await client.message
            .send(chatJid, `❌ Lagu *"${query}"* tidak ditemukan di YouTube.`, sendOpts)
            .catch(() => {})
          return
        }
        videoUrl = track.url
        title = track.title || ''
      }

      logger.info(`🎵 [REACT MUSIC] +${senderNumber} → "${title || query || videoUrl}"`)

      const { downloadUrl, title: dlTitle } = await downloadAudio(videoUrl)
      if (!title && dlTitle) title = dlTitle

      const audioBuffer = await downloadBuffer(downloadUrl, {
        timeout: 120_000,
        maxBytes: 99 * 1024 * 1024
      })

      await client.message.send(
        chatJid,
        {
          type: 'audio',
          media: audioBuffer,
          mimetype: 'audio/mpeg',
          ptt: true
        },
        sendOpts
      )

      await safeReactTarget(client, chatJid, targetKey, '🎶')
    } catch (err) {
      logger.warn({ err: err.message, chatJid, targetId }, '🎵 React music gagal')
      await safeReactTarget(client, chatJid, targetKey, '❎')
      await client.message
        .send(chatJid, `❌ Gagal memproses audio: ${String(err.message || err).slice(0, 180)}`, sendOpts)
        .catch(() => {})
    } finally {
      activeJobs.delete(jobKey)
    }
  }

  client.on('message', (event) => {
    if (event?.key?.id && event?.message) {
      cacheMessage(recentMessages, event.key.id, {
        key: event.key,
        message: event.message
      })
    }

    const unwrapped = unwrapMessage(event?.message)
    if (unwrapped?.reactionMessage) {
      const chatJid = event.key?.remoteJid || unwrapped.reactionMessage.key?.remoteJid
      void processMusicReaction({
        chatJid,
        reactorKey: event.key,
        reaction: unwrapped.reactionMessage,
        fromMe: Boolean(event.key?.fromMe)
      })
    }
  })

  client.on('message_send', (event) => {
    if (event?.id && event?.message) {
      cacheMessage(recentMessages, event.id, {
        key: {
          remoteJid: event.to,
          fromMe: true,
          id: event.id
        },
        message: event.message
      })
    }
  })

  client.on('message_addon', (event) => {
    if (event?.kind !== 'reaction') return
    const reaction = event.decrypted?.reaction
    const chatJid = event.key?.remoteJid || reaction?.key?.remoteJid
    void processMusicReaction({
      chatJid,
      reactorKey: event.key,
      reaction,
      fromMe: Boolean(event.key?.fromMe)
    })
  })
}
