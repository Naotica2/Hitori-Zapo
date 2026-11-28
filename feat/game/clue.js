/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * clue.js — Minta clue buat game yang support (tebakkata, dll).
 * Max 2 clue per sesi: kalimat hint + underscore pattern.
 */
import { getSession } from '../../handlers/gameHandler.js'

export default {
  name: 'clue',
  aliases: ['bantuan', 'hint'],
  tags: 'game',
  cooldown: 0,
  description: 'Minta clue buat game yang sedang berjalan',
  async run(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('🚫 Khusus grup.')
      return
    }

    let activeSession = null
    let activeType = null
    for (const type of ['tebakkata', 'tebakgambar']) {
      const s = getSession(ctx.chat, type)
      if (s?.supportClue && Date.now() < s.expiresAt) {
        activeSession = s
        activeType = type
        break
      }
    }

    if (!activeSession) {
      await ctx.reply('😅 Gak ada game yang butuh clue di grup ini sekarang.')
      return
    }

    if (activeSession.clueCount >= 2) {
      await ctx.reply('💡 Clue sudah habis (max 2 per sesi).')
      return
    }

    activeSession.clueCount += 1

    if (activeSession.clueCount === 1) {
      // Clue 1: kalimat hint tambahan
      const words = String(activeSession.answer).trim().split(/\s+/).filter(Boolean)
      const firstLetters = words.map((w) => w[0].toUpperCase()).join(' ')
      const letterLen = words.join('').length
      const lengthText = words.length > 1 ? `*${words.length} kata* (*${letterLen}* huruf)` : `*${letterLen}* huruf`
      await ctx.reply(
`╭─💡「 *CLUE #1* 」💡─╮
│
│ 📌 Jawaban:
│   • Berawalan huruf *${firstLetters}*
│   • Panjang ${lengthText}
│
╰────────────────────✦╯`
      )
    } else {
      // Clue 2: underscore pattern per kata (huruf pertama tiap kata kebuka)
      const words = String(activeSession.answer).trim().split(/\s+/).filter(Boolean)
      const pattern = words
        .map((w) => w[0].toUpperCase() + (w.length > 1 ? ' ' + w.slice(1).split('').map(() => '_').join(' ') : ''))
        .join('   ')
      await ctx.reply(
`╭─💡「 *CLUE #2* 」💡─╮
│
│ 🎯 Pola kata:
│   ${pattern}
│
╰────────────────────✦╯`
      )
    }
  }
}
