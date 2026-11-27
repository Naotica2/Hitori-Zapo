/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tebakgambar.js — Game Tebak Gambar (257 Level Reguler, Raja Gambar, Event & Emoji)
 */
import sharp from 'sharp'
import { isOn } from '../../core/groupSettings.js'
import { startGame, hasGame } from '../../handlers/gameHandler.js'
import { getEvents, getRegularLevelsCatalog, pickTebakGambarQuestion } from '../../scraper/TEBAKGAMBAR.js'

const GAME_DURATION_MS = 60_000

async function ensureCompatibleImage(buffer) {
  // Cek signature PNG / JPEG; jika WebP atau lainnya, konversi ke PNG via sharp agar tampil rapi sebagai foto WA
  const isPng = buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  if (isPng) return { buffer, mimetype: 'image/png' }

  const isJpg = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8
  if (isJpg) return { buffer, mimetype: 'image/jpeg' }

  const converted = await sharp(buffer, { pages: 1 }).png().toBuffer()
  return { buffer: converted, mimetype: 'image/png' }
}

function normalizeAnswer(answer) {
  return String(answer || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export default {
  name: 'tebakgambar',
  aliases: ['tg', 'tebakgbr'],
  tags: 'game',
  cooldown: 4_000,
  description: 'Game Tebak Gambar (257 Level Reguler, Raja Gambar, Emoji & Event; butuh .on game)',

  async run(ctx) {
    if (!ctx.isGroup) {
      return ctx.reply('🚫 Khusus grup.')
    }
    if (!isOn(ctx.chat, 'game')) {
      return ctx.reply('🎮 Fitur game belum dinyalakan di grup ini. Admin: `.on game`')
    }

    const arg = String(ctx.text || '').trim()
    const lower = arg.toLowerCase()

    if (/^(help|panduan|\?)$/i.test(lower)) {
      const cat = await getRegularLevelsCatalog().catch(() => ({ totalLevels: 257 }))
      return ctx.reply(
        '🖼️ *TEBAK GAMBAR*\n\n' +
          `*Mode Tersedia (${cat.totalLevels} Level):*\n` +
          `• \`${ctx.prefix}tebakgambar\` / \`${ctx.prefix}tg\` — soal acak\n` +
          `• \`${ctx.prefix}tg <1-${cat.totalLevels}>\` — pilih level tertentu\n` +
          `• \`${ctx.prefix}tg raja\` — khusus soal Boss / Raja Gambar 👑\n` +
          `• \`${ctx.prefix}tg emoji\` — mode Event Emoji 😍\n` +
          `• \`${ctx.prefix}tg event\` — lihat & pilih event spesial aktif`
      )
    }

    if (/^events?$/i.test(lower)) {
      await ctx.react('⏳')
      try {
        const events = await getEvents()
        if (!events.length) {
          return ctx.reply('📭 Tidak ada event Tebak Gambar yang sedang aktif.')
        }
        const rows = events.map(
          (ev) => `• *${ev.title}* (ID: \`${ev.id}\`)\n  ${ev.subtitle || '-'}`
        )
        await ctx.react('✅')
        return ctx.reply(
          '🎪 *EVENT TEBAK GAMBAR AKTIF*\n\n' +
            `${rows.join('\n\n')}\n\n` +
            `Cara main: \`${ctx.prefix}tg event <id/nama>\` atau \`${ctx.prefix}tg emoji\``
        )
      } catch (err) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal memuat daftar event: ' + String(err?.message || err).slice(0, 150))
      }
    }

    if (hasGame(ctx.chat, 'tebakgambar')) {
      return ctx.reply('⏳ Tebak Gambar masih berjalan di grup ini. Ketik jawaban atau *nyerah* dulu!')
    }

    let opts = {}
    if (lower) {
      if (/^(raja|boss)$/i.test(lower)) {
        opts = { bossOnly: true }
      } else if (/^events?\s+(.+)$/i.test(arg)) {
        opts = { eventQuery: arg.replace(/^events?\s+/i, '').trim() }
      } else if (/^\d+$/.test(lower)) {
        opts = { level: Number.parseInt(lower, 10) }
      } else {
        opts = { eventQuery: arg }
      }
    }

    await ctx.react('⏳')

    try {
      const picked = await pickTebakGambarQuestion(opts)
      const img = await ensureCompatibleImage(picked.imageBuffer)

      const displayAnswer = picked.answer.trim().toUpperCase()
      const normalized = normalizeAnswer(picked.answer)
      const wordCount = normalized.split(' ').filter(Boolean).length
      const letterCount = normalized.replace(/[^a-z0-9]/g, '').length

      const caption =
        '╭─🖼️「 *TEBAK GAMBAR* 」🖼️─╮\n' +
        '│\n' +
        `│ 📌 Mode: *${picked.modeLabel}*\n` +
        (picked.number ? `│ 🔢 Soal No: *#${picked.number}*\n` : '') +
        `│ 🔤 Panjang: *${wordCount} kata* (${letterCount} huruf)\n` +
        '│ ⏱️ Waktu: *60 detik*\n' +
        `│ 💡 Bantuan: *${ctx.prefix}clue*\n` +
        '│ 🏳️ Menyerah: ketik *nyerah*\n' +
        '│\n' +
        '╰────────────────────────✦╯'

      await ctx.client.message.send(ctx.chat, {
        type: 'image',
        media: img.buffer,
        mimetype: img.mimetype,
        caption
      })

      startGame(ctx.client, ctx.chat, 'tebakgambar', {
        kind: 'image',
        answer: normalized,
        display: displayAnswer,
        supportClue: true,
        expiresAt: Date.now() + GAME_DURATION_MS
      })

      await ctx.react('🖼️')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal memulai Tebak Gambar: ' + String(err?.message || err).slice(0, 200))
    }
  }
}
