/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * reminders.js — Pengingat otomatis persisten berbasis SQLite + scheduler aman
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger.js'

const MAX_ACTIVE_PER_USER = 10
const MAX_TOTAL_PENDING = 500
const MIN_DELAY_MS = 10_000
const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1000
const MAX_TEXT_LEN = 300
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

const dbInstances = new Map()
let schedulerTimer = null
let tickRunning = false

function getDbPath() {
  return process.env.HITORI_REMINDERS_DB || './session/reminders.sqlite'
}

function getDb(dbPath = getDbPath()) {
  const resolved = path.resolve(dbPath)
  const existing = dbInstances.get(resolved)
  if (existing) return existing

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const db = new Database(resolved)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      creator_jid TEXT NOT NULL,
      creator_num TEXT,
      text TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(sent_at, due_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_creator ON reminders(creator_jid, chat_jid, sent_at);
  `)
  dbInstances.set(resolved, db)
  return db
}

export function closeRemindersDb(dbPath = getDbPath()) {
  const resolved = path.resolve(dbPath)
  const db = dbInstances.get(resolved)
  if (db) {
    try { db.close() } catch {}
    dbInstances.delete(resolved)
  }
}

export function formatWibDateTime(epochMs) {
  const d = new Date(Number(epochMs))
  if (Number.isNaN(d.getTime())) return '-'
  const datePart = d.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  })
  const timePart = d
    .toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta'
    })
    .replace(/\./g, ':')
  return `${datePart}, ${timePart} WIB`
}

const UNIT_MS = {
  detik: 1000, dtk: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000, s: 1000,
  menit: 60_000, mnt: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, m: 60_000,
  jam: 3_600_000, j: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000, h: 3_600_000,
  hari: 86_400_000, day: 86_400_000, days: 86_400_000, d: 86_400_000,
  minggu: 7 * 86_400_000, week: 7 * 86_400_000, weeks: 7 * 86_400_000, w: 7 * 86_400_000
}

export function parseReminderTime(expr, nowMs = Date.now()) {
  const raw = String(expr || '').trim()
  if (!raw) throw new Error('Waktu pengingat kosong.')

  // 1. Tanggal eksplisit YYYY-MM-DD HH:mm (WIB)
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2})[:.](\d{2}))?$/i)
  if (isoMatch) {
    const [, y, mo, da, hh = '09', mm = '00'] = isoMatch
    const hour = Number.parseInt(hh, 10)
    const min = Number.parseInt(mm, 10)
    if (hour > 23 || min > 59) throw new Error('Jam tidak valid.')
    const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(da), hour, min, 0) - WIB_OFFSET_MS
    if (utcMs - nowMs < MIN_DELAY_MS) throw new Error('Waktu pengingat harus minimal 10 detik dari sekarang.')
    if (utcMs - nowMs > MAX_DELAY_MS) throw new Error('Waktu pengingat maksimal 365 hari ke depan.')
    return utcMs
  }

  // 2. Durasi relatif (mis. "30m", "1 jam 15 menit", "2j30m", "2 hari")
  const relCandidate = raw.replace(/\b(lagi|dari sekarang|from now|in)\b/gi, '').trim()
  const segRe = /(\d+(?:[.,]\d+)?)\s*(detik|dtk|seconds?|secs?|menit|mnt|minutes?|mins?|jam|hours?|hrs?|hari|days?|minggu|weeks?|s|m|j|h|d|w)\b/gi
  let match
  let consumedLen = 0
  let totalMs = 0
  while ((match = segRe.exec(relCandidate)) !== null) {
    const val = Number.parseFloat(match[1].replace(',', '.'))
    const unit = match[2].toLowerCase()
    // Disambiguate single "d": kalau setelah "hari" ga ada, di konteks Indo `2d` biasanya 2 hari jika >=1 tanpa menit? Untuk aman pakai "d" = day bila >=1? Wait: di timer umum "10s / 5m / 2h / 1d", so `d` = hari!
    const mult = unit === 'd' ? 86_400_000 : UNIT_MS[unit]
    if (!mult || !Number.isFinite(val)) continue
    totalMs += Math.round(val * mult)
    consumedLen += match[0].length
  }

  if (totalMs > 0 && consumedLen >= relCandidate.replace(/\s+/g, '').length * 0.6) {
    if (totalMs < MIN_DELAY_MS) throw new Error('Durasi pengingat minimal 10 detik.')
    if (totalMs > MAX_DELAY_MS) throw new Error('Durasi pengingat maksimal 365 hari.')
    return nowMs + totalMs
  }

  // 3. Jam WIB hari ini / besok (mis. "jam 21:30", "besok 08:00", "lusa 09.15")
  const clockMatch = raw.match(/^(?:(hari\s+ini|besok|lusa)\s+)?(?:(?:jam|pukul)\s+)?(\d{1,2})[:.](\d{2})(?:\s*wib)?$/i)
  if (clockMatch) {
    const dayWord = (clockMatch[1] || '').toLowerCase()
    const hour = Number.parseInt(clockMatch[2], 10)
    const min = Number.parseInt(clockMatch[3], 10)
    if (hour > 23 || min > 59) throw new Error('Format jam tidak valid (gunakan 00:00 - 23:59).')

    const wibNow = new Date(nowMs + WIB_OFFSET_MS)
    const dayOffset = dayWord === 'lusa' ? 2 : dayWord === 'besok' ? 1 : 0
    let targetUtc =
      Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate() + dayOffset, hour, min, 0) -
      WIB_OFFSET_MS

    if (!dayWord && targetUtc <= nowMs + MIN_DELAY_MS) {
      targetUtc += 86_400_000
    }
    if (targetUtc - nowMs < MIN_DELAY_MS) {
      throw new Error('Waktu yang dipilih sudah lewat atau kurang dari 10 detik.')
    }
    if (targetUtc - nowMs > MAX_DELAY_MS) {
      throw new Error('Waktu pengingat maksimal 365 hari ke depan.')
    }
    return targetUtc
  }

  throw new Error(
    'Format waktu tidak dikenali. Contoh: "15m", "2 jam", "jam 21:30", "besok 08:00", atau "2026-11-26 09:00".'
  )
}

function sanitizeReminderText(text) {
  const clean = String(text || '')
    .replace(/[\u200b-\u200f\u2060-\u2069\ufeff]/g, '')
    .replace(/@(\d+)/g, '@\u200b$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) throw new Error('Isi pesan pengingat tidak boleh kosong.')
  return clean.slice(0, MAX_TEXT_LEN)
}

export function createReminder({ chatJid, creatorJid, creatorNum, text, dueAt, dbPath } = {}) {
  if (!chatJid || !creatorJid) throw new Error('Context chat/pengirim tidak valid.')
  const now = Date.now()
  const dueMs = Number(dueAt)
  if (!Number.isFinite(dueMs) || dueMs - now < MIN_DELAY_MS || dueMs - now > MAX_DELAY_MS) {
    throw new Error('Waktu pengingat di luar batas (10 detik – 365 hari).')
  }

  const safeText = sanitizeReminderText(text)
  const db = getDb(dbPath)

  const userActive = db
    .prepare('SELECT COUNT(*) AS c FROM reminders WHERE creator_jid = ? AND sent_at IS NULL AND attempts < 3')
    .get(creatorJid).c
  if (userActive >= MAX_ACTIVE_PER_USER) {
    throw new Error(`Kamu sudah punya ${userActive} pengingat aktif (maksimal ${MAX_ACTIVE_PER_USER}). Hapus salah satu dulu.`)
  }

  const totalPending = db
    .prepare('SELECT COUNT(*) AS c FROM reminders WHERE sent_at IS NULL AND attempts < 3')
    .get().c
  if (totalPending >= MAX_TOTAL_PENDING) {
    throw new Error('Antrean pengingat server sedang penuh. Coba lagi nanti.')
  }

  const cleanNum = String(creatorNum || creatorJid.split('@')[0].split(':')[0] || '').trim()
  const res = db
    .prepare(
      'INSERT INTO reminders (chat_jid, creator_jid, creator_num, text, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(chatJid, creatorJid, cleanNum, safeText, Math.floor(dueMs), now)

  return db.prepare('SELECT * FROM reminders WHERE id = ?').get(res.lastInsertRowid)
}

export function listReminders({ chatJid, creatorJid, limit = 10, dbPath } = {}) {
  const db = getDb(dbPath)
  if (chatJid) {
    return db
      .prepare(
        'SELECT * FROM reminders WHERE creator_jid = ? AND chat_jid = ? AND sent_at IS NULL AND attempts < 3 ORDER BY due_at ASC LIMIT ?'
      )
      .all(creatorJid, chatJid, limit)
  }
  return db
    .prepare(
      'SELECT * FROM reminders WHERE creator_jid = ? AND sent_at IS NULL AND attempts < 3 ORDER BY due_at ASC LIMIT ?'
    )
    .all(creatorJid, limit)
}

export function cancelReminder({ id, creatorJid, isOwner = false, dbPath } = {}) {
  const numId = Number.parseInt(id, 10)
  if (!Number.isFinite(numId) || numId <= 0) return false
  const db = getDb(dbPath)
  if (isOwner) {
    const res = db.prepare('DELETE FROM reminders WHERE id = ? AND sent_at IS NULL').run(numId)
    return res.changes > 0
  }
  const res = db
    .prepare('DELETE FROM reminders WHERE id = ? AND creator_jid = ? AND sent_at IS NULL')
    .run(numId, creatorJid)
  return res.changes > 0
}

export function countPendingReminders(dbPath) {
  const db = getDb(dbPath)
  return db.prepare('SELECT COUNT(*) AS c FROM reminders WHERE sent_at IS NULL AND attempts < 3').get().c
}

export async function processDueReminders(client, { nowMs = Date.now(), dbPath } = {}) {
  if (!client?.message?.send) return 0
  const authState = client?.auth?.getState?.()
  if (authState && authState.registered === false) return 0

  const db = getDb(dbPath)
  const dueRows = db
    .prepare('SELECT * FROM reminders WHERE sent_at IS NULL AND attempts < 3 AND due_at <= ? ORDER BY due_at ASC LIMIT 20')
    .all(nowMs)

  let delivered = 0
  for (const row of dueRows) {
    try {
      const isGroup = row.chat_jid.endsWith('@g.us')
      const mentionNum = row.creator_num || row.creator_jid.split('@')[0].split(':')[0]
      const bodyText =
        `⏰ *PENGINGAT OTOMATIS* (#${row.id})\n\n` +
        (isGroup ? `Hai @${mentionNum}, jangan lupa:\n` : 'Jangan lupa:\n') +
        `• ${row.text}\n\n` +
        `_Dijadwalkan: ${formatWibDateTime(row.due_at)}_`

      const payload = isGroup
        ? {
            extendedTextMessage: {
              text: bodyText,
              contextInfo: { mentionedJid: [row.creator_jid] }
            }
          }
        : bodyText

      await client.message.send(row.chat_jid, payload)
      db.prepare('UPDATE reminders SET sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?')
        .run(Date.now(), row.id)
      delivered++
    } catch (err) {
      db.prepare('UPDATE reminders SET attempts = attempts + 1, last_error = ? WHERE id = ?')
        .run(String(err?.message || err).slice(0, 200), row.id)
      logger.warn({ id: row.id, err: err?.message }, '⏰ Gagal mengirim pengingat')
    }
  }
  return delivered
}

export function startReminderScheduler(client, intervalMs = 15_000) {
  stopReminderScheduler()
  schedulerTimer = setInterval(async () => {
    if (tickRunning) return
    tickRunning = true
    try {
      await processDueReminders(client)
    } catch (err) {
      logger.warn({ err: err?.message }, '⏰ Tick scheduler reminder error')
    } finally {
      tickRunning = false
    }
  }, intervalMs)
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref()
  logger.info('⏰ Reminder scheduler aktif')
  return schedulerTimer
}

export function stopReminderScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}
