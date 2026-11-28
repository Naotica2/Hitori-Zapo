/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tema.js — Ubah / reset Shared Chat Theme & wallpaper chat/grup (CHAT_THEME_SETTING)
 */
import { isGroupAdmin } from '../../core/permission.js'
import { logger } from '../../core/logger.js'
import {
  downloadTargetBuffer,
  extractTextFromMessage,
  getQuotedMessage,
  resolveTargetMedia
} from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import {
  COLOR_SCHEME_PRESETS,
  SOLID_COLOR_PRESETS,
  clearChatTheme,
  normalizeDimLevel,
  normalizeHexColor,
  setChatTheme
} from '../../lib/chatTheme.js'

const MAX_URL_BYTES = 15 * 1024 * 1024
const MAX_HTML_BYTES = 256 * 1024
const MAX_REDIRECTS = 5
const IMAGE_DOC_EXT_RE = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i

const HELP_TEXT =
  '🎨 *SHARED CHAT THEME (`.tema`)*\n\n' +
  'Mengirim pengaturan *Shared Chat Themes* (`CHAT_THEME_SETTING`) ke chat/grup ini.\n\n' +
  '*Pakai Gambar / Link:*\n' +
  '• Kirim / reply gambar dengan `.tema`\n' +
  '• `.tema https://example.com/wallpaper.jpg`\n' +
  '• `.tema <url> --dim 30 --scheme blue`\n' +
  '• `.tema --full` (pakai blur 9:16 tanpa crop gambar)\n\n' +
  '*Pakai Preset / Warna:*\n' +
  '• `.tema blue` / `green` / `emerald` / `purple` / `pink` / `red` / `minimal`\n' +
  '• `.tema --solid #1E293B` (atau `.tema --solid biru`)\n' +
  '• `.tema --scheme Royal-Blue@Tonal --nodoodle`\n\n' +
  '*Lainnya:*\n' +
  '• `.tema reset` / `.resettema` — kembalikan ke default\n' +
  '• `.tema list` — daftar preset warna & tema\n' +
  '• `.tema info` — cek tipe grup & status admin bot\n\n' +
  '_Catatan penting: Shared Chat Themes masih fitur beta/rollout bertahap di WhatsApp. Pada akun/versi WhatsApp (mobile/web) yang belum kebagian fitur ini, pesan protokol akan diabaikan diam-diam._'

function buildPresetListText() {
  const seenSchemes = new Map()
  for (const [alias, preset] of Object.entries(COLOR_SCHEME_PRESETS)) {
    if (!seenSchemes.has(preset.id)) {
      seenSchemes.set(preset.id, { aliases: [alias], label: preset.label, id: preset.id })
    } else {
      seenSchemes.get(preset.id).aliases.push(alias)
    }
  }
  const schemes = [...seenSchemes.values()]
    .map((entry) => `• *${entry.aliases.join('/')}* → \`${entry.id}\` (${entry.label})`)
    .join('\n')

  const seenSolids = new Map()
  for (const [alias, hex] of Object.entries(SOLID_COLOR_PRESETS)) {
    const key = `${hex.light}/${hex.dark}`
    if (!seenSolids.has(key)) seenSolids.set(key, [])
    seenSolids.get(key).push(alias)
  }
  const solids = [...seenSolids.values()].map((aliases) => aliases[0]).join(', ')

  return (
    '🎨 *DAFTAR PRESET `.tema`*\n\n' +
    `*Color Scheme / Tema:*\n${schemes}\n\n` +
    `*Warna Solid (\`--solid\`):*\n${solids}\nAtau hex bebas: \`--solid #102030\`\n\n` +
    '*Opsi tambahan:*\n' +
    '• `--dim 0..100` — atur tingkat redup gambar\n' +
    '• `--full` / `--blur` — mode blur 9:16 tanpa crop\n' +
    '• `--doodle` / `--nodoodle` — nyala/matikan pola doodle'
  )
}

