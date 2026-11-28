/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * gempaWatcher.js — Broadcast otomatis info gempa BMKG ke grup yang mengaktifkan `.on autogempa`
 */
import { getSetting, listEnabledGroups, setSetting } from './groupSettings.js'
import { logger } from './logger.js'
import { downloadUrlBuffer } from '../lib/media.js'
import { getLatestGempa } from '../scraper/BMKG.js'

const POLL_MS = 3 * 60 * 1000
const META_JID = '__bmkg_meta__'
const META_KEY = 'last_autogempa_id'

let watcherTimer = null
let isChecking = false

async function checkAndBroadcast(client) {
  if (isChecking) return
  const groups = listEnabledGroups('autogempa')
  if (!groups.length) return

  isChecking = true
  try {
    const g = await getLatestGempa()
    const eventSig = `${g.dateTime || `${g.tanggal} ${g.jam}`}|${g.coordinates}|${g.magnitude}`
    const prevSig = getSetting(META_JID, META_KEY)

    // Pertama kali aktif: simpan baseline supaya tidak mengirim ulang gempa lama
    if (!prevSig) {
      setSetting(META_JID, META_KEY, eventSig)
      return
    }
    if (prevSig === eventSig) return

    setSetting(META_JID, META_KEY, eventSig)

    const caption = [
      '🚨 *PERINGATAN GEMPA TERBARU BMKG*',
      '',
      `• Waktu     : *${g.tanggal}, ${g.jam}*`,
      `• Magnitudo : *M ${g.magnitude}*`,
      `• Kedalaman : *${g.kedalaman}*`,
      `• Koordinat : ${g.lintang}, ${g.bujur}`,
      `• Wilayah   : *${g.wilayah}*`,
      `• Potensi   : ${g.potensi}`,
      ...(g.dirasakan && g.dirasakan !== '-' ? [`• Dirasakan : ${g.dirasakan}`] : []),
      '',
      '> _Notifikasi otomatis BMKG (.off autogempa untuk matikan)_'
    ].join('\n')

    let mapBuf = null
    if (g.shakemapUrl) {
      try {
        mapBuf = await downloadUrlBuffer(g.shakemapUrl, { timeout: 15_000, maxBytes: 8 * 1024 * 1024 })
      } catch {}
    }

    for (const jid of groups) {
      try {
        if (mapBuf) {
          await client.message.send(jid, { type: 'image', media: mapBuf, mimetype: 'image/jpeg', caption })
        } else {
          await client.message.send(jid, caption)
        }
      } catch (err) {
        logger.warn({ err: err?.message, jid }, '⚠️ [autogempa] Gagal kirim notifikasi gempa ke grup')
      }
    }
  } catch (err) {
    logger.debug({ err: err?.message }, '⚠️ [autogempa] Gagal cek update BMKG')
  } finally {
    isChecking = false
  }
}

export function startGempaWatcher(client) {
  stopGempaWatcher()
  setTimeout(() => {
    void checkAndBroadcast(client)
  }, 15_000)
  watcherTimer = setInterval(() => {
    void checkAndBroadcast(client)
  }, POLL_MS)
  watcherTimer.unref?.()
}

export function stopGempaWatcher() {
  if (watcherTimer) {
    clearInterval(watcherTimer)
    watcherTimer = null
  }
}
