/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * GETCONTACT.js — Getcontact API v2.8 & VerifyKit v2.0 client (Diffie-Hellman + AES-256-ECB + HMAC-SHA256)
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SESSION_DIR = path.join(ROOT, 'session')

const getSessionFilePath = () =>
  process.env.GETCONTACT_SESSION_FILE || path.join(SESSION_DIR, 'getcontact_session.json')
const getPendingFilePath = () =>
  process.env.GETCONTACT_PENDING_FILE || path.join(SESSION_DIR, 'getcontact_pending.json')

const GTC_BASE = 'https://pbssrv-centralevents.com'
const VFK_BASE = 'https://api.verifykit.com'
const HMAC_KEY =
  '31426764382a642f3a6665497235466f3d236d5d785b722b4c657457442a495b494524324866782a2364292478587a78662d7a7b7578593f71703e2b7e365762'
const VFK_HMAC_KEY =
  '3452235d713252604a35562d325f765238695738485863672a705e6841544d3c7e6e45463028266f372b544e596f3829236b392825262e534a7e774f37653932'
const VFK_CLIENT_KEY = 'bhvbd7ced119dc6ad6a0b35bd3cf836555d6f71930d9e5a405f32105c790d'
const VFK_FINAL_KEY = 'bd48d8c25293cfb537619cc93ae3d6e372eb2ddfffff4ab0eb000777144c7bfa'
const BUNDLE_ID = 'app.source.getcontact'
const DH_P = 900719898367n
const DH_G = 7n
const APP_VERSION = '8.4.0'
const ANDROID_OS = 'android 9'
const LANG = 'en_US'
const COUNTRY = 'id'
const DEFAULT_TIMEOUT_MS = 15_000

function modPow(base, exp, mod) {
  let res = 1n
  base = base % mod
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % mod
    base = (base * base) % mod
    exp = exp / 2n
  }
  return res
}

function dhKeypair() {
  const priv = BigInt(Math.floor(Math.random() * 99_000_000) + 1_000_000)
  const pub = modPow(DH_G, priv, DH_P)
  return { priv, pub: Number(pub) }
}

function dhFinalKey(priv, serverPub) {
  const shared = modPow(BigInt(serverPub), priv, DH_P)
  return createHash('sha256').update(shared.toString()).digest('hex')
}

function signRequest(ts, message, keyHex) {
  return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(`${ts}-${message}`).digest('base64')
}

function encryptPayload(text, keyHex) {
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(keyHex, 'hex'), null)
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64')
}

function decryptPayload(b64, keyHex) {
  const decipher = createDecipheriv('aes-256-ecb', Buffer.from(keyHex, 'hex'), null)
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf8')
}

function writeJsonAtomic(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Nomor telepon wajib diisi')
  const cleaned = raw.trim().replace(/[^\d+]/g, '')
  if (!cleaned || cleaned.replace(/\+/g, '').length < 7) {
    throw new Error('Format nomor telepon tidak valid')
  }
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('0')) return `+62${cleaned.slice(1)}`
  if (cleaned.startsWith('62')) return `+${cleaned}`
  return `+${cleaned}`
}

export function saveSession(creds, filePath = getSessionFilePath()) {
  writeJsonAtomic(filePath, creds)
}

export function loadSession(filePath = getSessionFilePath()) {
  return readJsonSafe(filePath)
}

async function parseEncryptedJson(res, keyHex) {
  const rawText = await res.text()
  let json = null
  try {
    json = JSON.parse(rawText)
  } catch {
    throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 180)}`)
  }
  if (json?.data && typeof json.data === 'string') {
    try {
      return { status: res.status, data: JSON.parse(decryptPayload(json.data, keyHex)) }
    } catch {
      return { status: res.status, data: json }
    }
  }
  return { status: res.status, data: json }
}

async function vfkCall(endpoint, payload, deviceId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const raw = JSON.stringify(payload)
  const ts = String(Date.now())
  const signature = signRequest(ts, raw, VFK_HMAC_KEY)

  const res = await fetch(`${VFK_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-VFK-Client-Device-Id': deviceId,
      'X-VFK-Client-Key': VFK_CLIENT_KEY,
      'X-VFK-Sdk-Version': '0.11.4',
      'X-VFK-Os': 'android 9.0',
      'X-VFK-App-Version': '8.16.0',
      'X-VFK-Encrypted': '1',
      'X-VFK-Lang': 'in_ID',
      'X-VFK-Req-Timestamp': ts,
      'X-VFK-Req-Signature': signature
    },
    body: JSON.stringify({ data: encryptPayload(raw, VFK_FINAL_KEY) }),
    signal: AbortSignal.timeout(timeoutMs)
  })

  return parseEncryptedJson(res, VFK_FINAL_KEY)
}

