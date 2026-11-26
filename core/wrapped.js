/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * wrapped.js — Agregator ringan statistik bulanan grup (SQLite, tanpa simpan isi chat mentah)
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import config from '../config.js'
import { buildContext } from './context.js'
import { getSetting } from './groupSettings.js'
import { logger } from './logger.js'

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000
const MAX_WORDS_PER_MSG = 15
const MAX_UNIQUE_WORDS_PER_MONTH = 1000
const MONTH_NAMES_ID = [
  'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
]

const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'tapi', 'tetapi', 'kalau', 'kalo', 'jika', 'bila', 'karena', 'karna', 'sebab',
  'jadi', 'biar', 'agar', 'supaya', 'untuk', 'buat', 'dari', 'pada', 'dengan', 'sama', 'oleh', 'dalam',
  'ini', 'itu', 'situ', 'sini', 'sana', 'nya', 'aku', 'saya', 'kamu', 'engkau', 'anda', 'dia', 'mereka',
  'kita', 'kami', 'gue', 'gua', 'gw', 'lu', 'loe', 'elu', 'apa', 'siapa', 'mana', 'kapan', 'kenapa',
  'mengapa', 'bagaimana', 'gimana', 'berapa', 'ada', 'adalah', 'ialah', 'bukan', 'tidak', 'tak', 'gak',
  'nggak', 'engga', 'enggak', 'bisa', 'dapat', 'boleh', 'harus', 'wajib', 'perlu', 'mau', 'ingin', 'akan',
  'sudah', 'udah', 'telah', 'belum', 'blm', 'lagi', 'masih', 'sedang', 'pernah', 'juga', 'pula', 'pun',
  'saja', 'aja', 'cuma', 'hanya', 'lebih', 'kurang', 'sangat', 'banget', 'sekali', 'bgt', 'terus', 'lalu',
  'kemudian', 'tadi', 'nanti', 'besok', 'kemarin', 'sekarang', 'skrg', 'hari', 'ini', 'sih', 'deh', 'dong',
  'kan', 'kok', 'nih', 'tuh', 'yah', 'lah', 'kah', 'mah', 'loh', 'kek', 'kayak', 'kaya', 'gitu', 'gini',
  'begitu', 'begini', 'semua', 'banyak', 'sedikit', 'satu', 'dua', 'tiga', 'orang', 'hal', 'yaa', 'iya',
  'iyaa', 'oke', 'okee', 'okay', 'ok', 'the', 'and', 'for', 'you', 'are', 'that', 'this', 'with', 'from',
  'have', 'has', 'was', 'were', 'not', 'but', 'what', 'when', 'where', 'who', 'why', 'how', 'can', 'will'
])

const dbInstances = new Map()

function getDbPath() {
  return process.env.HITORI_WRAPPED_DB || './session/wrapped.sqlite'
}

