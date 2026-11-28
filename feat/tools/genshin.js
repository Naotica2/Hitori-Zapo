/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * genshin.js — Stalk profil & showcase karakter Genshin Impact via Enka.Network
 */
import config from '../../config.js'
import { downloadUrlBuffer, extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import { stalkGenshin } from '../../scraper/ENKA.js'

export default {
  name: 'genshin',
  aliases: ['gistalk', 'genshinstalk', 'enka'],
  tags: 'tools',
  cooldown: 5000,
  description: 'Cek profil, Adventure Rank, Abyss & showcase build karakter Genshin Impact',

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
        '⚔️ *GENSHIN IMPACT STALK*\n\n' +
          `Masukkan UID Genshin (9–10 digit).\n` +
          `*Contoh:* *${p}genshin 800000001*`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      const d = await stalkGenshin(uid)
      const lines = [
        '┌───「 ⚔️ *GENSHIN IMPACT STALK* 」───┐',
        '',
        `• Nickname    : *${d.nickname}*`,
        `• UID         : \`${d.uid}\` (${d.region})`,
        `• AR / WL     : *AR ${d.level}* • WL ${d.worldLevel}`,
        `• Achievement : *${d.achievements}*`,
        `• Spiral Abyss: Floor *${d.spiralAbyss}*`,
        ...(d.theater && d.theater !== '-' ? [`• Imaginarium : ${d.theater}`] : []),
        `• Max Friends : ${d.friendshipMax} karakter`,
        ...(d.signature ? [`• Bio         : ${d.signature.replace(/\n+/g, ' ')}`] : [])
      ]

      if (d.showcase.length) {
        lines.push('', '✨ *Showcase Karakter:*')
        for (const c of d.showcase.slice(0, 8)) {
          const head = `  ▸ *${c.name}* (Lv.${c.level}${c.constellation !== null ? ` C${c.constellation}` : ''})`
          if (c.critRate !== null && c.critDmg !== null) {
            lines.push(`${head}\n    ATK ${c.atk ?? '-'} | HP ${c.hp ?? '-'} | CR ${c.critRate}% / CD ${c.critDmg}%`)
          } else {
            lines.push(head)
          }
        }
      } else {
        lines.push('', '_Showcase karakter disembunyikan oleh pemain._')
      }

      lines.push('', '└─────────────────────────────────────┘', '', `> Sumber: Enka.Network • https://enka.network/u/${d.uid}`)
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
