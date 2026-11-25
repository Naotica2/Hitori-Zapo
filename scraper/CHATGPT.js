/**
 * ChatGPT Android Backend Client (Unofficial — com.openai.chatgpt v1.2026.307)
 * Mendukung chat teks (guest & login), vision upload, file attachment, webSearch,
 * deepResearch, generate/edit gambar, serta timeout & non-blocking PoW.
 */
import crypto from 'node:crypto'

export const BASE = 'https://android.chat.openai.com'
export const ANON = '/backend-anon'
export const AUTHED = '/backend-api'

const UA = 'ChatGPT/1.2026.307 (Android 14; sdk 34)'
const DEVICE = '00000000-0000-4000-8000-000000000000'
const VERSION = '1.2026.307'

const DEFAULT_SENTINEL_TIMEOUT_MS = 8_000
const DEFAULT_CHAT_TIMEOUT_MS = 25_000
const DEFAULT_UPLOAD_TIMEOUT_MS = 15_000
const MAX_POW_ITERATIONS = 2_000_000

const uuid = () => crypto.randomUUID()

function makeHttpError(message, status) {
  const err = new Error(message)
  err.status = status
  err.isAuthError = status === 401
  err.isBusy = status === 429 || status === 503 || status === 403
  return err
}

function withTimeoutSignal(timeoutMs, parentSignal) {
  const own = AbortSignal.timeout(timeoutMs)
  return parentSignal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([own, parentSignal])
    : own
}

async function solveProofOfWork(spec) {
  const cfg = spec.proofofwork?.config || spec
  const difficulty =
    typeof cfg.difficulty === 'object' ? Number(cfg.difficulty.value) : Number(cfg.difficulty)
  const line = cfg.required?.line ?? String(cfg.required ?? '')
  const prefix = '0'.repeat(Math.max(0, difficulty || 0))
  const target = cfg.required?.prefix ? `${line}${cfg.required.prefix}` : line

  for (let nonce = 0; nonce < MAX_POW_ITERATIONS; nonce++) {
    const hex = crypto.createHash('sha256').update(`${target}${nonce}`).digest('hex')
    if (hex.startsWith(prefix)) return { line, nonce }
    // Yield periodik agar CPU PoW tidak membekukan event loop bot WhatsApp
    if ((nonce & 4095) === 4095) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
  throw new Error('proof-of-work: batas iterasi tercapai')
}

function resolveAuth(opts = {}) {
  const token = (opts.accessToken ?? opts.token ?? process.env.CHATGPT_TOKEN ?? '').trim()
  const accountId = (opts.accountId ?? process.env.CHATGPT_ACCOUNT_ID ?? '').trim()
  return {
    token: token || undefined,
    accountId: accountId || undefined,
    prefix: token ? AUTHED : ANON
  }
}

function baseHeaders(opts, extra = {}) {
  const { token, accountId } = resolveAuth(opts)
  const h = {
    'user-agent': opts.userAgent ?? UA,
    'oai-device-id': opts.deviceId ?? DEVICE,
    'oai-client-version': opts.clientVersion ?? VERSION,
    ...extra
  }
  if (token) h.authorization = `Bearer ${token}`
  if (accountId) h['chatgpt-account-id'] = accountId
  return h
}

export async function chatRequirements(opts = {}) {
  const { prefix } = resolveAuth(opts)
  const timeoutMs = opts.sentinelTimeoutMs ?? DEFAULT_SENTINEL_TIMEOUT_MS
  const headers = baseHeaders(opts, {
    'content-type': 'application/json',
    'openai-sentinel-chat-requirements-token': 'undefined'
  })

  const res = await fetch(`${BASE}${prefix}/sentinel/chat-requirements`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: withTimeoutSignal(timeoutMs, opts.signal)
  })
  if (!res.ok) {
    throw makeHttpError(`chat-requirements HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status)
  }

  const data = await res.json()
  if (!data.proofofwork) return data

  const answer = await solveProofOfWork(data)
  const res2 = await fetch(`${BASE}${prefix}/sentinel/chat-requirements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ proofofwork: answer }),
    signal: withTimeoutSignal(timeoutMs, opts.signal)
  })
  if (!res2.ok) {
    throw makeHttpError(`chat-requirements(pow) HTTP ${res2.status}: ${(await res2.text()).slice(0, 200)}`, res2.status)
  }
  return res2.json()
}

