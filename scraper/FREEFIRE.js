/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * FREEFIRE.js — Free Fire OB55 (v1.132.1) protocol client & worker session manager
 */

import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SESSION_DIR = path.join(ROOT, 'session')

const API_KEY = '2ee44819e9b4598845141067b281621874d0d5d7af9d8f7e00c1e54715b7d1e3'
const AES_KEY = Buffer.from('Yg&tc%DEuh6%Zc^8', 'latin1')
const AES_IV = Buffer.from('6oyZDr22E3ychjM%', 'latin1')
const CLIENT_ID = '100067'
const RELEASE_VERSION = 'OB55'
const DEFAULT_LOGIN = 'https://loginbp.ggblueshark.com/MajorLogin'
const GARENA_TOKEN_HOSTS = [
  'https://ffmconnect.live.gop.garenanow.com/oauth/guest/token/grant',
  'https://auth.garena.com/oauth/guest/token/grant'
]
const GUEST_REGISTER_JSON = 'https://100067.connect.garena.com/api/v2/oauth/guest:register'
const GUEST_REGISTER_FORM = 'https://ffmconnect.live.gop.garenanow.com/oauth/guest/register'
const VERSION_URL = 'https://version.common.redflamenco.com/live/ver.php'
const REGISTER_HOST = 'https://loginbp.ggblueshark.com'
const UNITY_UA = 'Dalvik/2.1.0 (Linux; U; Android 13; A063 Build/TKQ1.221220.001)'
const TOKEN_REFRESH_MARGIN_MS = 120_000
const DEFAULT_TOKEN_TTL_SEC = 28_800

const CLUSTERS = [
  { cluster: 'IND', host: 'https://clientbp.freefireind.in' },
  { cluster: 'IND', host: 'https://client.ind.freefiremobile.com' },
  { cluster: 'EUROPE', host: 'https://clientbp.ppmainecoonghj.com' },
  { cluster: 'US', host: 'https://client.us.freefiremobile.com' }
]

const OB55_DEVICE_BLOB =
  '1a13323032352d31312d32362030313a35313a3238220966726565206669726528013a07312e3133322e314232416e64726f6964204f532039202f204150492d3238202850492f72656c2e636a772e32303232303531382e313134313333294a0848616e6468656c64520c4d544e2f537061636574656c5a045749464960800a68d00572033234307a2d7838362d3634205353453320535345342e3120535345342e32204156582041565832207c2032343030207c20348001e61e8a010f416472656e6f2028544d292036343092010d4f70656e474c20455320332e329a012b476f6f676c657c36323566373136662d393161372d343935622d396631362d303866653964336336353333a2010e3137362e32382e3133392e313835aa01026172b201203433303632343537393364653836646134323561353263616164663231656564ba010134c2010848616e6468656c64ca010d4f6e65506c7573204135303130ea014063363961653230386661643732373338623637346232383437623530613361316466613235643161313966616537343566633736616334613065343134633934f00101ca020c4d544e2f537061636574656cd2020457494649ca03203161633462383065636630343738613434323033626638666163363132306635e003b5ee02e8039a8002f003af13f80384078004a78f028804b5ee029004a78f029804b5ee02b00404c80401d2043d2f646174612f6170702f636f6d2e6474732e667265656669726574682d66705843537068495636644b43376a4c2d574f7952413d3d2f6c69622f61726de00401ea045f65363261623933353464386662356662303831646233333861636233333439317c2f646174612f6170702f636f6d2e6474732e667265656669726574682d66705843537068495636644b43376a4c2d574f7952413d3d2f626173652e61706bf00406f804018a050233329a050a32303139313139303236a80503b205094f70656e474c455332b805ff01c00504e005be7eea05093372645f7061727479f205704b717348543857393347646347335a6f7a454e6646775648746d377171316552554e6149444e67526f626f7a4942744c4f695943633459367a767670634943787a514632734f453463627974774c7334785a62526e70524d706d5752514b6d654f35766373386e51594268777148374bf805e7e4068806019006019a060134a2060134b2062213521146500e590349510e460900115843395f005b510f685b560a6107576d0f0366'

const loginInFlight = new Map()
let bootstrapInFlight = null

const varint = (n) => {
  let v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 0) {
    throw new RangeError(`invalid varint value: ${n}`)
  }
  const out = []
  while (v > 0x7f) {
    out.push((v % 128) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return Buffer.from(out)
}

const tag = (field, wire) => varint((field << 3) | wire)

const fieldBytes = (field, value) => {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
  return Buffer.concat([tag(field, 2), varint(buf.length), buf])
}

const fieldNumber = (field, value) => Buffer.concat([tag(field, 0), varint(value)])

const fieldBool = (field, value) => fieldNumber(field, value ? 1 : 0)

const encodeValue = (field, value) => {
  if (typeof value === 'number') return fieldNumber(field, value)
  if (typeof value === 'boolean') return fieldBool(field, value)
  return fieldBytes(field, value)
}

export const encode = (fields) => {
  const parts = []
  for (const [field, value] of fields) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) parts.push(encodeValue(field, item))
    } else {
      parts.push(encodeValue(field, value))
    }
  }
  return Buffer.concat(parts)
}

