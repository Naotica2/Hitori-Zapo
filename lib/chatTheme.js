/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * chatTheme.js — Patch ringan zapo-js + helper Shared Chat Theme (CHAT_THEME_SETTING)
 *
 * Catatan: Jangan import 'zapo-js' di level atas modul ini agar bisa di-import
 * di app.js SEBELUM 'zapo-js' dievaluasi oleh ESM loader.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import sharp from 'sharp'

const require = createRequire(import.meta.url)

const PATCH_MARKER = '/* CHAT_THEME_SETTING_PATCH */'
const MAX_THEME_IMAGE_BYTES = 15 * 1024 * 1024

export const COLOR_SCHEME_PRESETS = Object.freeze({
  default: { id: 'WhatsApp-Green@Minimal', label: 'Hijau WhatsApp Minimal' },
  green: { id: 'WhatsApp-Green@Minimal', label: 'Hijau WhatsApp Minimal' },
  hijau: { id: 'WhatsApp-Green@Minimal', label: 'Hijau WhatsApp Minimal' },
  emerald: { id: 'Emerald@Tonal@Minimal', label: 'Emerald Tonal Minimal' },
  tosca: { id: 'Emerald@Minimal', label: 'Emerald Minimal' },
  teal: { id: 'Emerald@Minimal', label: 'Emerald Minimal' },
  blue: { id: 'Royal-Blue@Tonal', label: 'Royal Blue Tonal' },
  biru: { id: 'Royal-Blue@Tonal', label: 'Royal Blue Tonal' },
  darkblue: { id: 'Default-Blue@Minimal', label: 'Default Blue Minimal', doodle: false },
  minimal: { id: 'Default-Blue@Minimal', label: 'Default Blue Minimal', doodle: false },
  tonalblue: { id: 'Default-Blue@Tonal@Minimal', label: 'Default Blue Tonal', doodle: false },
  purple: { id: 'Tyrian-Purple@Minimal', label: 'Tyrian Purple Minimal', doodle: false },
  ungu: { id: 'Tyrian-Purple@Minimal', label: 'Tyrian Purple Minimal', doodle: false },
  pink: { id: 'Pink@Minimal', label: 'Pink Minimal', doodle: false },
  red: { id: 'Red@Minimal', label: 'Red Minimal', doodle: false },
  merah: { id: 'Red@Minimal', label: 'Red Minimal', doodle: false }
})

export const SOLID_COLOR_PRESETS = Object.freeze({
  hitam: { light: '#111B21', dark: '#0B141A' },
  black: { light: '#111B21', dark: '#0B141A' },
  putih: { light: '#EFEAE2', dark: '#0B141A' },
  white: { light: '#EFEAE2', dark: '#0B141A' },
  biru: { light: '#D8ECFF', dark: '#0F2537' },
  blue: { light: '#D8ECFF', dark: '#0F2537' },
  navy: { light: '#132238', dark: '#0A1526' },
  pink: { light: '#FCE4EC', dark: '#2E111D' },
  ungu: { light: '#EDE7F6', dark: '#211433' },
  purple: { light: '#EDE7F6', dark: '#211433' },
  hijau: { light: '#E2F6E9', dark: '#0E281B' },
  green: { light: '#E2F6E9', dark: '#0E281B' },
  merah: { light: '#FDE8E8', dark: '#301014' },
  red: { light: '#FDE8E8', dark: '#301014' },
  kuning: { light: '#FFF8D6', dark: '#2A230D' },
  yellow: { light: '#FFF8D6', dark: '#2A230D' },
  abu: { light: '#E5E7EB', dark: '#182229' },
  gray: { light: '#E5E7EB', dark: '#182229' }
})

function patchMessageConstantsFile(filePath) {
  if (!fs.existsSync(filePath)) return false
  const src = fs.readFileSync(filePath, 'utf8')
  if (src.includes(PATCH_MARKER)) return false

  // Sisipkan SEBELUM GROUP_HISTORY agar patch album.js tetap cocok dengan pola terakhirnya
  const target = "    GROUP_HISTORY: 'group_history'"
  if (!src.includes(target)) return false

  const updated = src.replace(
    target,
    `    ${PATCH_MARKER}\n    CHAT_THEME: 'chat_theme',\n${target}`
  )
  fs.writeFileSync(filePath, updated, 'utf8')
  return true
}