function requireToken(opts) {
  const { token } = resolveAuth(opts)
  if (!token) throw new Error('fitur ini butuh accessToken (login) — guest ditolak server')
  return token
}

function detectImageDims(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  return { width: 1024, height: 1024 }
}

export async function uploadFile(data, opts = {}) {
  requireToken(opts)
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const name = opts.name ?? 'file.png'
  const mimeType = opts.mimeType ?? 'image/png'
  const { prefix } = resolveAuth(opts)
  const uploadTimeoutMs = opts.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS
  const sup = await chatRequirements(opts)

  const created = await fetch(`${BASE}${prefix}/files`, {
    method: 'POST',
    headers: baseHeaders(opts, {
      'content-type': 'application/json',
      'openai-sentinel-chat-requirements-token': sup.token
    }),
    body: JSON.stringify({
      file_name: name,
      file_size: buf.length,
      use_case: opts.useCase ?? 'multimodal'
    }),
    signal: withTimeoutSignal(uploadTimeoutMs, opts.signal)
  })
  if (!created.ok) {
    throw makeHttpError(`files HTTP ${created.status}: ${(await created.text()).slice(0, 200)}`, created.status)
  }
  const meta = await created.json()

  const put = await fetch(meta.upload_url, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'content-type': mimeType },
    body: buf,
    signal: withTimeoutSignal(uploadTimeoutMs, opts.signal)
  })
  if (!put.ok) {
    throw makeHttpError(`upload PUT HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`, put.status)
  }

  const fin = await fetch(`${BASE}${prefix}/files/${meta.file_id}/uploaded`, {
    method: 'POST',
    headers: baseHeaders(opts, {
      'content-type': 'application/json',
      'openai-sentinel-chat-requirements-token': sup.token
    }),
    body: '{}',
    signal: withTimeoutSignal(uploadTimeoutMs, opts.signal)
  })
  if (!fin.ok) {
    throw makeHttpError(
      `files/${meta.file_id}/uploaded HTTP ${fin.status}: ${(await fin.text()).slice(0, 200)}`,
      fin.status
    )
  }

  const done = await fin.json()
  const dims = detectImageDims(buf)
  return {
    fileId: meta.file_id,
    downloadUrl: done.download_url ?? null,
    name,
    mimeType,
    size: buf.length,
    width: opts.width ?? dims.width,
    height: opts.height ?? dims.height
  }
}

export async function getFile(fileId, opts = {}) {
  const { prefix } = resolveAuth(opts)
  const cleanId = String(fileId).replace(/^(sediment|file-service):\/\//, '')
  const res = await fetch(`${BASE}${prefix}/files/download/${cleanId}`, {
    headers: baseHeaders(opts),
    signal: withTimeoutSignal(opts.timeoutMs ?? 12_000, opts.signal)
  })
  if (!res.ok) {
    throw makeHttpError(`files/download HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status)
  }
  return res.json()
}

export async function downloadFile(fileId, opts = {}) {
  const info = await getFile(fileId, opts)
  const res = await fetch(info.download_url, {
    headers: baseHeaders(opts),
    signal: withTimeoutSignal(opts.timeoutMs ?? 30_000, opts.signal)
  })
  if (!res.ok) throw makeHttpError(`download HTTP ${res.status}`, res.status)
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    fileName: info.file_name ?? null,
    url: info.download_url
  }
}

function buildUserMessage(input, images, attachments) {
  const norm = (a) => (typeof a === 'string' ? { fileId: a } : a)
  const msg = { id: uuid(), author: { role: 'user' }, metadata: {} }
  const files = (attachments ?? []).map(norm)

  if (!images?.length && files.length) {
    msg.content = { content_type: 'text', parts: [String(input)] }
    msg.metadata.attachments = files.map((a) => ({
      id: a.fileId,
      name: a.name ?? 'file',
      mime_type: a.mimeType ?? 'application/octet-stream',
      size: a.size ?? null,
      status: 'uploaded'
    }))
    return msg
  }

  if (!images?.length) {
    msg.content = { content_type: 'text', parts: [String(input)] }
    return msg
  }

  const parts = images.map((img) => {
    const p = { content_type: 'image_asset_pointer', asset_pointer: `file-service://${img.fileId}` }
    if (img.size != null) p.size_bytes = img.size
    if (img.width != null) p.width = img.width
    if (img.height != null) p.height = img.height
    return p
  })
  if (input) parts.push(String(input))

  msg.content = { content_type: 'multimodal_text', parts }
  msg.metadata.attachments = images.map((img) => ({
    id: img.fileId,
    name: img.name ?? 'file.png',
    mime_type: img.mimeType ?? 'image/png',
    size: img.size ?? null
  }))
  return msg
}

function buildBody(input, images, opts) {
  const body = {
    action: 'next',
    conversation_id: opts.conversationId ?? null,
    parent_message_id: opts.parentMessageId ?? uuid(),
    messages: [buildUserMessage(input, images, opts.attachments)],
    model: opts.model ?? 'auto',
    timezone_offset_min: opts.timezoneOffsetMin ?? 420,
    history_and_training_disabled: opts.historyAndTrainingDisabled ?? false,
    user_message_timestamp: Math.round(Date.now() / 1000)
  }

  if (opts.imageHints) {
    body.conversation_mode = opts.conversationMode ?? { kind: 'primary_assistant' }
    body.system_hints = ['picture_v2']
  } else if (opts.conversationMode) {
    body.conversation_mode = opts.conversationMode
  }

  const tools = []
  if (opts.webSearch || opts.search) tools.push({ type: 'web_search' })
  if (opts.deepResearch) {
    tools.push({ type: 'connector', connector_id: 'connector_openai_deep_research' })
  }
  for (const tool of opts.tools ?? []) tools.push(tool)
  if (tools.length) body.tools = tools

  return body
}

async function* readSseEvents(res) {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const dataLine = event.split('\n').find((l) => l.startsWith('data:'))
      if (dataLine) yield dataLine.slice(5).trim()
    }
  }
  buf += decoder.decode().replace(/\r\n/g, '\n')
  if (buf.trim()) {
    const dataLine = buf.split('\n').find((l) => l.startsWith('data:'))
    if (dataLine) yield dataLine.slice(5).trim()
  }
}

