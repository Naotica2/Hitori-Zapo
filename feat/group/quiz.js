/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * quiz.js — WhatsApp Native Quiz Poll (PollType.QUIZ + correctAnswer + endTime)
 */
import crypto from 'node:crypto'
import config from '../../config.js'
import { getEvent } from '../../lib/media.js'

function parseQuizArgs(raw) {
  let text = String(raw || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let ansIndex = null
  let durMinutes = 0
  let hideParticipantName = false

  text = text.replace(/(^|\s)--ans(?:wer)?(?:=|\s+)(\d+)\b/gi, (_, lead, n) => {
    const val = Number.parseInt(n, 10)
    if (Number.isFinite(val) && val >= 1) ansIndex = val
    return lead
  })
  text = text.replace(/(^|\s)--dur(?:ation)?(?:=|\s+)(\d+)\b/gi, (_, lead, n) => {
    const val = Number.parseInt(n, 10)
    if (Number.isFinite(val) && val > 0) durMinutes = Math.min(val, 43_200)
    return lead
  })
  text = text.replace(/(^|\s)--anon(?:ymous|im)?\b/gi, (_, lead) => {
    hideParticipantName = true
    return lead
  })

  const parts = text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)

  return { ansIndex, durMinutes, hideParticipantName, parts }
}

export default {
  name: 'quiz',
  aliases: ['kuis', 'waquiz'],
  tags: 'group',
  cooldown: 4000,
  description: 'Buat kartu Kuis native WhatsApp dengan kunci jawaban benar',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (!raw || /^help$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '🧠 *WHATSAPP NATIVE QUIZ*\n\n' +
          'Tandai jawaban benar dengan tanda `*` di depan opsi (atau `--ans <nomor>`).\n\n' +
          '*Contoh:*\n' +
          `• *${p}quiz Ibukota Jepang? | *Tokyo | Osaka | Kyoto*\n` +
          `• *${p}quiz --ans 2 --dur 10 2 + 2 x 2 = ? | 8 | 6 | 4*\n\n` +
          '*Opsi:* `--ans <no>`, `--dur <menit>`, `--anon`\n' +
          '_Catatan: Tampilan UI Quiz adalah fitur eksperimental WhatsApp; beberapa versi WA klien hanya merendernya sebagai poll/pesan belum didukung jika belum rollout._',
        sendOpts
      )
    }

    const { ansIndex, durMinutes, hideParticipantName, parts } = parseQuizArgs(raw)
    if (parts.length < 3) {
      return ctx.client.message.send(
        ctx.chat,
        `❌ Format: *${p}quiz Pertanyaan | *Jawaban Benar | Opsi Salah 1 | Opsi Salah 2*`,
        sendOpts
      )
    }

    const question = parts[0].slice(0, 255)
    const rawOptions = parts.slice(1, 13)
    let correctName = null

    const cleanOptions = []
    for (let i = 0; i < rawOptions.length; i++) {
      let opt = rawOptions[i]
      const isMarked = opt.startsWith('*')
      if (isMarked) opt = opt.slice(1).trim()
      opt = opt.slice(0, 100)
      if (!opt || cleanOptions.includes(opt)) continue
      cleanOptions.push(opt)
      if (isMarked && !correctName) correctName = opt
      if (!isMarked && ansIndex === i + 1 && !correctName) correctName = opt
    }

    if (cleanOptions.length < 2) {
      return ctx.client.message.send(ctx.chat, '❌ Minimal butuh 2 opsi unik untuk kuis.', sendOpts)
    }
    if (!correctName) {
      correctName = cleanOptions[0]
    }

    const encKey = crypto.randomBytes(32)
    const pollBody = {
      encKey,
      name: question,
      options: cleanOptions.map((optionName) => ({ optionName })),
      selectableOptionsCount: 1,
      pollContentType: 1, // PollContentType.TEXT
      pollType: 1, // PollType.QUIZ
      correctAnswer: { optionName: correctName },
      ...(durMinutes > 0 ? { endTime: Math.floor(Date.now() / 1000) + durMinutes * 60 } : {}),
      ...(hideParticipantName ? { hideParticipantName: true } : {})
    }

    const protoMsg = hideParticipantName
      ? { pollCreationMessageV6: pollBody }
      : { pollCreationMessageV5: pollBody }

    await ctx.react('⏳')
    try {
      await ctx.client.message.send(ctx.chat, protoMsg, sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal mengirim kuis: ${String(err?.message || err).slice(0, 220)}`,
        sendOpts
      )
    }
  }
}
