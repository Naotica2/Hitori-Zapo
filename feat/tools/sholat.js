/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * sholat.js — Cek jadwal sholat resmi Kemenag RI (via myQuran v3)
 */
import config from '../../config.js'
import { getEvent } from '../../lib/media.js'
import { getPrayerSchedule } from '../../scraper/ISLAM.js'

export default {
  name: 'sholat',
  aliases: ['jadwalsholat', 'imsak', 'imsakiyah'],
  tags: 'tools',
  cooldown: 3000,
  description: 'Cek jadwal sholat & imsakiyah harian per kota/kabupaten Indonesia',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    let query = String(ctx.text || '').trim()
    if (!query || /^help$/i.test(query)) {
      return ctx.client.message.send(
        ctx.chat,
        '🕌 *JADWAL SHOLAT INDONESIA*\n\n' +
          '*Contoh:*\n' +
          `• *${p}sholat Jakarta Pusat*\n` +
          `• *${p}sholat Bandung*\n` +
          `• *${p}sholat Surabaya --besok*`,
        sendOpts
      )
    }

    let tomorrow = false
    query = query
      .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')
      .replace(/(^|\s)--(?:besok|tomorrow)\b/gi, (_, lead) => {
        tomorrow = true
        return lead
      })
      .trim()

    let dateKey = 'today'
    if (tomorrow) {
      const d = new Date(Date.now() + 7 * 3600_000 + 86_400_000)
      dateKey = d.toISOString().slice(0, 10)
    }

    await ctx.react('⏳')
    try {
      const s = await getPrayerSchedule(query, { dateKey })
      const t = s.times

      const msg = [
        '┌───「 🕌 *JADWAL SHOLAT* 」───┐',
        '',
        `📍 *${s.kabko}*${s.prov ? ` (${s.prov})` : ''}`,
        `📅 ${s.tanggal}`,
        '',
        `• Imsak   : *${t.imsak}*`,
        `• Subuh   : *${t.subuh}*`,
        `• Terbit  : ${t.terbit}`,
        `• Dhuha   : ${t.dhuha}`,
        `• Dzuhur  : *${t.dzuhur}*`,
        `• Ashar   : *${t.ashar}*`,
        `• Maghrib : *${t.maghrib}*`,
        `• Isya    : *${t.isya}*`,
        ...(s.alternatives.length > 1
          ? ['', `_Wilayah mirip: ${s.alternatives.join(', ')}_`]
          : []),
        '',
        '└─────────────────────────────┘',
        '',
        '> Sumber: Bimas Islam Kemenag RI (myQuran v3)'
      ].join('\n')

      await ctx.client.message.send(ctx.chat, msg, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
