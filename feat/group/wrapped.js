/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * wrapped.js — Group Wrapped: Rekap visual bulanan grup (.wrapped)
 */
import config from '../../config.js'
import { getUser } from '../../core/database.js'
import { getGroupWrappedStats, getWibParts, isWrappedEnabled } from '../../core/wrapped.js'
import { getEvent } from '../../lib/media.js'
import { renderGroupWrappedCard } from '../../lib/wrappedCanvas.js'

const RENDER_CACHE = (globalThis.HITORI_WRAPPED_RENDER_CACHE ??= new Map())
const CACHE_TTL_MS = 60_000

function enrichParticipantNames(stats, metaParticipants = []) {
  const metaMap = new Map()
  for (const p of metaParticipants || []) {
    if (!p || typeof p === 'string') continue
    const name = p.notify || p.pushName || p.name || p.verifiedName
    if (!name) continue
    for (const id of [p.jid, p.lid, p.phoneJid, p.pnJid, p.participantJid, p.jidAlt, p.lidJid]) {
      if (id) metaMap.set(id, name)
    }
  }

  const resolveName = (userJid, fallbackName) => {
    const dbName = getUser(userJid)?.name
    const metaName = metaMap.get(userJid)
    const chosen = dbName || metaName || fallbackName || `+${userJid.split('@')[0].split(':')[0]}`
    return String(chosen).trim()
  }

  stats.topYappers = stats.topYappers.map((u) => ({ ...u, displayName: resolveName(u.userJid, u.displayName) }))
  stats.leaderboard = stats.leaderboard.map((u) => ({ ...u, displayName: resolveName(u.userJid, u.displayName) }))
  for (const key of Object.keys(stats.awards)) {
    if (stats.awards[key]) {
      stats.awards[key] = {
        ...stats.awards[key],
        displayName: resolveName(stats.awards[key].userJid, stats.awards[key].displayName)
      }
    }
  }
  return stats
}

function fmtHour(h) {
  return `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 WIB`
}

function buildCaption(stats, groupName) {
  const a = stats.awards
  const lines = [
    `📊 *${groupName.toUpperCase()} — ${stats.monthLabel}*`,
    '',
    `• Total Pesan : *${stats.totals.messages.toLocaleString('id-ID')}* (${stats.totals.activeMembers} member aktif)`,
    `• Stiker / Media : ${stats.totals.stickers.toLocaleString('id-ID')} stiker • ${stats.totals.media.toLocaleString('id-ID')} media`,
    `• Jam Teramai : *${fmtHour(stats.totals.peakHour)}*`,
    ''
  ]

  if (a.topYapper) lines.push(`🗣️ *Top Yapper:* ${a.topYapper.displayName} (${a.topYapper.msgCount} pesan)`)
  if (a.stickerKing) lines.push(`🧸 *Raja Stiker:* ${a.stickerKing.displayName} (${a.stickerKing.count} stiker)`)
  if (a.nightOwl) lines.push(`🦉 *Kalong Grup:* ${a.nightOwl.displayName} (${a.nightOwl.count} pesan malam)`)
  if (a.botBestie) lines.push(`⚡ *Sobat Bot:* ${a.botBestie.displayName} (${a.botBestie.count} command)`)

  if (stats.topWords.length > 0) {
    lines.push(
      '',
      `💬 *Kata Populer:* ${stats.topWords
        .slice(0, 5)
        .map((w) => `${w.word} (${w.count}x)`)
        .join(', ')}`
    )
  }

  lines.push('', `> ✨ _*Powered by ${config.botName}*_`)
  return lines.join('\n')
}

