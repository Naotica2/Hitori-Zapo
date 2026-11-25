/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ai.js — Hitori AI assistant
 * Mendukung chat, vision gate, pembaca file repo (owner), live web/search, dan rich response.
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../../config.js'
import { LANGS, parseMarkdown, tokenize } from '../../lib/highlight.js'
import { tryDownloadImageBuffer, resolveTargetMedia } from '../../lib/media.js'
import { sendSubRich, subCode, subTable, subText } from '../../lib/aiRich.js'

const MAX_CODE = 12000
const MAX_TEXT = 3500
const MAX_CTX = 5000
const MEM = (globalThis.HITORI_AI_MEM ??= new Map())
const MEM_CAP = 8

const isCodeRequest = (q) => /\b(kode|code|html|css|javascript|js|script|game)\b/i.test(q)

async function loadAiConfig() {
  try {
    const mod = await import('../../config/ai/orca.js')
    return {
      orca: mod.orca,
      persona: mod.HITORI_PERSONA || `Kamu adalah ${config.botName} AI assistant yang ramah dan membantu.`,
      ORCA_CONFIG: mod.ORCA_CONFIG || {},
      jina: mod.jina
    }
  } catch {
    return null
  }
}

function codeSubmessage(code, lang) {
  let src = code
  let truncated = false
  if (src.length > MAX_CODE) {
    src = src.slice(0, MAX_CODE)
    truncated = true
  }
  const blocks = tokenize(src)
  if (truncated) blocks.push({ highlightType: 5, codeContent: '\n// … (terpotong)' })
  return {
    messageType: 5,
    codeMetadata: { codeLanguage: LANGS[lang] || lang || 'javascript', codeBlocks: blocks }
  }
}

function fileSummaryTable(file) {
  return {
    messageType: 4,
    tableMetadata: {
      title: 'Ringkasan File',
      rows: [
        { items: ['Properti', 'Nilai'], isHeading: true },
        { items: ['Nama', file.name], isHeading: false },
        { items: ['Path', file.safe], isHeading: false },
        { items: ['Bahasa', LANGS[file.ext] || file.ext], isHeading: false },
        { items: ['Ukuran', (file.code.length / 1024).toFixed(1) + ' KB'], isHeading: false },
        { items: ['Baris', String(file.code.split('\n').length)], isHeading: false }
      ]
    }
  }
}

function formatSearch(text) {
  const items = []
  const re = /\[(\d+)\] Title:\s*(.+)\n\[\1\] URL Source:\s*(.+)(?:\n\[\1\] Description:\s*(.+))?/g
  let m
  while ((m = re.exec(text))) {
    items.push({
      n: m[1],
      title: m[2].trim(),
      url: m[3].trim(),
      desc: (m[4] || '').trim()
    })
  }
  if (!items.length) return null

  return items
    .slice(0, 6)
    .map((it) => `*${it.n}. ${it.title}*\n${it.url}${it.desc ? `\n${it.desc}` : ''}`)
    .join('\n\n')
    .trim()
}

function chunkText(t, n) {
  const parts = []
  for (let i = 0; i < t.length; i += n) parts.push(t.slice(i, i + n))
  return parts
}

const SKIP_DIR = new Set(['node_modules', '.git', 'session', 'tmp', 'dist', 'coverage'])

function walk(dir, out = [], depth = 0) {
  if (depth > 5) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name) || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else out.push(p)
  }
  return out
}

function detectFile(query) {
  const m =
    query.match(/([\w@.-]+(?:\/[\w@.-]+)+\.(?:js|mjs|cjs|json|html?|py|md|sh|ya?ml|ts))/i) ||
    query.match(/([\w@.-]+\.(?:js|mjs|cjs|json|html?|py|md|sh|ya?ml|ts))/i)
  if (!m) return null

  const cwd = process.cwd()
  const want = path.normalize(m[1])
  const wantBase = path.basename(want).toLowerCase()

  const candidates = [path.resolve(cwd, want)]
  for (const f of walk(cwd)) {
    const rel = path.relative(cwd, f)
    if (rel.endsWith(want) || path.basename(f).toLowerCase() === wantBase) {
      candidates.push(f)
    }
  }

  for (const c of candidates) {
    if (c !== cwd && c.startsWith(cwd + path.sep)) {
      try {
        if (!fs.statSync(c).isFile()) continue
        const raw = fs.readFileSync(c)
        if (raw.includes(0)) continue
        return {
          safe: path.relative(cwd, c),
          name: path.basename(c),
          code: raw.toString('utf8'),
          ext: (path.extname(c).slice(1) || 'txt').toLowerCase()
        }
      } catch {}
    }
  }
  return null
}

async function extractImage(ctx) {
  const { rawMessage, quoted } = resolveTargetMedia(ctx)
  for (const msg of [rawMessage, quoted]) {
    if (!msg?.imageMessage) continue
    const buf = await tryDownloadImageBuffer(msg)
    if (buf?.length && buf.length <= 6 * 1024 * 1024) {
      const mime = (msg.imageMessage.mimetype || 'image/jpeg').split(';')[0]
      return `data:${mime};base64,${buf.toString('base64')}`
    }
  }
  return null
}

