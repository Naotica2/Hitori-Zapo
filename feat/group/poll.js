/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * poll.js — Polling WhatsApp modern (termasuk mode V6 Anonim & Open Add Option)
 */
import config from '../../config.js'
import { getEvent } from '../../lib/media.js'

function parsePollArgs(raw) {
  let text = String(raw || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let hideParticipantName = false
  let allowAddOption = false
  let multi = false
  let maxSelect = null

  text = text.replace(/(^|\s)--anon(?:ymous|im)?\b/gi, (_, lead) => {
    hideParticipantName = true
    return lead
  })
  text = text.replace(/(^|\s)--(?:add|open)\b/gi, (_, lead) => {
    allowAddOption = true
    return lead
  })
  text = text.replace(/(^|\s)--multi\b/gi, (_, lead) => {
    multi = true
    return lead
  })
  text = text.replace(/(^|\s)--max(?:=|\s+)(\d+)\b/gi, (_, lead, n) => {
    const val = Number.parseInt(n, 10)
    if (Number.isFinite(val) && val >= 0) maxSelect = val
    return lead
  })

  const parts = text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)

  return { hideParticipantName, allowAddOption, multi, maxSelect, parts }
}

export default {
  name: 'poll',
  aliases: ['polling', 'vote'],
  tags: 'group',
  cooldown: 4000,
  description: 'Buat polling WhatsApp (dukung mode anonim & tambah opsi bebas)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (!raw || /^help$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '📊 *POLLING WHATSAPP (V6)*\n\n' +
          '*Format:*\n' +
          `• *${p}poll Pertanyaan | Opsi 1 | Opsi 2 | Opsi 3*\n\n` +
          '*Opsi Tambahan:*\n' +
          '• `--anon` → sembunyikan nama pemilih (anonymous)\n' +
          '• `--open` → peserta boleh menambah pilihan sendiri\n' +
          '• `--multi` → boleh pilih lebih dari 1 opsi\n' +
          '• `--max N` → batas maksimal pilihan per orang\n\n' +
          '*Contoh:*\n' +
          `• *${p}poll --anon --open Makan siang apa? | Bakso | Mie Ayam | Nasi Padang*`,
        sendOpts
      )
    }

    const { hideParticipantName, allowAddOption, multi, maxSelect, parts } = parsePollArgs(raw)
    if (parts.length < 3) {
      return ctx.client.message.send(
        ctx.chat,
        `❌ Minimal 1 pertanyaan dan 2 opsi dipisah \`|\`.\nContoh: *${p}poll Mabar jam berapa? | 20:00 | 21:00*`,
        sendOpts
      )
    }

    const name = parts[0].slice(0, 255)
    const options = [...new Set(parts.slice(1).map((o) => o.slice(0, 100)))].slice(0, 12)
    if (options.length < 2) {
      return ctx.client.message.send(ctx.chat, '❌ Minimal butuh 2 opsi unik untuk polling.', sendOpts)
    }

    let selectableCount = 1
    if (maxSelect !== null) {
      selectableCount = maxSelect === 0 ? 0 : Math.min(maxSelect, options.length)
    } else if (multi) {
      selectableCount = options.length
    }

    await ctx.react('⏳')
    try {
      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'poll',
          name,
          options,
          selectableCount,
          ...(allowAddOption ? { allowAddOption: true } : {}),
          ...(hideParticipantName ? { hideParticipantName: true } : {})
        },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(
        ctx.chat,
        `❌ Gagal membuat polling: ${String(err?.message || err).slice(0, 220)}`,
        sendOpts
      )
    }
  }
}