async function readResponseUpTo(res, maxBytes, limitErrorMsg) {
  const cl = Number(res.headers.get('content-length') || 0)
  if (cl > maxBytes) {
    throw new Error(limitErrorMsg(cl))
  }

  if (!res.body) {
    return Buffer.alloc(0)
  }

  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(limitErrorMsg(total))
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

function extractMetaImageUrl(html, baseUrl) {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/i
  ]
  for (const re of patterns) {
    const match = html.match(re)
    if (match?.[1]) {
      const decoded = match[1].replace(/&amp;/gi, '&').trim()
      try {
        return new URL(decoded, baseUrl).toString()
      } catch {
        return null
      }
    }
  }
  return null
}

async function downloadSafeImageUrl(rawUrl, allowHtmlFallback = true) {
  let currentUrl = String(rawUrl || '').trim()

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safeUrl = await assertSafePublicUrl(currentUrl)
    const res = await fetch(safeUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000)
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel?.().catch(() => undefined)
      if (!loc) throw new Error(`Redirect HTTP ${res.status} tanpa Location.`)
      currentUrl = new URL(loc, safeUrl).toString()
      continue
    }

    if (!res.ok) {
      await res.body?.cancel?.().catch(() => undefined)
      throw new Error(`HTTP ${res.status} saat unduh gambar`)
    }

    const ct = String(res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('text/html') || ct.includes('application/xhtml')) {
      if (allowHtmlFallback) {
        try {
          const htmlBuf = await readResponseUpTo(
            res,
            MAX_HTML_BYTES,
            () => 'Halaman HTML terlalu besar untuk di-scan gambar'
          )
          const ogUrl = extractMetaImageUrl(htmlBuf.toString('utf8'), safeUrl)
          if (ogUrl) {
            return await downloadSafeImageUrl(ogUrl, false)
          }
        } catch (err) {
          if (!String(err?.message || '').includes('terlalu besar')) throw err
        }
      } else {
        await res.body?.cancel?.().catch(() => undefined)
      }
      throw new Error('URL mengarah ke halaman web (HTML), bukan direct link file gambar (.jpg/.png/.webp).')
    }

    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream') && !ct.includes('binary')) {
      await res.body?.cancel?.().catch(() => undefined)
      throw new Error(`URL bukan gambar (Content-Type: ${ct.split(';')[0]})`)
    }

    const buf = await readResponseUpTo(
      res,
      MAX_URL_BYTES,
      (bytes) => `Ukuran gambar terlalu besar (${(bytes / 1024 / 1024).toFixed(1)} MB, maks 15 MB)`
    )
    if (!buf.length) throw new Error('File gambar dari URL kosong')
    return buf
  }

  throw new Error('Terlalu banyak redirect pada URL gambar')
}

