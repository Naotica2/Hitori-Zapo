/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * connectionManager.js — Connection state & reconnection dengan backoff.
 */
import { logger } from '../core/logger.js'

let shuttingDown = false

export function markShutdown() {
  shuttingDown = true
}

export function setupConnection(client) {
  const MAX_RECONNECT_ATTEMPTS = 10
  let reconnectAttempt = 0
  let recoverFallbackTimer = null

  client.on('stream_failure', (e) => {
    if (shuttingDown) return
    logger.warn(`⚠️ Stream failure: ${e?.reason || e?.code || JSON.stringify(e)}`)
  })

  client.on('stanza_error', (e) => {
    if (shuttingDown) return
    logger.warn(`⚠️ Stanza error: ${e?.code || e?.text || JSON.stringify(e)}`)
  })

  client.on('connection', (event) => {
    if (shuttingDown) return // intentional close — diem aja

    if (event.status === 'open') {
      if (recoverFallbackTimer) {
        clearTimeout(recoverFallbackTimer)
        recoverFallbackTimer = null
      }
      logger.success(`🟢 Terhubung${event.isNewLogin ? ' (login baru)' : ''}`)
      reconnectAttempt = 0
      return
    }

    const reasonText = event.reason || 'unknown'
    const codeText = event.code != null ? `, code: ${event.code}` : ''
    logger.warn(`🔴 Koneksi terputus (reason: ${reasonText}${codeText}, isLogout: ${Boolean(event.isLogout)})`)

    if (event.isLogout) {
      logger.error('❌ Device di-unlink. Hapus folder session/ lalu jalankan ulang.')
      return
    }

    if (event.reason === 'failure_client_too_old') {
      logger.warn('🔄 Versi WA default kedaluwarsa (client_too_old) — auto-recover versi terbaru...')
      if (!recoverFallbackTimer) {
        recoverFallbackTimer = setTimeout(() => {
          recoverFallbackTimer = null
          if (!shuttingDown && !client.getState()?.connected) {
            void reconnectWithBackoff()
          }
        }, 12_000)
        recoverFallbackTimer.unref?.()
      }
      return
    }

    void reconnectWithBackoff()
  })

  async function reconnectWithBackoff() {
    if (shuttingDown) return
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(`❌ Menyerah setelah ${reconnectAttempt} percobaan reconnect.`)
      return
    }
    const delayMs = Math.min(30_000, 1_000 * 2 ** reconnectAttempt)
    reconnectAttempt += 1
    logger.info(`⏳ Reconnect dalam ${delayMs}ms (percobaan ke-${reconnectAttempt})`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      await client.connect()
    } catch (err) {
      logger.error({ err: err.message }, '❌ Reconnect gagal')
      void reconnectWithBackoff()
    }
  }
}
