/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ai.js — Hitori AI assistant (Smart Hybrid code/HTML delivery + file protocol)
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../../config.js'
import { LANGS, parseMarkdown } from '../../lib/highlight.js'
import { extractTargetMediaInput, analyzePdf, transcribeAudio } from '../../lib/aiMultimodal.js'
import { runToolAgent } from '../../lib/aiAgent.js'
import {
  assertSafePublicUrl,
  isSensitiveRepoPath,
  redactSecrets,
  safePublicFetch,
  wrapUntrustedContent
} from '../../lib/security.js'
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
      const rel = path.relative(cwd, c)
      if (isSensitiveRepoPath(rel)) continue
      try {
        if (!fs.statSync(c).isFile()) continue
        const raw = fs.readFileSync(c)
        if (raw.includes(0)) continue
        return {
          safe: rel,
          name: path.basename(c),
          code: raw.toString('utf8'),
          ext: (path.extname(c).slice(1) || 'txt').toLowerCase()
        }
      } catch {}
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
  try {
    const safeUrl = await assertSafePublicUrl(url)
    if (jina?.read) {
      const viaJina = await jina.read(safeUrl.toString(), MAX_CTX)
      if (viaJina) return viaJina
    }

    const res = await safePublicFetch(safeUrl.toString(), { timeoutMs: 15_000 })
    if (!res.contentType.includes('html')) return res.text.slice(0, MAX_CTX)

    const text = res.text
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
  } catch (err) {
    return { blockedError: err?.message || 'Gagal membaca URL' }
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

function buildSelfContainedHtml(parsedParts) {
  const htmlBlocks = []
  const cssBlocks = []
  const jsBlocks = []

  for (const part of parsedParts) {
    if (part.type !== 'code') continue
    const ext = resolveCodeExt(part.lang)
    if (ext === 'html') htmlBlocks.push(part.code)
    else if (ext === 'css') cssBlocks.push(part.code)
    else if (ext === 'js' || ext === 'mjs') jsBlocks.push(part.code)
  }

  if (htmlBlocks.length === 0) return null

  const primary = htmlBlocks.sort((a, b) => b.length - a.length)[0]
  if (cssBlocks.length === 0 && jsBlocks.length === 0 && /<html|<body|<script/i.test(primary)) {
    return primary
  }

  const styleTag = cssBlocks.length ? `<style>\n${cssBlocks.join('\n')}\n</style>` : ''
  const scriptTag = jsBlocks.length ? `<script>\n${jsBlocks.join('\n')}\n</script>` : ''

  if (/<html[\s>]/i.test(primary)) {
    let merged = primary
    if (styleTag) {
      merged = /<\/head>/i.test(merged)
        ? merged.replace(/<\/head>/i, `${styleTag}\n</head>`)
        : `${styleTag}\n${merged}`
    }
    if (scriptTag) {
      merged = /<\/body>/i.test(merged)
        ? merged.replace(/<\/body>/i, `${scriptTag}\n</body>`)
        : `${merged}\n${scriptTag}`
    }
    return merged
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="id">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
    '<title>Hitori Web App</title>',
    styleTag,
    '</head>',
    '<body>',
    primary,
    scriptTag,
    '</body>',
    '</html>'
  ]
    .filter(Boolean)
    .join('\n')
}

const footer = () => `\n> _*Powered by ${config.botName}*_`

export default {
  name: 'ai',
  aliases: ['hitori', 'ask', 'tanya', 'agent'],
  tags: 'ai',
  cooldown: 4000,
  description: 'AI Agent ber-tool & Multimodal (Foto, Voice Note, PDF/Dokumen, Pengingat)',

  async run(ctx) {
    const { cleanText: query, mode: deliveryMode, wantRichHtml } = extractDeliveryMode(ctx.text || '')

    if (/^(reset|mulai( ulang)?|lupakan)/i.test(query)) {
      MEM.delete(ctx.sender)
      return ctx.reply(`🧠 Sesi ${config.botName} AI di-reset. Mulai obrolan baru yuk!`)
    }

    let media = null
    try {
      media = await extractTargetMediaInput(ctx)
    } catch (mediaErr) {
      return ctx.reply('⚠️ ' + String(mediaErr?.message || mediaErr))
    }

    if (!query && !media) {
      return ctx.reply(
        `🤖 *${config.botName.toUpperCase()} AI AGENT*\n\n` +
          'Mau ngobrol apa, Kak?\n\n' +
          '*Fitur Chat & Tool Agent:*\n' +
          '• `.ai siapa kamu?`\n' +
          '• `.ai ingatkan aku 15m lagi matikan kompor`\n' +
          '• `.ai cari berita teknologi hari ini`\n' +
          '• `.ai rangkum https://...` _(anti-SSRF)_\n' +
          '• `.ai buatkan game html snake` _(auto file `.html` jika panjang)_\n\n' +
          '*Multimodal (Reply / Kirim Media):*\n' +
          '• Reply *Foto* + `.ai jelaskan gambar ini`\n' +
          '• Reply *Voice Note / Audio* + `.ai rangkum poin pentingnya`\n' +
          '• Reply *PDF / Dokumen Teks* + `.ai ringkas & terjemahkan`\n' +
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
      const file = query && ctx.isOwner && !media ? detectFile(query) : null

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

      if (media?.kind === 'image' && !ORCA_CONFIG.visionModel) {
        return ctx.reply(
          '👁️ Model vision belum dikonfigurasi pada `config/ai/orca.js`.\n' +
            'Format kirim gambar sudah benar, tinggal aktifkan `ORCA_CONFIG.visionModel`.'
        )
      }

      // Jalur khusus PDF multimodal (Gemini native PDF -> fallback teks PDF lokal)
      if (media?.kind === 'pdf') {
        const pdfRes = await analyzePdf(media.buffer, media.fileName, query, {
          orca,
          cfg: ORCA_CONFIG,
          persona
        })

        const newHist = MEM.get(ctx.sender) || []
        newHist.push({ role: 'user', content: `[PDF: ${media.fileName}] ${query || 'Ringkas PDF ini'}` })
        newHist.push({ role: 'assistant', content: (pdfRes.text || '').slice(0, 1200) })
        while (newHist.length > MEM_CAP) newHist.shift()
        MEM.set(ctx.sender, newHist)

        const pdfSubs = [
          subText(
            `🤖 *${config.botName.toUpperCase()} AI* — _${pdfRes.modeLabel}${pdfRes.provider ? ` • ${pdfRes.provider}` : ''}_\n📄 File: \`${media.fileName}\``
          ),
          ...chunkText(pdfRes.text.trim(), MAX_TEXT).slice(0, 6).map(subText),
          subText(footer())
        ]
        await sendSubRich(ctx, pdfSubs)
        await ctx.react('✨')
        return
      }

      let sttInfo = null
      let audioTranscript = ''
      if (media?.kind === 'audio') {
        const stt = await transcribeAudio(media.buffer, media.mime, ORCA_CONFIG)
        audioTranscript = stt.transcript
        sttInfo = stt.provider
      }

      const toolContext = []

      if (file) {
        toolContext.push(`FILE INTERNAL BOT: ${file.safe}\n"""\n${file.code.slice(0, MAX_CTX)}\n"""`)
      }

      const url = query ? extractUrl(query) : null
      if (url) {
        const pageRes = await readPage(url, jina)
        if (typeof pageRes === 'string' && pageRes) {
          pageRaw = pageRes
          toolContext.push(`KONTEN URL ${url}:\n${wrapUntrustedContent(`url:${url}`, pageRes, MAX_CTX)}`)
        } else {
          const reason = pageRes?.blockedError || 'diblokir situs/rate-limit'
          toolContext.push(
            `CATATAN: konten URL ${url} gagal diambil (${reason}). ` +
              'Jangan mengarang isinya; jelaskan secara jujur ke user.'
          )
        }
      } else if (query && /\b(cari(in)?|search|googling|google)\b/i.test(query) && jina?.search) {
        const q = query.replace(/\b(cari(in)?|search|googling|google)\b\s*/i, '').trim() || query
        searchRaw = await jina.search(q, MAX_CTX)
        if (searchRaw) {
          toolContext.push(`HASIL SEARCH WEB LIVE:\n${wrapUntrustedContent('web_search', searchRaw, MAX_CTX)}`)
        }
      }

      const messages = [{ role: 'system', content: persona + realTimeContext() }]
      const hist = MEM.get(ctx.sender) || []
      messages.push(...hist)

      if (toolContext.length) {
        messages.push({
          role: 'system',
          content: 'KONTEKS LIVE (pakai sebagai rujukan):\n\n' + toolContext.join('\n\n')
        })
      }

      let userContent
      let modeLabel = 'Chat Mode'
      if (media?.kind === 'image') {
        modeLabel = 'Vision Mode'
        userContent = orca.visionMessage(
          media.dataUri,
          query || 'Deskripsiin gambar atau dokumen foto ini dengan detail dan terstruktur dalam bahasa Indonesia.'
        )
      } else if (media?.kind === 'audio') {
        modeLabel = `Voice Note • ${sttInfo}`
        const task =
          query ||
          'Ringkas poin-poin inti dari transkrip voice note berikut secara jelas dalam bahasa Indonesia.'
        userContent = {
          role: 'user',
          content:
            `${task}\n\n` +
            `Transkrip Voice Note (${media.seconds ? `${media.seconds}s` : 'audio'}):\n` +
            wrapUntrustedContent('voice_note', audioTranscript, 6000)
        }
      } else if (media?.kind === 'textdoc') {
        modeLabel = `Dokumen • ${media.fileName}`
        const task =
          query ||
          `Ringkas isi dokumen "${media.fileName}" dan jelaskan poin terpentingnya dalam bahasa Indonesia.`
        userContent = {
          role: 'user',
          content:
            `${task}\n\n` +
            `Isi File (${media.fileName}):\n` +
            wrapUntrustedContent(`file:${media.fileName}`, media.textContent, 8000)
        }
      } else {
        userContent = { role: 'user', content: query }
      }
      messages.push(userContent)

      if (wantRichHtml) {
        messages.push({
          role: 'system',
          content:
            'ATURAN KARTU INTERAKTIF WHATSAPP WEBVIEW: Gabungkan seluruh HTML, CSS (<style>), dan JavaScript (<script>) ' +
            'menjadi SATU blok ```html lengkap dan self-contained (tanpa link/script CDN eksternal). ' +
            'Wajib pakai <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">, ' +
            'tombol sentuh/tap di layar (jangan hanya kontrol keyboard), dan jangan pakai alert(), confirm(), atau prompt().'
        })
      }

      const codeMode = Boolean(query && media?.kind !== 'image' && (isCodeRequest(query) || wantRichHtml))
      const canUseToolAgent =
        !codeMode &&
        !wantRichHtml &&
        !file &&
        media?.kind !== 'image'

      let result = null
      let toolsUsed = []

      if (canUseToolAgent) {
        try {
          result = await runToolAgent({ ctx, messages, orcaCfg: aiCfg, maxTokens: 2000 })
          toolsUsed = result.toolsUsed || []
          if (toolsUsed.length && media?.kind !== 'audio' && media?.kind !== 'textdoc') {
            modeLabel = 'Agent Mode'
          }
        } catch {
          result = null
        }
      }

      if (!result) {
        result = await orca.chat(messages, {
          model: media?.kind === 'image' ? ORCA_CONFIG.visionModel : undefined,
          enable_reasoning: !codeMode,
          max_tokens: codeMode ? 8192 : 2000,
          autoContinue: codeMode,
          maxContinuations: 1
        })
      }

      if (!result.text || !result.text.trim()) {
        result = await orca.chat(messages, { enable_reasoning: false, max_tokens: 4096 })
      }

      if (!result.text || !result.text.trim()) {
        await ctx.react('❎')
        return ctx.reply('⚠️ Provider AI mengembalikan respons kosong. Coba ulang sekali lagi ya, Kak 🙏')
      }

      const safeReplyText = redactSecrets(result.text)
      const newHist = MEM.get(ctx.sender) || []
      const memUserLabel =
        query ||
        (media?.kind === 'audio'
          ? `[VN: ${audioTranscript.slice(0, 120)}]`
          : media?.kind === 'textdoc'
            ? `[Dokumen: ${media.fileName}]`
            : '[user mengirim gambar]')
      newHist.push({ role: 'user', content: memUserLabel })
      newHist.push({ role: 'assistant', content: safeReplyText.slice(0, 1200) })
      while (newHist.length > MEM_CAP) newHist.shift()
      MEM.set(ctx.sender, newHist)

      const submessages = [
        subText(
          `🤖 *${config.botName.toUpperCase()} AI* — _${modeLabel}${result.provider ? ` • ${result.provider}` : ''}_` +
            (file ? '\n📎 File Protocol aktif' : '') +
            (toolsUsed.length ? `\n🛠️ Tools: ${toolsUsed.join(', ')}` : '') +
            (toolContext.length && !file ? '\n🌐 Live context aktif' : '')
        )
      ]

      if (media?.kind === 'audio' && audioTranscript) {
        const preview = audioTranscript.length > 260 ? audioTranscript.slice(0, 260) + '…' : audioTranscript
        submessages.push(subText(`🎙️ *Transkrip:* _"${preview}"_`))
      }

      const parsedParts = extractPartsWithHtmlFallback(safeReplyText)
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

      if (wantRichHtml) {
        const bundledHtml = buildSelfContainedHtml(parsedParts)
        const htmlPayload = bundledHtml || htmlCandidates.sort((a, b) => b.length - a.length)[0]
        if (htmlPayload) {
          try {
            await sendRichHtml(ctx, htmlPayload, { withVerification: false, withEdit: false })
          } catch (richErr) {
            console.warn('[AI] sendRichHtml gagal (file .html tetap terkirim):', richErr.message)
          }
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
      ctx.reply('*Maaf Error:* ' + redactSecrets(msg).slice(0, 300))
    }
  }
}