const readVarint = (buf, offset) => {
  let value = 0
  let shift = 0
  let pos = offset
  while (pos < buf.length) {
    const byte = buf[pos++]
    value += (byte & 0x7f) * Math.pow(2, shift)
    if ((byte & 0x80) === 0) return [value, pos]
    shift += 7
    if (shift > 63) throw new Error('invalid varint')
  }
  throw new Error('unexpected end of varint')
}

const decodeAt = (buf, offset) => {
  const result = {}
  let pos = offset
  while (pos < buf.length) {
    let header
    try {
      header = readVarint(buf, pos)
    } catch {
      return null
    }
    const key = header[0]
    pos = header[1]
    const field = key >> 3
    const wire = key & 7
    if (field === 0) return null
    try {
      if (wire === 0) {
        const value = readVarint(buf, pos)
        pos = value[1]
        ;(result[field] ||= []).push(value[0])
      } else if (wire === 2) {
        const len = readVarint(buf, pos)
        pos = len[1]
        if (pos + len[0] > buf.length) return null
        ;(result[field] ||= []).push(buf.subarray(pos, pos + len[0]))
        pos += len[0]
      } else if (wire === 5) {
        if (pos + 4 > buf.length) return null
        ;(result[field] ||= []).push(buf.subarray(pos, pos + 4))
        pos += 4
      } else if (wire === 1) {
        if (pos + 8 > buf.length) return null
        ;(result[field] ||= []).push(buf.subarray(pos, pos + 8))
        pos += 8
      } else {
        return null
      }
    } catch {
      return null
    }
  }
  return result
}

export const decode = (buf) => {
  const direct = decodeAt(buf, 0)
  if (direct) return direct
  for (let offset = 1; offset <= 128 && offset < buf.length; offset++) {
    const candidate = decodeAt(buf, offset)
    if (candidate && Object.keys(candidate).length > 0) return candidate
  }
  return {}
}

const decodeWithOffset = (buf, predicate, limit = 160) => {
  const max = Math.min(limit, buf.length - 1)
  for (let offset = 0; offset <= max; offset++) {
    const candidate = decodeAt(buf, offset)
    if (candidate && predicate(candidate)) return { fields: candidate, offset }
  }
  return null
}

const firstNumber = (fields, field) => {
  const values = fields[field]
  if (!values || values.length === 0) return undefined
  return values[0]
}

const firstBuffer = (fields, field) => {
  const values = fields[field]
  if (!values || values.length === 0) return undefined
  return values[0]
}

const firstText = (fields, field) => {
  const buf = firstBuffer(fields, field)
  return buf ? buf.toString('utf8') : undefined
}

const isPrintable = (buf) => {
  if (buf.length === 0) return false
  let printable = 0
  for (const byte of buf) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) printable++
  }
  return printable / buf.length > 0.9
}

const toTree = (buf, depth = 0) => {
  if (buf.length === 0) return {}
  if (depth > 8) return buf.toString('hex')
  const parsed = decodeAt(buf, 0)
  if (parsed && Object.keys(parsed).length > 0) {
    const out = {}
    for (const [field, values] of Object.entries(parsed)) {
      out[field] = values.map((value) => {
        if (Buffer.isBuffer(value)) {
          if (isPrintable(value)) return value.toString('utf8')
          if (value.length >= 2) return toTree(value, depth + 1)
          return value.toString('hex')
        }
        return value
      })
    }
    return out
  }
  if (isPrintable(buf)) return buf.toString('utf8')
  return buf.toString('hex')
}

const pretty = (fields) => {
  const out = {}
  for (const [key, values] of Object.entries(fields)) {
    out[key] = values.map((value) => (Buffer.isBuffer(value) ? toTree(value) : value))
  }
  return out
}

const sub = (fields, key) => {
  const value = firstBuffer(fields, key)
  return value ? decodeAt(value, 0) || {} : {}
}

const subList = (fields, key) =>
  (fields[key] || []).filter((item) => Buffer.isBuffer(item)).map((item) => decodeAt(item, 0) || {})

const encrypt = (buf) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_IV)
  return Buffer.concat([cipher.update(buf), cipher.final()])
}

const decodeBody = (buf, encoding) => {
  if (!encoding) return buf
  const enc = String(encoding).toLowerCase().trim()
  try {
    if (enc === 'gzip') return zlib.gunzipSync(buf)
    if (enc === 'deflate') return zlib.inflateSync(buf)
    if (enc === 'br') return zlib.brotliDecompressSync(buf)
  } catch {
    return buf
  }
  return buf
}

const safeJsonParse = (buf, contextLabel = 'response') => {
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '')
  try {
    return JSON.parse(text)
  } catch {
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 120)
    throw new Error(`${contextLabel}: invalid JSON (${preview || 'empty'})`)
  }
}

const request = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const target = new URL(url)
    const method = options.method || 'GET'
    const body = options.body || Buffer.alloc(0)
    const headers = { ...options.headers }
    if (options.body) headers['Content-Length'] = body.length
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method,
        headers,
        rejectUnauthorized: options.rejectUnauthorized !== false,
        timeout: options.timeout || 25_000
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks)
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: decodeBody(raw, res.headers['content-encoding'])
          })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('request timeout')))
    req.on('error', reject)
    if (body.length) req.write(body)
    req.end()
  })

