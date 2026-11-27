/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tema.js — Ubah / reset Shared Chat Theme & wallpaper chat/grup (CHAT_THEME_SETTING)
 */
import { isGroupAdmin } from '../../core/permission.js'
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

const MAX_URL_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 3

const HELP_TEXT =
  '🎨 *SHARED CHAT THEME (`.tema`)*\n\n' +
  'Mengubah tema / wallpaper chat untuk semua peserta (fitur *Shared Chat Themes* WhatsApp terbaru).\n\n' +
  '*Pakai Gambar / Link:*\n' +
  '• Kirim / reply gambar dengan `.tema`\n' +
  '• `.tema https://example.com/wallpaper.jpg`\n' +
  '• `.tema <url> --dim 30 --scheme blue`\n\n' +
  '*Pakai Preset / Warna:*\n' +
  '• `.tema blue` / `pink` / `purple` / `minimal` / `dark`\n' +
  '• `.tema --solid #1E293B` (atau `.tema --solid biru`)\n' +
  '• `.tema --scheme Royal-Blue@Tonal --nodoodle`\n\n' +
  '*Lainnya:*\n' +
  '• `.tema reset` / `.resettema` — kembalikan ke default\n' +
  '• `.tema list` — daftar preset warna & tema\n' +
  '• `.tema info` — cek tipe grup (biasa/announcement) & status admin bot\n\n' +
  '_Catatan: Efeknya tampil di aplikasi WhatsApp yang sudah mendukung Shared Chat Themes; member grup tetap bisa menimpa tema dari HP mereka._'

function buildPresetListText() {
  const schemes = Object.entries(COLOR_SCHEME_PRESETS)
    .filter(([k]) => !['biru', 'ungu', 'merah', 'oranye', 'hijau', 'gelap'].includes(k))
    .map(([k, v]) => `• *${k}* → \`${v.id}\` (${v.label})`)
    .join('\n')
  const solids = [...new Set(Object.keys(SOLID_COLOR_PRESETS))]
    .filter((k) => !['black', 'white', 'blue', 'purple', 'green', 'red', 'yellow', 'gray'].includes(k))
    .join(', ')

  return (
    '🎨 *DAFTAR PRESET `.tema`*\n\n' +
    `*Color Scheme / Tema:*\n${schemes}\n\n` +
    `*Warna Solid (\`--solid\`):*\n${solids}\nAtau hex bebas: \`--solid #102030\`\n\n` +
    '*Opsi tambahan:*\n' +
    '• `--dim 0..100` — atur tingkat redup gambar\n' +
    '• `--doodle` / `--nodoodle` — nyala/matikan pola doodle'
  )
}

async function downloadSafeImageUrl(rawUrl) {
  let currentUrl = String(rawUrl || '').trim()

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safeUrl = await assertSafePublicUrl(currentUrl)
    const res = await fetch(safeUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        Accept: 'image/*,*/*;q=0.8'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000)
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`Redirect HTTP ${res.status} tanpa Location.`)
      currentUrl = new URL(loc, safeUrl).toString()
      continue
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} saat unduh gambar`)

    const ct = String(res.headers.get('content-type') || '').toLowerCase()
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream')) {
      throw new Error(`URL bukan gambar (Content-Type: ${ct.split(';')[0]})`)
    }

    const cl = Number(res.headers.get('content-length') || 0)
    if (cl > MAX_URL_BYTES) {
      throw new Error(`Ukuran gambar terlalu besar (${(cl / 1024 / 1024).toFixed(1)} MB)`)
    }

    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) throw new Error('File gambar dari URL kosong')
    if (buf.length > MAX_URL_BYTES) {
      throw new Error(`Ukuran gambar melebihi 10 MB (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
    }
    return buf
  }

  throw new Error('Terlalu banyak redirect pada URL gambar')
}

function parseTemaArgs(rawText) {
  let text = String(rawText || '').trim()
  const opts = {
    scheme: undefined,
    solid: undefined,
    dim: undefined,
    doodle: undefined,
    stock: undefined,
    url: undefined
  }

  text = text.replace(/--(scheme|tema|color|solid|dim|stock)(?:=|\s+)(\S+)/gi, (_, k, v) => {
    const key = k.toLowerCase()
    if (key === 'scheme' || key === 'tema') opts.scheme = v
    else if (key === 'color' || key === 'solid') opts.solid = v
    else if (key === 'dim') opts.dim = v
    else if (key === 'stock') opts.stock = v
    return ' '
  })

  text = text.replace(/--(no-?doodle|doodle)\b/gi, (_, flag) => {
    opts.doodle = !flag.toLowerCase().startsWith('no')
    return ' '
  })

  const urlMatch = text.match(/https?:\/\/\S+/i)
  if (urlMatch) {
    opts.url = urlMatch[0].replace(/[),.!?]+$/, '')
    text = text.replace(urlMatch[0], ' ')
  }

  const remaining = text.trim()
  return { opts, remaining }
}

function digitsOnly(jid) {
  return String(jid || '').split('@')[0].split(':')[0]
}