async function gtcCall(endpoint, payload, { token, finalKey, clientDeviceId }, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const raw = JSON.stringify(payload)
  const ts = String(Date.now())
  const signature = signRequest(ts, raw, HMAC_KEY)

  const res = await fetch(`${GTC_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-os': ANDROID_OS,
      'x-app-version': APP_VERSION,
      'x-client-device-id': clientDeviceId,
      'x-lang': LANG,
      'x-req-timestamp': ts,
      'x-country-code': COUNTRY,
      'x-encrypted': '1',
      'x-req-signature': signature,
      'x-token': token,
      'User-Agent': 'okhttp/4.12.0'
    },
    body: JSON.stringify({ data: encryptPayload(raw, finalKey) }),
    signal: AbortSignal.timeout(timeoutMs)
  })

  return parseEncryptedJson(res, finalKey)
}

function assertGtcOk(res) {
  const meta = res.data?.meta
  if (meta && meta.httpStatusCode !== 200) {
    const code = meta.errorCode || meta.httpStatusCode || res.status
    const msg = meta.errorMessage || `HTTP error ${res.status}`
    throw new Error(`[Getcontact ${code}] ${msg}`)
  }
  if (res.status >= 400) {
    const msg = meta?.errorMessage || res.data?.message || `HTTP ${res.status}`
    throw new Error(`[Getcontact ${res.status}] ${msg}`)
  }
}

export async function initAuth(phoneNumber, options = {}) {
  const phone = normalizePhone(phoneNumber)
  const deviceId = options.clientDeviceId || randomBytes(8).toString('hex')
  const { priv, pub } = dhKeypair()
  const ts = String(Date.now())
  const pendingPath = options.pendingFile || getPendingFilePath()

  const regBody = {
    carrierCountryCode: '510',
    carrierName: 'Indosat Ooredoo',
    carrierNetworkCode: '01',
    countryCode: COUNTRY,
    deepLink: null,
    deviceName: 'SM-G977N',
    deviceType: 'Android',
    email: null,
    notificationToken: '',
    oldToken: null,
    peerKey: pub,
    timeZone: 'Asia/Bangkok',
    token: ''
  }

  const raw = JSON.stringify(regBody)
  const signature = signRequest(ts, raw, HMAC_KEY)

  const res = await fetch(`${GTC_BASE}/v2.8/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-os': ANDROID_OS,
      'x-app-version': APP_VERSION,
      'x-client-device-id': deviceId,
      'x-lang': LANG,
      'x-req-timestamp': ts,
      'x-country-code': COUNTRY,
      'x-encrypted': '0',
      'x-req-signature': signature,
      'User-Agent': 'okhttp/4.12.0'
    },
    body: raw,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  })

  const regJson = await res.json().catch(() => null)
  if (res.status !== 201 || !regJson?.result?.token || !regJson?.result?.serverKey) {
    throw new Error(regJson?.meta?.errorMessage || `Registrasi gagal: HTTP ${res.status}`)
  }

  const token = regJson.result.token
  const finalKey = dhFinalKey(priv, regJson.result.serverKey)
  const common = { token, finalKey, clientDeviceId: deviceId }

  const base = {
    carrierCountryCode: '510',
    carrierName: 'Indosat Ooredoo',
    carrierNetworkCode: '01',
    countryCode: COUNTRY,
    deviceName: 'SM-G977N',
    notificationToken: '',
    timeZone: 'Asia/Bangkok',
    token
  }

  await gtcCall('/v2.8/init-basic', base, common)
  await gtcCall('/v2.8/ad-settings', { source: 'init', token }, common)
  await gtcCall('/v2.8/init-intro', { ...base, hasRouting: false }, common)
  await gtcCall('/v2.8/country', { countryCode: 'ID', token }, common)
  await gtcCall(
    '/v2.8/validation-start',
    { app: 'verifykit', countryCode: COUNTRY, notificationToken: '', token },
    common
  )

  await vfkCall(
    '/v2.0/init',
    {
      isCallPermissionGranted: true,
      countryCode: 'ID',
      deviceName: 'SM-G977N',
      installedApps: '{"whatsapp":0,"telegram":0,"viber":0}',
      outsideCountryCode: 'ID',
      outsidePhoneNumber: phone,
      timezone: 'Asia/Bangkok',
      bundleId: BUNDLE_ID
    },
    deviceId
  )

  await vfkCall('/v2.0/country', { countryCode: 'ID', bundleId: BUNDLE_ID }, deviceId)

  const startRes = await vfkCall(
    '/v2.0/start',
    {
      countryCode: 'ID',
      mcc: '510',
      mnc: '01',
      phoneNumber: phone,
      app: 'whatsapp',
      bundleId: BUNDLE_ID
    },
    deviceId
  )

  const deeplink = startRes.data?.result?.deeplink
  const reference = startRes.data?.result?.reference
  if (!deeplink || !reference) {
    throw new Error(startRes.data?.meta?.errorMessage || 'Gagal memulai sesi VerifyKit')
  }

  const session = {
    phoneNumber: phone,
    clientDeviceId: deviceId,
    token,
    finalKey,
    reference,
    deeplink,
    createdAt: Date.now()
  }

  writeJsonAtomic(pendingPath, session)
  return session
}

