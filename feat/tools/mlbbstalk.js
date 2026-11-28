/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * mlbbstalk.js — Stalking profil, rank, koleksi & statistik Mobile Legends via protokol resmi Moonton
 */

import config from '../../config.js'
import { extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { parseTarget, stalk } from '../../scraper/MLBB.js'

function fmtNum(val) {
  const n = Number(val)
  return Number.isFinite(n) ? n.toLocaleString('id-ID') : '-'
}

function fmtDuration(sec) {
  const total = Number(sec || 0)
  if (!Number.isFinite(total) || total <= 0) return '-'
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m${String(s).padStart(2, '0')}s`
}

function buildUsageText(ctx) {
  const p = ctx.prefix || config.mainPrefix
  return [
    '⚔️ *MOBILE LEGENDS STALK*',
    '',
    'Cek profil, rank, koleksi, top hero & statistik akun MLBB.',
    '',
    '*Format:*',
    `• *${p}mlbbstalk <id> (<server>)*`,
    `• *${p}mlbb <id> <server>*`,
    '',
    '*Contoh:*',
    `• *${p}mlbbstalk 8961254 (2201)*`,
    `• *${p}mlbb 691438098 8747*`
  ].join('\n')
}

function formatMlbbCard(res) {
  const p = res.profile || res.stats?.profile || {}
  const s = res.stats
  const lines = ['┌───「 ⚔️ *MOBILE LEGENDS STALK* 」───┐', '']

  const cert = p.certified ? ' ✅' : ''
  const titleBadge = p.nameDisplay?.tag ? ` [${p.nameDisplay.tag}]` : ''
  const country = p.countryCode ? ` (${String(p.countryCode).toUpperCase()})` : ''

  lines.push(
    `• Nickname   : *${p.name || '-'}*${cert}${titleBadge}`,
    `• UID/Server : \`${res.roleId} (${res.zoneId})\`${country}`,
    `• Level      : *Lv.${p.level ?? '-'}*`,
    `• Rank       : *${p.rank?.fullName || 'Unranked'}*${p.rankPoints ? ` _(pts ${fmtNum(p.rankPoints)})_` : ''}`,
    `• Credit     : *${p.creditScore ?? s?.reputation ?? '-'}*`
  )

  if (p.signature) {
    lines.push(`• Bio        : ${String(p.signature).replace(/\n+/g, ' ').slice(0, 140)}`)
  }

  lines.push(
    '',
    '👥 *Sosial & Koleksi:*',
    `  ▸ Likes    : ${fmtNum(p.likes)} Profil • ${fmtNum(p.battleLikes)} Battle`,
    `  ▸ Koneksi  : ${fmtNum(p.followers)} Followers • ${fmtNum(p.following)} Following`,
    `  ▸ Koleksi  : *${fmtNum(p.heroCount)}* Hero • *${fmtNum(p.skinCount)}* Skin`
  )

  if (p.collection?.level) {
    const c = p.collection
    const qParts = []
    if (c.qualities?.legend) qParts.push(`Legend ${c.qualities.legend}`)
    if (c.qualities?.grand) qParts.push(`Grand ${c.qualities.grand}`)
    if (c.qualities?.exquisite) qParts.push(`Exquisite ${c.qualities.exquisite}`)
    if (c.qualities?.deluxe) qParts.push(`Deluxe ${c.qualities.deluxe}`)
    lines.push(
      `  ▸ Collector: *Lv.${c.level}* (${fmtNum(c.points)}/${fmtNum(c.nextLevelPoints)} pts)` +
        (qParts.length ? ` • ${qParts.join(', ')}` : '')
    )
  }

  if (s && Number.isFinite(s.totalMatches)) {
    lines.push(
      '',
      '📊 *Statistik Karier:*',
      `  ▸ Match    : *${fmtNum(s.totalMatches)}* (${fmtNum(s.wins)} Win • *${s.winRate}% WR*)`,
      `  ▸ MVP      : 🏆 *${fmtNum(s.mvp)}* Win MVP • ${fmtNum(s.loseMvp)} Lose MVP`,
      `  ▸ Rata²    : KDA *${s.avg?.kda ?? '-'}* • Gold/m ${fmtNum(s.avg?.money)} • DMG/m ${fmtNum(s.avg?.damage)}`,
      `  ▸ MultiKill: Double ${fmtNum(s.kills?.double)} • Triple ${fmtNum(s.kills?.triple)} • Quadra ${fmtNum(s.kills?.quadra)} • Penta *${fmtNum(s.kills?.penta)}*`
    )

    if (Array.isArray(s.heroes) && s.heroes.length > 0) {
      const topHeroes = [...s.heroes]
        .filter((h) => h.matches > 0)
        .sort((a, b) => b.matches - a.matches)
        .slice(0, 5)
      if (topHeroes.length) {
        lines.push('', '🏅 *Top Hero Paling Sering Dipakai:*')
        topHeroes.forEach((h, idx) => {
          const wr = h.matches > 0 ? ((h.wins / h.matches) * 100).toFixed(1) : '0.0'
          lines.push(`  ${idx + 1}. Hero #${h.heroId} — *${fmtNum(h.matches)}* match (${wr}% WR)`)
        })
      }
    }

    if (Array.isArray(s.matches) && s.matches.length > 0) {
      lines.push('', '🕒 *3 Match Terakhir:*')
      s.matches.slice(0, 3).forEach((m) => {
        const d = m.detail || {}
        const outcome = m.winCamp && d.camp ? (d.camp === m.winCamp ? '🟢 WIN' : '🔴 LOSE') : '⚪ MATCH'
        lines.push(
          `  ▸ ${outcome} • Hero #${d.heroId ?? '-'} (${d.kills ?? 0}/${d.deaths ?? 0}/${d.assists ?? 0}) • ${fmtDuration(m.duration)} • Gold ${fmtNum(d.money)}`
        )
      })
    }
  }

  const partialErrs = Object.entries(res.errors || {})
    .filter(([k]) => k !== 'history')
    .map(([k, v]) => `${k}: ${v}`)
  if (partialErrs.length) {
    lines.push('', `> _Sebagian data gagal diambil: ${partialErrs.join(' | ').slice(0, 120)}_`)
  }

  lines.push('', '└────────────────────────────────────┘', '', `> ✨ _*Powered by ${config.botName}*_`)
  return lines.join('\n')
}

