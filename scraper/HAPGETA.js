/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * HAPGETA.js — HAPGETA AI client (Image Gen, Video Gen, TTS/ASR, Chat/Vision) & persistent account pool
 */

import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SESSION_DIR = path.join(ROOT, 'session')

const AUTH = 'https://agent.hapgetaai.com'
const AI = 'https://aiagent.hapgetaai.com'
const MAIL = 'https://api.mail.tm'
const LITTERBOX_UPLOAD_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'
const DEFAULT_VIDEO_MODEL = 'seedance-1-5-pro-251215'
const DEFAULT_TIMEOUT = 120_000
const CHAT_TIMEOUT = 300_000
const POLL_TIMEOUT = 300_000
const POLL_INTERVAL = 3_000

const CHAT_ENDPOINTS = {
  text: `${AI}/inquire/text`,
  document: `${AI}/inquire/text`,
  vision: `${AI}/inquire/vision`,
  cat: `${AI}/inquire/cat-agent`,
  anything: `${AI}/inquire/ask_anything`,
  coding: `${AI}/inquire/coding`,
  finance: `${AI}/inquire/financial`,
  complexFinance: `${AI}/inquire/ComplexFinance`,
  news: `${AI}/inquire/mn/news`,
  website: `${AI}/inquire/website`,
  career: `${AI}/inquire/career`,
  psychological: `${AI}/inquire/psychiatrist/api`,
  legal: `${AI}/inquire/legal`
}

export const IMAGE_FEATURES = ['comic', 'drawing', 'poster', 'logo', 'portrait', 'editor']

const IMAGE_ENDPOINTS = {
  comic: `${AI}/inquire/text2image/image`,
  drawing: `${AI}/inquire/text2image/image`,
  poster: `${AI}/inquire/img/poster`,
  logo: `${AI}/inquire/img/logo`,
  portrait: `${AI}/inquire/img/portrait`,
  editor: `${AI}/inquire/img/editor`
}

const VIDEO_ENDPOINTS = {
  text: { submit: `${AI}/agent/video/text/generate`, status: `${AI}/agent/video/text/status` },
  one: { submit: `${AI}/agent/video/one/img/generate`, status: `${AI}/agent/video/one/status` },
  two: { submit: `${AI}/agent/video/two/img/generate`, status: `${AI}/agent/video/two/status` }
}

const IGNORED_OTP_WORDS = new Set([
  'HTML', 'HEAD', 'BODY', 'UTF8', 'HTTP', 'RGBA', 'HSLA', 'NONE', 'AUTO',
  'FONT', 'SIZE', 'BOLD', 'LINE', 'TEXT', 'SPAN', 'MAIL', 'CODE', 'TRUE',
  'NULL', 'VOID', 'TEST', 'DEMO', 'USER', 'INFO', 'LINK', 'VIEW', 'LOGO',
  'THIS', 'YOUR', 'WITH', 'FROM', 'THAT', 'HAVE', 'WILL', 'BEEN', 'HERE'
])

let createAccountInFlight = null
const refreshInFlight = new Map()

export class HapgetaError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'HapgetaError'
    Object.assign(this, extra)
  }
}

