/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * lirik.js — Cari lirik lagu, LRC sinkron (.lrc), dan tebak judul dari potongan lirik
 */
import config from '../../config.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import { downloadUrlBuffer, extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { getLyrics, searchTracks } from '../../scraper/MUSIXMATCH.js'

const SEARCH_SESSIONS = (globalThis.HITORI_LYRIC_SEARCH_SESSIONS ??= new Map())
const LRC_CACHE = (globalThis.HITORI_LRC_CACHE ??= new Map())
const CACHE_TTL_MS = 10 * 60 * 1000
const PER_PAGE = 5
const MAX_CHUNK_LEN = 3400

function pruneExpired(map) {
  const now = Date.now()
  for (const [key, entry] of map.entries()) {
    if (now - (entry.createdAt || 0) > CACHE_TTL_MS) map.delete(key)
  }
}

function cut(str, n) {
  const clean = String(str || '').replace(/\s+/g, ' ').trim()
  return clean.length > n ? clean.slice(0, n - 1).trimEnd() + '…' : clean
}

function sanitizeFileName(name) {
  return String(name || 'lyrics')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'lyrics'
}

function chunkText(text, maxLen = MAX_CHUNK_LEN) {
  const normalized = String(text || '').trim()
  if (normalized.length <= maxLen) return normalized ? [normalized] : []

  const chunks = []
  let rest = normalized
  while (rest.length > maxLen) {
    let splitAt = rest.lastIndexOf('\n', maxLen)
    if (splitAt < Math.floor(maxLen * 0.4)) {
      splitAt = rest.lastIndexOf(' ', maxLen)
    }
    if (splitAt <= 0) splitAt = maxLen
    chunks.push(rest.slice(0, splitAt).trimEnd())
    rest = rest.slice(splitAt).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}

function parseQuery(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return { mode: 'empty', query: '', artist: '' }

  const tokens = text.split(/\s+/)
  const first = tokens[0].toLowerCase()
  const tail = tokens.slice(1).join(' ').trim()

  if (['cari', 'search', 'list', '-s', '--search'].includes(first) && tail) {
    return { mode: 'search', query: tail, artist: '' }
  }
  if (['tebak', 'potongan', 'snippet', '-f', '--lyrics'].includes(first) && tail) {
    return { mode: 'snippet', query: tail, artist: '' }
  }

  const pipeIdx = text.indexOf('|')
  if (pipeIdx > 0) {
    const track = text.slice(0, pipeIdx).trim()
    const artist = text.slice(pipeIdx + 1).trim()
    return { mode: 'direct', query: track, artist }
  }

  return { mode: 'direct', query: text, artist: '' }
}

async function sendLrcDocument(ctx, item, sendOpts) {
  if (!item?.lrc) {
    return ctx.client.message.send(ctx.chat, 'ℹ️ Lagu ini belum punya lirik sinkron (.lrc) di Musixmatch.', sendOpts)
  }

  const baseName = sanitizeFileName(`${item.title} - ${item.artist}`)
  await ctx.client.message.send(
    ctx.chat,
    {
      type: 'document',
      media: Buffer.from(item.lrc, 'utf8'),
      mimetype: 'text/plain',
      fileName: `${baseName}.lrc`,
      caption: `🎼 Synced LRC: *${item.title}* — ${item.artist}`
    },
    sendOpts
  )
}

async function deliverLyrics(ctx, song, { asLrcOnly = false } = {}) {
  const rawEvent = getEvent(ctx)
  const sendOpts = rawEvent ? { quote: rawEvent } : {}

  if (asLrcOnly) {
    if (!song.lrc) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `ℹ️ *${song.title}* — ${song.artist} belum punya lirik sinkron (.lrc), adanya lirik teks biasa. Coba pakai *${config.mainPrefix}lirik*.`,
        sendOpts
      )
    }
    await sendLrcDocument(ctx, song, sendOpts)
    await ctx.react('✅')
    return
  }

  const year = song.released ? String(song.released).slice(0, 4) : '-'
  const metaLines = [
    '┌───「 🎵 *MUSIXMATCH* 」───┐',
    '',
    `• Judul  : *${song.title}*`,
    `• Artis  : ${song.artist || '-'}`,
    `• Album  : ${song.album || '-'} (${year})`,
    `• LRC    : ${song.lrc ? 'Tersedia (.lrc)' : 'Tidak ada'}`
  ]
  if (song.shareUrl) metaLines.push(`• Link   : ${song.shareUrl}`)
  metaLines.push('', '└─────────────────────────┘')

  const headerText = metaLines.join('\n')

  if (song.cover) {
    try {
      const coverBuf = await downloadUrlBuffer(song.cover, { timeout: 15_000 })
      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: coverBuf,
          mimetype: 'image/jpeg',
          caption: headerText
        },
        sendOpts
      )
    } catch {
      await ctx.client.message.send(ctx.chat, headerText, sendOpts)
    }
  } else {
    await ctx.client.message.send(ctx.chat, headerText, sendOpts)
  }

  if (song.instrumental) {
    await ctx.client.message.send(ctx.chat, '🎼 Lagu ini berstatus *Instrumental* (tidak memiliki lirik).', sendOpts)
    await ctx.react('✅')
    return
  }

  if (!song.lyrics) {
    await ctx.client.message.send(ctx.chat, 'ℹ️ Lirik teks lagu ini dibatasi hak cipta atau belum tersedia di Musixmatch.')
    await ctx.react('✅')
    return
  }

  const parts = chunkText(song.lyrics)
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1
    let body = parts[i]
    if (isLast) {
      if (song.copyright) {
        body += `\n\n_${cut(song.copyright, 160)}_`
      }
      body += `\n\n> ✨ _*Powered by ${config.botName}*_`
    }
    await ctx.client.message.send(ctx.chat, body)
  }

  if (song.lrc) {
    pruneExpired(LRC_CACHE)
    const lrcKey = `lrc:${ctx.sender}:${song.id}:${Date.now()}`
    LRC_CACHE.set(lrcKey, {
      title: song.title,
      artist: song.artist,
      lrc: song.lrc,
      createdAt: Date.now()
    })

    onRichReply(lrcKey, async (c2) => {
      const cached = LRC_CACHE.get(lrcKey)
      if (!cached) {
        return c2.reply(`⏱️ Tombol .lrc sudah kedaluwarsa. Jalankan *${config.mainPrefix}lrc ${song.title}* lagi.`)
      }
      const ev = getEvent(c2)
      await sendLrcDocument(c2, cached, ev ? { quote: ev } : {})
    })

    try {
      await ctx.client.message.send(ctx.chat, {
        interactiveMessage: {
          body: { text: 'Ingin file lirik sinkron (*.lrc*) untuk music player?' },
          footer: { text: `${config.botName} • Musixmatch` },
          nativeFlowMessage: {
            messageVersion: 1,
            buttons: [
              {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                  display_text: '📄 Download .lrc',
                  id: lrcKey
                })
              }
            ]
          }
        }
      })
    } catch {}
  }

  await ctx.react('✅')
}