function extractUrl(query) {
  let url = null

  const withScheme = query.match(/https?:\/\/\S+/i)
  if (withScheme) {
    url = withScheme[0]
  } else {
    const bare = query.match(
      /(?:^|\s)((?:www\.)?(?:[\w-]+\.)+(?:com|net|org|id|io|ai|co|dev|me|info|xyz|us|my|sg|to|app|gg|tv|cc)(?:\/\S*)?)(?=\s|$)/i
    )
    if (bare) url = 'https://' + bare[1]
  }

  if (url) url = url.replace(/[?!.,;:)'"\]]+$/g, '')
  return url
}

async function readPage(url, jina) {
  if (jina?.read) {
    const viaJina = await jina.read(url, MAX_CTX)
    if (viaJina) return viaJina
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HitoriMD/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') || ''
    const raw = await res.text()
    if (!type.includes('html')) return raw.slice(0, MAX_CTX)

    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return text.slice(0, MAX_CTX)
  } catch {
    return null
  }
}

function realTimeContext() {
  const now = new Date()
  const hari = now.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' })
  const tgl = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
  const jam = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
  return (
    `\n\nKONTEKS WAKTU REAL-TIME: Hari ini ${hari}, ${tgl}, jam ${jam} (zona Asia/Jakarta). ` +
    `Pakai ini kalau ditanya soal waktu, tanggal, atau kabar terbaru.`
  )
}

const footer = () => `\n> _*Powered by ${config.botName}*_`

export default {
  name: 'ai',
  aliases: ['hitori', 'ask', 'tanya'],
  tags: 'ai',
  description: 'Ngobrol sama Hitori AI',

  async run(ctx) {
    const query = (ctx.text || '').trim()

    if (/^(reset|mulai( ulang)?|lupakan)/i.test(query)) {
      MEM.delete(ctx.sender)
      return ctx.reply(`🧠 Sesi ${config.botName} AI di-reset. Mulai obrolan baru yuk!`)
    }

    const image = await extractImage(ctx)

    if (!query && !image) {
      return ctx.reply(
        `🤖 *${config.botName.toUpperCase()} AI*\n\n` +
        'Mau ngobrol apa, Kak?\n\n' +
        '*Contoh:*\n' +
        '• `.ai siapa kamu?`\n' +
        '• `.ai ambil file math.js`\n' +
        '• `.ai rangkum https://...`\n' +
        '• `.ai cari berita terbaru hari ini`\n' +
        '• `.ai buatkan kode HTML game sederhana`\n' +
        '• Reply foto + `.ai ini foto apa?`\n' +
        '• `.ai reset` (mulai sesi baru)'
      )
    }

    const aiCfg = await loadAiConfig()
    if (!aiCfg?.orca) {
      return ctx.reply(
        '⚠️ Provider AI belum dikonfigurasi.\n' +
        'Tambahkan file `config/ai/orca.js` terlebih dahulu untuk mengaktifkan fitur `.ai`.'
      )
    }

    const { orca, persona, ORCA_CONFIG, jina } = aiCfg
    await ctx.react('🤖')

    let pageRaw = null
    let searchRaw = null

    try {
      const file = query && ctx.isOwner ? detectFile(query) : null

      if (file && /\b(ambil(kan|in)?|kirim(kan)?|lihat|tunjuk(in)?|show|display|kasih)\b/i.test(query)) {
        await sendSubRich(ctx, [
          subText(
            `🤖 *${config.botName.toUpperCase()} AI* — _File Protocol_\n` +
            `✅ File \`${file.name}\` sudah diambil lengkap!\n\n📄 *Isi File:*`
          ),
          codeSubmessage(file.code, file.ext),
          fileSummaryTable(file),
          subText(footer())
        ])

        await ctx.react('📎')
        return
      }

      if (image && !ORCA_CONFIG.visionModel) {
        return ctx.reply(
          '👁️ Model vision belum dikonfigurasi pada `config/ai/orca.js`.\n' +
          'Format kirim gambar sudah benar, tinggal aktifkan `ORCA_CONFIG.visionModel`.'
        )
      }

      const toolContext = []

      if (file) {
        toolContext.push(`FILE INTERNAL BOT: ${file.safe}\n"""\n${file.code.slice(0, MAX_CTX)}\n"""`)
      }

      const url = query ? extractUrl(query) : null
      if (url) {
        pageRaw = await readPage(url, jina)
        if (pageRaw) {
          toolContext.push(`KONTEN URL ${url}:\n${pageRaw}`)
        } else {
          toolContext.push(
            `CATATAN: konten URL ${url} gagal diambil (diblokir situs/rate-limit). ` +
            'Jangan hallucinate; bilang jujur kalau gak bisa baca isinya dan minta user paste bagian pentingnya.'
          )
        }
      } else if (query && /\b(cari(in)?|search|googling|google)\b/i.test(query) && jina?.search) {
        const q = query.replace(/\b(cari(in)?|search|googling|google)\b\s*/i, '').trim() || query
        searchRaw = await jina.search(q, MAX_CTX)
        if (searchRaw) {
          toolContext.push(`HASIL SEARCH WEB LIVE:\n${searchRaw}`)
        } else {
          toolContext.push(
            'CATATAN: pencarian web live gak tersedia saat ini, mungkin limit jadi coba kembali nanti. ' +
            'Jangan hallucinate; kalau gak yakin, bilang jujur dan minta user kasih link.'
          )
        }
      }

      const messages = [{ role: 'system', content: persona + realTimeContext() }]
      const hist = MEM.get(ctx.sender) || []
      messages.push(...hist)

      if (toolContext.length) {
        messages.push({
          role: 'system',
          content: 'KONTEKS LIVE (hasil tools, pakai sebagai rujukan):\n\n' + toolContext.join('\n\n')
        })
      }

      let userContent
      if (image && query) userContent = orca.visionMessage(image, query)
      else if (image) userContent = orca.visionMessage(image, 'Deskripsiin gambar ini detail dalam bahasa Indonesia.')
      else userContent = { role: 'user', content: query }
      messages.push(userContent)

      const codeMode = Boolean(query && !image && isCodeRequest(query))
      let result = await orca.chat(messages, {
        model: image ? ORCA_CONFIG.visionModel : undefined,
        enable_reasoning: !codeMode,
        max_tokens: codeMode ? 4000 : 2000
      })

      if (!result.text || !result.text.trim()) {
        result = await orca.chat(messages, { enable_reasoning: false, max_tokens: 4000 })
      }

      if (!result.text || !result.text.trim()) {
        await ctx.react('❎')
        return ctx.reply('⚠️ Provider AI mengembalikan respons kosong. Coba ulang sekali lagi ya, Kak 🙏')
      }

      const newHist = MEM.get(ctx.sender) || []
      newHist.push({ role: 'user', content: query || '[user mengirim gambar]' })
      newHist.push({ role: 'assistant', content: (result.text || '').slice(0, 1200) })
      while (newHist.length > MEM_CAP) newHist.shift()
      MEM.set(ctx.sender, newHist)

      const submessages = [
        subText(
          `🤖 *${config.botName.toUpperCase()} AI* — _${image ? 'Vision Mode' : 'Chat Mode'}_` +
          (file ? '\n📎 File Protocol aktif' : '') +
          (toolContext.length && !file ? '\n🌐 Live context aktif' : '')
        )
      ]

      let contentCount = 0
      for (const part of parseMarkdown(result.text)) {
        if (part.type === 'text') {
          for (const c of chunkText(part.text.trim(), MAX_TEXT).slice(0, 6)) {
            submessages.push(subText(c))
            contentCount++
          }
        } else if (part.type === 'code') {
          submessages.push(subCode(part.code, part.lang))
          contentCount++
        } else if (part.type === 'table') {
          submessages.push(subTable(part.rows))
          contentCount++
        }
      }

      if (contentCount === 0) {
        for (const c of chunkText(result.text.trim(), MAX_TEXT).slice(0, 6)) {
          submessages.push(subText(c))
        }
      }

      if (file) {
        submessages.push(subText(`📄 *Isi File:* \`${file.name}\``))
        submessages.push(codeSubmessage(file.code, file.ext))
        submessages.push(fileSummaryTable(file))
      }

      submessages.push(subText(footer()))

      await sendSubRich(ctx, submessages)
      await ctx.react('✨')
    } catch (e) {
      const msg = String(e.message || e)

      if (msg.includes('PROVIDER_BUSY')) {
        try {
          if (searchRaw) {
            const fmt = formatSearch(searchRaw)
            if (fmt) {
              await sendSubRich(ctx, [
                subText(`🔎 *${config.botName.toUpperCase()} AI* — _Mode Darurat_\nProvider AI sedang sibuk, berikut hasil pencarian langsung:\n\n${fmt}`),
                subText(footer())
              ])
              await ctx.react('🔎')
              return
            }
          }

          if (pageRaw) {
            const subs = [
              subText(`🌐 *${config.botName.toUpperCase()} AI* — _Mode Darurat_\nProvider AI sedang sibuk, berikut konten halaman langsung:`)
            ]
            for (const c of chunkText(pageRaw, MAX_TEXT).slice(0, 3)) subs.push(subText(c))
            subs.push(subText(footer()))
            await sendSubRich(ctx, subs)
            await ctx.react('🌐')
            return
          }
        } catch {}

        await ctx.react('❎')
        return ctx.reply('⚠️ Provider AI sedang padat. Coba ulang beberapa detik lagi ya, Kak. 🙏')
      }

      await ctx.react('❎')
      ctx.reply('*Maaf Error:* ' + msg.slice(0, 300))
    }
  }
}