const fail = (message, extra) => {
  throw new HapgetaError(message, extra)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const timeoutSignal = (ms, signal) => {
  const timeout = AbortSignal.timeout(ms)
  if (!signal) return timeout
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  timeout.addEventListener('abort', () => controller.abort(timeout.reason), { once: true })
  return controller.signal
}

const normalizeSession = (session) => {
  if (!session?.token || !session?.userId) return null
  return {
    token: String(session.token),
    userId: String(session.userId),
    nickname: session.nickname || '',
    email: session.email || '',
    registered: Boolean(session.registered)
  }
}

let currentSession = null

export const setSession = (session) => {
  currentSession = normalizeSession(session)
  return currentSession
}

export const getSession = () => currentSession

const resolveSession = (session) => {
  const value = normalizeSession(session) || currentSession
  if (!value) {
    fail('A Hapgeta session is required: call login() or createAccount() first', { code: 'AUTH_REQUIRED' })
  }
  return value
}

const parseBody = async (response) => {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const describeDetail = (detail) => {
  if (!Array.isArray(detail)) return ''
  return detail.map((item) => `${(item.loc || []).join('.')}: ${item.msg}`).join('; ')
}

const ensureOk = (data, action, status) => {
  if (data && typeof data === 'object' && Array.isArray(data.detail)) {
    fail(describeDetail(data.detail) || `${action} rejected`, { status, payload: data, code: 'VALIDATION' })
  }
  if (data && typeof data === 'object' && data.error_msg) {
    fail(data.error_msg === 'insufficient_balance' ? 'Insufficient balance' : data.error_msg, {
      status,
      payload: data,
      code: data.error_msg
    })
  }
  if (data && typeof data === 'object' && data.code !== undefined && Number(data.code) !== 0) {
    const rawMsg = data.msg || data.message || `${action} failed`
    const isBalance = /insufficient|balance|credit|quota|saldo|余额不足/i.test(String(rawMsg))
    fail(rawMsg, {
      status,
      payload: data,
      code: isBalance ? 'insufficient_balance' : data.code
    })
  }
  return data
}

export function isBalanceError(err) {
  const code = String(err?.code || '').toLowerCase()
  const msg = String(err?.message || '').toLowerCase()
  return (
    code === 'insufficient_balance' ||
    /insufficient_balance|insufficient balance|not enough credit|saldo.*habis|余额不足/.test(msg)
  )
}

export function isAuthError(err) {
  const status = Number(err?.status || 0)
  const msg = String(err?.message || '').toLowerCase()
  return status === 401 || /token.*invalid|token.*expired|unauthorized|auth_required/.test(msg)
}

const requestJson = async (
  url,
  { method = 'GET', body, session, headers = {}, signal, timeout = DEFAULT_TIMEOUT, useAuth = true } = {}
) => {
  const auth = useAuth ? resolveSession(session) : null
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth ? { Token: auth.token, 'X-User-Id': auth.userId } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: timeoutSignal(timeout, signal)
  })
  const data = await parseBody(response)
  if (!response.ok) {
    fail(describeDetail(data?.detail) || data?.msg || data?.message || `HTTP ${response.status}`, {
      status: response.status,
      payload: data,
      code: data?.code
    })
  }
  return data
}

const authHeaders = (session, extra = {}) => ({
  Token: session.token,
  'X-User-Id': session.userId,
  ...extra
})

const extractText = (data) => {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return ''
  return data.text || data.content || data.data || ''
}

const collectSSE = async (response, { onText, onEvent } = {}) => {
  if (!response.ok) {
    const data = await parseBody(response)
    fail(describeDetail(data?.detail) || data?.msg || data?.message || `HTTP ${response.status}`, {
      status: response.status,
      payload: data,
      code: data?.code
    })
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    const data = await parseBody(response)
    fail(data?.msg || data?.message || 'Unexpected JSON response', {
      status: response.status,
      payload: data,
      code: data?.code
    })
  }
  const reader = response.body?.getReader()
  if (!reader) fail('Streaming response is not supported', { code: 'STREAM_UNSUPPORTED' })
  const decoder = new TextDecoder('utf-8')
  const result = {
    text: '',
    conversationId: '',
    messageId: '',
    taskId: '',
    cost: null,
    wallet: null,
    usage: null,
    images: [],
    events: [],
    completed: false
  }
  let buffer = ''
  let stopped = false

  const handle = (payload) => {
    if (!payload || typeof payload !== 'object') return
    result.events.push(payload)
    onEvent?.(payload)
    const event = String(payload.event || 'message')
    const data = payload.data !== undefined ? payload.data : payload
    if (payload.cost !== undefined) result.cost = payload.cost
    if (payload.wallet !== undefined) result.wallet = payload.wallet
    if (event === 'text') {
      const chunk = extractText(data)
      if (chunk) {
        result.text += chunk
        onText?.(chunk)
      }
    } else if (event === 'meta' || event === 'conversation') {
      const meta = data && typeof data === 'object' ? data : {}
      result.conversationId = meta.conversation_id || meta.conversationId || result.conversationId
      result.messageId = meta.message_id || meta.messageId || result.messageId
      result.taskId = meta.task_id || meta.taskId || result.taskId
    } else if (event === 'image_info') {
      const info = data && typeof data === 'object' ? data : { url: data }
      result.images.push(info)
      const urls = info.image_items || info.urls || info.url
      if (Array.isArray(urls)) result.images.push(...urls)
    } else if (event === 'usage_main' || event === 'usage') {
      result.usage = data
    } else if (event === 'cost') {
      result.cost = data
    } else if (event === 'billing') {
      const billing = typeof data === 'object' ? data : payload
      result.cost = billing.cost ?? result.cost
      result.wallet = billing.wallet ?? result.wallet
    } else if (event === 'all_done' || event === 'done') {
      result.completed = true
    } else if (event === 'error') {
      const error = data && typeof data === 'object' ? data : { message: data }
      fail(error.error_msg || error.msg || error.message || 'Stream error', {
        payload: error,
        code: error.error_code || error.code
      })
    }
    if (data && typeof data === 'object' && data.error_msg) {
      fail(
        data.error_msg === 'insufficient_balance'
          ? extractText(data) || 'Insufficient balance'
          : extractText(data) || data.error_msg,
        { payload, code: data.error_msg }
      )
    }
  }

  const drain = (block) => {
    const lines = block.split('\n')
    const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart())
    if (!dataLines.length) return
    const raw = dataLines.join('\n').trim()
    if (!raw || raw === '[DONE]') return
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    handle(payload)
  }

  while (!stopped) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let index = buffer.indexOf('\n\n')
    while (index !== -1) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      drain(block)
      if (result.completed) {
        stopped = true
        await reader.cancel().catch(() => {})
        break
      }
      index = buffer.indexOf('\n\n')
    }
  }
  if (!stopped && buffer.trim()) drain(buffer)
  return result
}

