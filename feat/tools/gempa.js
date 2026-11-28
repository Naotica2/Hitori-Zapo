/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * gempa.js — Info gempa bumi terkini, M5.0+, & dirasakan resmi dari BMKG
 */
import config from '../../config.js'
import { downloadUrlBuffer, getEvent } from '../../lib/media.js'
import { getGempaList, getLatestGempa } from '../../scraper/BMKG.js'

export default {
  name: 'gempa',
  aliases: ['infogempa', 'bmkg', 'autogempa'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Cek info gempa terbaru, M5.0+, dan peta guncangan resmi BMKG',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const sub = String(ctx.args[0] || '').trim().toLowerCase()
    if (/^(help|\?)$/i.test(sub)) {
      return ctx.client.message.send(
        ctx.chat,
        '🌋 *INFO GEMPA BMKG*\n\n' +
          `• *${p}gempa* — gempa terbaru lengkap peta guncangan (shakemap)\n` +
          `• *${p}gempa m5* / *terkini* — daftar 5 gempa M 5.0+ terbaru\n` +
          `• *${p}gempa dirasakan* — daftar 5 gempa dirasakan terbaru\n` +
          `• Admin grup bisa aktifkan notif otomatis via *${p}on autogempa*`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      if (['m5', 'terkini', 'dirasakan', 'list'].includes(sub)) {
        const mode = sub === 'dirasakan' ? 'dirasakan' : 'terkini'
        const list = await getGempaList(mode)
        const lines = list.slice(0, 5).map(
          (g, idx) =>
            `*${idx + 1}. M ${g.Magnitude}* • ${g.Tanggal} ${g.Jam}\n` +
            `   📍 ${g.Wilayah}\n` +
            `   📏 Kedalaman: ${g.Kedalaman}${g.Dirasakan ? ` • Dirasakan: ${g.Dirasakan}` : g.Potensi ? ` • ${g.Potensi}` : ''}`
        )
        await ctx.client.message.send(
          ctx.chat,
          `🌋 *${mode === 'dirasakan' ? '5 GEMPA DIRASAKAN' : '5 GEMPA M 5.0+ TERKINI'} (BMKG)*\n\n${lines.join('\n\n')}\n\n> Sumber: BMKG Indonesia`,
          sendOpts
        )
        await ctx.react('✅')
        return
      }

      const g = await getLatestGempa()
      const caption = [
        '┌───「 🌋 *GEMPA TERBARU BMKG* 」───┐',
        '',
        `• Waktu     : *${g.tanggal}, ${g.jam}*`,
        `• Magnitudo : *M ${g.magnitude}*`,
        `• Kedalaman : *${g.kedalaman}*`,
        `• Koordinat : ${g.lintang}, ${g.bujur} (${g.coordinates})`,
        `• Wilayah   : *${g.wilayah}*`,
        `• Potensi   : ${g.potensi}`,
        ...(g.dirasakan && g.dirasakan !== '-' ? [`• Dirasakan : ${g.dirasakan}`] : []),
        '',
        '└──────────────────────────────────┘',
        '',
        `> Sumber: BMKG RI • Tips: ketik *${p}gempa m5* / *${p}gempa dirasakan*`
      ].join('\n')

      if (g.shakemapUrl) {
        try {
          const mapBuf = await downloadUrlBuffer(g.shakemapUrl, { timeout: 15_000, maxBytes: 8 * 1024 * 1024 })
          await ctx.client.message.send(
            ctx.chat,
            { type: 'image', media: mapBuf, mimetype: 'image/jpeg', caption },
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
      return ctx.client.message.send(ctx.chat, `❌ Gagal mengambil data BMKG: ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