function patchEncodeContentFile(filePath, { isCjs = false } = {}) {
  if (!fs.existsSync(filePath)) return false
  let src = fs.readFileSync(filePath, 'utf8')
  if (src.includes(PATCH_MARKER)) return false

  const protoRef = isCjs ? '_proto_1.proto' : 'proto'
  const constPrefix = isCjs ? 'constants_1.' : ''

  // 1. resolveMessageTypeAttrFrom: CHAT_THEME_SETTING memakai stanza type="media"
  const typeAnchor =
    '    if ((msg.conversation !== undefined && msg.conversation !== null) ||\n' +
    '        (msg.extendedTextMessage && !msg.extendedTextMessage.matchedText) ||\n' +
    '        msg.protocolMessage ||'
  if (!src.includes(typeAnchor)) return false
  src = src.replace(
    typeAnchor,
    `    ${PATCH_MARKER}\n` +
      '    if (msg.protocolMessage?.chatThemeSetting) {\n' +
      `        return ${constPrefix}WA_STANZA_MSG_TYPES.MEDIA;\n` +
      '    }\n' +
      typeAnchor
  )

  // 2. resolveDecryptFailAttrFrom: tambahkan decrypt-fail="hide" agar klien yg belum support mengabaikan aman
  const decryptFailAnchor =
    `        if (protocolType === ${protoRef}.Message.ProtocolMessage.Type.EPHEMERAL_SYNC_RESPONSE ||`
  if (!src.includes(decryptFailAnchor)) return false
  src = src.replace(
    decryptFailAnchor,
    `        if (protocolType === ${protoRef}.Message.ProtocolMessage.Type.CHAT_THEME_SETTING ||\n` +
      '            Boolean(msg.protocolMessage.chatThemeSetting) ||\n' +
      `            protocolType === ${protoRef}.Message.ProtocolMessage.Type.EPHEMERAL_SYNC_RESPONSE ||`
  )

  // 3. resolveEncMediaTypeFrom: sisipkan mediatype="chat_theme" setelah GROUP_HISTORY (aman terhadap album patch)
  const encAnchor = `        return ${constPrefix}WA_ENC_MEDIA_TYPES.GROUP_HISTORY;`
  if (!src.includes(encAnchor)) return false
  src = src.replace(
    encAnchor,
    `${encAnchor}\n` +
      '    if (msg.protocolMessage?.chatThemeSetting)\n' +
      `        return ${constPrefix}WA_ENC_MEDIA_TYPES.CHAT_THEME;`
  )

  fs.writeFileSync(filePath, src, 'utf8')
  return true
}

function patchMediaConstantsFile(filePath, { isCjs = false } = {}) {
  if (!fs.existsSync(filePath)) return false
  const src = fs.readFileSync(filePath, 'utf8')
  if (src.includes("'chat-wallpaper-image'") && src.includes("'chat-wallpaper-on-image'")) {
    return false
  }

  const anchor = isCjs
    ? "exports.MEDIA_UPLOAD_PATHS = Object.freeze({\n    image: '/mms/image',"
    : "export const MEDIA_UPLOAD_PATHS = Object.freeze({\n    image: '/mms/image',"
  if (!src.includes(anchor)) return false

  let additions = ''
  if (!src.includes("'chat-wallpaper-image'")) {
    additions += "\n    'chat-wallpaper-image': '/mms/chat-wallpaper-image',"
  }
  if (!src.includes("'chat-wallpaper-on-image'")) {
    additions += "\n    'chat-wallpaper-on-image': '/mms/image',"
  }
  fs.writeFileSync(filePath, src.replace(anchor, `${anchor}${additions}`), 'utf8')
  return true
}