function cleanExtractedUrl(raw) {
  return String(raw || '').trim().replace(/[),.!?<>'"]+$/, '')
}

function parseTemaArgs(rawText) {
  // Normalisasi em-dash / en-dash dari keyboard HP agar --full / --dim terbaca normal
  let text = String(rawText || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  const opts = {
    scheme: undefined,
    solid: undefined,
    dim: undefined,
    doodle: undefined,
    stock: undefined,
    fit: 'cover',
    upload: 'image',
    url: undefined
  }

  const urlMatch = text.match(/https?:\/\/\S+/i)
  if (urlMatch) {
    opts.url = cleanExtractedUrl(urlMatch[0])
    text = text.replace(urlMatch[0], ' ')
  }

  text = text.replace(/(^|\s)--(scheme|tema|color|solid|dim|stock|fit|upload)(?:=|\s+)(\S+)/gi, (_, lead, k, v) => {
    const key = k.toLowerCase()
    if (key === 'scheme' || key === 'tema') opts.scheme = v
    else if (key === 'color' || key === 'solid') opts.solid = v
    else if (key === 'dim') opts.dim = v
    else if (key === 'stock') opts.stock = v
    else if (key === 'fit') opts.fit = v.toLowerCase() === 'blur' || v.toLowerCase() === 'full' ? 'blur' : 'cover'
    else if (key === 'upload') {
      const u = v.toLowerCase()
      opts.upload = u === 'wp' || u === 'wallpaper' ? 'wallpaper' : u === 'wpkey' ? 'wpkey' : 'image'
    }
    return lead
  })

  text = text.replace(/(^|\s)--(no-?doodle|doodle|full|blur|cover|wp)\b/gi, (_, lead, flag) => {
    const f = flag.toLowerCase()
    if (f === 'full' || f === 'blur') opts.fit = 'blur'
    else if (f === 'cover') opts.fit = 'cover'
    else if (f === 'wp') opts.upload = 'wallpaper'
    else opts.doodle = !f.startsWith('no')
    return lead
  })

  const remaining = text.trim()
  return { opts, remaining }
}

function digitsOnly(jid) {
  return String(jid || '').split('@')[0].split(':')[0]
}

function isUsableImageTarget(message, payload) {
  if (!payload || payload.mediaType === 'sticker') return false
  if (String(payload.mimetype || '').startsWith('image/')) return true
  if (payload.mediaType === 'document') {
    const docName =
      message?.documentMessage?.fileName ||
      message?.documentWithCaptionMessage?.message?.documentMessage?.fileName ||
      message?.ephemeralMessage?.message?.documentMessage?.fileName ||
      ''
    return IMAGE_DOC_EXT_RE.test(String(docName))
  }
  return false
}

async function inspectGroupStatus(ctx) {
  try {
    const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
    const creds = ctx.client.getCredentials?.() ?? ctx.client.auth?.getCurrentCredentials?.()
    const myIds = new Set([creds?.meJid, creds?.meLid].filter(Boolean).map(digitsOnly))
    const botParticipant = (meta.participants ?? []).find((p) => {
      const ids = [p.jid, p.lid, p.phoneNumber].filter(Boolean).map(digitsOnly)
      return ids.some((id) => myIds.has(id))
    })

    const botIsAdmin = Boolean(botParticipant?.isAdmin || botParticipant?.isSuperAdmin)
    const groupKind = meta.defaultSubgroup
      ? 'Grup Announcement Komunitas'
      : meta.isParentGroup
        ? 'Parent Komunitas'
        : 'Grup Reguler'

    return {
      subject: meta.subject,
      groupKind,
      announce: Boolean(meta.announce),
      restrict: Boolean(meta.restrict),
      defaultSubgroup: Boolean(meta.defaultSubgroup),
      botIsAdmin
    }
  } catch {
    return null
  }
}

export default {
  name: 'tema',
  aliases: ['settema', 'settheme', 'theme', 'wallpapergrup', 'wpgc', 'resettema', 'cleartema'],
  tags: 'group',
  description: 'Ganti atau reset Shared Chat Theme & wallpaper grup/chat',

  async run(ctx) {
    if (ctx.isGroup && !(await isGroupAdmin(ctx))) {
      return ctx.reply('🚫 Di grup, perintah ini khusus Admin grup / Staff bot.')
    }

    const cmd = (ctx.command || 'tema').toLowerCase()
    const raw = (ctx.text || '').trim()
    const { opts, remaining } = parseTemaArgs(raw)
    const firstWord = (remaining.split(/\s+/)[0] || '').toLowerCase()

    if (firstWord === 'list' || firstWord === 'preset' || firstWord === 'presets') {
      return ctx.reply(buildPresetListText())
    }

    if (firstWord === 'help' || firstWord === '?') {
      return ctx.reply(HELP_TEXT)
    }

    if (firstWord === 'info' || firstWord === 'cek' || firstWord === 'status') {
      if (!ctx.isGroup) {
        return ctx.reply('💬 Chat pribadi: `.tema` langsung bisa dipakai (efek terlihat jika kedua perangkat sudah mendapat rollout *Shared Chat Themes* WhatsApp).')
      }
      const st = await inspectGroupStatus(ctx)
      if (!st) {
        return ctx.reply('⚠️ Gagal membaca metadata grup saat ini.')
      }
      return ctx.reply(
        '🔍 *STATUS TEMA GRUP*\n\n' +
        `• Nama: *${st.subject}*\n` +
        `• Tipe: *${st.groupKind}*\n` +
        `• Mode hanya admin kirim pesan: ${st.announce ? '🔒 Ya' : '🔓 Tidak'}\n` +
        `• Batasi edit info grup: ${st.restrict ? '🔒 Ya' : '🔓 Tidak'}\n` +
        `• Status Bot: ${st.botIsAdmin ? '✅ Admin' : '👤 Member biasa'}`
      )
    }

    let groupStatus = null
    if (ctx.isGroup) {
      groupStatus = await inspectGroupStatus(ctx)
      if (groupStatus?.announce && !groupStatus.botIsAdmin) {
        return ctx.reply('🔒 Grup ini dalam mode *Announcement* (hanya admin yang bisa mengirim pesan). Jadikan bot admin dulu ya, Kak.')
      }
    }

    const isResetCmd =
      cmd === 'resettema' ||
      cmd === 'cleartema' ||
      ['reset', 'clear', 'hapus', 'off', 'default'].includes(firstWord)

    if (isResetCmd) {
      await ctx.react('⏳')
      try {
        await clearChatTheme(ctx.client, ctx.chat)
        await ctx.react('✅')
        return ctx.reply('🧹 Sinyal reset Shared Chat Theme (`clearTheme`) berhasil dikirim ke server WhatsApp.')
      } catch (err) {
        await ctx.react('❎')
        return ctx.reply(`😵 Gagal reset tema: ${String(err?.message || err).slice(0, 140)}`)
      }
    }

    // Prioritas gambar: (1) gambar dikirim langsung, (2) URL eksplisit di argumen, (3) gambar di pesan quoted, (4) URL di pesan quoted
    const { rawMessage, quoted, selfPayload, quotedPayload } = resolveTargetMedia(ctx)
    const hasSelfImage = isUsableImageTarget(rawMessage, selfPayload)
    const hasQuotedImage = isUsableImageTarget(quoted, quotedPayload)

    let imageSource = null
    if (hasSelfImage) {
      imageSource = { kind: 'media', message: rawMessage }
    } else if (opts.url) {
      imageSource = { kind: 'url', url: opts.url }
    } else if (hasQuotedImage) {
      imageSource = { kind: 'media', message: quoted }
    } else {
      const quotedText = extractTextFromMessage(quoted)
      const qUrl = quotedText.match(/https?:\/\/\S+/i)?.[0]
      if (qUrl) {
        imageSource = { kind: 'url', url: cleanExtractedUrl(qUrl) }
      }
    }

    // Tolak secara eksplisit bila target satu-satunya hanyalah stiker
    const targetedStickerOnly =
      !imageSource &&
      !opts.scheme &&
      !opts.solid &&
      !opts.stock &&
      (selfPayload?.mediaType === 'sticker' || quotedPayload?.mediaType === 'sticker')
    if (targetedStickerOnly) {
      return ctx.reply('⚠️ Stiker tidak bisa dipakai sebagai wallpaper tema. Kirim atau reply gambar/foto biasa (JPG/PNG/WebP), atau pakai link gambar.')
    }

    let resolvedScheme = opts.scheme
    let resolvedSolid = opts.solid
    let autoDoodle = opts.doodle

    if (!imageSource && !resolvedScheme && !resolvedSolid && !opts.stock) {
      if (!remaining) {
        return ctx.reply(HELP_TEXT)
      }
      const preset = COLOR_SCHEME_PRESETS[firstWord]
      const solidPreset = SOLID_COLOR_PRESETS[firstWord]
      const rawHex = normalizeHexColor(firstWord)

      if (preset) {
        resolvedScheme = preset.id
        if (autoDoodle === undefined && typeof preset.doodle === 'boolean') {
          autoDoodle = preset.doodle
        }
      } else if (rawHex) {
        resolvedSolid = rawHex
      } else if (solidPreset) {
        resolvedSolid = solidPreset
      } else if (/^[a-z0-9_-]+(?:@[a-z0-9_-]+)+$/i.test(remaining)) {
        resolvedScheme = remaining
      } else {
        return ctx.reply(
          `⚠️ Input "${remaining}" tidak dikenali.\n\n` +
          'Kirim/reply gambar, masukkan link gambar valid (`https://...`), atau ketik `.tema list` untuk melihat preset.'
        )
      }
    } else {
      if (!resolvedScheme && firstWord && COLOR_SCHEME_PRESETS[firstWord]) {
        const preset = COLOR_SCHEME_PRESETS[firstWord]
        resolvedScheme = preset.id
        if (autoDoodle === undefined && typeof preset.doodle === 'boolean') {
          autoDoodle = preset.doodle
        }
      } else if (resolvedScheme && COLOR_SCHEME_PRESETS[resolvedScheme.toLowerCase()]) {
        const preset = COLOR_SCHEME_PRESETS[resolvedScheme.toLowerCase()]
        resolvedScheme = preset.id
        if (autoDoodle === undefined && typeof preset.doodle === 'boolean') {
          autoDoodle = preset.doodle
        }
      }
    }

    if (typeof resolvedSolid === 'string' && SOLID_COLOR_PRESETS[resolvedSolid.toLowerCase()]) {
      resolvedSolid = SOLID_COLOR_PRESETS[resolvedSolid.toLowerCase()]
    }

    await ctx.react('⏳')

    try {
      let imageBuffer = null
      if (imageSource?.kind === 'media') {
        imageBuffer = await downloadTargetBuffer(imageSource.message)
      } else if (imageSource?.kind === 'url') {
        imageBuffer = await downloadSafeImageUrl(imageSource.url)
      }

      const applied = await setChatTheme(ctx.client, ctx.chat, {
        imageBuffer,
        imageFit: opts.fit,
        uploadMode: opts.upload,
        colorSchemeId: resolvedScheme,
        isDoodleEnabled: autoDoodle,
        dimLevel: normalizeDimLevel(opts.dim, 0),
        solidColor: resolvedSolid,
        stockImageId: opts.stock
      })

      if (applied.uploadMeta) {
        logger.info(
          {
            chat: ctx.chat,
            ...applied.uploadMeta,
            colorSchemeId: resolvedScheme ?? null,
            stanzaId: applied.result?.id ?? null
          },
          '🖼️  [.tema customImage dikirim]'
        )
      }

      await ctx.react('✅')

      const lines = [
        '🎨 *Perintah Shared Chat Theme Terkirim!*',
        `• Paket: ${applied.summary}`
      ]
      if (resolvedScheme) lines.push(`• Scheme: \`${resolvedScheme}\``)
      if (groupStatus) lines.push(`• Target: *${groupStatus.groupKind}*`)
      if (applied.result?.id) lines.push(`• Stanza ID: \`${applied.result.id}\``)
      lines.push('')
      lines.push(
        '_Catatan: Stanza protokol telah diterima server WhatsApp, tetapi tampilan tema baru berubah di aplikasi yang sudah mendapat fitur Shared Chat Themes (rollout beta/bertahap WhatsApp)._'
      )

      return ctx.reply(lines.join('\n'))
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply(`😵 Gagal mengganti tema: ${String(err?.message || err).slice(0, 220)}`)
    }
  }
}