async function inspectGroupStatus(ctx) {
  try {
    const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
    const meCreds = ctx.client.auth?.getState?.()
    const myIds = new Set([meCreds?.meJid, meCreds?.meLid].filter(Boolean).map(digitsOnly))
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
        return ctx.reply('💬 Chat pribadi: `.tema` langsung bisa dipakai (syaratnya WhatsApp kamu & lawan chat sudah dapat fitur *Shared Chat Themes*).')
      }
      const st = await inspectGroupStatus(ctx)
      if (!st) {
        return ctx.reply('⚠️ Gagal membaca metadata grup saat ini.')
      }
      return ctx.reply(
        `🔍 *STATUS TEMA GRUP*\n\n` +
        `• Nama: *${st.subject}*\n` +
        `• Tipe: *${st.groupKind}*\n` +
        `• Mode hanya admin kirim pesan: ${st.announce ? '🔒 Ya' : '🔓 Tidak'}\n` +
        `• Batasi edit info grup: ${st.restrict ? '🔒 Ya' : '🔓 Tidak'}\n` +
        `• Status Bot: ${st.botIsAdmin ? '✅ Admin' : '👤 Member biasa'}`
      )
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
        return ctx.reply('🧹 Tema chat bersama berhasil di-reset ke default.')
      } catch (err) {
        await ctx.react('❎')
        return ctx.reply(`😵 Gagal reset tema: ${String(err?.message || err).slice(0, 140)}`)
      }
    }

    // Resolve sumber gambar: prioritas (1) media langsung/quoted, (2) URL di argumen atau quoted text
    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const hasImageMedia =
      payload?.mimetype?.startsWith('image/') && !String(payload.mimetype).includes('webp')

    let imageUrl = opts.url || null
    if (!imageUrl && !hasImageMedia) {
      const quotedText = extractTextFromMessage(getQuotedMessage(ctx))
      const qUrl = quotedText.match(/https?:\/\/\S+/i)?.[0]
      if (qUrl) imageUrl = qUrl.replace(/[),.!?]+$/, '')
    }

    // Resolve preset/warna teks jika tidak ada gambar & tidak ada URL
    let resolvedScheme = opts.scheme
    let resolvedSolid = opts.solid
    let autoDoodle = opts.doodle

    if (!hasImageMedia && !imageUrl && !resolvedScheme && !resolvedSolid && !opts.stock) {
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
      } else if (/^[a-z0-9_-]+(?:@[a-z0-9_-]+)?$/i.test(remaining)) {
        resolvedScheme = remaining
      } else {
        return ctx.reply(
          `⚠️ Input "${remaining}" tidak dikenali.\n\n` +
          'Kirim/reply gambar, masukkan link gambar, atau ketik `.tema list` untuk melihat preset.'
        )
      }
    } else if (resolvedScheme && COLOR_SCHEME_PRESETS[resolvedScheme.toLowerCase()]) {
      const preset = COLOR_SCHEME_PRESETS[resolvedScheme.toLowerCase()]
      resolvedScheme = preset.id
      if (autoDoodle === undefined && typeof preset.doodle === 'boolean') {
        autoDoodle = preset.doodle
      }
    }

    if (typeof resolvedSolid === 'string' && SOLID_COLOR_PRESETS[resolvedSolid.toLowerCase()]) {
      resolvedSolid = SOLID_COLOR_PRESETS[resolvedSolid.toLowerCase()]
    }

    let groupStatus = null
    if (ctx.isGroup) {
      groupStatus = await inspectGroupStatus(ctx)
      if (groupStatus?.announce && !groupStatus.botIsAdmin) {
        return ctx.reply('🔒 Grup ini dalam mode *Announcement* (hanya admin yang bisa mengirim pesan). Jadikan bot admin dulu ya, Kak.')
      }
    }

    await ctx.react('⏳')

    try {
      let imageBuffer = null
      if (hasImageMedia) {
        imageBuffer = await downloadTargetBuffer(targetMessage)
      } else if (imageUrl) {
        imageBuffer = await downloadSafeImageUrl(imageUrl)
      }

      const applied = await setChatTheme(ctx.client, ctx.chat, {
        imageBuffer,
        colorSchemeId: resolvedScheme,
        isDoodleEnabled: autoDoodle,
        dimLevel: normalizeDimLevel(opts.dim, 0),
        solidColor: resolvedSolid,
        stockImageId: opts.stock
      })

      await ctx.react('✅')

      const lines = [
        '🎨 *Shared Chat Theme Diperbarui!*',
        `• Efek: ${applied.summary}`
      ]
      if (resolvedScheme) lines.push(`• Scheme: \`${resolvedScheme}\``)
      if (groupStatus) lines.push(`• Target: *${groupStatus.groupKind}*`)
      lines.push('')
      lines.push('_Perubahan hanya terlihat pada perangkat/klien WhatsApp yang sudah mendukung fitur Shared Chat Themes._')

      return ctx.reply(lines.join('\n'))
    } catch (err) {
      await ctx.react('❎')
      return ctx.reply(`😵 Gagal mengganti tema: ${String(err?.message || err).slice(0, 180)}`)
    }
  }
}