const chatStream = async (
  url,
  body,
  { session, conversationId, headers = {}, onText, onEvent, signal, timeout = CHAT_TIMEOUT } = {}
) => {
  const auth = resolveSession(session)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${url}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'cache-control': 'no-cache',
          ...authHeaders(auth),
          ...(conversationId ? { 'X-Conversation-Id': conversationId } : {}),
          ...headers
        },
        body: JSON.stringify(body),
        signal: timeoutSignal(timeout, signal)
      })
      return await collectSSE(response, { onText, onEvent })
    } catch (error) {
      if (error.code === 'redis_unavailable' && attempt < 3) {
        await sleep(2000 * attempt)
        continue
      }
      throw error
    }
  }
}

export const chat = ({ query, session, conversationId = '', files = [], inputs = {}, language = 'en', onText, onEvent, signal } = {}) =>
  chatStream(
    CHAT_ENDPOINTS.text,
    { query, ui_language: language, streaming: true, files, inputs },
    { session, conversationId, onText, onEvent, signal }
  )

export const chatVision = ({
  query,
  images = [],
  session,
  conversationId = '',
  deepThink = false,
  webSearch = false,
  onText,
  onEvent,
  signal
} = {}) =>
  chatStream(
    CHAT_ENDPOINTS.vision,
    {
      query,
      streaming: true,
      files: images,
      conversationId,
      inputs: { think_status: Boolean(deepThink), search_status: Boolean(webSearch) }
    },
    { session, conversationId, onText, onEvent, signal }
  )

const simpleChat = (type) => ({ query, session, conversationId = '', files = [], onText, onEvent, signal } = {}) =>
  chatStream(CHAT_ENDPOINTS[type], { query, streaming: true, files }, { session, conversationId, onText, onEvent, signal })

export const chatCat = simpleChat('cat')
export const chatAnything = simpleChat('anything')

export const sendChat = ({
  type = 'text',
  query,
  session,
  conversationId = '',
  files = [],
  inputs = {},
  language = 'en',
  onText,
  onEvent,
  signal
} = {}) => {
  const base = CHAT_ENDPOINTS[type]
  if (!base) fail(`Unknown chat type: ${type}`, { code: 'UNKNOWN_TYPE' })
  if (type === 'vision') {
    return chatVision({
      query,
      images: files,
      session,
      conversationId,
      deepThink: inputs.think_status,
      webSearch: inputs.search_status,
      onText,
      onEvent,
      signal
    })
  }
  if (type === 'text' || type === 'document') {
    return chat({ query, session, conversationId, files, inputs, language, onText, onEvent, signal })
  }
  return chatStream(base, { query, streaming: true, files }, { session, conversationId, onText, onEvent, signal })
}

export const createImage = async ({
  prompt,
  feature = 'comic',
  ratio = '1:1',
  style = '',
  styleDesc = '',
  files = [],
  selectedImageId = '',
  session,
  conversationId = ''
} = {}) => {
  const base = IMAGE_ENDPOINTS[feature]
  if (!base) fail(`Unknown image feature: ${feature}`, { code: 'UNKNOWN_TYPE' })
  const auth = resolveSession(session)
  const data = await requestJson(`${base}/messages`, {
    method: 'POST',
    session: auth,
    headers: conversationId ? { 'X-Conversation-Id': conversationId } : {},
    body: {
      query: prompt,
      streaming: false,
      files,
      ...(selectedImageId ? { selected_image_id: selectedImageId, selected_image_action: 'style_reference' } : {}),
      inputs: { style, style_desc: styleDesc, ratio }
    }
  })
  ensureOk(data, 'Image generation')
  const taskId = data.data?.taskId || data.data?.task_id || ''
  if (!taskId) fail('Image task id missing', { payload: data, code: 'TASK_MISSING' })
  return {
    taskId,
    conversationId: data.data?.conversation_id || data.data?.conversationId || conversationId,
    raw: data
  }
}

