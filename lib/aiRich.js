/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * aiRich.js — Engine Rich Response AI untuk Zapo.
 */
import crypto from 'node:crypto'
import { generateVerificationMetadata } from './richHtml.js'
import { tokenize, LANGS, LANG_EXT } from './highlight.js'

export const VIEW_CODE_LIMIT = 5000
export const PREVIEW_CODE_LIMIT = 3000
export const SPLIT_CHUNK_LIMIT = 4000

const CODE_MIMETYPES = {
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  js: 'text/plain',
  mjs: 'text/plain',
  cjs: 'text/plain',
  ts: 'text/plain',
  py: 'text/plain',
  md: 'text/plain',
  sh: 'text/plain',
  css: 'text/plain',
  yml: 'text/plain',
  yaml: 'text/plain',
  txt: 'text/plain'
}

export function guessCodeMime(extOrLang = '') {
  const clean = String(extOrLang || '').trim().toLowerCase().replace(/^\./, '')
  const mappedExt = LANG_EXT[clean] || clean
  return CODE_MIMETYPES[mappedExt] || 'application/octet-stream'
}

export function resolveCodeExt(extOrLang = '') {
  const clean = String(extOrLang || '').trim().toLowerCase().replace(/^\./, '')
  return LANG_EXT[clean] || clean || 'txt'
}

function sliceOnNewline(text, limit) {
  if (text.length <= limit) return text
  const cut = text.lastIndexOf('\n', limit)
  return cut > limit * 0.5 ? text.slice(0, cut) : text.slice(0, limit)
}

export function splitCodeChunks(code, chunkLimit = SPLIT_CHUNK_LIMIT) {
  const src = String(code || '')
  if (src.length <= chunkLimit) return [src]

  const chunks = []
  let pos = 0
  while (pos < src.length) {
    if (src.length - pos <= chunkLimit) {
      chunks.push(src.slice(pos))
      break
    }
    const windowStr = src.slice(pos, pos + chunkLimit)
    const nl = windowStr.lastIndexOf('\n')
    const step = nl > chunkLimit * 0.4 ? nl + 1 : chunkLimit
    chunks.push(src.slice(pos, pos + step))
    pos += step
  }
  return chunks
}

export function buildPreviewCodeSub(code, lang = 'javascript', { previewLimit = PREVIEW_CODE_LIMIT, footerNote = '' } = {}) {
  const src = String(code || '')
  const truncated = src.length > previewLimit
  const snippet = truncated ? sliceOnNewline(src, previewLimit) : src
  const blocks = tokenize(snippet)
  if (truncated) {
    const note = footerNote || `\n// … (preview ${snippet.length}/${src.length} karakter — file utuh terlampir)`
    blocks.push({ highlightType: 5, codeContent: note })
  }
  return {
    messageType: 5,
    codeMetadata: {
      codeLanguage: LANGS[lang] || lang || 'javascript',
      codeBlocks: blocks
    }
  }
}

export async function sendCodeDocument(ctx, { code, fileName, extOrLang, caption }) {
  const ext = resolveCodeExt(extOrLang)
  const finalName = fileName || `hitori-code.${ext}`
  return ctx.client.message.send(
    ctx.chat,
    {
      type: 'document',
      media: Buffer.from(String(code || ''), 'utf8'),
      mimetype: guessCodeMime(ext),
      fileName: finalName,
      caption
    },
    ctx.event ? { quote: ctx.event } : {}
  )
}

export function extractDeliveryMode(text = '') {
  let clean = String(text || '')
  let mode = 'auto'
  if (/\B--(file|doc)\b/i.test(clean)) {
    mode = 'file'
    clean = clean.replace(/\B--(file|doc)\b/gi, '')
  } else if (/\B--split\b/i.test(clean)) {
    mode = 'split'
    clean = clean.replace(/\B--split\b/gi, '')
  }
  const wantRichHtml = /\B--rich(html)?\b|\b(richhtml|playhtml|jalankan di wa|main langsung di wa|kartu html)\b/i.test(clean)
  clean = clean.replace(/\B--rich(html)?\b/gi, '').replace(/\s+/g, ' ').trim()
  return { cleanText: clean, mode, wantRichHtml }
}

/**
 * Smart Hybrid code delivery:
 * - auto: View Code penuh bila <= 5000 char; jika lebih, kirim 1 preview View Code + file dokumen utuh.
 * - file: kirim file dokumen utuh langsung.
 * - split: pecah View Code per ~4000 char (maks 5 bagian; jika masih lebih panjang, lampirkan juga file utuh).
 */
