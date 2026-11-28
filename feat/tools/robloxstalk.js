/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * robloxstalk.js — Cek profil, avatar full-body, statistik & status online akun Roblox
 */
import sharp from 'sharp'
import config from '../../config.js'
import { logger } from '../../core/logger.js'
import { downloadUrlBuffer, extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { robloxStalk } from '../../scraper/ROBLOX.js'

/**
 * Render avatar PNG transparan Roblox ke atas background studio gradient JPEG 760x760
 * supaya tampil tajam di WhatsApp (tidak gelap/hilang transparansinya).
 */
export async function renderRobloxCharacterJpeg(pngBuffer) {
  const bgSvg =
    '<svg width="760" height="760" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><radialGradient id="g" cx="50%" cy="42%" r="65%">' +
    '<stop offset="0%" stop-color="#1e293b"/>' +
    '<stop offset="100%" stop-color="#090d16"/>' +
    '</radialGradient></defs>' +
    '<rect width="760" height="760" fill="url(#g)"/>' +
    '<ellipse cx="380" cy="650" rx="210" ry="50" fill="rgba(56,189,248,0.12)"/>' +
    '</svg>'

  const avatar = await sharp(pngBuffer)
    .resize(700, 700, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  return sharp(Buffer.from(bgSvg))
    .composite([{ input: avatar, gravity: 'center' }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

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
          const rawImgBuf = await downloadUrlBuffer(u.avatarUrl, { timeout: 20_000, maxBytes: 8 * 1024 * 1024 })
          let imgBuf = rawImgBuf
          let mimetype = 'image/png'
          try {
            imgBuf = await renderRobloxCharacterJpeg(rawImgBuf)
            mimetype = 'image/jpeg'
          } catch {}
          await ctx.client.message.send(
            ctx.chat,
            { type: 'image', media: imgBuf, mimetype, caption },
            sendOpts
          )
          await ctx.react('✅')
          return
        } catch (imgErr) {
          logger.warn({ err: imgErr?.message, avatarUrl: u.avatarUrl }, '⚠️ [robloxstalk] Gagal kirim avatar Roblox')
        }
      }

      await ctx.client.message.send(ctx.chat, caption, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