function patchProtocolMediaFile(filePath, { isCjs = false } = {}) {
  if (!fs.existsSync(filePath)) return false
  const src = fs.readFileSync(filePath, 'utf8')
  if (src.includes("'chat-wallpaper-image'") && src.includes("'chat-wallpaper-on-image'")) {
    return false
  }

  const anchor = '    image: IMAGE_KEYS,'
  if (!src.includes(anchor)) return false

  const encoderRef = isCjs ? 'bytes_1.TEXT_ENCODER' : 'TEXT_ENCODER'
  let additions = ''
  if (!src.includes("'chat-wallpaper-image'")) {
    additions += `\n    'chat-wallpaper-image': ${encoderRef}.encode('WhatsApp Chat Wallpaper Keys'),`
  }
  if (!src.includes("'chat-wallpaper-on-image'")) {
    additions += `\n    'chat-wallpaper-on-image': ${encoderRef}.encode('WhatsApp Chat Wallpaper Keys'),`
  }
  fs.writeFileSync(filePath, src.replace(anchor, `${anchor}${additions}`), 'utf8')
  return true
}

export function ensureChatThemePatch() {
  const results = { patched: [], skipped: [] }
  try {
    const zapoRoot = path.dirname(require.resolve('zapo-js/package.json'))
    const jobs = [
      ['esm/protocol/message.js', () => patchMessageConstantsFile(path.join(zapoRoot, 'dist/esm/protocol/message.js'))],
      ['dist/protocol/message.js', () => patchMessageConstantsFile(path.join(zapoRoot, 'dist/protocol/message.js'))],
      ['esm/message/encode/content.js', () => patchEncodeContentFile(path.join(zapoRoot, 'dist/esm/message/encode/content.js'), { isCjs: false })],
      ['dist/message/encode/content.js', () => patchEncodeContentFile(path.join(zapoRoot, 'dist/message/encode/content.js'), { isCjs: true })],
      ['esm/media/constants.js', () => patchMediaConstantsFile(path.join(zapoRoot, 'dist/esm/media/constants.js'), { isCjs: false })],
      ['dist/media/constants.js', () => patchMediaConstantsFile(path.join(zapoRoot, 'dist/media/constants.js'), { isCjs: true })],
      ['esm/protocol/media.js', () => patchProtocolMediaFile(path.join(zapoRoot, 'dist/esm/protocol/media.js'), { isCjs: false })],
      ['dist/protocol/media.js', () => patchProtocolMediaFile(path.join(zapoRoot, 'dist/protocol/media.js'), { isCjs: true })]
    ]
    for (const [name, fn] of jobs) {
      if (fn()) results.patched.push(name)
      else results.skipped.push(name)
    }
  } catch (err) {
    results.error = err?.message || String(err)
  }
  return results
}

// Jalankan segera saat modul di-import agar patch aktif sebelum zapo-js dimuat.
ensureChatThemePatch()

export function normalizeHexColor(input) {
  if (!input) return null
  const clean = String(input).trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean.toUpperCase()}`
  if (/^[0-9a-f]{8}$/i.test(clean)) return `#${clean.toUpperCase()}`
  return null
}

export function normalizeDimLevel(input, defaultVal = 0) {
  if (input === undefined || input === null || input === '') return defaultVal
  const raw = String(input).trim()
  const hasPercent = raw.endsWith('%')
  const num = Number(hasPercent ? raw.slice(0, -1).trim() : raw)
  if (!Number.isFinite(num)) return defaultVal
  if (num <= 0) return 0
  if (hasPercent) {
    return Math.min(1, Number((num / 100).toFixed(2)))
  }
  // Angka bulat 1..100 tanpa titik desimal diperlakukan sebagai persen (contoh: --dim 30 atau --dim 1)
  if (!raw.includes('.') && Number.isInteger(num) && num <= 100) {
    return Number((num / 100).toFixed(2))
  }
  if (num > 1 && num <= 100) {
    return Number((num / 100).toFixed(2))
  }
  return Math.min(1, Number(num.toFixed(2)))
}

