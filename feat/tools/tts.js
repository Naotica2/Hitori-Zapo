/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tts.js — Text-to-Speech (Voice Note / Audio via HAPGETA AI)
 */

import config from '../../config.js'
import { extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'
import { runWithWorkerSession, textToSpeech } from '../../scraper/HAPGETA.js'

const MAX_TTS_CHARS = 800

export default {
  name: 'tts',
  aliases: ['say', 'haptts'],
  tags: 'tools',
  cooldown: 5000,
  description: 'Ubah teks menjadi suara / Voice Note AI',

  async run(ctx) {
    const p = ctx.prefix || config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    let raw = String(ctx.text || '').trim()
    let asVoiceNote = true
    if (/(?:^|\s)--(?:mp3|audio)\b/i.test(raw)) {
      asVoiceNote = false
      raw = raw.replace(/(?:^|\s)--(?:mp3|audio)\b/gi, '').trim()
    }

    if (!raw) {
      raw = extractTextFromMessage(getQuotedMessage(ctx)).trim()
    }

    if (!raw || /^(help|\?)$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '🗣️ *AI TEXT TO SPEECH*\n\n' +
          `• *${p}tts <teks>* — kirim sebagai Voice Note\n` +
          `• *${p}tts --audio <teks>* — kirim sebagai file audio\n` +
          `• Reply pesan teks lalu ketik *${p}tts*\n\n` +
          `_Maksimal ${MAX_TTS_CHARS} karakter._`,
        sendOpts
      )
    }

    if (raw.length > MAX_TTS_CHARS) {
      return ctx.client.message.send(
        ctx.chat,
        `⚠️ Teks terlalu panjang (${raw.length} karakter, maks ${MAX_TTS_CHARS} karakter).`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      let audioRes
      try {
        // Coba tanpa membakar sesi dulu; fallback ke worker session bila server mewajibkan token
        audioRes = await textToSpeech({ text: raw })
      } catch {
        audioRes = await runWithWorkerSession((session) => textToSpeech({ text: raw, session }))
      }

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'audio',
          media: audioRes.buffer,
          mimetype: audioRes.contentType || 'audio/mpeg',
          ptt: asVoiceNote
        },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      await ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 260)}`, sendOpts)
    }
  }
}
