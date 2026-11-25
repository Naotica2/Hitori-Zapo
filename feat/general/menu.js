/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * menu.js — Menu utama, per-kategori, allmenu, interaktif, & detail command
 */
import { createRequire } from 'node:module'
import config from '../../config.js'
import { listFeatures, getFeature } from '../loader.js'
import { totalUsers, getBalance, getUser } from '../../core/database.js'
import { getCharacter } from '../../core/rpg.js'
import { onRichReply } from '../../handlers/messageHandler.js'

const require = createRequire(import.meta.url)
const pkg = require('../../package.json')

const CATEGORY_ORDER = [
  'general',
  'ai',
  'downloader',
  'sticker',
  'media',
  'tools',
  'minecraft',
  'rpg',
  'game',
  'group',
  'interactive',
  'owner'
]

const CATEGORY_META = {
  general: { emoji: '📌', label: 'General', info: 'Informasi & utilitas dasar' },
  ai: { emoji: '🤖', label: 'AI', info: 'Asisten AI & olah gambar' },
  downloader: { emoji: '📥', label: 'Downloader', info: 'Unduh video, musik & media' },
  sticker: { emoji: '🧸', label: 'Sticker', info: 'Buat & ubah stiker WhatsApp' },
  media: { emoji: '🎨', label: 'Media', info: 'Edit gambar & efek visual' },
  tools: { emoji: '🛠️', label: 'Tools', info: 'Alat bantu & konversi file' },
  minecraft: { emoji: '🧱', label: 'Minecraft', info: 'Marketplace & CurseForge Bedrock' },
  rpg: { emoji: '🧭', label: 'RPG', info: 'Petualangan Nusantara Wilds' },
  game: { emoji: '🎮', label: 'Game', info: 'Permainan santai di chat' },
  group: { emoji: '👥', label: 'Group', info: 'Pengaturan & moderasi grup' },
  interactive: { emoji: '🎛️', label: 'Interactive', info: 'Demo tombol & daftar interaktif' },
  owner: { emoji: '👑', label: 'Owner', info: 'Perintah khusus owner bot' }
}

const SMALL_CAPS_MAP = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
  s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
}

function toSmallCaps(text) {
  return String(text || '')
    .toLowerCase()
    .split('')
    .map((c) => SMALL_CAPS_MAP[c] || c)
    .join('')
}

