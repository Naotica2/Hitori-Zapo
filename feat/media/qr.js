/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * qr.js — Generator QR Code kustom (teks, URL, Wi-Fi, warna, & overlay logo tengah)
 */
import QRCode from 'qrcode'
import sharp from 'sharp'
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'

const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function normalizeHex(val, fallback) {
  if (!val) return fallback
  const raw = String(val).trim()
  if (!HEX_RE.test(raw)) return fallback
  const clean = raw.replace(/^#/, '')
  if (clean.length === 3) {
    return '#' + clean.split('').map((c) => c + c).join('')
  }
  return '#' + clean
}

function parseQrArgs(raw) {
  let text = String(raw || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let dark = '#000000'
  let light = '#ffffff'
  let wifiMode = false
  let size = 600

  text = text.replace(/(^|\s)--(?:fg|dark|color)(?:=|\s+)(\S+)/gi, (_, lead, val) => {
    dark = normalizeHex(val, dark)
    return lead
  })
  text = text.replace(/(^|\s)--(?:bg|light)(?:=|\s+)(\S+)/gi, (_, lead, val) => {
    light = normalizeHex(val, light)
    return lead
  })
  text = text.replace(/(^|\s)--wifi\b/gi, (_, lead) => {
    wifiMode = true
    return lead
  })
  text = text.replace(/(^|\s)--size(?:=|\s+)(\d+)\b/gi, (_, lead, val) => {
    const n = Number.parseInt(val, 10)
    if (Number.isFinite(n)) size = Math.max(256, Math.min(n, 1200))
    return lead
  })

  return { dark, light, wifiMode, size, payload: text.trim() }
}

function escapeWifiField(str) {
  return String(str || '').replace(/([\\;,:"'])/g, '\\$1')
}

export default {
  name: 'qr',
  aliases: ['qrcode', 'makeqr', 'qrgen'],
  tags: 'media',
  cooldown: 3000,
  description: 'Buat gambar QR Code dari teks, URL, atau konfigurasi Wi-Fi (dukung overlay logo)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    if (!raw || /^help$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '📱 *QR CODE GENERATOR*\n\n' +
          '*Contoh:*\n' +
          `• *${p}qr https://whatsapp.com*\n` +
          `• *${p}qr --fg #1e40af --bg #f8fafc Halo Dunia*\n` +
          `• *${p}qr --wifi NamaWifi | PasswordWifi | WPA*\n` +
          '• Reply gambar dengan caption `' +
          `${p}qr https://linkmu.id` +
          '` untuk menaruh logo di tengah QR!',
        sendOpts
      )
    }

    const { dark, light, wifiMode, size, payload } = parseQrArgs(raw)
    if (!payload) {
      return ctx.client.message.send(ctx.chat, `❌ Teks atau URL QR tidak boleh kosong.`, sendOpts)
    }

    let finalContent = payload
    let displayNote = payload
    if (wifiMode) {
      const [ssid = '', pass = '', auth = 'WPA'] = payload.split('|').map((s) => s.trim())
      if (!ssid) {
        return ctx.client.message.send(ctx.chat, `❌ Format Wi-Fi: *${p}qr --wifi SSID | Password | WPA*`, sendOpts)
      }
      const sec = /^(nopass|none|open)$/i.test(auth) || !pass ? 'nopass' : /^wep$/i.test(auth) ? 'WEP' : 'WPA'
      finalContent = `WIFI:T:${sec};S:${escapeWifiField(ssid)};P:${sec === 'nopass' ? '' : escapeWifiField(pass)};;`
      displayNote = `Wi-Fi SSID: *${ssid}* (${sec})`
    }

    if (finalContent.length > 1800) {
      return ctx.client.message.send(ctx.chat, '❌ Teks terlalu panjang untuk QR Code (maks 1800 karakter).', sendOpts)
    }

    await ctx.react('⏳')
    try {
      let qrBuf = await QRCode.toBuffer(finalContent, {
        type: 'png',
        width: size,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark, light }
      })

      const { targetMessage, payload: mediaPayload } = resolveTargetMedia(ctx)
      const mime = String(mediaPayload?.mimetype || '')
      if (targetMessage && mediaPayload && (mediaPayload.mediaType === 'image' || mediaPayload.mediaType === 'sticker' || mime.startsWith('image/'))) {
        try {
          const logoRaw = await downloadTargetBuffer(targetMessage)
          const logoSize = Math.round(size * 0.22)
          const padSize = logoSize + 14
          const logoResized = await sharp(logoRaw, { pages: 1 })
            .resize(logoSize, logoSize, { fit: 'cover' })
            .png()
            .toBuffer()

          const badge = await sharp({
            create: {
              width: padSize,
              height: padSize,
              channels: 4,
              background: light
            }
          })
            .composite([{ input: logoResized, gravity: 'center' }])
            .png()
            .toBuffer()

          qrBuf = await sharp(qrBuf)
            .composite([{ input: badge, gravity: 'center' }])
            .png()
            .toBuffer()
        } catch {}
      }

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: qrBuf,
          mimetype: 'image/png',
          caption: `📱 *QR Code Siap Dipindai*\n• Isi: ${displayNote.slice(0, 180)}`
        },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ Gagal membuat QR Code: ${String(err?.message || err).slice(0, 200)}`, sendOpts)
    }
  }
}