function assetOf(part) {
  if (!part || typeof part === 'string') return null
  const ptr = part.asset_pointer
  if (!ptr || part.content_type !== 'image_asset_pointer') return null
  return {
    fileId: ptr.replace(/^(sediment|file-service):\/\//, ''),
    pointer: ptr,
    mimeType: part.mime_type ?? 'image/png',
    width: part.width ?? null,
    height: part.height ?? null,
    size: part.size_bytes ?? null
  }
}

async function consumeStream(res) {
  const texts = new Map()
  const order = []
  const images = []
  const seen = new Set()
  const sources = []
  const srcSeen = new Set()
  let conversationId = null
  let lastId = null
  let done = false

  for await (const line of readSseEvents(res)) {
    if (line === '[DONE]') break
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.conversation_id) conversationId = ev.conversation_id
    const msg = ev.message
    if (!msg) continue
    const role = msg.author?.role
    if (msg.id) lastId = msg.id

    if (role === 'assistant' && Array.isArray(msg.content?.parts)) {
      const parts = msg.content.parts.filter((p) => typeof p === 'string')
      if (msg.id) {
        if (!texts.has(msg.id)) order.push(msg.id)
        texts.set(msg.id, parts)
      }
    }

    if (role === 'tool') {
      for (const u of msg.metadata?.safe_urls ?? []) {
        if (!srcSeen.has(u)) {
          srcSeen.add(u)
          sources.push(u)
        }
      }
      for (const m of JSON.stringify(msg).matchAll(/"url":"([^"]+)"/g)) {
        if (!srcSeen.has(m[1])) {
          srcSeen.add(m[1])
          sources.push(m[1])
        }
      }
    }

    for (const ref of msg.metadata?.content_references ?? []) {
      if (ref?.url && !srcSeen.has(ref.url)) {
        srcSeen.add(ref.url)
        sources.push(ref.url)
      }
    }
    for (const c of msg.metadata?.citations ?? []) {
      if (c?.url && !srcSeen.has(c.url)) {
        srcSeen.add(c.url)
        sources.push(c.url)
      }
    }

    if (Array.isArray(msg.content?.parts)) {
      for (const part of msg.content.parts) {
        const asset = assetOf(part)
        if (asset && !seen.has(asset.fileId)) {
          seen.add(asset.fileId)
          images.push(asset)
        }
      }
    }

    if (msg.status === 'finished_successfully' || msg.status === 'finished' || msg.end_turn) {
      done = true
    }
    if (msg.status === 'rate_limited' || ev.error) {
      const errMsg = JSON.stringify(ev.error ?? ev)
      const err = new Error(errMsg)
      err.isBusy = msg.status === 'rate_limited' || /rate.?limit/i.test(errMsg)
      throw err
    }
  }

  const text = order.map((id) => texts.get(id).join('')).join('')
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    if (!srcSeen.has(m[0])) {
      srcSeen.add(m[0])
      sources.push(m[0])
    }
  }
  return { text, images, sources, conversationId, parentMessageId: lastId, done }
}