const trim = (value) => String(value ?? '').trim()

const makePassword = () => {
  const charset = '0123456789abcdefghijklmnopqrstuvwxyz!@#$%^&*()'
  let raw = ''
  for (let i = 0; i < 64; i++) raw += charset[crypto.randomInt(charset.length)]
  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase()
}

export const grantToken = async (uid, password) => {
  const body = new URLSearchParams({
    uid: String(uid),
    password,
    response_type: 'token',
    client_type: '2',
    client_secret: API_KEY,
    client_id: CLIENT_ID
  }).toString()
  let lastError
  for (const endpoint of GARENA_TOKEN_HOSTS) {
    try {
      const res = await request(endpoint, {
        method: 'POST',
        body: Buffer.from(body),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'GarenaMSDK/4.0.19P9(A063 ;Android 13;en;IN;)',
          'Accept-Encoding': 'gzip'
        }
      })
      if (res.status !== 200) {
        lastError = new Error(`token grant failed: HTTP ${res.status}`)
        continue
      }
      const json = safeJsonParse(res.body, 'token grant')
      if (!json.access_token || !json.open_id) {
        lastError = new Error('token grant failed: missing access_token or open_id')
        continue
      }
      return {
        uid: Number(json.uid || uid),
        openId: json.open_id,
        accessToken: json.access_token,
        tokenType: json.token_type || 'Bearer',
        expiresAt: json.expiry_time || null,
        refreshExpiresAt: json.refresh_expiry_time || null
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('token grant failed')
}

const registerGuest = async () => {
  const password = makePassword()
  const payload = JSON.stringify({ app_id: Number(CLIENT_ID), client_type: 2, password, source: 2 })
  const signature = crypto.createHmac('sha256', API_KEY).update(payload).digest('hex')
  let lastError
  try {
    const res = await request(GUEST_REGISTER_JSON, {
      method: 'POST',
      body: Buffer.from(payload),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        'User-Agent': 'GarenaMSDK/4.0.19P9(A063 ;Android 13;en;IN;)',
        Authorization: `Signature ${signature}`
      }
    })
    const json = safeJsonParse(res.body, `guest register HTTP ${res.status}`)
    if (res.status === 200 && json.data && json.data.uid) {
      return { uid: Number(json.data.uid), password, passwordHash: password }
    }
    lastError = new Error(`guest register failed: HTTP ${res.status} ${json.msg || json.message || ''}`.trim())
  } catch (error) {
    lastError = error
  }
  const form = new URLSearchParams({ password, client_type: '2', source: '2', app_id: CLIENT_ID }).toString()
  const formSignature = crypto.createHmac('sha256', API_KEY).update(form).digest('hex')
  const res = await request(GUEST_REGISTER_FORM, {
    method: 'POST',
    body: Buffer.from(form),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'GarenaMSDK/4.0.19P9(A063 ;Android 13;en;IN;)',
      Authorization: `Signature ${formSignature}`
    }
  })
  const json = safeJsonParse(res.body, `guest register fallback HTTP ${res.status}`)
  const uid = json.uid || (json.data && json.data.uid)
  if (res.status === 200 && uid) return { uid: Number(uid), password, passwordHash: password }
  throw lastError || new Error(`guest register failed: HTTP ${res.status}`)
}

export const createGuest = async () => {
  const guest = await registerGuest()
  const token = await grantToken(guest.uid, guest.password)
  return { ...guest, ...token }
}

const xorOpenId = (openId) => {
  const stream = [
    0x30, 0x30, 0x30, 0x32, 0x30, 0x31, 0x37, 0x30, 0x30, 0x30, 0x30, 0x30, 0x32, 0x30, 0x31, 0x37,
    0x30, 0x30, 0x30, 0x30, 0x30, 0x32, 0x30, 0x31, 0x37, 0x30, 0x30, 0x30, 0x30, 0x30, 0x32, 0x30
  ]
  const source = Buffer.from(openId, 'utf8')
  const out = Buffer.alloc(source.length)
  for (let i = 0; i < source.length; i++) out[i] = source[i] ^ stream[i % stream.length]
  return out
}

