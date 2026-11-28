/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * kurs.js — Cek & konversi nilai tukar mata uang asing realtime (ExchangeRate + Frankfurter)
 */
import config from '../../config.js'
import { getEvent } from '../../lib/media.js'

const POPULAR_CURRENCIES = ['USD', 'IDR', 'MYR', 'SGD', 'JPY', 'EUR', 'GBP', 'AUD', 'SAR', 'KRW', 'CNY']

async function fetchRates(base = 'USD') {
  const cleanBase = String(base || 'USD').toUpperCase()
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(cleanBase)}`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (res.ok) {
      const json = await res.json()
      if (json?.result === 'success' && json?.rates) {
        return { base: json.base_code || cleanBase, date: json.time_last_update_utc || 'Realtime', rates: json.rates, source: 'ExchangeRate-API' }
      }
    }
  } catch {}

  const res2 = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(cleanBase)}`, {
    signal: AbortSignal.timeout(10_000)
  })
  if (!res2.ok) throw new Error(`Kode mata uang "${cleanBase}" tidak ditemukan.`)
  const j2 = await res2.json()
  return { base: j2.base || cleanBase, date: j2.date || '-', rates: j2.rates || {}, source: 'Frankfurter (ECB)' }
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '-'
  return n >= 100
    ? n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
    : n.toLocaleString('id-ID', { maximumFractionDigits: 4 })
}

export default {
  name: 'kurs',
  aliases: ['currency', 'valas', 'forex', 'rate'],
  tags: 'tools',
  cooldown: 3000,
  description: 'Cek kurs mata uang asing & konversi valas realtime',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (/^(help|\?)$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '💱 *KURS & KONVERSI MATA UANG*\n\n' +
          '*Contoh:*\n' +
          `• *${p}kurs* — ringkasan kurs mata uang populer terhadap IDR\n` +
          `• *${p}kurs 100 usd idr* — konversi 100 USD ke IDR\n` +
          `• *${p}kurs 5000 jpy* — konversi 5000 JPY ke IDR\n` +
          `• *${p}kurs myr idr* — cek 1 MYR dalam IDR`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      if (!raw) {
        const data = await fetchRates('IDR')
        const lines = POPULAR_CURRENCIES.filter((c) => c !== 'IDR' && data.rates[c]).map((c) => {
          const perUnit = 1 / data.rates[c]
          return `• 1 *${c}* = Rp *${fmtMoney(perUnit)}*`
        })
        await ctx.client.message.send(
          ctx.chat,
          `💱 *KURS POPULER → IDR*\n\n${lines.join('\n')}\n\n_Update: ${data.date} • ${data.source}_\n_Ketik *${p}kurs 100 usd idr* untuk hitung cepat._`,
          sendOpts
        )
        await ctx.react('✅')
        return
      }

      const tokens = raw
        .replace(/\b(ke|to|in)\b/gi, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)

      let amount = 1
      let from = 'USD'
      let to = 'IDR'

      if (/^\d+(?:[.,]\d+)?$/.test(tokens[0])) {
        amount = Number.parseFloat(tokens[0].replace(',', '.'))
        from = (tokens[1] || 'USD').toUpperCase()
        to = (tokens[2] || (from === 'IDR' ? 'USD' : 'IDR')).toUpperCase()
      } else {
        from = (tokens[0] || 'USD').toUpperCase()
        to = (tokens[1] || (from === 'IDR' ? 'USD' : 'IDR')).toUpperCase()
      }

      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Nominal harus lebih besar dari 0.')

      const data = await fetchRates(from)
      const rate = to === from ? 1 : data.rates[to]
      if (!rate) throw new Error(`Mata uang tujuan "${to}" tidak dikenali.`)

      const converted = amount * rate
      await ctx.client.message.send(
        ctx.chat,
        '💱 *KONVERSI KURS*\n\n' +
          `• *${fmtMoney(amount)} ${from}* = *${fmtMoney(converted)} ${to}*\n` +
          `• Rate 1 ${from} = ${fmtMoney(rate)} ${to}\n` +
          `• Sumber : ${data.source} (${data.date})`,
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