async function sendSearchChoices(ctx, query, results, { asLrcOnly = false, isSnippet = false } = {}) {
  pruneExpired(SEARCH_SESSIONS)
  const items = results.slice(0, PER_PAGE)
  const sessionId = `${Date.now()}`

  SEARCH_SESSIONS.set(`${ctx.sender}:${sessionId}`, {
    items,
    asLrcOnly,
    createdAt: Date.now()
  })

  const lines = [
    `✦ ──『 🔎 *HASIL MUSIXMATCH* 』── ✦`,
    '',
    `• ${isSnippet ? 'Potongan Lirik' : 'Pencarian'}: _${cut(query, 60)}_`,
    ''
  ]

  const buttons = items.map((t, i) => {
    const yr = t.released ? ` (${String(t.released).slice(0, 4)})` : ''
    const lrcBadge = t.hasSynced ? ' • LRC' : ''
    lines.push(`${i + 1}. *${cut(t.title, 42)}*${yr}`)
    lines.push(`   👤 ${cut(t.artist, 34)}${lrcBadge}`)

    const pickId = `hitorilirik:${ctx.sender}:${sessionId}:${i}`
    onRichReply(pickId, async (c2) => {
      const sess = SEARCH_SESSIONS.get(`${ctx.sender}:${sessionId}`)
      const picked = sess?.items?.[i]
      if (!picked) {
        return c2.reply(`⏱️ Pilihan pencarian sudah kedaluwarsa. Ketik *${config.mainPrefix}lirik ${cut(query, 35)}* lagi.`)
      }
      await c2.react('⏳')
      try {
        const song = await getLyrics({ trackId: picked.id })
        await deliverLyrics(c2, song, { asLrcOnly: sess.asLrcOnly })
      } catch (err) {
        await c2.react('❎')
        await c2.reply('❌ Gagal memuat lirik: ' + String(err.message || err).slice(0, 220))
      }
    })

    return {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: `${i + 1}. ${cut(t.title, 20)}`,
        id: pickId
      })
    }
  })

  lines.push('', 'Tap tombol di bawah untuk lihat liriknya 🎶')

  try {
    await ctx.client.message.send(ctx.chat, {
      interactiveMessage: {
        body: { text: lines.join('\n') },
        footer: { text: `${config.botName} • Pilih Lagu` },
        nativeFlowMessage: {
          messageVersion: 1,
          buttons
        }
      }
    })
  } catch {
    await ctx.reply(lines.join('\n'))
  }

  await ctx.react('✅')
}

