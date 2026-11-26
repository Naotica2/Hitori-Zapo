/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * igstalk.js — Cek info profil, bio, dan statistik akun Instagram
 */
import config from '../../config.js'
import {
  downloadUrlBuffer,
  extractTextFromMessage,
  getEvent,
  getQuotedMessage
} from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { cleanUsername, igStalk } from '../../scraper/IGSTALK.js'

const MAX_AVATAR_BYTES = 8 * 1024 * 1024

function resolveUsernameInput(ctx) {
  const direct = String(ctx.text || '').trim()
  if (direct) return direct

  const quotedText = extractTextFromMessage(getQuotedMessage(ctx)).trim()
  if (!quotedText) return ''

  const urlMatch = quotedText.match(/https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+/i)
  if (urlMatch) return urlMatch[0]

  const atMatch = quotedText.match(/@([a-zA-Z0-9._]{1,30})/)
  if (atMatch) return atMatch[1]

  return cleanUsername(quotedText)
}

export default {
  name: 'igstalk',
  aliases: ['stalkig', 'iginfo', 'igprofil'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Cek profil, bio, followers, dan info akun Instagram',

  async run(ctx) {
    const p = config.mainPrefix
    const rawTarget = resolveUsernameInput(ctx)

    if (!rawTarget) {
      return ctx.reply(
        '📸 *INSTAGRAM STALK*\n\n' +
          'Masukkan username atau link profil Instagram.\n\n' +
          '*Contoh:*\n' +
          `• *${p}igstalk jokowi*\n` +
          `• *${p}igstalk @zuck*\n` +
          `• *${p}igstalk https://instagram.com/instagram*`
      )
    }

    await ctx.react('⏳')

    try {
      const res = await igStalk(rawTarget)
      if (!res?.status || !res?.data?.user) {
        await ctx.react('❎')
        return ctx.reply(`❌ ${res?.message || 'Profil Instagram tidak ditemukan.'}`)
      }

      const u = res.data.user
      const posts = res.data.recent_posts?.items || []
      const badges = []
      if (u.is_verified === true) badges.push('✅ Verified')
      if (u.is_private === true) badges.push('🔒 Private')
      else if (u.is_private === false) badges.push('🌐 Public')

      const lines = [
        '┌───「 📸 *INSTAGRAM STALK* 」───┐',
        '',
        `• Nama      : *${u.full_name || u.username}*${badges.length ? ` (${badges.join(' • ')})` : ''}`,
        `• Username  : @${u.username}`,
        ...(u.id ? [`• ID Akun   : \`${u.id}\``] : []),
        `• Followers : *${u.stats?.followers ?? '-'}*`,
        `• Following : *${u.stats?.following ?? '-'}*`,
        `• Postingan : *${u.stats?.posts ?? '-'}*`
      ]

      if (u.biography) {
        lines.push(`• Bio       : ${u.biography}`)
      }
      if (u.external_url) {
        lines.push(`• Website   : ${u.external_url}`)
      }
      lines.push(`• Profil    : https://www.instagram.com/${u.username}/`)

      if (posts.length > 0) {
        lines.push('', '🖼️ *Postingan Terbaru:*')
        for (const item of posts.slice(0, 3)) {
          const kind = item.product_type === 'clips' ? '🎬 Reel' : item.type === 'video' ? '🎥 Video' : '🖼️ Foto'
          lines.push(`  ▸ ${kind}: ${item.url}`)
        }
      }

      lines.push('', '└──────────────────────────────┘', '', `> ✨ _*Powered by ${config.botName}*_`)
      const caption = lines.join('\n')

      const rawEvent = getEvent(ctx)
      const sendOpts = rawEvent ? { quote: rawEvent } : {}

      if (u.profile_pic_url) {
        try {
          await assertSafePublicUrl(u.profile_pic_url)
          const avatarBuf = await downloadUrlBuffer(u.profile_pic_url, {
            timeout: 20_000,
            maxBytes: MAX_AVATAR_BYTES
          })
          await ctx.client.message.send(
            ctx.chat,
            {
              type: 'image',
              media: avatarBuf,
              mimetype: 'image/jpeg',
              caption
            },
            sendOpts
          )
          await ctx.react('✅')
          return
        } catch {
          // Fallback ke pesan teks jika CDN avatar gagal diakses
        }
      }

      await ctx.client.message.send(ctx.chat, caption, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply('❌ Error sistem: ' + String(err?.message || err).slice(0, 220))
    }
  }
}