export const getImageTask = async ({ taskId, feature = 'comic', session } = {}) => {
  const base = feature === 'comic' || feature === 'drawing' ? `${AI}/inquire/text2image` : `${AI}/inquire/img`
  const data = await requestJson(`${base}/messages/task`, { method: 'POST', session, body: { taskId } })
  return ensureOk(data, 'Image task status')
}

export const generateImage = async ({ interval = POLL_INTERVAL, timeout = POLL_TIMEOUT, onProgress, ...options } = {}) => {
  const started = await createImage(options)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const task = await getImageTask({
      taskId: started.taskId,
      feature: options.feature || 'comic',
      session: options.session
    })
    onProgress?.(task)
    const status = String(task?.status || '').toUpperCase()
    if (status === 'SUCCESS' || status === 'SUCCEEDED') {
      return {
        taskId: started.taskId,
        conversationId: started.conversationId,
        urls: Array.isArray(task.url) ? task.url : task.url ? [task.url] : [],
        items: Array.isArray(task.image_items) ? task.image_items : [],
        cost: task.cost ?? null,
        text: task.text || '',
        raw: task
      }
    }
    if (status === 'FAILED' || status === 'ERROR') {
      fail(task.text || task.msg || task.message || 'Image generation failed', { payload: task, code: 'TASK_FAILED' })
    }
    await sleep(interval)
  }
  fail('Image generation timed out', { code: 'TIMEOUT', taskId: started.taskId })
}

const videoSubmit = async ({
  prompt,
  type = 'text',
  images = [],
  model = DEFAULT_VIDEO_MODEL,
  duration = 5,
  ratio = '16:9',
  audio = true,
  session
} = {}) => {
  const auth = resolveSession(session)
  const endpoint = VIDEO_ENDPOINTS[type]
  if (!endpoint) fail(`Unknown video type: ${type}`, { code: 'UNKNOWN_TYPE' })
  const payload = { prompt, model_id: model, generate_audio: audio, userId: auth.userId, token: auth.token }
  const url = `${endpoint.submit}?duration=${encodeURIComponent(duration)}&ratio=${encodeURIComponent(ratio)}`
  const body =
    type === 'text'
      ? payload
      : type === 'one'
        ? { request: payload, image_url: images[0] || '', reference_video_url: '' }
        : { request: payload, image_urls: images.slice(0, 2) }
  const data = await requestJson(url, {
    method: 'POST',
    session: auth,
    headers: { userId: auth.userId, Token: auth.token },
    body
  })
  const result = data?.result || data
  if (Number(result?.code) !== 0) {
    const rawMsg = result?.data || result?.msg || result?.message || 'Video generation failed'
    const isBalance = /insufficient|balance|credit|quota|saldo|余额不足/i.test(String(rawMsg))
    fail(rawMsg, { payload: data, code: isBalance ? 'insufficient_balance' : result?.code })
  }
  return {
    taskId: result.task_id || result.taskId || '',
    evaluateTaskId: result.evaluate_task_id || '',
    status: result.status || '',
    raw: data
  }
}

const videoTask = async ({ taskId, type = 'text', prompt = '', images = [], session } = {}) => {
  const endpoint = VIDEO_ENDPOINTS[type]
  if (!endpoint) fail(`Unknown video type: ${type}`, { code: 'UNKNOWN_TYPE' })
  const body = { prompt }
  if (type === 'one') body.image_url = images[0] || ''
  if (type === 'two') body.image_url = images.slice(0, 2)
  const data = await requestJson(`${endpoint.status}/${encodeURIComponent(taskId)}`, {
    method: 'POST',
    session,
    headers: { userId: resolveSession(session).userId, Token: resolveSession(session).token },
    body
  })
  return ensureOk(data, 'Video task status')
}

export const createVideo = (options) => videoSubmit(options)

export const getVideoTask = (options) => videoTask(options)

