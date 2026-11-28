/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * quran.js — Baca ayat Al-Qur'an, Latin, terjemahan Indonesia, & kirim audio murottal
 */
import config from '../../config.js'
import { downloadUrlBuffer, getEvent } from '../../lib/media.js'
import { getSurahDetail } from '../../scraper/ISLAM.js'

const MAX_AYAT_PER_MSG = 10

function parseQuranInput(raw) {
  let text = String(raw || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let withAudio = false
  text = text
    .replace(/(^|\s)--(?:audio|mp3|vn)\b/gi, (_, lead) => {
      withAudio = true
      return lead
    })
    .trim()

  const m = text.match(/^(.+?)(?:[:\s]+(\d+)(?:-(\d+))?)?$/)
  if (!m) return { surah: text, start: 1, end: 5, hasRange: false, withAudio }

  const surah = m[1].trim()
  if (!m[2]) return { surah, start: 1, end: 5, hasRange: false, withAudio }

  const start = Math.max(1, Number.parseInt(m[2], 10))
  const end = m[3] ? Math.max(start, Number.parseInt(m[3], 10)) : start
  return { surah, start, end, hasRange: true, withAudio }
}

export default {
  name: 'quran',
  aliases: ['alquran', 'ayat', 'surah'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Baca Al-Qur\'an lengkap Arab, Latin, terjemahan ID, & audio murottal',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (!raw || /^help$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '📖 *AL-QUR\'AN DIGITAL*\n\n' +
          '*Contoh:*\n' +
          `• *${p}quran Al-Fatihah* — baca 5 ayat pertama\n` +
          `• *${p}quran 2:255* — Ayat Kursi\n` +
          `• *${p}quran Al-Kahfi:1-10* — rentang ayat (maks 10 per pesan)\n` +
          `• *${p}quran 112 --audio* — sertakan audio murottal`,
        sendOpts
      )
    }

    const { surah, start, end, hasRange, withAudio } = parseQuranInput(raw)
    if (!surah) {
      return ctx.client.message.send(ctx.chat, `❌ Masukkan nama atau nomor surah (1-114).`, sendOpts)
    }

    await ctx.react('⏳')
    try {
      const data = await getSurahDetail(surah)
      const total = data.jumlahAyat || data.ayat.length
      if (start > total) {
        throw new Error(`Surah *${data.namaLatin}* hanya memiliki ${total} ayat.`)
      }

      const clampedEnd = Math.min(total, start + MAX_AYAT_PER_MSG - 1, hasRange ? end : start + 4)
      const slice = data.ayat.slice(start - 1, clampedEnd)

      const blocks = slice.map(
        (a) =>
          `*${data.nomor}:${a.nomorAyat}*\n` +
          `${a.teksArab}\n` +
          `_${String(a.teksLatin || '').trim()}_\n` +
          `↳ "${String(a.teksIndonesia || '').trim()}"`
      )

      const header =
        `📖 *QS. ${data.namaLatin}* (${data.nama}) • *${data.arti}*\n` +
        `_${data.tempatTurun} • ${total} Ayat • Menampilkan ayat ${start}–${clampedEnd}_\n\n`

      const footer =
        clampedEnd < end
          ? `\n\n_Catatan: Maksimal ${MAX_AYAT_PER_MSG} ayat per pesan._\n> Sumber: Kemenag RI / EQuran.id`
          : '\n\n> Sumber: Kemenag RI / EQuran.id'

      await ctx.client.message.send(ctx.chat, header + blocks.join('\n\n') + footer, sendOpts)

      if (withAudio) {
        const audioUrl =
          slice.length === 1 && slice[0]?.audio?.['05']
            ? slice[0].audio['05']
            : data.audioFull?.['05']
        if (audioUrl) {
          const mp3 = await downloadUrlBuffer(audioUrl, { timeout: 45_000, maxBytes: 25 * 1024 * 1024 })
          await ctx.client.message.send(
            ctx.chat,
            { type: 'audio', media: mp3, mimetype: 'audio/mpeg' },
            sendOpts
          )
        }
      }

      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
