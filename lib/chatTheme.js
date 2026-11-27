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
const MAX_THEME_IMAGE_BYTES = 10 * 1024 * 1024

export const COLOR_SCHEME_PRESETS = Object.freeze({
  default: { id: 'Default', label: 'Default WhatsApp' },
  green: { id: 'Default', label: 'Hijau WhatsApp' },
  hijau: { id: 'Default', label: 'Hijau WhatsApp' },
  pink: { id: 'Pink', label: 'Merah Muda' },
  blue: { id: 'Royal-Blue@Tonal', label: 'Royal Blue Tonal' },
  biru: { id: 'Royal-Blue@Tonal', label: 'Royal Blue Tonal' },
  purple: { id: 'Purple@Tonal', label: 'Ungu Tonal' },
  ungu: { id: 'Purple@Tonal', label: 'Ungu Tonal' },
  red: { id: 'Crimson@Tonal', label: 'Merah Crimson' },
  merah: { id: 'Crimson@Tonal', label: 'Merah Crimson' },
  orange: { id: 'Tangerine@Tonal', label: 'Oranye Hangat' },
  oranye: { id: 'Tangerine@Tonal', label: 'Oranye Hangat' },
  teal: { id: 'Teal@Tonal', label: 'Tosca Tonal' },
  tosca: { id: 'Teal@Tonal', label: 'Tosca Tonal' },
  mono: { id: 'Default-Mono@Minimal', label: 'Monokrom Minimal (tanpa doodle)', doodle: false },
  minimal: { id: 'Default-Mono@Minimal', label: 'Monokrom Minimal (tanpa doodle)', doodle: false },
  dark: { id: 'Slate-Dark@Minimal', label: 'Gelap Minimal', doodle: false },
  gelap: { id: 'Slate-Dark@Minimal', label: 'Gelap Minimal', doodle: false }
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

  // 1. resolveMessageTypeAttrFrom: CHAT_THEME_SETTING wajib memakai stanza type="media"
  const typeAnchor =
    "    if ((msg.conversation !== undefined && msg.conversation !== null) ||\n" +
    "        (msg.extendedTextMessage && !msg.extendedTextMessage.matchedText) ||\n" +
    "        msg.protocolMessage ||"
  if (!src.includes(typeAnchor)) return false
  src = src.replace(
    typeAnchor,
    `    ${PATCH_MARKER}\n` +
      `    if (msg.protocolMessage?.chatThemeSetting) {\n` +
      `        return ${constPrefix}WA_STANZA_MSG_TYPES.MEDIA;\n` +
      `    }\n` +
      typeAnchor
  )

  // 2. resolveDecryptFailAttrFrom: tambahkan decrypt-fail="hide" agar WA lama mengabaikannya dengan aman
  const decryptFailAnchor =
    `        if (protocolType === ${protoRef}.Message.ProtocolMessage.Type.EPHEMERAL_SYNC_RESPONSE ||`
  if (!src.includes(decryptFailAnchor)) return false
  src = src.replace(
    decryptFailAnchor,
    `        if (protocolType === ${protoRef}.Message.ProtocolMessage.Type.CHAT_THEME_SETTING ||\n` +
      `            Boolean(msg.protocolMessage.chatThemeSetting) ||\n` +
      `            protocolType === ${protoRef}.Message.ProtocolMessage.Type.EPHEMERAL_SYNC_RESPONSE ||`
  )

  // 3. resolveEncMediaTypeFrom: sisipkan mediatype="chat_theme" setelah GROUP_HISTORY (aman terhadap album patch)
  const encAnchor = `        return ${constPrefix}WA_ENC_MEDIA_TYPES.GROUP_HISTORY;`
  if (!src.includes(encAnchor)) return false
  src = src.replace(
    encAnchor,
    `${encAnchor}\n` +
      `    if (msg.protocolMessage?.chatThemeSetting)\n` +
      `        return ${constPrefix}WA_ENC_MEDIA_TYPES.CHAT_THEME;`
  )

  fs.writeFileSync(filePath, src, 'utf8')
  return true
}

function patchMediaConstantsFile(filePath, { isCjs = false } = {}) {
  if (!fs.existsSync(filePath)) return false
  const src = fs.readFileSync(filePath, 'utf8')
  if (src.includes("'chat-wallpaper-image'")) return false

  const anchor = isCjs
    ? "exports.MEDIA_UPLOAD_PATHS = Object.freeze({\n    image: '/mms/image',"
    : "export const MEDIA_UPLOAD_PATHS = Object.freeze({\n    image: '/mms/image',"
  if (!src.includes(anchor)) return false

  const updated = src.replace(
    anchor,
    `${anchor}\n    'chat-wallpaper-image': '/mms/chat-wallpaper-image',`
  )
  fs.writeFileSync(filePath, updated, 'utf8')
  return true
}

function patchProtocolMediaFile(filePath, { isCjs = false } = {}) {
  if (!fs.existsSync(filePath)) return false
  const src = fs.readFileSync(filePath, 'utf8')
  if (src.includes("'chat-wallpaper-image'")) return false

  const anchor = isCjs
    ? "    image: IMAGE_KEYS,"
    : "    image: IMAGE_KEYS,"
  if (!src.includes(anchor)) return false

  const encoderRef = isCjs ? 'bytes_1.TEXT_ENCODER' : 'TEXT_ENCODER'
  const updated = src.replace(
    anchor,
    `${anchor}\n    'chat-wallpaper-image': ${encoderRef}.encode('WhatsApp Chat Wallpaper Keys'),`
  )
  fs.writeFileSync(filePath, updated, 'utf8')
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
  const num = Number(input)
  if (!Number.isFinite(num)) return defaultVal
  if (num < 0) return 0
  if (num > 1 && num <= 100) return Number((num / 100).toFixed(2))
  return Math.min(1, Number(num.toFixed(2)))
}

export async function normalizeThemeImage(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Buffer gambar kosong.')
  }
  if (buffer.length > MAX_THEME_IMAGE_BYTES) {
    throw new Error('Ukuran gambar terlalu besar (maks 10 MB).')
  }

  const targetW = 1080
  const targetH = 1920
  const fitMode = String(options.fit || 'cover').toLowerCase() === 'blur' ? 'blur' : 'cover'

  // Auto-orient sesuai EXIF lalu normalisasi ke rasio portrait 9:16 JPEG baseline
  const rotated = await sharp(buffer).rotate().toBuffer()
  let pipeline

  if (fitMode === 'blur') {
    const bg = await sharp(rotated)
      .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
      .blur(28)
      .modulate({ brightness: 0.72 })
      .toBuffer()
    const fg = await sharp(rotated)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: false })
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

  const meta = await sharp(out).metadata()
  return {
    buffer: out,
    width: meta.width || targetW,
    height: meta.height || targetH,
    bytes: out.length,
    fit: fitMode
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
    dimLevel = 0,
    solidColor,
    stockImageId
  } = options

  const chatThemeSetting = {
    settingTimestampMs: Date.now()
  }

  let appliedSummary = ''

  if (clear) {
    chatThemeSetting.clearTheme = true
    appliedSummary = 'Tema chat di-reset ke default'
  } else {
    if (colorSchemeId) {
      chatThemeSetting.colorSchemeId = String(colorSchemeId)
    }

    if (imageBuffer) {
      const prepared = await normalizeThemeImage(imageBuffer, { fit: imageFit })
      // WhatsApp mewajibkan tipe media & HKDF khusus 'chat-wallpaper-image'
      const uploaded = await client.message.upload(prepared.buffer, {
        type: 'chat-wallpaper-image',
        mimetype: 'image/jpeg'
      })

      chatThemeSetting.customImage = {
        directPath: uploaded.directPath,
        mediaKey: uploaded.mediaKey,
        fileEncSha256: uploaded.fileEncSha256,
        fileSha256: uploaded.fileSha256,
        dimLevel: normalizeDimLevel(dimLevel, 0)
      }
      appliedSummary = `Wallpaper gambar custom (${prepared.width}x${prepared.height} 9:16, redup ${Math.round((chatThemeSetting.customImage.dimLevel || 0) * 100)}%)`
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
      chatThemeSetting.stockImage = {
        stockImageId: String(stockImageId),
        dimLevel: normalizeDimLevel(dimLevel, 0)
      }
      appliedSummary = `Stock wallpaper (${stockImageId})`
    } else {
      const autoDoodle =
        typeof isDoodleEnabled === 'boolean'
          ? isDoodleEnabled
          : !String(colorSchemeId || '').includes('@Minimal')
      chatThemeSetting.defaultWallpaper = { isDoodleEnabled: autoDoodle }
      appliedSummary = `Tema ${colorSchemeId || 'Default'} (${autoDoodle ? 'dengan doodle' : 'tanpa doodle'})`
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

  const result = await client.message.send(chatJid, protoPayload, {
    additionalAttributes: { type: 'media' }
  })

  return {
    result,
    summary: appliedSummary,
    setting: chatThemeSetting
  }
}

export async function clearChatTheme(client, chatJid) {
  return setChatTheme(client, chatJid, { clear: true })
}