export const generateVideo = async ({ interval = 5000, timeout = POLL_TIMEOUT, onProgress, ...options } = {}) => {
  const started = await videoSubmit(options)
  if (!started.taskId) fail('Video task id missing', { payload: started.raw, code: 'TASK_MISSING' })
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const task = await videoTask({ ...options, taskId: started.taskId })
    onProgress?.(task)
    const status = String(task?.status || '').toLowerCase()
    if (status === 'succeeded' || status === 'success') {
      return {
        taskId: started.taskId,
        videoUrl: task.video_url || task.videoUrl || '',
        coverUrl: task.cover_url || task.coverUrl || '',
        tokensUsed: task.tokens_used ?? null,
        deduction: task.deduction_amount ?? null,
        seed: task.seed ?? null,
        raw: task
      }
    }
    if (status === 'failed' || status === 'error') {
      fail(task.message || task.msg || 'Video generation failed', { payload: task, code: 'TASK_FAILED' })
    }
    await sleep(interval)
  }
  fail('Video generation timed out', { code: 'TIMEOUT', taskId: started.taskId })
}

export const listVideoHistory = ({ taskType = '', page = 1, size = 20, session } = {}) => {
  const auth = resolveSession(session)
  const query = [
    `userId=${encodeURIComponent(auth.userId)}`,
    ...(taskType ? [`task_type=${encodeURIComponent(taskType)}`] : []),
    `page=${page}`,
    `size=${size}`
  ].join('&')
  return requestJson(`${AI}/agent/video/history?${query}`, {
    session: auth,
    headers: { userId: auth.userId, Token: auth.token }
  })
}

const featureBase = (type) => CHAT_ENDPOINTS[type] || IMAGE_ENDPOINTS[type] || ''

export const listHistory = ({ type = 'text', limit = 20, skip = 0, sort = -1, session } = {}) => {
  const base = featureBase(type)
  if (!base) fail(`Unknown feature: ${type}`, { code: 'UNKNOWN_TYPE' })
  return requestJson(
    `${base}/history?limit=${encodeURIComponent(limit)}&skip=${encodeURIComponent(skip)}&sort=${encodeURIComponent(sort)}`,
    { session }
  )
}

export const listMessages = async ({ type = 'text', conversationId = '', limit = 20, skip = 0, session } = {}) => {
  const base = featureBase(type)
  if (!base) fail(`Unknown feature: ${type}`, { code: 'UNKNOWN_TYPE' })
  let id = conversationId
  if (!id) {
    const history = await listHistory({ type, limit: 1, session })
    id = history?.history?.[0]?.conversationId || history?.history?.[0]?.conversation_id || ''
  }
  if (!id) fail(`No conversation found for ${type}`, { code: 'CONVERSATION_NOT_FOUND' })
  return requestJson(`${base}/messages?skip=${encodeURIComponent(skip)}&limit=${encodeURIComponent(limit)}`, {
    session,
    headers: { 'X-Conversation-Id': id }
  })
}

export const textToSpeech = async ({ text, session, signal } = {}) => {
  const cleanText = String(text ?? '').trim()
  if (!cleanText) fail('Text is required for TTS', { code: 'TEXT_REQUIRED' })
  const form = new FormData()
  form.append('text', cleanText)
  const auth = session ? resolveSession(session) : currentSession
  const response = await fetch(`${AI}/agent/yyfy/api/voice/tts?_t=${Date.now()}`, {
    method: 'POST',
    headers: { accept: 'audio/mpeg, audio/*', ...(auth ? authHeaders(auth) : {}) },
    body: form,
    signal: timeoutSignal(DEFAULT_TIMEOUT, signal)
  })
  if (!response.ok) fail(`TTS failed with HTTP ${response.status}`, { status: response.status })
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) fail('TTS returned empty audio buffer', { code: 'EMPTY_AUDIO' })
  return {
    buffer,
    contentType: response.headers.get('content-type') || 'audio/mpeg'
  }
}

export const speechToText = async ({ audio, filename = 'audio.mp3', contentType = 'audio/mpeg', session, signal } = {}) => {
  if (!audio) fail('Audio data is required', { code: 'AUDIO_REQUIRED' })
  const blob = audio instanceof Blob ? audio : new Blob([audio], { type: contentType })
  const form = new FormData()
  form.append('file', blob, filename)
  const auth = session ? resolveSession(session) : currentSession
  const response = await fetch(`${AI}/agent/yyfy/api/voice/asr`, {
    method: 'POST',
    headers: { accept: 'application/json', ...(auth ? authHeaders(auth) : {}) },
    body: form,
    signal: timeoutSignal(DEFAULT_TIMEOUT, signal)
  })
  const data = await parseBody(response)
  if (!response.ok) {
    fail(describeDetail(data?.detail) || data?.msg || `ASR failed with HTTP ${response.status}`, {
      status: response.status,
      payload: data
    })
  }
  return data
}

export const sendEmailCode = async (email, type = 0) => {
  const data = await requestJson(`${AUTH}/code/email`, { method: 'POST', body: { email, type }, useAuth: false })
  return ensureOk(data, 'Send email code')
}

