/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * hsr.js — Stalk profil & build karakter Honkai: Star Rail (Mihomo / Enka)
 */
import config from '../../config.js'
import { downloadUrlBuffer, extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { stalkHsr } from '../../scraper/ENKA.js'

export default {
  name: 'hsr',
  aliases: ['hsrstalk', 'starrail', 'honkaistalk'],
  tags: 'tools',
  cooldown: 5000,
  description: 'Cek profil, Trailblaze Level & build karakter Honkai: Star Rail',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    let target = String(ctx.text || '').trim()
    if (!target) {
      target = extractTextFromMessage(getQuotedMessage(ctx)).trim()
    }
    const uid = (target.match(/\d{9,10}/) || [])[0] || ''

    if (!uid || /^help$/i.test(target)) {
      return ctx.client.message.send(
        ctx.chat,
        '🚂 *HONKAI: STAR RAIL STALK*\n\n' +
          `Masukkan UID HSR (9–10 digit).\n` +
          `*Contoh:* *${p}hsr 800000002*`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      const d = await stalkHsr(uid)
      const lines = [
        '┌───「 🚂 *HONKAI: STAR RAIL STALK* 」───┐',
        '',
        `• Nickname    : *${d.nickname}*`,
        `• UID         : \`${d.uid}\``,
        `• Trailblaze  : *TL ${d.level}* • EQ ${d.equilibriumLevel}`,
        `• Karakter    : ${d.charactersOwned} • Light Cone: ${d.lightConesOwned}`,
        `• Achievement : *${d.achievements}* • MoC: ${d.memoryOfChaos}`,
        ...(d.signature ? [`• Bio         : ${d.signature.replace(/\n+/g, ' ')}`] : [])
      ]

      if (d.showcase.length) {
        lines.push('', '✨ *Karakter Showcase:*')
        for (const c of d.showcase.slice(0, 6)) {
          lines.push(`  ▸ *${c.name}* (Lv.${c.level} E${c.eidolon})`)
          if (c.lightCone) lines.push(`    🪩 LC: ${c.lightCone}`)
          if (c.atk || c.critRate) {
            lines.push(`    ⚔️ ATK ${c.atk ?? '-'} | SPD ${c.spd ?? '-'} | CR ${c.critRate ?? '-'} / CD ${c.critDmg ?? '-'}`)
          }
        }
      }

      lines.push('', '└──────────────────────────────────────┘', '', `> Sumber: Mihomo / Enka.Network`)
      const caption = lines.join('\n')

      if (d.avatarUrl) {
        try {
          await assertSafePublicUrl(d.avatarUrl)
          const imgBuf = await downloadUrlBuffer(d.avatarUrl, { timeout: 15_000, maxBytes: 5 * 1024 * 1024 })
          await ctx.client.message.send(ctx.chat, { type: 'image', media: imgBuf, mimetype: 'image/png', caption }, sendOpts)
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
