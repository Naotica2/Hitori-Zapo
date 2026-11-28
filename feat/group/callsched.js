/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * callsched.js — Kirim kartu Jadwal Panggilan Suara/Video WhatsApp
 */
import config from '../../config.js'
import { formatWibDateTime, parseReminderTime } from '../../core/reminders.js'
import { getEvent } from '../../lib/media.js'

function parseCallArgs(raw) {
  let text = String(raw || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let callType = 1 // 1: VOICE, 2: VIDEO
  let useEventMode = false

  text = text.replace(/(^|\s)--(?:video|vid|vc)\b/gi, (_, lead) => {
    callType = 2
    return lead
  })
  text = text.replace(/(^|\s)--(?:voice|audio)\b/gi, (_, lead) => {
    callType = 1
    return lead
  })
  text = text.replace(/(^|\s)--event\b/gi, (_, lead) => {
    useEventMode = true
    return lead
  })

  const parts = text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)

  return { callType, useEventMode, parts }
}

export default {
  name: 'callsched',
  aliases: ['jadwalcall', 'schedcall', 'callcard'],
  tags: 'group',
  cooldown: 4000,
  description: 'Kirim kartu Jadwal Panggilan Suara/Video WhatsApp',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (!raw || /^help$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '📞 *JADWAL PANGGILAN WHATSAPP*\n\n' +
          '*Format:*\n' +
          `• *${p}callsched Judul Panggilan | Waktu*\n\n` +
          '*Opsi:*\n' +
          '• `--voice` (default) / `--video` → panggilan suara atau video\n' +
          '• `--event` → pakai kartu Event RSVP modern WhatsApp\n\n' +
          '*Contoh:*\n' +
          `• *${p}callsched Briefing Malam | besok 20:00*\n` +
          `• *${p}callsched --video Mabar Open Mic | 30m*`,
        sendOpts
      )
    }

    const { callType, useEventMode, parts } = parseCallArgs(raw)
    if (parts.length < 2) {
      return ctx.client.message.send(
        ctx.chat,
        `❌ Format: *${p}callsched Judul Panggilan | Waktu*\nContoh: *${p}callsched Briefing | 1 jam*`,
        sendOpts
      )
    }

    const title = parts[0].slice(0, 120)
    let scheduledMs
    try {
      scheduledMs = parseReminderTime(parts[1])
    } catch (e) {
      return ctx.client.message.send(ctx.chat, `❌ ${e.message}`, sendOpts)
    }

    await ctx.react('⏳')
    try {
      if (useEventMode) {
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'event',
            name: `${callType === 2 ? '📹' : '📞'} ${title}`,
            startTime: Math.floor(scheduledMs / 1000),
            isScheduleCall: true,
            hasReminder: true,
            reminderOffsetSec: 900
          },
          sendOpts
        )
      } else {
        await ctx.client.message.send(
          ctx.chat,
          {
            scheduledCallCreationMessage: {
              scheduledTimestampMs: scheduledMs,
              callType,
              title
            }
          },
          { ...sendOpts, additionalAttributes: { type: 'text' } }
        )
      }
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal membuat jadwal panggilan (${formatWibDateTime(scheduledMs)}): ${String(err?.message || err).slice(0, 200)}`,
        sendOpts
      )
    }
  }
}