export async function normalizeThemeImage(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Buffer gambar kosong.')
  }
  if (buffer.length > MAX_THEME_IMAGE_BYTES) {
    throw new Error('Ukuran gambar terlalu besar (maks 15 MB).')
  }

  let sourceMeta
  try {
    sourceMeta = await sharp(buffer).metadata()
  } catch {
    throw new Error('File bukan gambar valid atau format gambar rusak/tidak didukung.')
  }
  if (!sourceMeta?.width || !sourceMeta?.height) {
    throw new Error('Dimensi gambar tidak valid.')
  }

  const targetW = 1080
  const targetH = 1920
  const fitMode = String(options.fit || 'cover').toLowerCase() === 'blur' ? 'blur' : 'cover'

  // Auto-orient sesuai EXIF lalu pastikan colorspace sRGB agar CMYK/16-bit tidak bermasalah
  const rotated = await sharp(buffer).rotate().toColorspace('srgb').toBuffer()
  let pipeline

  if (fitMode === 'blur') {
    const bg = await sharp(rotated)
      .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
      .blur(28)
      .modulate({ brightness: 0.72 })
      .flatten({ background: { r: 11, g: 20, b: 26 } })
      .png()
      .toBuffer()
    const fg = await sharp(rotated)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer()
    pipeline = sharp(bg).composite([{ input: fg, gravity: 'centre' }])
  } else {
    pipeline = sharp(rotated).resize(targetW, targetH, {
      fit: 'cover',
      position: 'centre'
    })
  }

  const out = await pipeline
    .flatten({ background: { r: 11, g: 20, b: 26 } })
    .jpeg({
      quality: 88,
      progressive: false,
      mozjpeg: false,
      chromaSubsampling: '4:2:0'
    })
    .toBuffer()

  const normalizedBuffer = out.buffer instanceof ArrayBuffer ? out : Buffer.from(out)
  const meta = await sharp(normalizedBuffer).metadata()
  return {
    buffer: normalizedBuffer,
    width: meta.width || targetW,
    height: meta.height || targetH,
    sourceWidth: sourceMeta.width,
    sourceHeight: sourceMeta.height,
    bytes: normalizedBuffer.length,
    fit: fitMode
  }
}

async function assertRuntimeChatThemeAttrs(protoPayload) {
  const { resolveEncMediaType } = await import('zapo-js')
  const mediatype = resolveEncMediaType(protoPayload)
  if (mediatype !== 'chat_theme') {
    throw new Error(
      'Patch CHAT_THEME_SETTING di zapo-js belum aktif pada runtime ini. Restart bot agar patch termuat sebelum zapo-js.'
    )
  }
}

