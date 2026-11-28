/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * menfess.js — Kirim pesan anonim ke seseorang.
 */

import { getEvent, getContextInfo } from '../../lib/media.js'
import { createThread, deliverMenfess } from '../../handlers/menfessHandler.js'

function normalizeNumber(input) {
  let n = String(input).replace(/[^\d]/g, '')
  if (!n || n.length < 8) return null
  if (n.startsWith('0')) n = '62' + n.slice(1)
  return n + '@s.whatsapp.net'
}

export default {
  name: 'menfess',
  aliases: ['nfess', 'anonim'],
  tags: 'tools',
  description: 'Kirim pesan anonim ke seseorang (bisa dibales anonim juga)',

  async run(ctx) {
    if (ctx.chat?.endsWith('@g.us')) {
      return ctx.reply(
        '🕶️ Menfess cuma bisa dipake lewat *chat pribadi ke bot* (biar beneran rahasia).\nDM bot ini langsung ya, terus ketik ulang *.menfess*-nya di sana.'
      )
    }

    const event = getEvent(ctx)
    const rawMessage = event?.message ?? event
    const ci = getContextInfo(rawMessage)
    const raw = (ctx.text || '').trim()

    if (!raw) {
      return ctx.reply(
        '🕶️ *MENFESS*\n\n' +
        'Cara pake:\n*.menfess <nomor/@mention> <pesan>*\n\n' +
        'Contoh:\n.menfess 628123456789 Halo kak, mau nanya sesuatu...'
      )
    }

    let targetJid = null
    let message = raw

    if (ci?.mentionedJid?.[0]) {
      targetJid = ci.mentionedJid[0]
      message = raw.replace(/@\d+/, '').trim()
    } else {
      const match = raw.match(/^\+?(\d{8,15})\s+([\s\S]+)$/)
      if (!match) {
        return ctx.reply('Format gak kebaca. Contoh: *.menfess 628123456789 pesan kamu di sini*')
      }
      targetJid = normalizeNumber(match[1])
      message = match[2].trim()
    }

    if (!targetJid) return ctx.reply('⚠️ Nomor/target gak valid.')
    if (!message) return ctx.reply('⚠️ Pesannya mana? Contoh: *.menfess 628123456789 halo kak*')
    if (targetJid === ctx.sender) return ctx.reply('Gak bisa menfess ke diri sendiri, Kak.')

    const threadId = createThread(ctx.sender, targetJid)

    await ctx.react('⏳')
    try {
      await deliverMenfess({ ...ctx, sender: ctx.sender }, threadId, message, { isReply: false })
      await ctx.react('✅')
      await ctx.reply('✅ Menfess terkirim secara anonim. Kalo dia bales, notifnya bakal muncul di sini juga.')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('Gagal ngirim menfess: ' + (e.message || e))
    }
  }
}