const majorLogin = async (token, options = {}) => {
  const releaseVersion = options.releaseVersion || RELEASE_VERSION
  const loginUrl = options.loginUrl || DEFAULT_LOGIN
  const payload = encode([
    [22, token.openId],
    [23, '4'],
    [29, token.accessToken],
    [77, '4'],
    [99, '4']
  ])
  const body = encrypt(payload)
  const res = await request(loginUrl, {
    method: 'POST',
    body,
    headers: {
      'User-Agent': UNITY_UA,
      'X-GA': 'v1 1',
      'X-GA-SV': '1',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Encoding': 'gzip',
      Authorization: 'Bearer',
      'X-Unity-Version': '2018.4.11f1',
      ReleaseVersion: releaseVersion
    }
  })
  const text = res.body.toString('utf8')
  if (res.status !== 200) {
    throw new Error(`major login failed: HTTP ${res.status} ${text.trim().slice(0, 120)}`.trim())
  }
  const isJwt = (value) => Boolean(value) && value.length > 40 && value.toString('utf8', 0, 3) === 'eyJ'
  const found = decodeWithOffset(
    res.body,
    (fields) => typeof firstNumber(fields, 1) === 'number' && isJwt(firstBuffer(fields, 8)),
    1024
  )
  if (!found) {
    const note = res.body.toString('latin1').match(/[\x20-\x7e]{6,}/g)
    throw new Error(`major login failed: unexpected response${note ? ` (${note.join(' ').slice(0, 120)})` : ''}`)
  }
  const fields = found.fields
  const accountId = firstNumber(fields, 1)
  const jwt = firstText(fields, 8)
  const serverUrl = firstText(fields, 10) || options.serverUrl || null
  const key = firstBuffer(fields, 22)
  const iv = firstBuffer(fields, 23)
  return {
    uid: token.uid,
    openId: token.openId,
    accessToken: token.accessToken,
    accountId,
    token: jwt,
    serverUrl,
    key: key ? key.toString('base64') : undefined,
    iv: iv ? iv.toString('base64') : undefined,
    lockRegion: firstText(fields, 2),
    notiRegion: firstText(fields, 3),
    ipRegion: firstText(fields, 4),
    ttl: firstNumber(fields, 9),
    raw: pretty(fields)
  }
}

export const login = async (uid, password, options = {}) => {
  if (!trim(uid) || !trim(password)) throw new Error('uid and password are required')
  const token = await grantToken(trim(uid), trim(password))
  return majorLogin(token, options)
}

const gameHeaders = (session, releaseVersion) => ({
  'User-Agent': UNITY_UA,
  Connection: 'Keep-Alive',
  'Accept-Encoding': 'gzip',
  'X-Unity-Version': '2018.4.11f1',
  'X-GA': 'v1 1',
  ReleaseVersion: releaseVersion || RELEASE_VERSION,
  'Content-Type': 'application/x-www-form-urlencoded',
  Authorization: `Bearer ${session.token}`
})

const requireSession = (session) => {
  if (!session || !session.token) throw new Error('a valid session from login() is required')
  if (!session.serverUrl) {
    throw new Error(
      'session has no serverUrl; this account is not bound to a region yet (log in once from the game client or register an account whose region has a known server)'
    )
  }
  return session.serverUrl.replace(/\/+$/, '')
}

class HttpStatusError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export const search = async (keyword, session, options = {}) => {
  const base = requireSession(session)
  const cleanKeyword = trim(keyword)
  if (!cleanKeyword || cleanKeyword.length < 3) throw new Error('keyword must be at least 3 characters')
  const res = await request(`${base}/FuzzySearchAccountByName`, {
    method: 'POST',
    body: encrypt(encode([[1, cleanKeyword]])),
    headers: gameHeaders(session, options.releaseVersion)
  })
  if (res.status !== 200) {
    throw new HttpStatusError(
      `search failed: HTTP ${res.status} ${res.body.toString('latin1').replace(/[^\x20-\x7e]/g, '').slice(0, 100)}`.trim(),
      res.status
    )
  }
  const found = decodeWithOffset(res.body, (fields) => Array.isArray(fields[1]) && fields[1].some((item) => Buffer.isBuffer(item)))
  if (!found) return []
  return found.fields[1]
    .filter((item) => Buffer.isBuffer(item))
    .map((item) => {
      const entry = decodeAt(item, 0) || {}
      return {
        accountId: firstNumber(entry, 1),
        nickname: firstText(entry, 3),
        region: firstText(entry, 5),
        level: firstNumber(entry, 6),
        likes: firstNumber(entry, 7),
        raw: pretty(entry)
      }
    })
}

const decodeBasicInfo = (fields) => ({
  accountId: firstNumber(fields, 1),
  nickname: firstText(fields, 3),
  region: firstText(fields, 5),
  level: firstNumber(fields, 6),
  likes: firstNumber(fields, 7),
  createdAt: firstNumber(fields, 44),
  lastLoginAt: firstNumber(fields, 24),
  releaseVersion: firstText(fields, 50),
  raw: pretty(fields)
})

const decodeClan = (fields) => {
  if (!firstNumber(fields, 1)) return null
  return {
    clanId: firstNumber(fields, 1),
    name: firstText(fields, 2),
    leaderId: firstNumber(fields, 3),
    raw: pretty(fields)
  }
}

const decodePet = (fields) => {
  if (!firstNumber(fields, 1)) return null
  return {
    petId: firstNumber(fields, 1),
    name: firstText(fields, 2),
    level: firstNumber(fields, 3),
    exp: firstNumber(fields, 4),
    skillId: firstNumber(fields, 6),
    skinId: firstNumber(fields, 9),
    raw: pretty(fields)
  }
}

const decodeProfile = (fields) => ({
  avatarId: firstNumber(fields, 1),
  outfitHex: firstBuffer(fields, 4) ? firstBuffer(fields, 4).toString('hex') : undefined,
  clothes: subList(fields, 5).map((item) => ({ slot: firstNumber(item, 1), itemId: firstNumber(item, 2) })),
  raw: pretty(fields)
})