function getDb(dbPath = getDbPath()) {
  const resolved = path.resolve(dbPath)
  const existing = dbInstances.get(resolved)
  if (existing) return existing

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const db = new Database(resolved)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS wrapped_user_monthly (
      month TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      display_name TEXT,
      msg_count INTEGER NOT NULL DEFAULT 0,
      sticker_count INTEGER NOT NULL DEFAULT 0,
      media_count INTEGER NOT NULL DEFAULT 0,
      command_count INTEGER NOT NULL DEFAULT 0,
      night_count INTEGER NOT NULL DEFAULT 0,
      active_days TEXT NOT NULL DEFAULT '',
      last_seen INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month, group_jid, user_jid)
    );
    CREATE TABLE IF NOT EXISTS wrapped_hour_monthly (
      month TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      hour_wib INTEGER NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month, group_jid, hour_wib)
    );
    CREATE TABLE IF NOT EXISTS wrapped_word_monthly (
      month TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      word TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month, group_jid, word)
    );
    CREATE INDEX IF NOT EXISTS idx_wrapped_user_rank
      ON wrapped_user_monthly (month, group_jid, msg_count DESC);
    CREATE INDEX IF NOT EXISTS idx_wrapped_word_rank
      ON wrapped_word_monthly (month, group_jid, count DESC);
  `)
  dbInstances.set(resolved, db)
  return db
}

export function closeWrappedDb(dbPath = getDbPath()) {
  const resolved = path.resolve(dbPath)
  const db = dbInstances.get(resolved)
  if (db) {
    try { db.close() } catch {}
    dbInstances.delete(resolved)
  }
}

export function getWibParts(epochMs = Date.now()) {
  const d = new Date(Number(epochMs) + WIB_OFFSET_MS)
  const year = d.getUTCFullYear()
  const monthNum = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const hour = d.getUTCHours()
  return {
    month: `${year}-${String(monthNum).padStart(2, '0')}`,
    year,
    monthNum,
    day,
    hour
  }
}

export function formatMonthLabel(monthKey) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return String(monthKey || '-')
  const idx = Number.parseInt(m[2], 10) - 1
  return `${MONTH_NAMES_ID[idx] || m[2]} ${m[1]}`
}

export function isWrappedEnabled(groupJid) {
  return getSetting(groupJid, 'wrapped') !== '0'
}

export function extractTrackedWords(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/@\d+\b/g, ' ')
  const tokens = raw.match(/[a-z0-9']{3,20}/g) || []
  const unique = []
  const seen = new Set()
  for (const tok of tokens) {
    const clean = tok.replace(/^'+|'+$/g, '')
    if (clean.length < 3 || /^\d+$/.test(clean) || STOPWORDS.has(clean) || seen.has(clean)) continue
    seen.add(clean)
    unique.push(clean)
    if (unique.length >= MAX_WORDS_PER_MSG) break
  }
  return unique
}

function mergeActiveDays(existingStr, dayNum) {
  const tag = String(dayNum)
  if (!existingStr) return tag
  const set = new Set(existingStr.split(',').filter(Boolean))
  if (set.has(tag)) return existingStr
  set.add(tag)
  return [...set].join(',')
}

function isCountableContent(msg) {
  if (!msg || typeof msg !== 'object') return false
  return Boolean(
    msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage ||
      msg.videoMessage ||
      msg.stickerMessage ||
      msg.audioMessage ||
      msg.documentMessage ||
      msg.documentWithCaptionMessage?.message?.documentMessage
  )
}

export function recordGroupActivity({
  groupJid,
  userJid,
  displayName = '',
  text = '',
  isSticker = false,
  isMedia = false,
  isCommand = false,
  timestampMs = Date.now(),
  dbPath
} = {}) {
  if (!groupJid?.endsWith('@g.us') || !userJid) return false

  const db = getDb(dbPath)
  const { month, day, hour } = getWibParts(timestampMs)
  const isNight = hour >= 23 || hour <= 4 ? 1 : 0
  const cleanName = String(displayName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 48) || null

  const words = isCommand || isSticker ? [] : extractTrackedWords(text)

  const tx = db.transaction(() => {
    const prev = db
      .prepare('SELECT active_days FROM wrapped_user_monthly WHERE month = ? AND group_jid = ? AND user_jid = ?')
      .get(month, groupJid, userJid)

    const nextDays = mergeActiveDays(prev?.active_days || '', day)

    db.prepare(`
      INSERT INTO wrapped_user_monthly (
        month, group_jid, user_jid, display_name,
        msg_count, sticker_count, media_count, command_count, night_count, active_days, last_seen
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(month, group_jid, user_jid) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, wrapped_user_monthly.display_name),
        msg_count = wrapped_user_monthly.msg_count + 1,
        sticker_count = wrapped_user_monthly.sticker_count + excluded.sticker_count,
        media_count = wrapped_user_monthly.media_count + excluded.media_count,
        command_count = wrapped_user_monthly.command_count + excluded.command_count,
        night_count = wrapped_user_monthly.night_count + excluded.night_count,
        active_days = excluded.active_days,
        last_seen = excluded.last_seen
    `).run(
      month,
      groupJid,
      userJid,
      cleanName,
      isSticker ? 1 : 0,
      isMedia ? 1 : 0,
      isCommand ? 1 : 0,
      isNight,
      nextDays,
      Math.floor(timestampMs)
    )

    db.prepare(`
      INSERT INTO wrapped_hour_monthly (month, group_jid, hour_wib, msg_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(month, group_jid, hour_wib) DO UPDATE SET
        msg_count = wrapped_hour_monthly.msg_count + 1
    `).run(month, groupJid, hour)

    if (words.length > 0) {
      const wordCountTotal = db
        .prepare('SELECT COUNT(*) AS c FROM wrapped_word_monthly WHERE month = ? AND group_jid = ?')
        .get(month, groupJid).c

      const upsertWord = db.prepare(`
        INSERT INTO wrapped_word_monthly (month, group_jid, word, count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(month, group_jid, word) DO UPDATE SET
          count = wrapped_word_monthly.count + 1
      `)
      const bumpExistingWord = db.prepare(`
        UPDATE wrapped_word_monthly SET count = count + 1
        WHERE month = ? AND group_jid = ? AND word = ?
      `)

      let remainingRoom = Math.max(0, MAX_UNIQUE_WORDS_PER_MONTH - wordCountTotal)
      for (const w of words) {
        if (remainingRoom > 0) {
          const info = upsertWord.run(month, groupJid, w)
          if (info.changes > 0) remainingRoom--
        } else {
          bumpExistingWord.run(month, groupJid, w)
        }
      }
    }
  })

  tx()
  return true
}

export function recordWrappedEvent(client, event) {
  try {
    if (!event || event.key?.fromMe) return
    const chat = event.key?.remoteJid
    if (!chat?.endsWith('@g.us')) return
    if (!isWrappedEnabled(chat)) return

    const msg = event.message
    if (!isCountableContent(msg)) return

    const ctx = buildContext(client, event)
    if (!ctx.sender) return

    const text = String(ctx.body || '').trim()
    const isSticker = Boolean(msg.stickerMessage)
    const isMedia = Boolean(
      msg.imageMessage ||
        msg.videoMessage ||
        msg.audioMessage ||
        msg.documentMessage ||
        msg.documentWithCaptionMessage?.message?.documentMessage
    )
    const isCommand = Boolean(text && config.prefixes?.some((p) => text.startsWith(p)))
    const tsSec = Number(event.messageTimestamp || 0)
    const timestampMs = tsSec > 1_000_000_000 ? tsSec * 1000 : Date.now()

    recordGroupActivity({
      groupJid: chat,
      userJid: ctx.sender,
      displayName: ctx.pushName || '',
      text,
      isSticker,
      isMedia,
      isCommand,
      timestampMs
    })
  } catch (err) {
    logger.warn({ err: err?.message }, '📊 Wrapped tracker gagal mencatat event')
  }
}

export function getGroupWrappedStats(groupJid, month = getWibParts().month, { dbPath } = {}) {
  const db = getDb(dbPath)

  const users = db
    .prepare(
      'SELECT * FROM wrapped_user_monthly WHERE month = ? AND group_jid = ? ORDER BY msg_count DESC, sticker_count DESC'
    )
    .all(month, groupJid)

  const hourRows = db
    .prepare('SELECT hour_wib, msg_count FROM wrapped_hour_monthly WHERE month = ? AND group_jid = ?')
    .all(month, groupJid)

  const topWords = db
    .prepare(
      'SELECT word, count FROM wrapped_word_monthly WHERE month = ? AND group_jid = ? ORDER BY count DESC, word ASC LIMIT 6'
    )
    .all(month, groupJid)

  const availableMonths = db
    .prepare('SELECT DISTINCT month FROM wrapped_user_monthly WHERE group_jid = ? ORDER BY month DESC LIMIT 12')
    .all(groupJid)
    .map((r) => r.month)

  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }))
  for (const r of hourRows) {
    if (r.hour_wib >= 0 && r.hour_wib <= 23) hourly[r.hour_wib].count = r.msg_count
  }

  let peakHour = 0
  let peakHourCount = 0
  for (const h of hourly) {
    if (h.count > peakHourCount) {
      peakHour = h.hour
      peakHourCount = h.count
    }
  }

  let totalMessages = 0
  let totalStickers = 0
  let totalMedia = 0
  let totalCommands = 0

  for (const u of users) {
    totalMessages += u.msg_count
    totalStickers += u.sticker_count
    totalMedia += u.media_count
    totalCommands += u.command_count
  }

  const pickTopBy = (field) => {
    let best = null
    for (const u of users) {
      if ((u[field] || 0) <= 0) continue
      if (!best || u[field] > best[field] || (u[field] === best[field] && u.msg_count > best.msg_count)) {
        best = u
      }
    }
    return best
  }

  const normalizedUsers = users.map((u) => ({
    userJid: u.user_jid,
    displayName: u.display_name || `+${u.user_jid.split('@')[0].split(':')[0]}`,
    msgCount: u.msg_count,
    stickerCount: u.sticker_count,
    mediaCount: u.media_count,
    commandCount: u.command_count,
    nightCount: u.night_count,
    activeDaysCount: u.active_days ? u.active_days.split(',').filter(Boolean).length : 0,
    pct: totalMessages > 0 ? Number(((u.msg_count / totalMessages) * 100).toFixed(1)) : 0
  }))

  const toAward = (row, valueKey) =>
    row
      ? {
          userJid: row.user_jid,
          displayName: row.display_name || `+${row.user_jid.split('@')[0].split(':')[0]}`,
          count: row[valueKey] || 0
        }
      : null

  return {
    month,
    monthLabel: formatMonthLabel(month),
    groupJid,
    availableMonths,
    totals: {
      messages: totalMessages,
      stickers: totalStickers,
      media: totalMedia,
      commands: totalCommands,
      activeMembers: users.length,
      peakHour,
      peakHourCount
    },
    hourly,
    topYappers: normalizedUsers.slice(0, 3),
    leaderboard: normalizedUsers.slice(0, 10),
    awards: {
      topYapper: normalizedUsers[0] || null,
      stickerKing: toAward(pickTopBy('sticker_count'), 'sticker_count'),
      nightOwl: toAward(pickTopBy('night_count'), 'night_count'),
      botBestie: toAward(pickTopBy('command_count'), 'command_count'),
      mediaPlug: toAward(pickTopBy('media_count'), 'media_count')
    },
    topWords
  }
}