export async function setChatTheme(client, chatJid, options = {}) {
  if (!client?.message?.send) {
    throw new Error('Client message coordinator tidak tersedia.')
  }

  const {
    clear = false,
    colorSchemeId,
    isDoodleEnabled,
    imageBuffer,
    imageFit = 'cover',
    uploadMode = 'image',
    dimLevel = 0,
    solidColor,
    stockImageId
  } = options

  const chatThemeSetting = {
    settingTimestampMs: Date.now()
  }

  let appliedSummary = ''
  let uploadMeta = null

  if (clear) {
    chatThemeSetting.clearTheme = true
    appliedSummary = 'Tema chat di-reset ke default'
  } else {
    if (colorSchemeId) {
      chatThemeSetting.colorSchemeId = String(colorSchemeId)
    }

    if (imageBuffer) {
      const prepared = await normalizeThemeImage(imageBuffer, { fit: imageFit })
      const uploadTypeMap = {
        wallpaper: 'chat-wallpaper-image',
        wpkey: 'chat-wallpaper-on-image',
        image: 'image'
      }
      const resolvedUploadType = uploadTypeMap[String(uploadMode || 'image').toLowerCase()] || 'image'
      const uploaded = await client.message.upload(prepared.buffer, {
        type: resolvedUploadType,
        mimetype: 'image/jpeg'
      })
      if (!uploaded?.directPath || !uploaded?.mediaKey || !uploaded?.fileEncSha256 || !uploaded?.fileSha256) {
        throw new Error('Upload wallpaper ke CDN WhatsApp mengembalikan metadata media tidak lengkap.')
      }

      const normalizedDim = normalizeDimLevel(dimLevel, 0)
      chatThemeSetting.customImage = {
        directPath: uploaded.directPath,
        mediaKey: uploaded.mediaKey,
        fileEncSha256: uploaded.fileEncSha256,
        fileSha256: uploaded.fileSha256,
        dimLevel: normalizedDim
      }
      uploadMeta = {
        uploadType: resolvedUploadType,
        directPathPrefix: String(uploaded.directPath).slice(0, 36),
        bytes: prepared.bytes
      }
      const modeLabel = prepared.fit === 'blur' ? 'full-blur 9:16' : '9:16 cover'
      appliedSummary = `Wallpaper custom (${prepared.width}x${prepared.height} ${modeLabel}, redup ${Math.round(normalizedDim * 100)}%, mode ${resolvedUploadType})`
    } else if (solidColor) {
      const colorLight = normalizeHexColor(solidColor.colorLight || solidColor.light || solidColor)
      const colorDark = normalizeHexColor(solidColor.colorDark || solidColor.dark || colorLight)
      if (!colorLight) throw new Error('Format warna solid tidak valid. Contoh: #1E293B')
      chatThemeSetting.solidColor = {
        colorLight,
        colorDark: colorDark || colorLight,
        isDoodleEnabled: isDoodleEnabled ?? true
      }
      appliedSummary = `Warna solid (${colorLight}${colorDark && colorDark !== colorLight ? ` / ${colorDark}` : ''})`
    } else if (stockImageId) {
      const normalizedDim = normalizeDimLevel(dimLevel, 0)
      chatThemeSetting.stockImage = {
        stockImageId: String(stockImageId),
        dimLevel: normalizedDim
      }
      appliedSummary = `Stock wallpaper (${stockImageId})`
    } else {
      const autoDoodle =
        typeof isDoodleEnabled === 'boolean'
          ? isDoodleEnabled
          : !String(colorSchemeId || '').includes('@Minimal')
      chatThemeSetting.defaultWallpaper = { isDoodleEnabled: autoDoodle }
      appliedSummary = `Tema ${colorSchemeId || 'WhatsApp-Green@Minimal'} (${autoDoodle ? 'dengan doodle' : 'tanpa doodle'})`
    }
  }

  const protoPayload = {
    protocolMessage: {
      type: 34, // Proto.Message.ProtocolMessage.Type.CHAT_THEME_SETTING
      chatThemeSetting
    },
    messageContextInfo: {
      messageSecret: crypto.randomBytes(32)
    }
  }

  await assertRuntimeChatThemeAttrs(protoPayload)

  const result = await client.message.send(chatJid, protoPayload, {
    additionalAttributes: { type: 'media' },
    disableGroupEphemeralAutoInject: true,
    disableDirectEphemeralAutoInject: true
  })

  return {
    result,
    summary: appliedSummary,
    setting: chatThemeSetting,
    uploadMeta
  }
}

export async function clearChatTheme(client, chatJid) {
  return setChatTheme(client, chatJid, { clear: true })
}

export function describeProtocolMessage(protocolMessage) {
  if (!protocolMessage || typeof protocolMessage !== 'object') return null
  if (protocolMessage.chatThemeSetting || protocolMessage.type === 34) {
    const s = protocolMessage.chatThemeSetting || {}
    const parts = ['tema chat 🎨']
    if (s.clearTheme) parts.push('reset')
    if (s.colorSchemeId) parts.push(`scheme=${s.colorSchemeId}`)
    if (s.customImage) parts.push(`customImage(dim=${s.customImage.dimLevel ?? 0})`)
    else if (s.solidColor) parts.push(`solid(${s.solidColor.colorLight || '?'})`)
    else if (s.stockImage) parts.push(`stock(${s.stockImage.stockImageId || '?'})`)
    else if (s.defaultWallpaper) parts.push(`default(doodle=${Boolean(s.defaultWallpaper.isDoodleEnabled)})`)
    return parts.join(' • ')
  }
  return null
}