const decodeEquipped = (fields) =>
  subList(fields, 5).map((item) => ({
    id: firstNumber(item, 1),
    itemId: firstNumber(item, 3),
    nameKey: firstText(item, 7),
    raw: pretty(item)
  }))

const decodeModeStats = (fields) =>
  subList(fields, 14).map((item) => ({ mode: firstNumber(item, 1), points: firstNumber(item, 2), raw: pretty(item) }))

const decodeSocial = (fields) => ({
  signature: firstText(fields, 9) || firstText(fields, 14) || '',
  gender: firstNumber(fields, 10),
  language: firstText(fields, 11),
  raw: pretty(fields)
})

export function parseAccountId(raw) {
  const cleaned = trim(raw)
    .replace(/^#/, '')
    .replace(/^(?:u?id)\s*(?::|\s+)?/i, '')
    .replace(/^#/, '')
    .trim()
  if (!/^\d+$/.test(cleaned)) return null
  const num = Number(cleaned)
  if (!Number.isSafeInteger(num) || num <= 0) return null
  return num
}

export const stalk = async (accountId, session, options = {}) => {
  const base = requireSession(session)
  const id = parseAccountId(accountId)
  if (!id) throw new Error('a valid accountId is required')
  const res = await request(`${base}/GetPlayerPersonalShow`, {
    method: 'POST',
    body: encrypt(encode([[1, id], [2, 7], [3, 1]])),
    headers: gameHeaders(session, options.releaseVersion)
  })
  if (res.status !== 200) {
    throw new HttpStatusError(
      `stalk failed: HTTP ${res.status} ${res.body.toString('latin1').replace(/[^\x20-\x7e]/g, '').slice(0, 100)}`.trim(),
      res.status
    )
  }
  const found = decodeWithOffset(res.body, (fields) => Array.isArray(fields[1]) && Buffer.isBuffer(fields[1][0]))
  const fields = found ? found.fields : decode(res.body)
  const basic = decodeBasicInfo(sub(fields, 1))
  const profile = decodeProfile(sub(fields, 2))
  const clan = decodeClan(sub(fields, 6))
  const pet = decodePet(sub(fields, 8))
  const social = decodeSocial(sub(fields, 9))
  const credit = sub(fields, 11)
  const leaderRaw = sub(fields, 7)
  const clanLeader = firstNumber(leaderRaw, 1)
    ? {
        accountId: firstNumber(leaderRaw, 1),
        nickname: firstText(leaderRaw, 3),
        region: firstText(leaderRaw, 5),
        level: firstNumber(leaderRaw, 6),
        likes: firstNumber(leaderRaw, 7),
        raw: pretty(leaderRaw)
      }
    : null
  return {
    accountId: basic.accountId || id,
    nickname: basic.nickname,
    region: basic.region,
    level: basic.level,
    likes: basic.likes,
    createdAt: basic.createdAt,
    lastLoginAt: basic.lastLoginAt,
    releaseVersion: basic.releaseVersion,
    signature: social.signature,
    creditScore: firstNumber(credit, 1),
    clan,
    clanLeader,
    pet,
    social,
    profile,
    equipped: decodeEquipped(fields),
    modeStats: decodeModeStats(fields),
    mmr: subList(fields, 13),
    basic,
    credit,
    raw: toTree(res.body)
  }
}

const clusterOf = (session) => {
  if (session && session.lockRegion) return String(session.lockRegion).toUpperCase()
  const host = String((session && session.serverUrl) || '').replace(/\/+$/, '').toLowerCase()
  const match = CLUSTERS.find((entry) => entry.host === host)
  return (match && match.cluster) || 'UNKNOWN'
}

export const lookup = async (accountId, sessions, options = {}) => {
  const list = (Array.isArray(sessions) ? sessions : [sessions]).filter((item) => item && item.token && item.serverUrl)
  if (list.length === 0) throw new Error('lookup requires at least one session from login() with a serverUrl')
  const seen = new Set()
  const attempts = []
  for (const session of list) {
    const base = session.serverUrl.replace(/\/+$/, '')
    if (seen.has(base)) continue
    seen.add(base)
    try {
      const profile = await stalk(accountId, session, options)
      return { accountId: profile.accountId, cluster: clusterOf(session), serverUrl: base, session, profile, attempts }
    } catch (error) {
      attempts.push({ serverUrl: base, cluster: clusterOf(session), message: error.message })
      if (options.stopOnError && !/BR_ACCOUNT_NOT_FOUND/.test(error.message)) break
    }
  }
  return null
}

const resolveDeviceIp = async (options = {}) => {
  if (options.ip) return options.ip
  try {
    const res = await request('https://api.ipify.org?format=json', {
      method: 'GET',
      headers: { 'User-Agent': UNITY_UA },
      timeout: 4000
    })
    return safeJsonParse(res.body, 'ipify').ip || ''
  } catch {
    return ''
  }
}

const buildRegisterPayload = (token, name, regionCode, ip) => {
  const template = decode(Buffer.from(OB55_DEVICE_BLOB, 'hex'))
  const fields = {}
  for (const [key, values] of Object.entries(template)) fields[key] = [...values]
  fields[1] = [name]
  fields[2] = [token.accessToken]
  fields[3] = [token.openId]
  fields[5] = [102000007]
  fields[6] = [4]
  fields[7] = [1]
  fields[13] = [1]
  fields[14] = [xorOpenId(token.openId)]
  fields[15] = [regionCode]
  fields[16] = [1]
  fields[19] = [`Google|${crypto.randomUUID()}`]
  fields[20] = [ip || '']
  fields[22] = [token.openId]
  fields[23] = ['4']
  fields[29] = [token.accessToken]
  fields[99] = ['4']
  const entries = []
  for (const key of Object.keys(fields).map(Number).sort((a, b) => a - b)) {
    for (const value of fields[key]) entries.push([key, value])
  }
  return encode(entries)
}

export const registerGame = async (guest, nickname, region = 'IND', options = {}) => {
  const token = guest.accessToken ? guest : await grantToken(guest.uid, guest.password)
  const regionCode = String(region || 'IND').toUpperCase()
  const host = options.host || REGISTER_HOST
  const name = trim(nickname)
  if (name.length < 4 || name.length > 12) throw new Error('nickname must be between 4 and 12 characters')
  const ip = await resolveDeviceIp(options)
  const payload = buildRegisterPayload(token, name, regionCode, ip)
  const res = await request(`${host.replace(/\/+$/, '')}/MajorRegister`, {
    method: 'POST',
    body: encrypt(payload),
    headers: {
      'User-Agent': 'UnityPlayer/2018.4.12f1 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)',
      Accept: '*/*',
      'Accept-Encoding': 'gzip',
      Authorization: `Bearer ${token.accessToken}`,
      Connection: 'Keep-Alive',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-GA': 'v1 1',
      'X-GA-SV': String(Math.floor(Date.now() / 1000)),
      'X-Unity-Version': '2018.4.11f1',
      ReleaseVersion: options.releaseVersion || RELEASE_VERSION
    }
  })
  const text = res.body.toString('latin1').replace(/[^\x20-\x7e]/g, '').trim()
  return {
    success: res.status === 200,
    status: res.status,
    message: res.status === 200 ? '' : text,
    nickname: name,
    region: regionCode,
    ip
  }
}

export const createAccount = async (options = {}) => {
  const guest = await createGuest()
  const nickname = trim(options.nickname) || `Htr${crypto.randomInt(100000, 999999)}`
  const registration = await registerGame(guest, nickname, options.region || 'IND', options)
  if (!registration.success) {
    const error = new Error(`game registration rejected: HTTP ${registration.status} ${registration.message}`.trim())
    error.guest = guest
    error.registration = registration
    throw error
  }
  const session = await login(guest.uid, guest.password, options)
  return { ...guest, nickname, region: registration.region, session }
}

export const getVersion = async (version = '1.132.1', region = 'VN', lang = 'vi') => {
  const url = `${VERSION_URL}?version=${encodeURIComponent(version)}&lang=${encodeURIComponent(lang)}&device=android&region=${encodeURIComponent(region)}`
  const res = await request(url, { headers: { 'User-Agent': UNITY_UA, 'Accept-Encoding': 'gzip' } })
  if (res.status !== 200) throw new Error(`version lookup failed: HTTP ${res.status}`)
  return safeJsonParse(res.body, 'version lookup')
}

/* ---------- Bot Worker Session Store & High-Level Helpers ---------- */

export const getSessionStorePath = () =>
  process.env.FREEFIRE_SESSION_FILE || path.join(SESSION_DIR, 'freefire_sessions.json')

function writeJsonAtomic(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function readStore(filePath = getSessionStorePath()) {
  if (!existsSync(filePath)) return { activeUid: null, accounts: [] }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    const accounts = Array.isArray(raw?.accounts) ? raw.accounts.filter((a) => a && a.uid && a.password) : []
    return {
      activeUid: raw?.activeUid ? String(raw.activeUid) : (accounts[0]?.uid ? String(accounts[0].uid) : null),
      accounts
    }
  } catch {
    return { activeUid: null, accounts: [] }
  }
}

function saveStore(store, filePath = getSessionStorePath()) {
  writeJsonAtomic(filePath, {
    activeUid: store.activeUid ? String(store.activeUid) : null,
    accounts: store.accounts || []
  })
}

function buildAccountRecord(uid, password, session, meta = {}) {
  const now = Date.now()
  const ttlSec = Number(session.ttl || DEFAULT_TOKEN_TTL_SEC)
  return {
    uid: Number(uid),
    password: String(password),
    nickname: meta.nickname || session.raw?.[1]?.[0] || '',
    region: meta.region || session.lockRegion || session.ipRegion || 'ID',
    cluster: clusterOf(session),
    accountId: session.accountId || null,
    serverUrl: session.serverUrl || null,
    lockRegion: session.lockRegion || null,
    ipRegion: session.ipRegion || null,
    token: session.token || null,
    ttl: ttlSec,
    obtainedAt: now,
    expiresAt: now + ttlSec * 1000,
    autoCreated: Boolean(meta.autoCreated),
    banned: false
  }
}

function isTokenFresh(record) {
  return Boolean(
    !record?.banned &&
      record?.token &&
      record?.serverUrl &&
      Number(record?.expiresAt || 0) - TOKEN_REFRESH_MARGIN_MS > Date.now()
  )
}

function isPermanentAccountError(err) {
  return /Exploiting loopholes|Protection Bypass|token grant failed|unauthorized/i.test(String(err?.message || ''))
}

function toSessionObject(record) {
  return {
    uid: Number(record.uid),
    accountId: record.accountId,
    token: record.token,
    serverUrl: record.serverUrl,
    lockRegion: record.lockRegion,
    ipRegion: record.ipRegion,
    ttl: record.ttl
  }
}

function upsertAccountRecord(record, { setActive = true } = {}, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const key = String(record.uid)
  const idx = store.accounts.findIndex((a) => String(a.uid) === key)
  if (idx >= 0) store.accounts[idx] = { ...store.accounts[idx], ...record }
  else store.accounts.push(record)
  if (setActive || !store.activeUid) store.activeUid = key
  saveStore(store, filePath)
  return record
}

export function listWorkerAccounts(filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  return {
    activeUid: store.activeUid,
    accounts: store.accounts.map((acc) => ({
      uid: acc.uid,
      accountId: acc.accountId || null,
      nickname: acc.nickname || '',
      region: acc.region || acc.lockRegion || '-',
      cluster: acc.cluster || 'UNKNOWN',
      serverUrl: acc.serverUrl || null,
      active: String(acc.uid) === String(store.activeUid),
      autoCreated: Boolean(acc.autoCreated),
      banned: Boolean(acc.banned),
      tokenValid: isTokenFresh(acc),
      expiresAt: acc.expiresAt || 0
    }))
  }
}

export function setActiveWorkerAccount(uid, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const key = trim(uid)
  const found = store.accounts.find((a) => String(a.uid) === key)
  if (!found) throw new Error(`Akun UID ${key} tidak ada di daftar tersimpan.`)
  store.activeUid = key
  saveStore(store, filePath)
  return found
}

export function removeWorkerAccount(uid, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const key = trim(uid)
  const before = store.accounts.length
  store.accounts = store.accounts.filter((a) => String(a.uid) !== key)
  if (store.accounts.length === before) return false
  if (String(store.activeUid) === key) {
    store.activeUid = store.accounts[0]?.uid ? String(store.accounts[0].uid) : null
  }
  saveStore(store, filePath)
  return true
}

async function loginAndCacheAccount(account, filePath = getSessionStorePath()) {
  const key = `${filePath}:${account.uid}`
  if (loginInFlight.has(key)) return loginInFlight.get(key)
  const task = (async () => {
    const session = await login(account.uid, account.password)
    if (!session.serverUrl) {
      throw new Error(`Akun UID ${account.uid} belum punya serverUrl/region game. Login sekali lewat game Free Fire atau buat worker baru.`)
    }
    const updated = buildAccountRecord(account.uid, account.password, session, {
      nickname: account.nickname,
      region: account.region,
      autoCreated: account.autoCreated
    })
    upsertAccountRecord(updated, { setActive: false }, filePath)
    return updated
  })().finally(() => {
    loginInFlight.delete(key)
  })
  loginInFlight.set(key, task)
  return task
}

function markWorkerBanned(uid, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const key = String(uid)
  const target = store.accounts.find((a) => String(a.uid) === key)
  if (!target) return
  if (target.autoCreated) {
    removeWorkerAccount(key, filePath)
    return
  }
  target.banned = true
  target.token = null
  target.expiresAt = 0
  saveStore(store, filePath)
}

export async function addWorkerAccount(uid, password, { setActive = true } = {}, filePath = getSessionStorePath()) {
  const cleanUid = trim(uid)
  const cleanPassword = trim(password)
  if (!/^\d+$/.test(cleanUid) || !cleanPassword) {
    throw new Error('UID dan password akun Garena harus valid.')
  }
  const session = await login(cleanUid, cleanPassword)
  if (!session.serverUrl) {
    throw new Error('Akun berhasil login, tetapi belum memiliki serverUrl (belum masuk game/terikat region).')
  }
  const record = buildAccountRecord(cleanUid, cleanPassword, session, { autoCreated: false })
  upsertAccountRecord(record, { setActive }, filePath)
  return record
}

export async function createWorkerAccount({ nickname, region = 'ID', setActive = true, autoCreated = false } = {}, filePath = getSessionStorePath()) {
  const created = await createAccount({ nickname, region })
  if (!created?.session?.serverUrl) {
    throw new Error('Akun berhasil dibuat, namun serverUrl kosong.')
  }
  const record = buildAccountRecord(created.uid, created.password, created.session, {
    nickname: created.nickname,
    region: created.region,
    autoCreated
  })
  upsertAccountRecord(record, { setActive }, filePath)
  return { ...record, session: created.session }
}

async function bootstrapAutoWorker(region = 'ID', filePath = getSessionStorePath()) {
  if (!bootstrapInFlight) {
    bootstrapInFlight = createWorkerAccount({ region, setActive: true, autoCreated: true }, filePath).finally(() => {
      bootstrapInFlight = null
    })
  }
  return bootstrapInFlight
}

async function ensureActiveWorkerSession({ forceRefresh = false, autoBootstrap = true } = {}, filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const active = store.accounts.find((a) => String(a.uid) === String(store.activeUid)) || null
  const candidates = [
    ...(active ? [active] : []),
    ...store.accounts.filter((a) => String(a.uid) !== String(active?.uid) && !a.banned)
  ]

  let lastErr = null
  for (const acc of candidates) {
    if (!forceRefresh && isTokenFresh(acc)) {
      return toSessionObject(acc)
    }
    try {
      const refreshed = await loginAndCacheAccount(acc, filePath)
      if (String(refreshed.uid) !== String(store.activeUid)) {
        upsertAccountRecord(refreshed, { setActive: true }, filePath)
      }
      return toSessionObject(refreshed)
    } catch (err) {
      lastErr = err
      if (isPermanentAccountError(err)) {
        markWorkerBanned(acc.uid, filePath)
        continue
      }
      throw err
    }
  }

  if (!autoBootstrap) {
    throw lastErr || new Error('Belum ada akun worker Free Fire tersimpan. Owner bisa setup lewat .ffcreate atau .fflogin.')
  }

  const created = await bootstrapAutoWorker('ID', filePath)
  return toSessionObject(created)
}

async function withWorkerRetry(fn, filePath = getSessionStorePath()) {
  const session = await ensureActiveWorkerSession({ forceRefresh: false, autoBootstrap: true }, filePath)
  try {
    return await fn(session)
  } catch (err) {
    if (err?.status === 401 || /HTTP 401|signature is invalid|token/i.test(String(err?.message || ''))) {
      const freshSession = await ensureActiveWorkerSession({ forceRefresh: true, autoBootstrap: true }, filePath)
      return await fn(freshSession)
    }
    throw err
  }
}

export async function refreshActiveWorker(filePath = getSessionStorePath()) {
  const store = readStore(filePath)
  const account =
    store.accounts.find((a) => String(a.uid) === String(store.activeUid)) ||
    store.accounts[0] ||
    null
  if (!account) {
    throw new Error('Belum ada akun worker Free Fire tersimpan.')
  }
  try {
    return await loginAndCacheAccount(account, filePath)
  } catch (err) {
    if (account.autoCreated && isPermanentAccountError(err)) {
      removeWorkerAccount(account.uid, filePath)
      const replacement = await bootstrapAutoWorker(account.region || 'ID', filePath)
      return { ...replacement, rotated: true }
    }
    if (isPermanentAccountError(err)) {
      markWorkerBanned(account.uid, filePath)
    }
    throw err
  }
}

export async function searchPlayers(keyword, filePath = getSessionStorePath()) {
  const clean = trim(keyword)
  if (clean.length < 3) throw new Error('Nickname pencarian minimal 3 karakter.')
  return withWorkerRetry((session) => search(clean, session), filePath)
}

export async function stalkPlayer(accountId, { useLookup = true } = {}, filePath = getSessionStorePath()) {
  const id = parseAccountId(accountId)
  if (!id) throw new Error('UID Free Fire tidak valid (harus berupa angka).')

  const primary = await withWorkerRetry(async (session) => {
    try {
      const profile = await stalk(id, session)
      return { hit: true, profile, cluster: clusterOf(session), serverUrl: session.serverUrl, session }
    } catch (err) {
      if (/BR_ACCOUNT_NOT_FOUND/.test(String(err?.message || ''))) {
        return { hit: false, error: err, usedHost: session.serverUrl?.replace(/\/+$/, '') }
      }
      throw err
    }
  }, filePath)

  if (primary.hit) return primary

  if (useLookup) {
    const store = readStore(filePath)
    const others = store.accounts.filter((a) => {
      const host = String(a.serverUrl || '').replace(/\/+$/, '')
      return !host || host !== primary.usedHost
    })
    if (others.length > 0) {
      const sessions = []
      for (const acc of others) {
        try {
          const rec = isTokenFresh(acc) ? acc : await loginAndCacheAccount(acc, filePath)
          sessions.push(toSessionObject(rec))
        } catch {
          // Skip akun cluster yang gagal refresh agar tidak menggagalkan lookup lainnya
        }
      }
      if (sessions.length > 0) {
        const res = await lookup(id, sessions)
        if (res) {
          return {
            hit: true,
            profile: res.profile,
            cluster: res.cluster,
            serverUrl: res.serverUrl,
            session: res.session
          }
        }
      }
    }
  }

  throw new Error(`Akun UID \`${id}\` tidak ditemukan di cluster yang aktif (BR_ACCOUNT_NOT_FOUND).`)
}

export default {
  createGuest,
  lookup,
  createAccount,
  login,
  search,
  stalk,
  registerGame,
  getVersion,
  grantToken,
  encode,
  decode,
  parseAccountId,
  getSessionStorePath,
  listWorkerAccounts,
  setActiveWorkerAccount,
  removeWorkerAccount,
  addWorkerAccount,
  createWorkerAccount,
  searchPlayers,
  stalkPlayer
}
