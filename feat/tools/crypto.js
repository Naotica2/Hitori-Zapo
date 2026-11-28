/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * crypto.js — Cek harga & perubahan 24 jam cryptocurrency realtime (CoinGecko)
 */
import config from '../../config.js'
import { getEvent } from '../../lib/media.js'

const COIN_SHORTCUTS = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  bnb: 'binancecoin',
  ton: 'the-open-network',
  xrp: 'ripple',
  doge: 'dogecoin',
  ada: 'cardano',
  sui: 'sui',
  usdt: 'tether',
  pepe: 'pepe',
  shib: 'shiba-inu',
  avax: 'avalanche-2',
  trx: 'tron',
  ltc: 'litecoin',
  dot: 'polkadot',
  link: 'chainlink',
  matic: 'matic-network',
  pol: 'polygon-ecosystem-token'
}

const DEFAULT_COINS = ['bitcoin', 'ethereum', 'solana', 'the-open-network', 'binancecoin', 'dogecoin']

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'HitoriMD/1.0' },
    signal: AbortSignal.timeout(12_000)
  })
  if (res.status === 429) throw new Error('CoinGecko sedang rate-limit, coba lagi sebentar.')
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
  return res.json()
}

function fmtUsd(v) {
  if (!Number.isFinite(v)) return '-'
  return v >= 1 ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${v.toPrecision(4)}`
}

function fmtIdr(v) {
  if (!Number.isFinite(v)) return '-'
  return `Rp ${v.toLocaleString('id-ID', { maximumFractionDigits: v >= 100 ? 0 : 4 })}`
}

function fmtPct(v) {
  if (!Number.isFinite(v)) return ''
  const icon = v >= 0 ? '📈 +' : '📉 '
  return `${icon}${v.toFixed(2)}%`
}

export default {
  name: 'crypto',
  aliases: ['coin', 'koin', 'btc'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Cek harga & pergerakan 24 jam cryptocurrency (IDR & USD)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (/^(help|\?)$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '🪙 *HARGA CRYPTO REALTIME*\n\n' +
          '*Contoh:*\n' +
          `• *${p}crypto* — daftar top coin (BTC, ETH, SOL, TON, BNB, DOGE)\n` +
          `• *${p}crypto btc*\n` +
          `• *${p}crypto 0.5 eth* — hitung nilai 0.5 ETH dalam IDR & USD`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    try {
      const tokens = raw ? raw.split(/\s+/).filter(Boolean) : []
      let amount = 1
      let query = tokens.join(' ')

      if (tokens.length >= 2 && /^\d+(?:[.,]\d+)?$/.test(tokens[0])) {
        amount = Number.parseFloat(tokens[0].replace(',', '.'))
        query = tokens.slice(1).join(' ')
      }

      if (!query && ctx.command === 'btc') query = 'btc'

      if (!query) {
        const prices = await fetchJson(
          `https://api.coingecko.com/api/v3/simple/price?ids=${DEFAULT_COINS.join(',')}&vs_currencies=usd,idr&include_24hr_change=true`
        )
        const lines = DEFAULT_COINS.filter((id) => prices[id]).map((id) => {
          const item = prices[id]
          const label = id.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
          return `*• ${label}*\n  ${fmtIdr(item.idr)} (${fmtUsd(item.usd)}) • ${fmtPct(item.idr_24h_change)}`
        })
        await ctx.client.message.send(
          ctx.chat,
          `🪙 *PASAR CRYPTO REALTIME*\n\n${lines.join('\n\n')}\n\n_Ketik *${p}crypto <koin>* untuk koin spesifik._\n> Sumber: CoinGecko`,
          sendOpts
        )
        await ctx.react('✅')
        return
      }

      const key = query.toLowerCase().trim()
      let coinId = COIN_SHORTCUTS[key] || null
      let coinName = query.toUpperCase()

      if (!coinId) {
        const search = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(key)}`)
        const hit = search?.coins?.[0]
        if (!hit?.id) throw new Error(`Koin "${query}" tidak ditemukan di CoinGecko.`)
        coinId = hit.id
        coinName = `${hit.name} (${hit.symbol})`
      }

      const prices = await fetchJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd,idr&include_24hr_change=true&include_market_cap=true`
      )
      const info = prices?.[coinId]
      if (!info) throw new Error(`Data harga untuk "${coinId}" tidak tersedia.`)

      const totalIdr = info.idr * amount
      const totalUsd = info.usd * amount

      await ctx.client.message.send(
        ctx.chat,
        [
          '🪙 *CRYPTO CHECKER*',
          '',
          `• Koin   : *${coinName}*`,
          ...(amount !== 1 ? [`• Jumlah : *${amount}*`] : []),
          `• IDR    : *${fmtIdr(totalIdr)}*`,
          `• USD    : *${fmtUsd(totalUsd)}*`,
          `• 24 Jam : ${fmtPct(info.idr_24h_change)}`,
          '> Sumber: CoinGecko'
        ].join('\n'),
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    }
  }
}