export default {
  name: 'lirik',
  aliases: ['lyrics', 'lyric', 'carilirik', 'lrc'],
  tags: 'tools',
  cooldown: 3000,
  description: 'Cari lirik lagu, LRC sinkron, atau tebak judul dari potongan lirik',

  async run(ctx) {
    const p = config.mainPrefix
    const asLrcOnly = String(ctx.command || '').toLowerCase() === 'lrc'
    const quotedText = extractTextFromMessage(getQuotedMessage(ctx)).trim()
    const rawInput = (ctx.text || quotedText).trim()
    const parsed = parseQuery(rawInput)

    if (parsed.mode === 'empty') {
      return ctx.reply(
        '🎵 *MUSIXMATCH LYRICS*\n\n' +
          `*Cara Pakai:*\n` +
          `• *${p}lirik <judul>* — langsung tampilkan lirik lagu\n` +
          `• *${p}lirik <judul> | <artis>* — hasil lebih presisi\n` +
          `• *${p}lirik cari <judul>* — pilih dari daftar lagu\n` +
          `• *${p}lirik tebak <potongan lirik>* — tebak lagu dari lirik\n` +
          `• *${p}lrc <judul>* — langsung kirim file lirik sinkron (.lrc)\n\n` +
          `_Atau reply pesan berisi potongan lirik / judul lagu dengan *${p}lirik*._`
      )
    }

    await ctx.react('⏳')

    try {
      if (parsed.mode === 'snippet') {
        const hits = await searchTracks({ lyrics: parsed.query, limit: PER_PAGE })
        if (!hits.length) {
          await ctx.react('❎')
          return ctx.reply(`❌ Tidak menemukan lagu dengan potongan lirik _"${cut(parsed.query, 60)}"_.`)
        }
        return await sendSearchChoices(ctx, parsed.query, hits, { asLrcOnly, isSnippet: true })
      }

      if (parsed.mode === 'search') {
        let hits = await searchTracks({ track: parsed.query, limit: PER_PAGE, preferOriginal: true })
        let isSnippet = false
        if (!hits.length) {
          hits = await searchTracks({ lyrics: parsed.query, limit: PER_PAGE })
          isSnippet = true
        }
        if (!hits.length) {
          await ctx.react('❎')
          return ctx.reply(`❌ Lagu _"${cut(parsed.query, 60)}"_ tidak ditemukan di katalog Musixmatch.`)
        }
        return await sendSearchChoices(ctx, parsed.query, hits, { asLrcOnly, isSnippet })
      }

      if (parsed.artist) {
        const song = await getLyrics({ track: parsed.query, artist: parsed.artist })
        return await deliverLyrics(ctx, song, { asLrcOnly })
      }

      let hits = await searchTracks({ track: parsed.query, limit: 1, preferOriginal: true })
      if (!hits.length) {
        hits = await searchTracks({ lyrics: parsed.query, limit: 1 })
      }
      if (!hits.length) {
        await ctx.react('❎')
        return ctx.reply(`❌ Lirik untuk _"${cut(parsed.query, 60)}"_ tidak ditemukan di Musixmatch.`)
      }

      const song = await getLyrics({ trackId: hits[0].id })
      return await deliverLyrics(ctx, song, { asLrcOnly })
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal mengambil lirik: ' + String(err.message || err).slice(0, 220))
    }
  }
}
