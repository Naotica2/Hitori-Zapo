/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ai.js — Hitori AI assistant (Smart Hybrid code/HTML delivery + file protocol)
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../../config.js'
import { LANGS, parseMarkdown } from '../../lib/highlight.js'
import { tryDownloadImageBuffer, resolveTargetMedia } from '../../lib/media.js'
import {
  VIEW_CODE_LIMIT,
  SPLIT_CHUNK_LIMIT,
  buildPreviewCodeSub,
  deliverSmartCode,
  extractDeliveryMode,
  resolveCodeExt,
  sendCodeDocument,
  sendSubRich,
  splitCodeChunks,
  subCode,
  subTable,
  subText
} from '../../lib/aiRich.js'
import { sendRichHtml } from '../../lib/richHtml.js'

const MAX_TEXT = 3500
const MAX_CTX = 5000
const MEM = (globalThis.HITORI_AI_MEM ??= new Map())
const MEM_CAP = 8

const isCodeRequest = (q) =>
  /\b(kode|code|html|css|javascript|js|script|game|snake|tetris|flappy|web|program|bot|plugin)\b/i.test(q)

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

function buildFileSummaryRows(file) {
  return [
    ['Properti', 'Nilai'],
    ['Nama', file.name],
    ['Path', file.safe],
    ['Bahasa', LANGS[file.ext] || file.ext],
    ['Ukuran', `${(file.code.length / 1024).toFixed(1)} KB`],
    ['Baris', String(file.code.split('\n').length)]
  ]
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
    'Pakai ini kalau ditanya soal waktu, tanggal, atau kabar terbaru.'
  )
}

function extractPartsWithHtmlFallback(rawText) {
  const parts = parseMarkdown(rawText)
  if (parts.some((p) => p.type === 'code')) return parts

  const rawHtmlMatch =
    rawText.match(/(<!doctype\s+html[\s\S]*<\/html>|<html[\s\S]*<\/html>)/i) ||
    rawText.match(/(<!doctype\s+html[\s\S]{200,}|<html[\s\S]{200,})/i)

  if (!rawHtmlMatch) return parts

  const idx = rawHtmlMatch.index ?? 0
  const htmlCode = rawHtmlMatch[1].trim()
  const before = rawText.slice(0, idx).trim()
  const after = rawText.slice(idx + rawHtmlMatch[0].length).trim()

  const merged = []
  if (before) merged.push({ type: 'text', text: before })
  merged.push({ type: 'code', lang: 'html', code: htmlCode })
  if (after) merged.push({ type: 'text', text: after })
  return merged
}

function isFullHtmlDocument(lang, code) {
  const ext = resolveCodeExt(lang)
  if (ext !== 'html') return false
  return /<!doctype\s+html|<html|<canvas|<script/i.test(code) || code.length > 800
}

function deriveCodeFileName(code, lang, query, index) {
  const ext = resolveCodeExt(lang)
  const titleMatch = ext === 'html' ? code.match(/<title>([^<]{1,40})<\/title>/i)?.[1] : ''
  const rawSlug = (titleMatch || query || 'hitori-code')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const base = rawSlug || 'hitori-code'
  return `${base}${index > 0 ? `-${index + 1}` : ''}.${ext}`
}

const footer = () => `\n> _*Powered by ${config.botName}*_`