export const register = async ({ email, password, code, countryCode } = {}) => {
  const data = await requestJson(`${AUTH}/auth/register`, {
    method: 'POST',
    useAuth: false,
    body: { authType: 4, account: email, password, smsCode: code, ...(countryCode ? { countryCode } : {}) }
  })
  ensureOk(data, 'Register')
  return setSession({ ...data.data, email, registered: data.data?.registered ?? true })
}

export const login = async ({ email, password } = {}) => {
  const data = await requestJson(`${AUTH}/auth/login`, {
    method: 'POST',
    useAuth: false,
    body: { authType: 1, data: { email, password } }
  })
  ensureOk(data, 'Login')
  return setSession({ ...data.data, email, registered: data.data?.registered ?? false })
}

export const isRegistered = async (email) => {
  return requestJson(`${AUTH}/auth/isRegister?account=${encodeURIComponent(email)}`, { useAuth: false })
}

const mailRequest = async (reqPath, { method = 'GET', body, token } = {}) => {
  const response = await fetch(`${MAIL}${reqPath}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
  })
  const data = await parseBody(response)
  if (!response.ok) {
    fail(data?.message || data?.['hydra:description'] || `Mail service HTTP ${response.status}`, {
      status: response.status,
      payload: data
    })
  }
  return data
}

const randomLocal = (prefix = 'hapgeta') => `${prefix}${crypto.randomBytes(3).toString('hex')}`
const randomPassword = () => `Hap${crypto.randomBytes(4).toString('hex')}9`
const hydraList = (data) => (Array.isArray(data) ? data : data?.['hydra:member'] || [])

export const createInbox = async ({ prefix = 'hapgeta', password = randomPassword() } = {}) => {
  let lastError = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const domains = await mailRequest('/domains')
      const domain = hydraList(domains).find((item) => item.isActive && !item.isPrivate)?.domain
      if (!domain) fail('No usable mail.tm domain', { code: 'MAIL_DOMAIN' })
      const address = `${randomLocal(prefix)}@${domain}`
      const account = await mailRequest('/accounts', { method: 'POST', body: { address, password } })
      const tokenData = await mailRequest('/token', { method: 'POST', body: { address, password } })
      return {
        address: account.address || address,
        password,
        token: tokenData.token,
        id: account.id
      }
    } catch (error) {
      lastError = error
      if (error.status === 429 && attempt < 4) {
        await sleep(10_000 * attempt)
        continue
      }
      throw error
    }
  }
  throw lastError || new HapgetaError('Failed to create mail.tm inbox', { code: 'MAIL_RATE_LIMIT' })
}

export function extractOtpFromEmailDetail(detail) {
  const plain = String(detail?.text || detail?.intro || '').trim()
  const rawHtml = Array.isArray(detail?.html) ? detail.html.join('\n') : String(detail?.html || '')
  const cleanHtml = rawHtml
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

  for (const source of [plain, cleanHtml]) {
    if (!source) continue
    const explicit = source.match(/(?:verification\s*code|kode\s*verifikasi|code)\s*(?:is|adalah)?\s*[:：]\s*([A-Za-z0-9]{4,8})\b/i)
    if (explicit) return explicit[1].toUpperCase()
  }

  for (const source of [plain, cleanHtml]) {
    if (!source) continue
    const tokens = source.match(/\b([A-Za-z0-9]{4})\b/g) || []
    // Prioritaskan token yang punya angka agar tidak tertangkap kata biasa/CSS
    const withDigit = tokens.find((t) => /\d/.test(t) && !IGNORED_OTP_WORDS.has(t.toUpperCase()))
    if (withDigit) return withDigit.toUpperCase()
    const cleanAlpha = tokens.find((t) => !IGNORED_OTP_WORDS.has(t.toUpperCase()))
    if (cleanAlpha) return cleanAlpha.toUpperCase()
  }

  return null
}

export const readVerificationCode = async (inbox, { timeout = 120_000, interval = 5_000 } = {}) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    let list
    try {
      list = await mailRequest('/messages', { token: inbox.token })
    } catch (error) {
      if (error.status === 429) {
        await sleep(10_000)
        continue
      }
      throw error
    }
    const messages = hydraList(list)
    for (const message of messages) {
      if (!/verification|hapgeta|code/i.test(`${message.subject || ''} ${message.intro || ''}`)) continue
      const detail = await mailRequest(`/messages/${message.id}`, { token: inbox.token })
      const code = extractOtpFromEmailDetail(detail)
      if (code) return code
    }
    await sleep(interval)
  }
  fail('Verification email not received in time', { code: 'MAIL_TIMEOUT' })
}

export const createAccount = async ({ prefix = 'hapgeta', password = randomPassword() } = {}) => {
  const inbox = await createInbox({ prefix, password })
  await sendEmailCode(inbox.address, 0)
  const code = await readVerificationCode(inbox)
  const session = await register({ email: inbox.address, password, code })
  return { ...session, email: inbox.address, password, code, inbox }
}

/* ---------- Bot Persistence, Account Pool & Public Image Helper ---------- */

export const getSessionStorePath = () =>
  process.env.HAPGETA_SESSION_FILE || path.join(SESSION_DIR, 'hapgeta_sessions.json')

function writeJsonAtomic(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function readStore(filePath = getSessionStorePath()) {
  if (!existsSync(filePath)) return { activeId: null, accounts: [] }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    const accounts = Array.isArray(raw?.accounts)
      ? raw.accounts.filter((a) => a && a.userId && a.token)
      : []
    return {
      activeId: raw?.activeId ? String(raw.activeId) : (accounts[0]?.userId ? String(accounts[0].userId) : null),
      accounts
    }
  } catch {
    return { activeId: null, accounts: [] }
  }
}

function saveStore(store, filePath = getSessionStorePath()) {
  writeJsonAtomic(filePath, {
    activeId: store.activeId ? String(store.activeId) : null,
    accounts: store.accounts || []
  })
}

function buildAccountRecord(session, { email = '', password = '', exhausted = false } = {}) {
  return {
    userId: String(session.userId),
    token: String(session.token),
    nickname: session.nickname || '',
    email: email || session.email || '',
    password: password || '',
    exhausted: Boolean(exhausted),
    updatedAt: Date.now()
  }
}

function upsertAccountRecord(record, { setActive = true } = {}, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const idx = store.accounts.findIndex(
    (a) => String(a.userId) === String(record.userId) || (record.email && a.email === record.email)
  )
  if (idx >= 0) store.accounts[idx] = { ...store.accounts[idx], ...record }
  else store.accounts.push(record)
  if (setActive || !store.activeId) store.activeId = String(record.userId)
  saveStore(store, filePath)
  setSession(record)
  return record
}

export function listWorkerAccounts(filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  return {
    activeId: store.activeId,
    accounts: store.accounts.map((acc) => ({
      userId: String(acc.userId),
      email: acc.email || '-',
      nickname: acc.nickname || '',
      active: String(acc.userId) === String(store.activeId),
      exhausted: Boolean(acc.exhausted),
      hasPassword: Boolean(acc.password),
      updatedAt: acc.updatedAt || 0
    }))
  }
}

export function setActiveWorkerAccount(target, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const key = String(target || '').trim().toLowerCase()
  const found = store.accounts.find(
    (a) => String(a.userId).toLowerCase() === key || String(a.email || '').toLowerCase() === key
  )
  if (!found) throw new Error(`Akun HAPGETA "${target}" tidak ditemukan di cache.`)
  found.exhausted = false
  store.activeId = String(found.userId)
  saveStore(store, filePath)
  setSession(found)
  return found
}

export function removeWorkerAccount(target, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const key = String(target || '').trim().toLowerCase()
  const before = store.accounts.length
  store.accounts = store.accounts.filter(
    (a) => String(a.userId).toLowerCase() !== key && String(a.email || '').toLowerCase() !== key
  )
  if (store.accounts.length === before) return false
  if (String(store.activeId || '').toLowerCase() === key || !store.accounts.some((a) => String(a.userId) === String(store.activeId))) {
    store.activeId = store.accounts[0]?.userId ? String(store.accounts[0].userId) : null
  }
  saveStore(store, filePath)
  return true
}

export async function addWorkerAccount({ email, password, setActive = true } = {}, filePath = getSessionStorePath()) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanPass = String(password || '').trim()
  if (!cleanEmail || !cleanPass) throw new Error('Email dan password HAPGETA wajib diisi.')
  const session = await login({ email: cleanEmail, password: cleanPass })
  const record = buildAccountRecord(session, { email: cleanEmail, password: cleanPass, exhausted: false })
  return upsertAccountRecord(record, { setActive }, filePath)
}

export async function createWorkerAccount({ prefix = 'hapgeta', password, setActive = true } = {}, filePath = getSessionStorePath()) {
  if (!createAccountInFlight) {
    createAccountInFlight = createAccount({ prefix, ...(password ? { password } : {}) }).finally(() => {
      createAccountInFlight = null
    })
  }
  const created = await createAccountInFlight
  const record = buildAccountRecord(created, {
    email: created.email,
    password: created.password,
    exhausted: false
  })
  return upsertAccountRecord(record, { setActive }, filePath)
}

async function refreshStoredAccount(account, filePath = getSessionStorePath()) {
  if (!account?.email || !account?.password) return null
  const key = `${filePath}:${account.userId}`
  if (refreshInFlight.has(key)) return refreshInFlight.get(key)
  const task = (async () => {
    const session = await login({ email: account.email, password: account.password })
    const updated = buildAccountRecord(session, {
      email: account.email,
      password: account.password,
      exhausted: Boolean(account.exhausted)
    })
    upsertAccountRecord(updated, { setActive: true }, filePath)
    return updated
  })().finally(() => {
    refreshInFlight.delete(key)
  })
  refreshInFlight.set(key, task)
  return task
}

function markAccountExhausted(userId, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const target = store.accounts.find((a) => String(a.userId) === String(userId))
  if (!target) return
  target.exhausted = true
  saveStore(store, filePath)
}

function getOrderedCandidates(store) {
  const active = store.accounts.find((a) => String(a.userId) === String(store.activeId))
  const rest = store.accounts.filter((a) => String(a.userId) !== String(active?.userId))
  return [...(active ? [active] : []), ...rest].filter((a) => !a.exhausted)
}

export async function runWithWorkerSession(fn, { allowInitialBootstrap = true } = {}, filePath = getSessionStorePath()) {
  const initialStore = readStore(filePath)
  if (!initialStore.accounts.length) {
    if (!allowInitialBootstrap) {
      throw new Error('Belum ada akun HAPGETA tersimpan. Owner bisa daftar/login via .hapcreate atau .haplogin.')
    }
    await createWorkerAccount({ setActive: true }, filePath)
  }

  let triedAny = false
  const maxPasses = Math.max(4, readStore(filePath).accounts.length + 2)
  for (let pass = 0; pass < maxPasses; pass++) {
    const curStore = readStore(filePath)
    const candidates = getOrderedCandidates(curStore)
    if (!candidates.length) break

    const candidate = candidates[0]
    triedAny = true
    const sess = normalizeSession(candidate)
    if (String(curStore.activeId) !== String(candidate.userId)) {
      upsertAccountRecord(candidate, { setActive: true }, filePath)
    }
    try {
      return await fn(sess)
    } catch (err) {
      if (isAuthError(err) && candidate.email && candidate.password) {
        const refreshed = await refreshStoredAccount(candidate, filePath)
        if (refreshed) {
          return await fn(normalizeSession(refreshed))
        }
      }
      if (isBalanceError(err)) {
        markAccountExhausted(candidate.userId, filePath)
        continue
      }
      throw err
    }
  }

  if (triedAny) {
    fail(
      'Kredit seluruh akun HAPGETA tersimpan sudah habis (insufficient_balance). Owner bisa tambah akun baru via .hapcreate atau .haplogin.',
      { code: 'insufficient_balance' }
    )
  }
  fail('Tidak ada akun HAPGETA aktif yang siap dipakai.', { code: 'AUTH_REQUIRED' })
}

export async function uploadPublicImage(buffer, filename = 'image.jpg', mime = 'image/jpeg') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Buffer gambar kosong.')
  }
  const fd = new FormData()
  fd.append('reqtype', 'fileupload')
  fd.append('time', '1h')
  fd.append('fileToUpload', new Blob([buffer], { type: mime }), filename)
  const res = await fetch(LITTERBOX_UPLOAD_URL, {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(30_000)
  })
  const url = (await res.text()).trim()
  if (!res.ok || !url.startsWith('https://')) {
    throw new Error(`Gagal upload media ke host sementara (${res.status}): ${url.slice(0, 120)}`)
  }
  return url
}

export default {
  HapgetaError,
  IMAGE_FEATURES,
  setSession,
  getSession,
  isBalanceError,
  isAuthError,
  chat,
  chatVision,
  chatCat,
  chatAnything,
  sendChat,
  createImage,
  getImageTask,
  generateImage,
  createVideo,
  getVideoTask,
  generateVideo,
  listVideoHistory,
  listHistory,
  listMessages,
  textToSpeech,
  speechToText,
  sendEmailCode,
  register,
  login,
  isRegistered,
  createInbox,
  extractOtpFromEmailDetail,
  readVerificationCode,
  createAccount,
  getSessionStorePath,
  listWorkerAccounts,
  setActiveWorkerAccount,
  removeWorkerAccount,
  addWorkerAccount,
  createWorkerAccount,
  runWithWorkerSession,
  uploadPublicImage
}
