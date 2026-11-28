/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ffstalk.js — Stalking profil, cari pemain, & cek versi Free Fire (OB55)
 */

import config from '../../config.js'
import { extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { richList } from '../../lib/richMessage.js'
import { onRichReply } from '../../handlers/messageHandler.js'
import {
  getVersion,
  parseAccountId,
  searchPlayers,
  stalkPlayer
} from '../../scraper/FREEFIRE.js'

const SEARCH_SLOT_MAX = 20
const SEARCH_TTL_MS = 15 * 60 * 1000
const FF_SEARCH_SLOTS = (globalThis.HITORI_FF_SEARCH_SLOTS ??= { seq: 0, entries: new Map() })

function formatWibDate(unixSeconds) {
  const sec = Number(unixSeconds || 0)
  if (!Number.isFinite(sec) || sec <= 0) return '-'
  const d = new Date(sec * 1000)
  return (
    d.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(/\./g, ':') + ' WIB'
  )
}

function fmtNum(val) {
  const n = Number(val)
  return Number.isFinite(n) ? n.toLocaleString('id-ID') : '-'
}

function genderLabel(code) {
  if (code === 1) return 'Male'
  if (code === 2) return 'Female'
  return code != null ? String(code) : '-'
}

function formatProfileCard(result) {
  const p = result.profile
  const regionTag =
    result.cluster && result.cluster !== 'UNKNOWN' && result.cluster !== p.region
      ? ` _(${result.cluster})_`
      : ''
  const lines = [
    '┌───「 🔥 *FREE FIRE STALK* 」───┐',
    '',
    `• Nickname   : *${p.nickname || '-'}*`,
    `• UID Akun   : \`${p.accountId}\``,
    `• Region     : *${p.region || '-'}*${regionTag}`,
    `• Level      : *${p.level ?? '-'}*`,
    `• Likes      : *${fmtNum(p.likes)}*`,
    `• Patch      : ${p.releaseVersion || '-'}`
  ]

  if (p.creditScore != null) {
    lines.push(`• Credit     : *${p.creditScore}*`)
  }
  if (p.social?.gender != null) {
    lines.push(`• Gender     : ${genderLabel(p.social.gender)}`)
  }
  lines.push(`• Dibuat     : ${formatWibDate(p.createdAt)}`)
  lines.push(`• Login Akhir: ${formatWibDate(p.lastLoginAt)}`)

  if (p.signature) {
    lines.push(`• Bio        : ${p.signature}`)
  }

  if (p.clan) {
    lines.push(
      '',
      '🛡️ *Guild / Clan:*',
      `  ▸ Nama   : *${p.clan.name || '-'}*`,
      `  ▸ ID     : \`${p.clan.clanId}\``
    )
    if (p.clanLeader) {
      lines.push(
        `  ▸ Leader : ${p.clanLeader.nickname || '-'} (Lv.${p.clanLeader.level ?? '-'} • \`${p.clanLeader.accountId}\`)`
      )
    }
  }

  if (p.pet) {
    lines.push(
      '',
      '🐾 *Pet:*',
      `  ▸ Nama  : *${p.pet.name || '-'}* (Lv.${p.pet.level ?? '-'} • EXP ${fmtNum(p.pet.exp)})`,
      `  ▸ Pet ID: \`${p.pet.petId}\``
    )
  }

  const equippedCount = Array.isArray(p.equipped) ? p.equipped.length : 0
  const clothesCount = Array.isArray(p.profile?.clothes) ? p.profile.clothes.length : 0
  if (equippedCount > 0 || clothesCount > 0 || p.profile?.avatarId) {
    lines.push('', '🎒 *Tampilan & Koleksi:*')
    if (p.profile?.avatarId) lines.push(`  ▸ Avatar ID : \`${p.profile.avatarId}\``)
    if (clothesCount > 0) lines.push(`  ▸ Outfit Slot: ${clothesCount} item`)
    if (equippedCount > 0) {
      const sampleKeys = p.equipped
        .slice(0, 3)
        .map((e) => e.nameKey || `#${e.itemId || e.id}`)
        .filter(Boolean)
      lines.push(`  ▸ Badge BP  : ${equippedCount} terpasang${sampleKeys.length ? ` (${sampleKeys.join(', ')})` : ''}`)
    }
  }

  if (Array.isArray(p.modeStats) && p.modeStats.length > 0) {
    const statText = p.modeStats
      .slice(0, 5)
      .map((s) => `Mode ${s.mode}: ${fmtNum(s.points)} pts`)
      .join(' • ')
    lines.push('', `🏆 *Mode Stats:* ${statText}`)
  }

  lines.push('', '└──────────────────────────────┘', '', `> ✨ _*Powered by ${config.botName}*_`)
  return lines.join('\n')
}

async function sendStalkResult(ctx, uidInput, sendOpts) {
  const result = await stalkPlayer(uidInput)
  const card = formatProfileCard(result)
  await ctx.client.message.send(ctx.chat, card, sendOpts)
  await ctx.react('✅')
}

function registerSearchSlot(sender, items) {
  const now = Date.now()
  for (const [k, entry] of FF_SEARCH_SLOTS.entries) {
    if (now - entry.createdAt > SEARCH_TTL_MS) FF_SEARCH_SLOTS.entries.delete(k)
  }

  const slot = FF_SEARCH_SLOTS.seq % SEARCH_SLOT_MAX
  FF_SEARCH_SLOTS.seq = (FF_SEARCH_SLOTS.seq + 1) % 1_000_000
  FF_SEARCH_SLOTS.entries.set(slot, { sender, items, createdAt: now })

  items.slice(0, 10).forEach((item, idx) => {
    const replyId = `ffpick:${slot}:${idx}`
    onRichReply(replyId, async (clickCtx) => {
      const saved = FF_SEARCH_SLOTS.entries.get(slot)
      if (!saved || Date.now() - saved.createdAt > SEARCH_TTL_MS) {
        return clickCtx.reply(`⏳ Hasil pencarian sudah kedaluwarsa. Jalankan *${config.mainPrefix}ffstalk ${item.accountId}* secara langsung.`)
      }
      const picked = saved.items[idx]
      if (!picked?.accountId) return
      const clickOpts = clickCtx.event ? { quote: clickCtx.event } : {}
      await clickCtx.react('⏳')
      try {
        await sendStalkResult(clickCtx, picked.accountId, clickOpts)
      } catch (err) {
        await clickCtx.react('❎')
        await clickCtx.client.message.send(
          clickCtx.chat,
          `❌ ${String(err?.message || err).slice(0, 240)}`,
          clickOpts
        )
      }
    })
  })

  return slot
}

async function sendSearchResult(ctx, keyword, sendOpts) {
  const results = await searchPlayers(keyword)
  if (!results.length) {
    await ctx.react('❎')
    return ctx.client.message.send(
      ctx.chat,
      `❌ Tidak ditemukan pemain Free Fire dengan nickname *${keyword}*.`,
      sendOpts
    )
  }

  const slot = registerSearchSlot(ctx.sender, results)
  const lines = [
    `🔎 *PENCARIAN FREE FIRE* — _"${keyword}"_`,
    `Ditemukan *${results.length}* akun:`,
    ''
  ]

  results.slice(0, 10).forEach((r, i) => {
    lines.push(`${i + 1}. *${r.nickname || '-'}*`)
    lines.push(`   UID: \`${r.accountId}\` • Lv.${r.level ?? '-'}${r.region ? ` • ${r.region}` : ''}`)
  })

  lines.push('', `> Tap tombol daftar di bawah atau ketik *${config.mainPrefix}ffstalk <uid>*`)
  const textBody = lines.join('\n')

  try {
    const listPayload = richList({
      text: textBody,
      footer: `${config.botName} • Free Fire Search`,
      title: 'Pilih Pemain',
      buttonText: '🔥 Lihat Profil',
      sections: [
        {
          title: `Hasil "${keyword.slice(0, 20)}"`,
          rows: results.slice(0, 10).map((r, i) => ({
            title: `${i + 1}. ${r.nickname || 'Unknown'}`.slice(0, 24),
            description: `UID ${r.accountId} • Lv.${r.level ?? '-'}${r.region ? ` • ${r.region}` : ''}`.slice(0, 72),
            id: `ffpick:${slot}:${i}`
          }))
        }
      ]
    })
    await ctx.client.message.send(ctx.chat, listPayload, sendOpts)
  } catch {
    await ctx.client.message.send(ctx.chat, textBody, sendOpts)
  }

  await ctx.react('✅')
}

async function sendVersionResult(ctx, regionArg, sendOpts) {
  const region = (regionArg || 'ID').toUpperCase()
  const info = await getVersion('1.132.1', region, region === 'VN' ? 'vi' : 'id')
  const msg = [
    '┌───「 📡 *FREE FIRE SERVER INFO* 」───┐',
    '',
    `• Release Version : *${info.latest_release_version || '-'}*`,
    `• Remote Version  : *${info.remote_version || '-'}*`,
    `• Server Status   : ${info.is_server_open ? '🟢 Open' : '🔴 Closed'}${info.is_firewall_open ? ' (Firewall ON)' : ''}`,
    `• Country / Region: *${info.country_code || region}*`,
    `• Login Host      : ${info.server_url || '-'}`,
    '',
    '└────────────────────────────────────┘'
  ].join('\n')
  await ctx.client.message.send(ctx.chat, msg, sendOpts)
  await ctx.react('✅')
}

function buildUsageText(ctx) {
  const p = ctx.prefix || config.mainPrefix
  const lines = [
    '🔥 *FREE FIRE TOOLS*',
    '',
    `• *${p}ffstalk <uid>* — cek profil akun lengkap`,
    `• *${p}ffsearch <nickname>* — cari pemain (min. 3 huruf)`,
    `• *${p}ffver [region]* — cek status & patch server`,
    '',
    '*Contoh:*',
    `• *${p}ffstalk 985587381*`,
    `• *${p}ffsearch senos*`,
    `• *${p}ffver ID*`
  ]
  if (ctx.isOwner) {
    lines.push('', `👑 Owner: gunakan *${p}ffadmin* untuk kelola akun worker.`)
  }
  return lines.join('\n')
}

export default {
  name: 'ffstalk',
  aliases: ['ff', 'ffsearch', 'ffcari', 'ffver', 'ffversion'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Stalking profil, cari nickname, & cek server Free Fire',

  async run(ctx) {
    const cmd = String(ctx.command || 'ffstalk').toLowerCase()
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}
    const tokens = String(ctx.text || '').trim().split(/\s+/).filter(Boolean)
    const first = (tokens[0] || '').toLowerCase()

    if (cmd === 'ffver' || cmd === 'ffversion' || (cmd === 'ff' && ['ver', 'version'].includes(first))) {
      await ctx.react('⏳')
      try {
        const reg = cmd === 'ff' ? tokens[1] : tokens[0]
        await sendVersionResult(ctx, reg, sendOpts)
      } catch (err) {
        await ctx.react('❎')
        await ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 240)}`, sendOpts)
      }
      return
    }

    if (cmd === 'ffsearch' || cmd === 'ffcari' || (cmd === 'ff' && ['search', 'cari'].includes(first))) {
      const keyword = cmd === 'ff' ? tokens.slice(1).join(' ').trim() : String(ctx.text || '').trim()
      if (!keyword || keyword.length < 3) {
        const p = ctx.prefix || config.mainPrefix
        return ctx.client.message.send(
          ctx.chat,
          `❌ Masukkan nickname minimal 3 karakter.\nContoh: *${p}ffsearch senos*`,
          sendOpts
        )
      }
      await ctx.react('⏳')
      try {
        await sendSearchResult(ctx, keyword, sendOpts)
      } catch (err) {
        await ctx.react('❎')
        await ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 240)}`, sendOpts)
      }
      return
    }

    if (first === 'help') {
      return ctx.client.message.send(ctx.chat, buildUsageText(ctx), sendOpts)
    }

    let rawInput = cmd === 'ff' && first === 'stalk' ? tokens.slice(1).join(' ').trim() : String(ctx.text || '').trim()
    if (!rawInput) {
      const quotedText = extractTextFromMessage(getQuotedMessage(ctx)).trim()
      const uidMatch = quotedText.match(/\b(\d{5,15})\b/)
      if (uidMatch) rawInput = uidMatch[1]
    }

    if (!rawInput) {
      return ctx.client.message.send(ctx.chat, buildUsageText(ctx), sendOpts)
    }

    await ctx.react('⏳')
    try {
      const uid = parseAccountId(rawInput)
      if (uid) {
        await sendStalkResult(ctx, uid, sendOpts)
      } else if (rawInput.length >= 3) {
        await sendSearchResult(ctx, rawInput, sendOpts)
      } else {
        await ctx.react('❎')
        await ctx.client.message.send(ctx.chat, buildUsageText(ctx), sendOpts)
      }
    } catch (err) {
      await ctx.react('❎')
      await ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 240)}`, sendOpts)
    }
  }
}
