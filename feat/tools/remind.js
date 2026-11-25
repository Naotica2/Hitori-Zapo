/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * remind.js — Buat, lihat, dan hapus pengingat otomatis berbasis SQLite (WIB)
 */
import config from '../../config.js'
import {
  cancelReminder,
  createReminder,
  formatWibDateTime,
  listReminders,
  parseReminderTime
} from '../../core/reminders.js'

function parseRemindInput(raw) {
  const text = String(raw || '').trim()
  if (!text) return null

  const pipeIdx = text.indexOf('|')
  if (pipeIdx > 0) {
    return {
      timeExpr: text.slice(0, pipeIdx).trim(),
      message: text.slice(pipeIdx + 1).trim()
    }
  }

  // dukung format tanpa pipe: "15m Matikan kompor" / "2 jam Belajar" / "besok 08:00 Meeting"
  const m = text.match(
    /^((?:(?:hari\s+ini|besok|lusa)\s+)?(?:(?:jam|pukul)\s+)?\d{1,2}[:.]\d{2}(?:\s*wib)?|\d{4}-\d{2}-\d{2}(?:[T\s]+\d{1,2}[:.]\d{2})?|(?:\d+(?:[.,]\d+)?\s*(?:detik|dtk|menit|mnt|jam|hari|minggu|s|m|j|h|d|w)\s*)+)\s+(.+)$/i
  )
  if (!m) return null
  return {
    timeExpr: m[1].trim(),
    message: m[2].trim()
  }
}

export default {
  name: 'remind',
  aliases: ['reminder', 'pengingat', 'ingatkan'],
  tags: 'tools',
  cooldown: 3000,
  description: 'Buat pengingat otomatis di chat (persisten SQLite)',

  async run(ctx) {
    const p = config.mainPrefix
    const raw = String(ctx.text || '').trim()
    const tokens = raw.split(/\s+/).filter(Boolean)
    const sub = (tokens[0] || '').toLowerCase()

    if (!raw || sub === 'help') {
      return ctx.reply(
        '⏰ *PENGINGAT OTOMATIS*\n\n' +
          '*Cara Pakai:*\n' +
          `• *${p}remind 15m | Matikan kompor*\n` +
          `• *${p}remind 2 jam | Belajar*\n` +
          `• *${p}remind besok 08:00 | Meeting klien*\n` +
          `• *${p}remind list* — lihat daftar pengingat aktifmu\n` +
          `• *${p}remind hapus <id>* — batalkan pengingat\n\n` +
          `_Bisa juga langsung lewat *${p}ai ingatkan aku 15 menit lagi cek oven*!_`
      )
    }

    if (['list', 'daftar', 'cek'].includes(sub)) {
      const rows = listReminders({ chatJid: ctx.chat, creatorJid: ctx.sender })
      if (!rows.length) {
        return ctx.reply('📭 Kamu belum punya pengingat aktif di chat ini.')
      }
      const lines = rows.map(
        (r) => `• *#${r.id}* — ${formatWibDateTime(r.due_at)}\n  ${r.text}`
      )
      return ctx.reply(`⏰ *PENGINGAT AKTIF KAMU*\n\n${lines.join('\n\n')}`)
    }

    if (['hapus', 'del', 'delete', 'cancel', 'batal'].includes(sub)) {
      const id = tokens[1]
      if (!id) return ctx.reply(`Gunakan *${p}remind hapus <id>*`)
      const ok = cancelReminder({ id, creatorJid: ctx.sender, isOwner: Boolean(ctx.isOwner) })
      return ctx.reply(
        ok
          ? `✅ Pengingat *#${id}* berhasil dibatalkan.`
          : `❌ Pengingat *#${id}* tidak ditemukan atau bukan milikmu.`
      )
    }

    const parsed = parseRemindInput(raw)
    if (!parsed || !parsed.message) {
      return ctx.reply(
        `❌ Format kurang tepat. Contoh:\n• *${p}remind 30m | Angkat jemuran*\n• *${p}remind besok 07:30 | Rapat*`
      )
    }

    try {
      const dueAt = parseReminderTime(parsed.timeExpr)
      const row = createReminder({
        chatJid: ctx.chat,
        creatorJid: ctx.sender,
        creatorNum: ctx.senderNumber,
        text: parsed.message,
        dueAt
      })
      await ctx.react('⏰')
      return ctx.reply(
        `✅ *Pengingat #${row.id} tersimpan!*\n` +
          `• Jadwal : ${formatWibDateTime(row.due_at)}\n` +
          `• Pesan  : ${row.text}`
      )
    } catch (err) {
      return ctx.reply('❌ ' + String(err.message || err))
    }
  }
}
