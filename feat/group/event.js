/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * event.js — Buat kartu Event resmi WhatsApp + RSVP + opsional auto-pin
 */
import config from '../../config.js'
import { isGroupAdmin } from '../../core/permission.js'
import { formatWibDateTime, parseReminderTime } from '../../core/reminders.js'
import { getEvent } from '../../lib/media.js'

function parseEventArgs(raw) {
  let text = String(raw || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let locationName = ''
  let description = ''
  let joinLink = ''
  let isScheduleCall = false
  let reminderOffsetSec = 1800
  let hasReminder = true
  let durHours = 2
  let shouldPin = false
  let extraGuestsAllowed = true

  text = text.replace(/(^|\s)--(?:loc|lokasi)(?:=|\s+)("[^"]+"|\S+)/gi, (_, lead, val) => {
    locationName = val.replace(/^"|"$/g, '').trim()
    return lead
  })
  text = text.replace(/(^|\s)--desc(?:=|\s+)("[^"]+")/gi, (_, lead, val) => {
    description = val.replace(/^"|"$/g, '').trim()
    return lead
  })
  text = text.replace(/(^|\s)--link(?:=|\s+)(\S+)/gi, (_, lead, val) => {
    joinLink = val.trim()
    return lead
  })
  text = text.replace(/(^|\s)--dur(?:=|\s+)(\d+(?:[.,]\d+)?)\b/gi, (_, lead, val) => {
    const n = Number.parseFloat(val.replace(',', '.'))
    if (Number.isFinite(n) && n > 0 && n <= 168) durHours = n
    return lead
  })
  text = text.replace(/(^|\s)--remind(?:=|\s+)(\d+)\b/gi, (_, lead, val) => {
    const mins = Number.parseInt(val, 10)
    if (mins === 0) hasReminder = false
    else if (mins > 0 && mins <= 1440) {
      hasReminder = true
      reminderOffsetSec = mins * 60
    }
    return lead
  })
  text = text.replace(/(^|\s)--no-?remind\b/gi, (_, lead) => {
    hasReminder = false
    return lead
  })
  text = text.replace(/(^|\s)--call\b/gi, (_, lead) => {
    isScheduleCall = true
    return lead
  })
  text = text.replace(/(^|\s)--pin\b/gi, (_, lead) => {
    shouldPin = true
    return lead
  })
  text = text.replace(/(^|\s)--noguests\b/gi, (_, lead) => {
    extraGuestsAllowed = false
    return lead
  })

  const parts = text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    locationName,
    description,
    joinLink,
    isScheduleCall,
    hasReminder,
    reminderOffsetSec,
    durHours,
    shouldPin,
    extraGuestsAllowed,
    parts
  }
}

export default {
  name: 'event',
  aliases: ['acara', 'waevent', 'jadwal'],
  tags: 'group',
  cooldown: 4000,
  description: 'Buat kartu Event resmi WhatsApp lengkap tombol RSVP Hadir/Tidak & Reminder',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (!raw || /^help$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '📅 *WHATSAPP EVENT MAKER*\n\n' +
          '*Format:*\n' +
          `• *${p}event Judul Acara | Waktu | Deskripsi (opsional) | Lokasi (opsional)*\n\n` +
          '*Contoh:*\n' +
          `• *${p}event Mabar MLBB | besok 20:00 | Push rank bareng | Discord*\n` +
          `• *${p}event Nonton Bareng | 2 jam | Episode baru | --pin --remind 15*\n` +
          `• *${p}event Rapat Tim | 2026-12-01 19:30 | --call --link https://call.whatsapp.com/...*\n\n` +
          '*Flag:* `--pin`, `--call`, `--dur <jam>`, `--remind <menit>`, `--loc <tempat>`, `--link <url>`',
        sendOpts
      )
    }

    const opts = parseEventArgs(raw)
    if (opts.parts.length < 2) {
      return ctx.client.message.send(
        ctx.chat,
        `❌ Format minimal: *${p}event Judul Acara | Waktu*\nContoh: *${p}event Mabar | besok 20:00*`,
        sendOpts
      )
    }

    const name = opts.parts[0].slice(0, 100)
    const timeExpr = opts.parts[1]
    const descText = (opts.description || opts.parts[2] || '').slice(0, 2000)
    const locName = (opts.locationName || opts.parts[3] || '').slice(0, 150)

    let startMs
    try {
      startMs = parseReminderTime(timeExpr)
    } catch (e) {
      return ctx.client.message.send(ctx.chat, `❌ ${e.message}`, sendOpts)
    }

    const startTime = Math.floor(startMs / 1000)
    const endTime = Math.floor((startMs + opts.durHours * 3600_000) / 1000)

    await ctx.react('⏳')
    try {
      const eventPayload = {
        type: 'event',
        name,
        startTime,
        endTime,
        extraGuestsAllowed: opts.extraGuestsAllowed,
        ...(descText ? { description: descText } : {}),
        ...(locName ? { location: { latitude: 0, longitude: 0, name: locName } } : {}),
        ...(opts.joinLink ? { joinLink: opts.joinLink } : {}),
        ...(opts.isScheduleCall ? { isScheduleCall: true } : {}),
        ...(opts.hasReminder
          ? { hasReminder: true, reminderOffsetSec: opts.reminderOffsetSec }
          : { hasReminder: false })
      }

      const res = await ctx.client.message.send(ctx.chat, eventPayload, sendOpts)

      let pinNote = ''
      if (opts.shouldPin && res?.id) {
        const canPin = !ctx.isGroup || (await isGroupAdmin(ctx))
        if (canPin) {
          try {
            await ctx.client.message.send(ctx.chat, {
              type: 'pin',
              target: { remoteJid: ctx.chat, id: res.id, fromMe: true },
              durationSecs: 604_800
            })
            pinNote = '\n📌 _Kartu event otomatis di-pin selama 7 hari._'
          } catch {
            pinNote = '\n⚠️ _Event terkirim, tapi gagal auto-pin._'
          }
        }
      }

      await ctx.react('✅')
      if (pinNote) {
        await ctx.client.message.send(
          ctx.chat,
          `✅ Event *${name}* dijadwalkan untuk *${formatWibDateTime(startMs)}*.${pinNote}`,
          sendOpts
        )
      }
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal membuat event: ${String(err?.message || err).slice(0, 220)}`,
        sendOpts
      )
    }
  }
}