function getCategoryMeta(tag) {
  return (
    CATEGORY_META[tag] ?? {
      emoji: '📦',
      label: tag.charAt(0).toUpperCase() + tag.slice(1),
      info: 'Daftar perintah'
    }
  )
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d} hari`)
  if (h) parts.push(`${h} jam`)
  parts.push(`${m} mnt`)
  return parts.join(' ')
}

function getWibInfo() {
  const now = new Date()
  const hourStr = now.toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    hour12: false
  })
  const hour = Number.parseInt(hourStr, 10)
  const timeWib = now
    .toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    .replace(/\./g, ':')

  let greeting = 'Selamat Malam 🌙'
  if (hour >= 4 && hour < 10) greeting = 'Selamat Pagi 🌅'
  else if (hour >= 10 && hour < 15) greeting = 'Selamat Siang ☀️'
  else if (hour >= 15 && hour < 18) greeting = 'Selamat Sore 🌇'

  return { greeting, timeWib }
}

function footer() {
  return `> _*${config.botName} x Zapo-JS*_`
}

function regroup({ isOwner = false, isAdmin = false } = {}) {
  const bucket = {}
  for (const f of listFeatures()) {
    if (f.owner && !isOwner) continue
    if (f.admin && !isAdmin) continue
    const tag = f.tags || 'other'
    if (tag === 'owner' && !isOwner) continue
    ;(bucket[tag] ??= []).push(f)
  }

  const orderedTags = Object.keys(bucket).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a)
    const ib = CATEGORY_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })

  const grouped = {}
  for (const tag of orderedTags) {
    grouped[tag] = bucket[tag].sort((a, b) => a.name.localeCompare(b.name))
  }
  return grouped
}

function countGrouped(grouped) {
  return Object.values(grouped).reduce((sum, list) => sum + list.length, 0)
}

function buildHeader(ctx, visibleTotal) {
  const { greeting, timeWib } = getWibInfo()
  const userRow = getUser(ctx.sender)
  const userName = userRow?.name || ctx.pushName || 'User'
  const statusText = ctx.isStaff
    ? `${ctx.role === 'owner' ? '👑' : '🛡️'} ${ctx.role.toUpperCase()}${ctx.staffLabel ? ` • ${ctx.staffLabel}` : ''}`
    : '👤 User'
  const char = getCharacter(ctx.sender)
  const bal = getBalance(ctx.sender)
  const rpgText = char
    ? `Lv.${char.level} • 💰 ${bal.gold}G • 💎 ${bal.gems}`
    : `Belum mulai (${config.mainPrefix}hunt)`

  return [
    `${greeting}`,
    `✦ Hai @${ctx.senderNumber} 👋`,
    '',
    `${toSmallCaps('welcome to')} *${config.botName}*.`,
    '',
    `┌───「 ${toSmallCaps('bot information')} 」`,
    `├ ${toSmallCaps('name')} : ${config.botName}`,
    `├ ${toSmallCaps('version')} : v${pkg.version || '0.1.0'}`,
    `├ ${toSmallCaps('features')} : ${visibleTotal} fitur`,
    `├ ${toSmallCaps('users')} : ${totalUsers()} user`,
    `└ ${toSmallCaps('uptime')} : ${fmtUptime(process.uptime() * 1000)}`,
    '',
    `┌───「 ${toSmallCaps('user information')} 」`,
    `├ ${toSmallCaps('name')} : ${userName}`,
    `├ ${toSmallCaps('status')} : ${statusText}`,
    `├ ${toSmallCaps('rpg')} : ${rpgText}`,
    `└ ${toSmallCaps('waktu')} : ${timeWib} WIB`
  ]
}

function formatCategoryBox(tag, list, prefix) {
  const meta = getCategoryMeta(tag)
  const lines = [`╭─〔 ${meta.emoji} *${toSmallCaps(meta.label)}* 〕`]
  for (const f of list) {
    const badge = f.owner ? ' 🔒' : f.admin ? ' 🛡️' : ''
    lines.push(`│ ▸ ${prefix}${f.name}${badge}`)
  }
  lines.push('╰─⬣')
  return lines.join('\n')
}

function overviewMenu(ctx, grouped) {
  const p = config.mainPrefix
  const tags = Object.keys(grouped)
  const lines = [...buildHeader(ctx, countGrouped(grouped)), '']

  if (tags.length > 0) {
    lines.push(`✦ *${toSmallCaps('daftar kategori')}* ✦`)
    tags.forEach((tag, idx) => {
      const meta = getCategoryMeta(tag)
      const count = grouped[tag].length
      const edge = idx === 0 ? '╭' : '┆'
      lines.push(`${edge}   • ${meta.emoji} ${p}menu ${tag}  _(${count})_`)
    })
    lines.push('╰➤────────────────────')
    lines.push('')
  }

  lines.push(`💡 *${toSmallCaps('navigasi')}:*`)
  lines.push(`• *${p}menu <kategori>* — buka isi kategori`)
  lines.push(`• *${p}menu all* / *${p}allmenu* — semua command`)
  lines.push(`• *${p}menu list* / *${p}menu button* — menu interaktif`)
  lines.push(`• *${p}help <command>* — cek alias & fungsi`)
  lines.push('')
  lines.push(footer())
  return lines.join('\n')
}

function categoryMenu(tag, grouped) {
  const p = config.mainPrefix
  const list = grouped[tag] ?? []
  const meta = getCategoryMeta(tag)

  return [
    formatCategoryBox(tag, list, p),
    '',
    `_${meta.info}_ • *${list.length} fitur*`,
    `💡 *${p}menu all* semua menu • *${p}help <cmd>* detail command`,
    '',
    footer()
  ].join('\n')
}

function allMenu(ctx, grouped) {
  const p = config.mainPrefix
  const lines = [...buildHeader(ctx, countGrouped(grouped)), '']

  for (const [tag, list] of Object.entries(grouped)) {
    lines.push(formatCategoryBox(tag, list, p))
    lines.push('')
  }

  lines.push(`💡 Ketik *${p}help <command>* untuk lihat alias & fungsi command.`)
  lines.push('')
  lines.push(footer())
  return lines.join('\n')
}

function commandDetailMenu(feat) {
  const p = config.mainPrefix
  const meta = getCategoryMeta(feat.tags || 'other')
  const aliases = (feat.aliases ?? []).map((a) => `${p}${a}`).join(', ') || '-'
  const access = feat.owner ? '👑 Khusus Owner' : feat.admin ? '🛡️ Khusus Admin/Staff' : '👤 Semua User'
  const cdSec = feat.cooldown ? `${(feat.cooldown / 1000).toFixed(feat.cooldown % 1000 === 0 ? 0 : 1)} detik` : 'Default'

  return [
    `┌───「 🔍 *${toSmallCaps('detail command')}* 」`,
    `├ Command : *${p}${feat.name}*`,
    `├ Kategori : ${meta.emoji} ${meta.label}`,
    `├ Alias : ${aliases}`,
    `├ Akses : ${access}`,
    `├ Cooldown : ${cdSec}`,
    `└ Info : ${feat.description || '-'}`,
    '',
    footer()
  ].join('\n')
}

async function sendMenuText(ctx, text) {
  const sendOpts = ctx.event ? { quote: ctx.event } : {}
  try {
    await ctx.client.message.send(
      ctx.chat,
      {
        extendedTextMessage: {
          text,
          contextInfo: { mentionedJid: [ctx.sender] }
        }
      },
      sendOpts
    )
  } catch {
    await ctx.reply(text)
  }
}

const registeredTags = new Set()
let allHandlerRegistered = false

function ensureHandlers() {
  const allTags = new Set([...Object.keys(CATEGORY_META), ...Object.keys(regroup({ isOwner: true, isAdmin: true }))])
  for (const tag of allTags) {
    if (registeredTags.has(tag)) continue
    registeredTags.add(tag)
    onRichReply(`menu:cat:${tag}`, async (c) => {
      const grouped = regroup(c)
      if (!grouped[tag]) {
        await c.reply(`🚫 Kategori "${tag}" tidak tersedia untukmu.`)
        return
      }
      await sendMenuText(c, categoryMenu(tag, grouped))
    })
  }

  if (!allHandlerRegistered) {
    allHandlerRegistered = true
    onRichReply('menu:all', async (c) => {
      await sendMenuText(c, allMenu(c, regroup(c)))
    })
  }
}

export default {
  name: 'menu',
  aliases: ['help', 'cmd', 'allmenu', 'menucat'],
  tags: 'general',
  description: 'Menu bot rapi: .menu, .menu all, .menu <kategori>, .menu list, .menu button',
  async run(ctx) {
    ensureHandlers()
    const p = config.mainPrefix
    const grouped = regroup(ctx)
    const sub = (ctx.args[0] ?? '').toLowerCase()

    if (ctx.command === 'allmenu' || sub === 'all') {
      await sendMenuText(ctx, allMenu(ctx, grouped))
      return
    }

    if (sub === 'list') {
      const rows = Object.entries(grouped).map(([tag, list]) => {
        const meta = getCategoryMeta(tag)
        return {
          id: `menu:cat:${tag}`,
          title: `${meta.emoji} ${meta.label}`,
          description: `${list.length} fitur • ${meta.info}`
        }
      })
      rows.push({
        id: 'menu:all',
        title: '📜 Semua Menu',
        description: `Tampilkan semua ${countGrouped(grouped)} fitur`
      })

      await ctx.replyList({
        text: `Pilih kategori menu *${config.botName}*:`,
        footer: `${config.botName} • Interactive Menu`,
        title: 'Kategori Menu',
        buttonText: 'Buka Kategori',
        sections: [{ title: 'Daftar Kategori', rows }]
      })
      return
    }

    if (sub === 'button' || sub === 'btn') {
      const buttons = Object.keys(grouped).map((tag) => {
        const meta = getCategoryMeta(tag)
        return {
          id: `menu:cat:${tag}`,
          text: `${meta.emoji} ${meta.label}`
        }
      })
      buttons.push({ id: 'menu:all', text: '📜 Semua' })

      await ctx.replyButtons({
        text: `Pilih kategori menu *${config.botName}*:`,
        footer: `${config.botName} • Interactive`,
        buttons
      })
      return
    }

    const canSeeFeature = (feat) =>
      feat && (!feat.owner || ctx.isOwner) && (!feat.admin || ctx.isAdmin) && (feat.tags !== 'owner' || ctx.isOwner)

    if (sub === 'detail' && ctx.args[1]) {
      const targetName = ctx.args[1].replace(/^[.!/#,]+/, '').toLowerCase()
      const feat = getFeature(targetName)
      if (!canSeeFeature(feat)) {
        await ctx.reply(`❌ Command "${targetName}" tidak ditemukan.`)
        return
      }
      await sendMenuText(ctx, commandDetailMenu(feat))
      return
    }

    if (sub) {
      if (grouped[sub]) {
        await sendMenuText(ctx, categoryMenu(sub, grouped))
        return
      }

      const cleanSub = sub.replace(/^[.!/#,]+/, '')
      const feat = getFeature(cleanSub)
      if (canSeeFeature(feat)) {
        await sendMenuText(ctx, commandDetailMenu(feat))
        return
      }

      const rawGroupedAll = regroup({ isOwner: true, isAdmin: true })
      if (rawGroupedAll[sub] && !ctx.isOwner) {
        await ctx.reply(`🚫 Kategori "${sub}" khusus Owner bot.`)
        return
      }

      await ctx.reply(
        `❌ Kategori/command "${sub}" tidak ditemukan.\n` +
          `Kategori tersedia: ${Object.keys(grouped).join(', ')}\n` +
          `Atau ketik *${p}menu* untuk melihat daftar kategori.`
      )
      return
    }

    await sendMenuText(ctx, overviewMenu(ctx, grouped))
  }
}
