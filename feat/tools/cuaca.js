/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * cuaca.js — Prakiraan cuaca resmi BMKG (auto-lookup adm4) + fallback Open-Meteo global
 */
import config from '../../config.js'
import { getEvent } from '../../lib/media.js'
import { getWeatherForecast } from '../../scraper/BMKG.js'

export default {
  name: 'cuaca',
  aliases: ['weather', 'prakiraan'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Cek prakiraan cuaca akurat per wilayah (BMKG Indonesia & Open-Meteo)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const query = String(ctx.text || '').trim()
    if (!query || /^help$/i.test(query)) {
      return ctx.client.message.send(
        ctx.chat,
        '⛅ *PRAKIRAAN CUACA*\n\n' +
          '*Contoh:*\n' +
          `• *${p}cuaca Bandung*\n` +
          `• *${p}cuaca Kemayoran, Jakarta*\n` +
          `• *${p}cuaca 31.71.03.1001* _(kode adm4 BMKG)_\n` +
          `• *${p}cuaca Tokyo* _(kota luar negeri)_`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      const w = await getWeatherForecast(query)
      const locParts = [w.location.desa, w.location.kecamatan, w.location.kotkab, w.location.provinsi].filter(Boolean)
      const c = w.current

      const timeline = w.slots.slice(0, 6).map((s) => {
        const jam = String(s.localDatetime || '').split(/\s+/)[1]?.slice(0, 5) || s.localDatetime
        return `• *${jam}* — ${s.desc} | 🌡️ ${s.tempC}°C | 💧 ${s.humidity}%${s.windKmh !== undefined ? ` | 💨 ${s.windKmh} km/j` : ''}`
      })

      const text = [
        '┌───「 ⛅ *PRAKIRAAN CUACA* 」───┐',
        '',
        `📍 *${locParts.join(', ')}*`,
        ...(w.location.adm4 ? [`🆔 ADM4: \`${w.location.adm4}\``] : []),
        '',
        `🌤️ Kondisi  : *${c.desc}*`,
        `🌡️ Suhu     : *${c.tempC}°C*`,
        `💧 Lembap   : *${c.humidity}%*`,
        ...(c.windKmh !== undefined ? [`💨 Angin    : ${c.windKmh} km/j${c.windDir ? ` (${c.windDir})` : ''}`] : []),
        ...(c.cloudPct !== undefined ? [`☁️ Tutup Awan: ${c.cloudPct}%`] : []),
        '',
        '🕒 *Prakiraan Jam Berikutnya:*',
        ...timeline,
        '',
        '└──────────────────────────────┘',
        '',
        `> Sumber: ${w.source}`
      ].join('\n')

      await ctx.client.message.send(ctx.chat, text, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
