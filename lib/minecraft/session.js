/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * lib/minecraft/session.js — Manajemen sesi pencarian/saran Minecraft per user (timeout 5 menit)
 */

const SESSIONS = (globalThis.HITORI_MC_SESSIONS ??= new Map())

export const SESSION_TIMEOUT = 5 * 60 * 1000

export function getSessionKey(jidOrCtx) {
  if (jidOrCtx && typeof jidOrCtx === 'object') {
    const candidate = jidOrCtx.senderNumber || jidOrCtx.sender || jidOrCtx.senderLid || ''
    return getSessionKey(candidate)
  }
  const raw = String(jidOrCtx || '')
  return raw.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') || raw.toLowerCase()
}

function getCandidateKeys(jidOrCtx) {
  if (!jidOrCtx || typeof jidOrCtx !== 'object') {
    return [getSessionKey(jidOrCtx)].filter(Boolean)
  }
  const rawList = [jidOrCtx.senderNumber, jidOrCtx.sender, jidOrCtx.senderLid]
  const keys = []
  for (const item of rawList) {
    if (!item) continue
    const k = getSessionKey(item)
    if (k && !keys.includes(k)) keys.push(k)
  }
  return keys
}

export function getSession(jidOrCtx) {
  for (const key of getCandidateKeys(jidOrCtx)) {
    const session = SESSIONS.get(key)
    if (!session) continue
    if (Date.now() - session.startedAt > SESSION_TIMEOUT) {
      clearSession(jidOrCtx)
      return null
    }
    return session
  }
  return null
}

export function setSession(jidOrCtx, data) {
  clearSession(jidOrCtx)
  const keys = getCandidateKeys(jidOrCtx)

  const timeout = setTimeout(() => {
    for (const k of keys) SESSIONS.delete(k)
  }, SESSION_TIMEOUT)
  timeout.unref?.()

  const record = {
    ...data,
    startedAt: Date.now(),
    timeout,
    keysBound: keys
  }

  for (const k of keys) SESSIONS.set(k, record)
  return record
}

export function clearSession(jidOrCtx) {
  for (const key of getCandidateKeys(jidOrCtx)) {
    const session = SESSIONS.get(key)
    if (session?.timeout) clearTimeout(session.timeout)
    if (session?.keysBound) {
      for (const boundKey of session.keysBound) SESSIONS.delete(boundKey)
    } else {
      SESSIONS.delete(key)
    }
  }
}