export default {
  name: 'mlbbstalk',
  aliases: ['mlbb', 'ml', 'mlstalk', 'stalkml', 'stalkmlbb'],
  tags: 'tools',
  cooldown: 5000,
  description: 'Stalking profil, rank, koleksi skin & statistik akun Mobile Legends (MLBB)',

  async run(ctx) {
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    let rawInput = String(ctx.text || '').trim()
    if (!rawInput) {
      rawInput = extractTextFromMessage(getQuotedMessage(ctx)).trim()
    }

    if (!rawInput || /^help$/i.test(rawInput)) {
      return ctx.client.message.send(ctx.chat, buildUsageText(ctx), sendOpts)
    }

    let target
    try {
      target = parseTarget(rawInput)
    } catch {
      return ctx.client.message.send(ctx.chat, buildUsageText(ctx), sendOpts)
    }

    await ctx.react('⏳')
    try {
      const res = await stalk(target, { timeout: 8000, includeHistory: false })
      const p = res.profile || res.stats?.profile
      if (!p || (!p.name && !p.level)) {
        const reason = res.errors?.profile || res.errors?.stats || 'Akun tidak ditemukan atau private.'
        await ctx.react('❎')
        return ctx.client.message.send(
          ctx.chat,
          `❌ Gagal stalk MLBB \`${target.roleId} (${target.zoneId})\`: ${String(reason).slice(0, 180)}`,
          sendOpts
        )
      }

      const card = formatMlbbCard(res)
      await ctx.client.message.send(ctx.chat, card, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
