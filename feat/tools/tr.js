/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tr.js — Terjemahan cepat multi-bahasa (Google Translate GTX + fallback MyMemory)
 */
import config from '../../config.js'
import { extractTextFromMessage, getEvent, getQuotedMessage } from '../../lib/media.js'

const LANG_ALIASES = {
  indo: 'id',
  indonesia: 'id',
  inggris: 'en',
  english: 'en',
  jepang: 'ja',
  jp: 'ja',
  japan: 'ja',
  korea: 'ko',
  kr: 'ko',
  arab: 'ar',
  china: 'zh-CN',
  mandarin: 'zh-CN',
  cn: 'zh-CN',
  jawa: 'jw',
  sunda: 'su',
  spanyol: 'es',
  prancis: 'fr',
  jerman: 'de',
  rusia: 'ru',
  thailand: 'th',
  vietnam: 'vi',
  malay: 'ms',
  melayu: 'ms'
}

const VALID_LANG_RE = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i

function resolveLangCode(token) {
  const clean = String(token || '').trim().toLowerCase()
  if (LANG_ALIASES[clean]) return LANG_ALIASES[clean]
  if (VALID_LANG_RE.test(clean)) {
    if (clean === 'zh' || clean === 'zh-cn') return 'zh-CN'
    if (clean === 'zh-tw') return 'zh-TW'
    return clean
  }
  return null
}

async function translateGtx(text, tl, sl = 'auto') {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}` +
    `&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12_000)
  })
  if (!res.ok) throw new Error(`GTX HTTP ${res.status}`)
  const data = await res.json()
  const segments = Array.isArray(data?.[0]) ? data[0] : []
  const translated = segments.map((s) => (Array.isArray(s) ? s[0] || '' : '')).join('')
  if (!translated) throw new Error('Hasil terjemahan kosong.')
  return {
    text: translated,
    detectedSource: typeof data?.[2] === 'string' ? data[2] : sl,
    targetLang: tl
  }
}

async function translateMyMemory(text, tl, sl = 'en') {
  const src = sl === 'auto' ? (tl === 'id' ? 'en' : 'id') : sl
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(`${src}|${tl}`)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`)
  const data = await res.json()
  const out = data?.responseData?.translatedText
  if (!out) throw new Error('Terjemahan gagal.')
  return { text: out, detectedSource: src, targetLang: tl }
}

export default {
  name: 'tr',
  aliases: ['translate', 'terjemah', 'terjemahkan'],
  tags: 'tools',
  cooldown: 3000,
  description: 'Terjemahkan teks atau pesan yang di-reply ke berbagai bahasa',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    const quotedText = extractTextFromMessage(getQuotedMessage(ctx)).trim()

    if (/^(list|lang|bahasa|help|\?)$/i.test(raw) || (!raw && !quotedText)) {
      return ctx.client.message.send(
        ctx.chat,
        '🌐 *TRANSLATOR MULTI-BAHASA*\n\n' +
          '*Contoh:*\n' +
          `• *${p}tr id Good morning everyone*\n` +
          `• *${p}tr en Selamat pagi dunia*\n` +
          `• *${p}tr ja Aku lapar*\n` +
          `• Reply pesan teks orang lain dengan *${p}tr id*\n\n` +
          '*Kode Populer:* `id` (Indonesia), `en` (Inggris), `ja` (Jepang), `ko` (Korea), `ar` (Arab), `zh-CN` (Mandarin), `jw` (Jawa), `su` (Sunda), `ms`, `fr`, `de`, `es`',
        sendOpts
      )
    }

    const firstToken = String(ctx.args[0] || '')
    const parsedLang = resolveLangCode(firstToken)

    let targetLang = 'id'
    let sourceText = ''

    if (parsedLang && (ctx.args.length > 1 || quotedText)) {
      targetLang = parsedLang
      sourceText = raw.slice(firstToken.length).trim() || quotedText
    } else if (!parsedLang && quotedText && !raw) {
      targetLang = 'id'
      sourceText = quotedText
    } else if (parsedLang && !raw.slice(firstToken.length).trim() && !quotedText) {
      return ctx.client.message.send(ctx.chat, `❌ Masukkan teks atau reply pesan yang ingin diterjemahkan ke *${parsedLang}*.`, sendOpts)
    } else {
      targetLang = 'id'
      sourceText = raw || quotedText
    }

    if (!sourceText) {
      return ctx.client.message.send(ctx.chat, '❌ Teks sumber kosong.', sendOpts)
    }

    await ctx.react('⏳')
    try {
      let result
      try {
        result = await translateGtx(sourceText.slice(0, 3500), targetLang, 'auto')
      } catch {
        result = await translateMyMemory(sourceText.slice(0, 500), targetLang)
      }

      await ctx.client.message.send(
        ctx.chat,
        `🌐 *TERJEMAHAN (${String(result.detectedSource).toUpperCase()} → ${result.targetLang.toUpperCase()})*\n\n${result.text}`,
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ Gagal menerjemahkan: ${String(err?.message || err).slice(0, 200)}`, sendOpts)
    }
  }
}