export async function deliverSmartCode(
  ctx,
  { code, fileName, ext, summaryRows, headerText, footerText, mode = 'auto' }
) {
  const src = String(code || '')
  const totalLen = src.length
  const totalLines = src.split('\n').length
  const docCaption =
    `📄 *${fileName}*\n` +
    `• Baris: ${totalLines} | Ukuran: ${(totalLen / 1024).toFixed(1)} KB\n` +
    `✅ Versi lengkap 100% tanpa terpotong.`

  if (mode === 'file') {
    await sendCodeDocument(ctx, { code: src, fileName, extOrLang: ext, caption: docCaption })
    return { deliveredAs: 'document' }
  }

  if (mode === 'split' && totalLen > VIEW_CODE_LIMIT) {
    const allChunks = splitCodeChunks(src, SPLIT_CHUNK_LIMIT)
    const maxInlineParts = 5
    const chunks = allChunks.slice(0, maxInlineParts)
    const hasRemainder = allChunks.length > maxInlineParts

    for (let i = 0; i < chunks.length; i++) {
      const subs = []
      if (i === 0 && headerText) subs.push(subText(headerText))
      subs.push(subText(`📄 *${fileName}* — _Part ${i + 1}/${chunks.length}${hasRemainder ? '+' : ''}_`))
      subs.push(subCode(chunks[i], ext))
      if (i === chunks.length - 1) {
        if (summaryRows) subs.push(subTable(summaryRows, 'Ringkasan File'))
        if (footerText) subs.push(subText(footerText))
      }
      await sendSubRich(ctx, subs)
    }

    if (hasRemainder) {
      await sendCodeDocument(ctx, {
        code: src,
        fileName,
        extOrLang: ext,
        caption: `${docCaption}\n_(File terlalu besar untuk ${allChunks.length} bagian View Code, versi utuh dilampirkan.)_`
      })
    }
    return { deliveredAs: hasRemainder ? 'split+document' : 'split', parts: chunks.length }
  }

  if (totalLen <= VIEW_CODE_LIMIT) {
    const subs = []
    if (headerText) subs.push(subText(headerText))
    subs.push(subCode(src, ext))
    if (summaryRows) subs.push(subTable(summaryRows, 'Ringkasan File'))
    if (footerText) subs.push(subText(footerText))
    await sendSubRich(ctx, subs)
    return { deliveredAs: 'view_code' }
  }

  const previewSub = buildPreviewCodeSub(src, ext, {
    previewLimit: PREVIEW_CODE_LIMIT
  })
  const subs = []
  if (headerText) subs.push(subText(headerText))
  subs.push(previewSub)
  if (summaryRows) subs.push(subTable(summaryRows, 'Ringkasan File'))
  if (footerText) subs.push(subText(footerText))
  await sendSubRich(ctx, subs)
  await sendCodeDocument(ctx, { code: src, fileName, extOrLang: ext, caption: docCaption })
  return { deliveredAs: 'preview+document' }
}

const SUB_BOT_JID = '867051314767696@bot'
const UNI_BOT_JID = '236911050403982@bot'

function buildGroupNodes() {
  return [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' }, content: [] }]
        }
      ]
    }
  ]
}

function sendOptions(ctx) {
  const opts = { additionalAttributes: { type: 'text' } }
  if (`${ctx.chat || ''}`.endsWith('@g.us')) {
    opts.customNodes = buildGroupNodes()
  }
  return opts
}

export function subText(text) {
  return { messageType: 2, messageText: text }
}

export function subCode(code, lang = 'javascript') {
  return {
    messageType: 5,
    codeMetadata: {
      codeLanguage: LANGS[lang] || lang || 'javascript',
      codeBlocks: tokenize(code)
    }
  }
}

export function subTable(rows, title) {
  return {
    messageType: 4,
    tableMetadata: {
      ...(title ? { title } : {}),
      rows: rows.map((r, i) => ({ items: r, isHeading: i === 0 }))
    }
  }
}

export function subLatex(text, expressions) {
  return {
    messageType: 8,
    latexMetadata: { text, expressions }
  }
}

export function buildSubContent(submessages, botJid = SUB_BOT_JID) {
  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid },
            forwardOrigin: 4
          }
        }
      }
    }
  }
}

export async function sendSubRich(ctx, submessages) {
  return ctx.client.message.send(ctx.chat, buildSubContent(submessages), sendOptions(ctx))
}

export async function editReplace(ctx, id, content) {
  return ctx.client.message.send(
    ctx.chat,
    {
      botForwardedMessage: {
        message: {
          protocolMessage: {
            key: { remoteJid: ctx.chat, fromMe: true, id },
            type: 14,
            editedMessage: content
          }
        }
      }
    },
    sendOptions(ctx)
  )
}

export function thinkingPrimitive(title = 'Sedang berpikir...') {
  return {
    __typename: 'GenAIBotProgressStatusPrimitive',
    title,
    is_in_progress: true
  }
}

export function textPrimitive(text, inlineEntities) {
  return {
    __typename: 'GenAIMarkdownTextUXPrimitive',
    text,
    ...(inlineEntities?.length ? { inline_entities: inlineEntities } : {})
  }
}

export function hyperlinkEntity(key, displayName, url) {
  return {
    key,
    metadata: {
      display_name: displayName,
      is_trusted: true,
      url,
      __typename: 'GenAIInlineLinkItem'
    }
  }
}

export function single(primitive) {
  return { view_model: { primitive, __typename: 'GenAISingleLayoutViewModel' } }
}

export function vStack(primitives) {
  return { view_model: { primitives, __typename: 'GenAIVStackLayoutViewModel' } }
}

export function buildAIContent(sections) {
  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: '',
        verificationMetadata: generateVerificationMetadata(),
        botResponseId: crypto.randomUUID()
      }
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          unifiedResponse: {
            data: Buffer.from(
              JSON.stringify({
                __typename: 'GenAIUnifiedResponse',
                response_id: crypto.randomUUID(),
                sections: sections.map((s) => ({
                  __typename: 'GenAIUnifiedResponseSection',
                  ...s
                }))
              })
            ).toString('base64')
          },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: UNI_BOT_JID },
            forwardOrigin: 4
          }
        }
      }
    }
  }
}

export async function sendAIRich(ctx, sections) {
  return ctx.client.message.send(ctx.chat, buildAIContent(sections), sendOptions(ctx))
}

export async function sendThinking(ctx, title = 'Sedang berpikir...') {
  const content = buildAIContent([vStack([thinkingPrimitive(title)])])

  const sent = await ctx.client.message.send(ctx.chat, content, sendOptions(ctx))
  const id = sent?.id || sent?.key?.id || null
  if (!id) return sent

  try {
    await editReplace(ctx, id, content)
  } catch (e) {
    console.log('[AIRich] thinking bypass-edit fail:', String(e?.message || e).slice(0, 120))
  }

  return sent
}