export default {
  name: 'wrapped',
  aliases: ['groupwrapped', 'recap', 'rekap'],
  tags: 'group',
  cooldown: 10_000,
  description: 'Rekap visual bulanan aktivitas grup (Top Yapper, Raja Stiker, Jam Ramai)',

  async run(ctx) {
    const p = config.mainPrefix
    if (!ctx.isGroup) {
      return ctx.reply('🚫 Command ini khusus di dalam grup.')
    }

    if (!isWrappedEnabled(ctx.chat)) {
      return ctx.reply(
        `🚫 Fitur *wrapped* sedang dimatikan di grup ini.\nAdmin grup bisa menyalakannya kembali dengan *${p}on wrapped*.`
      )
    }

    const arg = String(ctx.text || '').trim()
    const lowerArg = arg.toLowerCase()
    const currentMonth = getWibParts().month
    const monthMatch = arg.match(/^(\d{4}-\d{2})$/)
    const targetMonth = monthMatch ? monthMatch[1] : currentMonth
    const isTopList = ['top', 'list', 'leaderboard', 'rank'].includes(lowerArg)

    if (arg && !monthMatch && !isTopList) {
      return ctx.reply(
        '📊 *GROUP WRAPPED*\n\n' +
          '*Cara Pakai:*\n' +
          `• *${p}wrapped* — poster rekap bulan ini\n` +
          `• *${p}wrapped ${currentMonth}* — rekap bulan tertentu\n` +
          `• *${p}wrapped top* — leaderboard teks Top 10 member\n` +
          `• *${p}off wrapped* / *${p}on wrapped* — matikan/nyalakan pencatatan (Admin)`
      )
    }

    await ctx.react('📊')

    try {
      let groupName = 'Grup WhatsApp'
      let participants = []
      try {
        const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
        if (meta?.subject) groupName = meta.subject
        participants = meta?.participants || []
      } catch {}

      const stats = enrichParticipantNames(
        getGroupWrappedStats(ctx.chat, targetMonth),
        participants
      )

      if (stats.totals.messages === 0) {
        await ctx.react('ℹ️')
        const availNote = stats.availableMonths.length
          ? `\n\nBulan yang tersedia: ${stats.availableMonths.map((m) => `\`${m}\``).join(', ')}`
          : '\n\nPencatatan sudah aktif — ngobrol dulu di grup ini lalu cek lagi nanti!'
        return ctx.reply(`📭 Belum ada aktivitas tercatat untuk *${stats.monthLabel}*.${availNote}`)
      }

      if (isTopList) {
        const rows = stats.leaderboard.map(
          (u, idx) =>
            `${idx + 1}. *${u.displayName}* — ${u.msgCount.toLocaleString('id-ID')} pesan (${u.pct}%) • ${u.stickerCount} stiker`
        )
        await ctx.react('✅')
        return ctx.reply(
          `🏆 *LEADERBOARD ${stats.monthLabel}*\n` +
            `📌 ${groupName}\n\n` +
            `${rows.join('\n')}\n\n` +
            `• Total: *${stats.totals.messages.toLocaleString('id-ID')}* pesan • Puncak *${fmtHour(stats.totals.peakHour)}*`
        )
      }

      const cacheKey = `${ctx.chat}:${targetMonth}`
      const cached = RENDER_CACHE.get(cacheKey)
      let pngBuffer
      if (
        cached &&
        cached.msgCount === stats.totals.messages &&
        Date.now() - cached.createdAt < CACHE_TTL_MS
      ) {
        pngBuffer = cached.buffer
      } else {
        pngBuffer = await renderGroupWrappedCard(stats, {
          groupName,
          botName: config.botName
        })
        RENDER_CACHE.set(cacheKey, {
          msgCount: stats.totals.messages,
          buffer: pngBuffer,
          createdAt: Date.now()
        })
        if (RENDER_CACHE.size > 30) {
          const oldest = RENDER_CACHE.keys().next().value
          RENDER_CACHE.delete(oldest)
        }
      }

      const rawEvent = getEvent(ctx)
      const sendOpts = rawEvent ? { quote: rawEvent } : {}

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: pngBuffer,
          mimetype: 'image/png',
          caption: buildCaption(stats, groupName)
        },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal membuat Group Wrapped: ' + String(err?.message || err).slice(0, 220))
    }
  }
}
