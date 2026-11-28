/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * mlbbstalk.js — Stalking profil, rank, koleksi & statistik Mobile Legends via protokol resmi Moonton
 */

import config from '../../config.js'
import { extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { heroName, parseTarget, PVP_MODES, stalk } from '../../scraper/MLBB.js'

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━'

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

function fmtGold(gold) {
  const n = Number(gold || 0)
  if (!Number.isFinite(n) || n <= 0) return '-'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function fmtRank(rank) {
  if (!rank) return 'Unranked'
  if (rank.stars !== null && rank.stars !== undefined) {
    return `${rank.fullName} (★${fmtNum(rank.stars)})`
  }
  return rank.fullName || 'Unranked'
}

function buildUsageText(ctx) {
  const p = ctx.prefix || config.mainPrefix
  return [
    '⚔️ *MOBILE LEGENDS STALK*',
    DIVIDER,
    'Cek profil, rank, koleksi, top hero & statistik akun MLBB.',
    '',
    '*Format:*',
    `• *${p}mlbbstalk* <id> (<server>)`,
    `• *${p}mlbb* <id> <server>`,
    '',
    '*Contoh:*',
    `• ${p}mlbbstalk 8961254 (2201)`,
    `• ${p}mlbb 691438098 8747`
  ].join('\n')
}

function formatMlbbCard(res) {
  const p = res.profile || res.stats?.profile || {}
  const s = res.stats

  const cert = p.certified ? ' ✅' : ''
  const shortTag = !p.nameDisplay?.title && p.nameDisplay?.tag ? ` [${p.nameDisplay.tag}]` : ''
  const country = p.countryCode ? ` • ${String(p.countryCode).toUpperCase()}` : ''

  const lines = [
    '⚔️ *MOBILE LEGENDS STALK*',
    DIVIDER,
    `👤 *${p.name || '-'}*${cert}${shortTag}`,
    `🆔 \`${res.roleId} (${res.zoneId})\`${country}`
  ]

  if (p.nameDisplay?.title) {
    const tagPart = p.nameDisplay.tag ? ` [${p.nameDisplay.tag}]` : ''
    lines.push(`🏴 *Squad:* ${p.nameDisplay.title}${tagPart}`)
  }

  lines.push(
    `🏅 *Rank:* ${fmtRank(p.rank)}`,
    `⭐ *Level:* ${p.level ?? '-'}  •  🛡️ *Credit:* ${p.creditScore ?? s?.reputation ?? '-'}`
  )

  if (s?.seasonMaxRank && s.seasonMaxRank.level > (p.rankLevel || 0)) {
    lines.push(`📈 *Peak Season:* ${fmtRank(s.seasonMaxRank)}`)
  }

  if (p.signature) {
    lines.push(`💬 _${String(p.signature).replace(/\s+/g, ' ').trim().slice(0, 140)}_`)
  }

  lines.push(
    '',
    '🎒 *Profil & Koleksi*',
    `• *Hero / Skin:* ${fmtNum(p.heroCount)} Hero • ${fmtNum(p.skinCount)} Skin`
  )

  if (p.collection?.level) {
    const c = p.collection
    const qParts = []
    if (c.qualities?.supreme) qParts.push(`Supreme ${c.qualities.supreme}`)
    if (c.qualities?.grand) qParts.push(`Grand ${c.qualities.grand}`)
    if (c.qualities?.exquisite) qParts.push(`Exquisite ${c.qualities.exquisite}`)
    if (c.qualities?.deluxe) qParts.push(`Deluxe ${c.qualities.deluxe}`)
    lines.push(`• *Collector:* Lv.${c.level} (${fmtNum(c.points)}/${fmtNum(c.nextLevelPoints)} pts)`)
    if (qParts.length) lines.push(`  ↳ ${qParts.join(' • ')}`)
  }

  lines.push(
    `• *Sosial:* ${fmtNum(p.likes)} Like • ${fmtNum(p.followers)} Followers • ${fmtNum(p.following)} Following`
  )

  if (s && Number.isFinite(s.totalMatches)) {
    lines.push(
      '',
      '📊 *Statistik Karier*',
      `• *Total Match:* ${fmtNum(s.totalMatches)} (${fmtNum(s.wins)} Win • *${s.winRate}% WR*)`
    )

    for (const modeId of ['2', '1', '4']) {
      const m = s.byType?.[modeId]
      if (!m || m.matches <= 0) continue
      const wr = ((m.wins / m.matches) * 100).toFixed(1)
      const mvpText = m.mvp > 0 ? ` • ${fmtNum(m.mvp)} MVP` : ''
      lines.push(`• *${PVP_MODES[modeId]}:* ${fmtNum(m.matches)} match (${wr}% WR${mvpText})`)
    }

    const avgParts = [`KDA *${s.avg?.kda ?? '-'}*`, `Gold/m ${fmtNum(s.avg?.money)}`]
    if (s.avg?.damage > 0) avgParts.push(`DMG/m ${fmtNum(s.avg.damage)}`)

    const savage = s.kills?.savage ?? s.kills?.penta ?? 0
    const maniac = s.kills?.maniac ?? s.kills?.quadra ?? 0

    lines.push(
      `• *MVP:* 🏆 ${fmtNum(s.mvp)} Win • ${fmtNum(s.loseMvp)} MVP Loss`,
      `• *Rata-rata:* ${avgParts.join(' • ')}`,
      `• *Multi-Kill:* *${fmtNum(savage)}* Savage • *${fmtNum(maniac)}* Maniac • ${fmtNum(s.kills?.triple)} Triple • ${fmtNum(s.kills?.double)} Double`
    )

    if (Array.isArray(s.heroes) && s.heroes.length > 0) {
      const topHeroes = [...s.heroes]
        .filter((h) => h.matches > 0)
        .sort((a, b) => b.matches - a.matches)
        .slice(0, 5)
      if (topHeroes.length) {
        lines.push('', '🔥 *Top 5 Hero Favorit*')
        topHeroes.forEach((h, idx) => {
          const wr = h.matches > 0 ? ((h.wins / h.matches) * 100).toFixed(1) : '0.0'
          const name = h.heroName || heroName(h.heroId)
          lines.push(`${idx + 1}. *${name}* — ${fmtNum(h.matches)} match (${wr}% WR)`)
        })
      }
    }

    if (Array.isArray(s.matches) && s.matches.length > 0) {
      lines.push('', '🕒 *3 Match Terakhir*')
      s.matches.slice(0, 3).forEach((m) => {
        const d = m.detail || {}
        const outcome = m.winCamp && d.camp ? (d.camp === m.winCamp ? '🟢 *WIN*' : '🔴 *LOSE*') : '⚪ *MATCH*'
        const modeTag = m.mode || PVP_MODES[m.pvpType] ? ` [${m.mode || PVP_MODES[m.pvpType]}]` : ''
        const name = d.heroName || heroName(d.heroId)
        lines.push(
          `• ${outcome} — *${name}*${modeTag} • \`${d.kills ?? 0}/${d.deaths ?? 0}/${d.assists ?? 0}\` • ${fmtDuration(m.duration)} • ${fmtGold(d.money)} Gold`
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

  lines.push('', DIVIDER, `_Powered by ${config.botName}_`)
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