const CANDIDATE_WALLPAPER_HKDF_KEYS = [
  'WhatsApp Image Keys',
  'WhatsApp Chat Wallpaper Keys',
  'WhatsApp Wallpaper Keys',
  'WhatsApp Chat Theme Keys'
]

export function detectMatchingWallpaperHkdfKey(mediaKey, ciphertextHmac, expectedFileSha256) {
  if (!(mediaKey instanceof Uint8Array) || mediaKey.byteLength !== 32) return null
  if (!(ciphertextHmac instanceof Uint8Array) || ciphertextHmac.byteLength <= 10) return null

  const ciphertext = ciphertextHmac.subarray(0, ciphertextHmac.byteLength - 10)
  const expectedMac = ciphertextHmac.subarray(ciphertextHmac.byteLength - 10)

  for (const info of CANDIDATE_WALLPAPER_HKDF_KEYS) {
    const expanded = Buffer.from(crypto.hkdfSync('sha256', mediaKey, Buffer.alloc(0), Buffer.from(info), 80))
    const iv = expanded.subarray(0, 16)
    const encKey = expanded.subarray(16, 48)
    const macKey = expanded.subarray(48, 80)

    const mac = crypto.createHmac('sha256', macKey).update(iv).update(ciphertext).digest().subarray(0, 10)
    if (!crypto.timingSafeEqual(mac, expectedMac)) continue

    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      if (expectedFileSha256 instanceof Uint8Array && expectedFileSha256.byteLength === 32) {
        const hash = crypto.createHash('sha256').update(plaintext).digest()
        if (!crypto.timingSafeEqual(hash, expectedFileSha256)) continue
      }
      return { hkdfInfo: info, plaintext }
    } catch {
      continue
    }
  }
  return null
}

export async function inspectIncomingChatTheme(client, event, log) {
  const s = event?.message?.protocolMessage?.chatThemeSetting
  if (!s) return null

  const rawAttrs = event?.rawNode?.attrs ?? {}
  const rawEnc = Array.isArray(event?.rawNode?.content)
    ? event.rawNode.content.find((n) => n?.tag === 'enc')?.attrs
    : undefined

  const summary = {
    stanzaType: rawAttrs.type,
    encAttrs: rawEnc,
    clearTheme: s.clearTheme ?? undefined,
    colorSchemeId: s.colorSchemeId ?? undefined,
    settingTimestampMs: s.settingTimestampMs ? String(s.settingTimestampMs) : undefined,
    defaultWallpaper: s.defaultWallpaper ?? undefined,
    solidColor: s.solidColor ?? undefined,
    stockImage: s.stockImage ?? undefined,
    customImage: s.customImage
      ? {
          directPath: s.customImage.directPath,
          dimLevel: s.customImage.dimLevel,
          mediaKeyLen: s.customImage.mediaKey?.byteLength,
          fileSha256Hex: s.customImage.fileSha256 ? Buffer.from(s.customImage.fileSha256).toString('hex').slice(0, 16) : undefined
        }
      : undefined
  }

  if (s.customImage?.directPath && s.customImage?.mediaKey) {
    try {
      const { WaMediaTransferClient } = await import('zapo-js')
      const transfer = client?.message?.mediaTransfer ?? new WaMediaTransferClient()
      const encrypted = await transfer.downloadBytes({
        directPath: s.customImage.directPath,
        timeoutMs: 10_000
      })
      const matched = detectMatchingWallpaperHkdfKey(
        s.customImage.mediaKey,
        encrypted,
        s.customImage.fileSha256
      )
      if (matched) {
        let meta = null
        try {
          const m = await sharp(matched.plaintext).metadata()
          meta = { format: m.format, width: m.width, height: m.height, bytes: matched.plaintext.length }
        } catch {}
        summary.detectedHkdf = matched.hkdfInfo
        summary.imageMeta = meta
      } else {
        summary.detectedHkdf = 'none_matched'
      }
    } catch (err) {
      summary.probeError = err?.message || String(err)
    }
  }

  log?.info?.({ chatTheme: summary }, '🎨 [CHAT_THEME_SETTING masuk]')
  return summary
}