export async function checkAuth(input = null, options = {}) {
  const save = options.save !== false
  const sessionPath = options.sessionFile || getSessionFilePath()
  const pendingPath = options.pendingFile || getPendingFilePath()

  const session =
    input && typeof input === 'object' && input.reference && input.token
      ? input
      : readJsonSafe(pendingPath)

  if (!session || !session.reference || !session.token) {
    throw new Error('Sesi pending tidak ditemukan. Jalankan .gtcauth <nomor> terlebih dahulu.')
  }

  const checkRes = await vfkCall(
    '/v2.0/check',
    { reference: session.reference, bundleId: BUNDLE_ID },
    session.clientDeviceId
  )

  const sessionId = checkRes.data?.result?.sessionId
  if (!sessionId) {
    return {
      verified: false,
      message: 'Belum terverifikasi. Pastikan pesan verifikasi WhatsApp ke VerifyKit sudah terkirim (centang dua).'
    }
  }

  const resultRes = await gtcCall(
    '/v2.8/verifykit-result',
    { sessionId, token: session.token },
    session
  )
  assertGtcOk(resultRes)

  const validationDate = resultRes.data?.result?.validationDate
  if (!validationDate) {
    throw new Error(resultRes.data?.meta?.errorMessage || 'Gagal mengonfirmasi hasil VerifyKit')
  }

  const credentials = {
    phoneNumber: session.phoneNumber,
    clientDeviceId: session.clientDeviceId,
    token: session.token,
    finalKey: session.finalKey,
    validationDate
  }

  if (save) saveSession(credentials, sessionPath)
  try {
    unlinkSync(pendingPath)
  } catch {}

  return {
    verified: true,
    credentials,
    message: 'Nomor berhasil diverifikasi dan kredensial disimpan!'
  }
}

export function resolveCreds(customCreds = null, sessionFile = getSessionFilePath()) {
  if (customCreds?.token && customCreds?.finalKey && customCreds?.clientDeviceId) {
    return customCreds
  }
  const saved = loadSession(sessionFile)
  if (saved?.token && saved?.finalKey && saved?.clientDeviceId) {
    return saved
  }
  if (process.env.GTC_TOKEN && process.env.GTC_FINAL_KEY && process.env.GTC_DEVICE_ID) {
    return {
      token: process.env.GTC_TOKEN,
      finalKey: process.env.GTC_FINAL_KEY,
      clientDeviceId: process.env.GTC_DEVICE_ID
    }
  }
  throw new Error('Sesi Getcontact belum ada. Jalankan .gtcauth <nomor> lalu .gtccheck.')
}

export async function search(phoneNumber, customCreds = null) {
  const creds = resolveCreds(customCreds)
  const phone = normalizePhone(phoneNumber)
  const res = await gtcCall(
    '/v2.8/search',
    { countryCode: COUNTRY, phoneNumber: phone, source: 'search', token: creds.token },
    creds
  )
  assertGtcOk(res)

  const d = res.data?.result || {}
  const profile = d.profile || {}
  return {
    phone,
    name: profile.name || '',
    surname: profile.surname || '',
    displayName: profile.displayName || '',
    email: profile.email || '',
    tagCount: profile.tagCount || 0,
    tags: (d.tags || []).map((t) => ({
      tag: t.tag,
      count: t.count || 1
    }))
  }
}

export async function getTags(phoneNumber, customCreds = null) {
  const creds = resolveCreds(customCreds)
  const phone = normalizePhone(phoneNumber)
  const res = await gtcCall(
    '/v2.8/number-detail',
    { countryCode: COUNTRY, phoneNumber: phone, source: 'profile', token: creds.token },
    creds
  )
  assertGtcOk(res)

  const d = res.data?.result || {}
  return (d.tags || []).map((t) => ({
    tag: t.tag,
    count: t.count || 1
  }))
}

export async function getQuota(customCreds = null) {
  const creds = resolveCreds(customCreds)
  const res = await gtcCall('/v2.8/subscription', { token: creds.token }, creds)
  assertGtcOk(res)

  const usage = res.data?.result?.subscriptionInfo?.usage || {}
  return {
    renewDate: res.data?.result?.subscriptionInfo?.renewDate || '',
    searchRemaining: usage.search?.remainingCount ?? 0,
    searchLimit: usage.search?.limit ?? 0,
    detailRemaining: usage.numberDetail?.remainingCount ?? 0,
    detailLimit: usage.numberDetail?.limit ?? 0
  }
}

/**
 * Gabungan search + tags: selalu kembalikan profil dasar meski endpoint number-detail terkena limit/VIP.
 */
export async function lookupNumber(phoneNumber, customCreds = null) {
  const info = await search(phoneNumber, customCreds)
  let tagsError = ''

  if (info.tagCount > 0 && info.tags.length === 0) {
    try {
      const detailTags = await getTags(info.phone, customCreds)
      if (detailTags.length) info.tags = detailTags
    } catch (err) {
      tagsError = err?.message || String(err)
    }
  }

  return { ...info, tagsError }
}

export default {
  normalizePhone,
  saveSession,
  loadSession,
  resolveCreds,
  initAuth,
  checkAuth,
  search,
  getTags,
  getQuota,
  lookupNumber
}