async function postConversation(input, images, opts) {
  const { prefix, token } = resolveAuth(opts)
  const sup = await chatRequirements(opts)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS
  const signal = withTimeoutSignal(timeoutMs, opts.signal)
  const headers = baseHeaders(opts, {
    'content-type': 'application/json',
    'openai-sentinel-chat-requirements-token': sup.token,
    accept: 'text/event-stream'
  })

  const send = (sig) =>
    fetch(`${BASE}${prefix}/f/conversation`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(input, images, opts)),
      signal: sig
    })

  let res = await send(signal)
  if ((res.status === 401 || res.status === 403) && !token) {
    const fresh = await chatRequirements(opts)
    headers['openai-sentinel-chat-requirements-token'] = fresh.token
    res = await send(withTimeoutSignal(timeoutMs, opts.signal))
  }
  if (!res.ok) {
    throw makeHttpError(
      `conversation HTTP ${res.status}: ${(await res.text()).slice(0, 220)}`,
      res.status
    )
  }
  return consumeStream(res)
}

export async function converse(input, opts = {}) {
  return postConversation(input, opts.images, opts)
}

export function getPlan(opts = {}) {
  const token = (opts.accessToken ?? opts.token ?? process.env.CHATGPT_TOKEN ?? '').trim()
  if (!token) {
    return {
      guest: true,
      plan: null,
      planType: null,
      accountId: null,
      email: null,
      expiresAt: null,
      valid: false
    }
  }
  const part = token.split('.')[1]
  if (!part) return { guest: false, valid: false, error: 'token bukan JWT' }

  const pad = part.length % 4 ? '='.repeat(4 - (part.length % 4)) : ''
  let claims
  try {
    claims = JSON.parse(Buffer.from(part + pad, 'base64url').toString('utf8'))
  } catch {
    return { guest: false, valid: false, error: 'token bukan JWT' }
  }

  const authClaims = claims['https://api.openai.com/auth'] ?? {}
  const profile = claims['https://api.openai.com/profile'] ?? {}
  const exp = claims.exp ? claims.exp * 1000 : null
  return {
    guest: false,
    valid: !exp || exp > Date.now(),
    plan: authClaims.chatgpt_plan_type ?? null,
    planType: authClaims.chatgpt_plan_type ?? null,
    accountId: authClaims.chatgpt_account_id ?? null,
    userId: authClaims.chatgpt_user_id ?? claims.user?.id ?? null,
    email: profile.email ?? null,
    name: profile.name ?? null,
    expiresAt: exp,
    exp: claims.exp ?? null
  }
}

export async function webSearch(query, opts = {}) {
  requireToken(opts)
  return postConversation(query, opts.images, { ...opts, search: true })
}

export async function deepResearch(query, opts = {}) {
  requireToken(opts)
  return postConversation(query, opts.images, { ...opts, deepResearch: true })
}

export async function generateImage(prompt, opts = {}) {
  requireToken(opts)
  const out = await postConversation(prompt, opts.images, { ...opts, imageHints: true })
  return { ...out, prompt }
}

export async function editImage(image, prompt, opts = {}) {
  requireToken(opts)
  let img = image
  if (image && !image.fileId) {
    const buf = Buffer.isBuffer(image) ? image : image.data ?? image.buffer
    const name = image.name ?? 'image.png'
    const uploaded = await uploadFile(buf, {
      ...opts,
      name,
      mimeType: image.mimeType ?? 'image/png',
      width: image.width,
      height: image.height
    })
    img = {
      fileId: uploaded.fileId,
      name,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      width: uploaded.width,
      height: uploaded.height
    }
  }
  const out = await postConversation(prompt, [img], { ...opts, imageHints: true })
  return { ...out, prompt }
}

export default {
  chatRequirements,
  converse,
  generateImage,
  editImage,
  uploadFile,
  downloadFile,
  getFile,
  getPlan,
  webSearch,
  deepResearch,
  BASE,
  ANON,
  AUTHED
}
