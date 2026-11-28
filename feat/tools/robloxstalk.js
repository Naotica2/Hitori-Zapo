/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * robloxstalk.js — Cek profil, avatar full-body, statistik & status online akun Roblox
 */
import config from '../../config.js'
import { downloadUrlBuffer, extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { robloxStalk } from '../../scraper/ROBLOX.js'

function fmtNum(v) {
  return typeof v === 'number' ? v.toLocaleString('id-ID') : String(v ?? '-')
}

function fmtDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })
}

export default {
  name: 'robloxstalk',
  aliases: ['rblx', 'roblox', 'stalkroblox'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Cek profil, bio, avatar 3D, followers, grup, & status akun Roblox',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    let target = String(ctx.text || '').trim()
    if (!target) {
      const q = extractTextFromMessage(getQuotedMessage(ctx)).trim()
      const m = q.match(/roblox\.com\/users\/(\d+)/i)
      target = m ? m[1] : q.split(/\s+/)[0] || ''
    } else {
      const m = target.match(/roblox\.com\/users\/(\d+)/i)
      if (m) target = m[1]
    }

    if (!target || /^help$/i.test(target)) {
      return ctx.client.message.send(
        ctx.chat,
        '🟥 *ROBLOX STALK*\n\n' +
          '*Contoh:*\n' +
          `• *${p}robloxstalk Roblox*\n` +
          `• *${p}rblx Builderman*\n` +
          `• *${p}rblx 1* _(User ID)_`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      const u = await robloxStalk(target)
      const badges = []
      if (u.hasVerifiedBadge) badges.push('✅ Verified')
      if (u.isBanned) badges.push('🚫 Banned')

      const lines = [
        '┌───「 🟥 *ROBLOX STALK* 」───┐',
        '',
        `• Display  : *${u.displayName}*${badges.length ? ` (${badges.join(' • ')})` : ''}`,
        `• Username : @${u.name}`,
        `• User ID  : \`${u.id}\``,
        `• Status   : *${u.presenceStatus}*${u.lastLocation && u.lastLocation !== 'Offline' ? ` (${u.lastLocation})` : ''}`,
        `• Dibuat   : ${fmtDate(u.created)}`,
        `• Friends  : *${fmtNum(u.friendsCount)}*`,
        `• Followers: *${fmtNum(u.followersCount)}* • Following: *${fmtNum(u.followingsCount)}*`,
        ...(u.description ? [`• Bio      : ${u.description.slice(0, 220).replace(/\n+/g, ' ')}`] : []),
        ...(u.groups.length
          ? ['', '🏷️ *Grup Teratas:*', ...u.groups.map((g) => `  ▸ ${g.name} (${g.role})`)]
          : []),
        '',
        `• Profil   : ${u.profileUrl}`,
        '',
        '└─────────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ]

      const caption = lines.join('\n')
      if (u.avatarUrl) {
        try {
          await assertSafePublicUrl(u.avatarUrl)
          const imgBuf = await downloadUrlBuffer(u.avatarUrl, { timeout: 15_000, maxBytes: 8 * 1024 * 1024 })
          await ctx.client.message.send(
            ctx.chat,
            { type: 'image', media: imgBuf, mimetype: 'image/png', caption },
            sendOpts
          )
          await ctx.react('✅')
          return
        } catch {}
      }

      await ctx.client.message.send(ctx.chat, caption, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
