/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tiktokstalk.js — Cek info profil, bio, followers, likes & total video akun TikTok
 */
import config from '../../config.js'
import { downloadUrlBuffer, extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { cleanTikTokUsername, tiktokStalk } from '../../scraper/TIKTOKSTALK.js'

function fmtCount(n) {
  return Number.isFinite(n) ? n.toLocaleString('id-ID') : String(n ?? '-')
}

export default {
  name: 'tiktokstalk',
  aliases: ['ttstalk', 'stalktt', 'ttinfo', 'ttprofil'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Cek profil, bio, followers, likes, dan statistik akun TikTok',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    let target = String(ctx.text || '').trim()
    if (!target) {
      target = cleanTikTokUsername(extractTextFromMessage(getQuotedMessage(ctx)))
    }

    if (!target || /^help$/i.test(target)) {
      return ctx.client.message.send(
        ctx.chat,
        '🎵 *TIKTOK STALK*\n\n' +
          '*Contoh:*\n' +
          `• *${p}tiktokstalk tiktok*\n` +
          `• *${p}ttstalk @khaby.lame*\n` +
          `• *${p}ttstalk https://www.tiktok.com/@tiktok*`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      const u = await tiktokStalk(target)
      const badges = []
      if (u.verified) badges.push('✅ Verified')
      badges.push(u.privateAccount ? '🔒 Private' : '🌐 Public')

      const lines = [
        '┌───「 🎵 *TIKTOK STALK* 」───┐',
        '',
        `• Nama      : *${u.nickname}* (${badges.join(' • ')})`,
        `• Username  : @${u.uniqueId}`,
        `• User ID   : \`${u.id}\``,
        `• Followers : *${fmtCount(u.followers)}*`,
        `• Following : *${fmtCount(u.following)}*`,
        `• Total Like: *${fmtCount(u.hearts)}*`,
        `• Video     : *${fmtCount(u.videos)}*`,
        ...(u.region ? [`• Region    : ${u.region}`] : []),
        ...(u.signature ? [`• Bio       : ${u.signature.replace(/\n+/g, ' ')}`] : []),
        ...(u.bioLink ? [`• Link Bio  : ${u.bioLink}`] : []),
        `• Profil    : ${u.profileUrl}`,
        '',
        '└─────────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ]

      const caption = lines.join('\n')
      if (u.avatarUrl) {
        try {
          await assertSafePublicUrl(u.avatarUrl)
          const avatarBuf = await downloadUrlBuffer(u.avatarUrl, { timeout: 20_000, maxBytes: 8 * 1024 * 1024 })
          await ctx.client.message.send(
            ctx.chat,
            { type: 'image', media: avatarBuf, mimetype: 'image/jpeg', caption },
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