export default {
  name: 'ai',
  aliases: ['hitori', 'ask', 'tanya'],
  tags: 'ai',
  description: 'Ngobrol sama Hitori AI',

  async run(ctx) {
    const { cleanText: query, mode: deliveryMode, wantRichHtml } = extractDeliveryMode(ctx.text || '')

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
          '• `.ai buatkan game html snake` _(auto file `.html` jika panjang)_\n' +
          '• `.ai --rich buatkan game html sederhana` _(coba kartu interaktif WA)_\n' +
          '• Reply foto + `.ai ini foto apa?`\n' +
          '• `.ai reset` _(mulai sesi baru)_'
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
        await deliverSmartCode(ctx, {
          code: file.code,
          fileName: file.name,
          ext: file.ext,
          mode: deliveryMode,
          headerText:
            `🤖 *${config.botName.toUpperCase()} AI* — _File Protocol_\n` +
            `✅ File \`${file.name}\` siap!\n\n📄 *Isi File:*`,
          summaryRows: buildFileSummaryRows(file),
          footerText: footer()
        })

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

      const codeMode = Boolean(query && !image && (isCodeRequest(query) || wantRichHtml))
      let result = await orca.chat(messages, {
        model: image ? ORCA_CONFIG.visionModel : undefined,
        enable_reasoning: !codeMode,
        max_tokens: codeMode ? 8192 : 2000,
        autoContinue: codeMode,
        maxContinuations: 1
      })

      if (!result.text || !result.text.trim()) {
        result = await orca.chat(messages, { enable_reasoning: false, max_tokens: 4096 })
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

      const parsedParts = extractPartsWithHtmlFallback(result.text)
      const pendingDocs = []
      const splitBatches = []
      const htmlCandidates = []
      let contentCount = 0

      for (const part of parsedParts) {
        if (part.type === 'text') {
          for (const c of chunkText(part.text.trim(), MAX_TEXT).slice(0, 6)) {
            submessages.push(subText(c))
            contentCount++
          }
        } else if (part.type === 'table') {
          submessages.push(subTable(part.rows))
          contentCount++
        } else if (part.type === 'code') {
          const isHtmlDoc = isFullHtmlDocument(part.lang, part.code)
          if (isHtmlDoc) htmlCandidates.push(part.code)

          const shouldAttachDoc =
            deliveryMode === 'file' || part.code.length > VIEW_CODE_LIMIT || isHtmlDoc
          const fileName = deriveCodeFileName(part.code, part.lang, query, pendingDocs.length)

          if (deliveryMode === 'split' && part.code.length > VIEW_CODE_LIMIT) {
            const chunks = splitCodeChunks(part.code, SPLIT_CHUNK_LIMIT).slice(0, 5)
            chunks.forEach((chunk, idx) => {
              splitBatches.push([
                subText(`📄 *${fileName}* — _Part ${idx + 1}/${chunks.length}_`),
                subCode(chunk, part.lang || 'txt')
              ])
            })
            if (part.code.length > SPLIT_CHUNK_LIMIT * 5) {
              pendingDocs.push({ code: part.code, lang: part.lang, fileName })
            }
          } else if (shouldAttachDoc) {
            pendingDocs.push({ code: part.code, lang: part.lang, fileName })
            if (deliveryMode !== 'file') {
              submessages.push(
                buildPreviewCodeSub(part.code, part.lang || 'txt')
              )
            }
          } else {
            submessages.push(subCode(part.code, part.lang || 'txt'))
          }
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
        if (file.code.length > VIEW_CODE_LIMIT) {
          submessages.push(buildPreviewCodeSub(file.code, file.ext))
          pendingDocs.push({ code: file.code, lang: file.ext, fileName: file.name })
        } else {
          submessages.push(subCode(file.code, file.ext))
        }
        submessages.push(subTable(buildFileSummaryRows(file), 'Ringkasan File'))
      }

      if (pendingDocs.length > 0 && result.finishReason === 'length') {
        submessages.push(subText('⚠️ _Catatan: Output kode sangat panjang; sebagian akhir mungkin terhenti di batas token provider._'))
      }

      submessages.push(subText(footer()))

      if (!(deliveryMode === 'file' && submessages.length <= 2 && pendingDocs.length > 0)) {
        await sendSubRich(ctx, submessages)
      }

      for (const batch of splitBatches) {
        await sendSubRich(ctx, batch)
      }

      for (const doc of pendingDocs) {
        const lines = doc.code.split('\n').length
        const kb = (doc.code.length / 1024).toFixed(1)
        await sendCodeDocument(ctx, {
          code: doc.code,
          fileName: doc.fileName,
          extOrLang: doc.lang,
          caption: `📦 *${doc.fileName}*\n• ${lines} baris | ${kb} KB\n✅ File utuh tanpa terpotong.`
        })
      }

      if (wantRichHtml && htmlCandidates.length > 0) {
        const htmlPayload = htmlCandidates.sort((a, b) => b.length - a.length)[0]
        try {
          await sendRichHtml(ctx, htmlPayload)
        } catch (richErr) {
          console.warn('[AI] sendRichHtml gagal (file .html tetap terkirim):', richErr.message)
        }
      }

      await ctx.react('✨')
    } catch (e) {
      const msg = String(e.message || e)

      if (msg.includes('PROVIDER_BUSY')) {
        try {
          if (searchRaw) {
            const fmt = formatSearch(searchRaw)
            if (fmt) {
              await sendSubRich(ctx, [
                subText(
                  `🔎 *${config.botName.toUpperCase()} AI* — _Mode Darurat_\nProvider AI sedang sibuk, berikut hasil pencarian langsung:\n\n${fmt}`
                ),
                subText(footer())
              ])
              await ctx.react('🔎')
              return
            }
          }

          if (pageRaw) {
            const subs = [
              subText(
                `🌐 *${config.botName.toUpperCase()} AI* — _Mode Darurat_\nProvider AI sedang sibuk, berikut konten halaman langsung:`
              )
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
