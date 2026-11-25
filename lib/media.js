/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * media.js — Helper pesan, quote, dan download/upload media
 */
import { downloadMediaMessage, resolveMediaPayload } from 'zapo-js'
import { logger } from '../core/logger.js'

const MEDIA_FIELDS = [
  'imageMessage',
  'videoMessage',
  'stickerMessage',
  'documentMessage',
  'audioMessage'
]

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function withTimeout(promise, ms = 10_000) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout unduh media ${ms}ms`)), ms)
    )
  ])
}

function findContainer(message) {
  if (!message) return undefined
  if (MEDIA_FIELDS.some((f) => message[f])) return message

  const quoted = getQuotedMessage(message)
  if (quoted && MEDIA_FIELDS.some((f) => quoted[f])) return quoted

  return undefined
}

export function getEvent(ctx) {
  return ctx?.message ?? ctx?.event ?? ctx?.raw ?? ctx?.msg ?? null
}

export function getRawMessage(ctxOrEvent) {
  if (!ctxOrEvent) return null
  const event = ctxOrEvent.message || ctxOrEvent.event || ctxOrEvent.raw || ctxOrEvent.msg
    ? getEvent(ctxOrEvent)
    : ctxOrEvent
  return event?.message ?? event ?? null
}

export function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) {
      return node.contextInfo
    }
  }
  return null
}

export function getQuotedMessage(ctxOrMessage) {
  const raw = ctxOrMessage?.event || ctxOrMessage?.msg || ctxOrMessage?.raw
    ? getRawMessage(ctxOrMessage)
    : (ctxOrMessage?.message ?? ctxOrMessage)
  return getContextInfo(raw)?.quotedMessage ?? null
}

export function extractTextFromMessage(message) {
  if (!message) return ''
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
  )
}

export function extractUrlFromCtx(ctx, regex, { stripTrailing = false } = {}) {
  const clean = (value) => (stripTrailing ? value.replace(/[),.!?]+$/, '') : value)
  const text = String(ctx?.text || '').trim()
  const direct = text.match(regex)
  if (direct) return clean(direct[0])

  const quotedText = extractTextFromMessage(getQuotedMessage(ctx))
  const quotedMatch = quotedText.match(regex)
  return quotedMatch ? clean(quotedMatch[0]) : null
}

export async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export function resolveTargetMedia(ctx, { preferQuoted = true, includeSelf = true } = {}) {
  const event = getEvent(ctx)
  if (!event) {
    return {
      event: null,
      rawMessage: null,
      ctxInfo: null,
      quoted: null,
      targetMessage: null,
      payload: null
    }
  }

  const rawMessage = event.message ?? event
  const ctxInfo = getContextInfo(rawMessage)
  const quoted = ctxInfo?.quotedMessage ?? null
  const targetMessage = preferQuoted
    ? (quoted || (includeSelf ? rawMessage : null))
    : rawMessage
  const payload = targetMessage ? resolveMediaPayload(targetMessage) : null

  return { event, rawMessage, ctxInfo, quoted, targetMessage, payload }
}

export async function downloadTargetBuffer(targetMessage) {
  if (!targetMessage) throw new Error('Pesan target media kosong')
  const stream = await downloadMediaMessage(targetMessage)
  const buffer = await streamToBuffer(stream)
  if (!buffer?.length) throw new Error('Buffer media kosong')
  return buffer
}

export async function tryDownloadImageBuffer(message) {
  if (!message) return null
  try {
    const payload = resolveMediaPayload(message)
    if (!payload?.mimetype || !String(payload.mimetype).startsWith('image/')) return null
    const buffer = await downloadTargetBuffer(message)
    return buffer?.length ? buffer : null
  } catch {
    return null
  }
}

export async function downloadUrlBuffer(
  url,
  { timeout = 60_000, maxBytes = 0, headers = {}, ua = DEFAULT_UA } = {}
) {
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} saat unduh media`)

  const buffer = Buffer.from(await res.arrayBuffer())
  if (!buffer.length) throw new Error('Empty buffer dari URL media')
  if (maxBytes > 0 && buffer.length > maxBytes) {
    throw new Error(`Ukuran file melebihi batas (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)
  }
  return buffer
}

export async function downloadMedia(client, event) {
  const container = findContainer(event?.message)
  if (!container) return undefined

  const field = MEDIA_FIELDS.find((f) => container[f])

  try {
    const bytes = await withTimeout(client.message.downloadBytes(container), 10_000)
    return {
      buffer: Buffer.from(bytes),
      mimetype: container[field]?.mimetype ?? 'application/octet-stream',
      kind: field.replace('Message', '')
    }
  } catch (err) {
    logger.warn({ err: err.message, field }, '📥 Gagal/timeout unduh media')
    return undefined
  }
}
