/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * lib/minecraft/workflow.js — Workflow pencarian, catalog, & downloader Minecraft Marketplace + CurseForge Bedrock
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileTypeFromBuffer } from 'file-type'
import config from '../../config.js'
import { downloadUrlBuffer } from '../media.js'
import Toolcoin from './toolcoin.js'
import { cfEngine, BEDROCK_GAME_ID } from './curseforge.js'
import { findSuggestion } from './suggest.js'
import { getSession, setSession } from './session.js'

const MAX_WA_SIZE = 99 * 1024 * 1024 // 99 MB
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TEMP_DL_DIR = path.join(ROOT_DIR, 'storage', 'temp', 'minecraft')
const UUID_RE = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/

function quoteOpts(ctx) {
  return ctx?.event ? { quote: ctx.event } : undefined
}

async function safeReact(ctx, emoji) {
  if (!ctx?.react) return
  try {
    await ctx.react(emoji)
  } catch {}
}

export async function replyQuoted(ctx, text) {
  try {
    return await ctx.client.message.send(ctx.chat, String(text), quoteOpts(ctx))
  } catch {
    return ctx.reply(String(text))
  }
}

export function authRequiredMessage(prefix = config.mainPrefix) {
  return (
    `*AKSES DITOLAK: BOT BELUM TERHUBUNG KE XBOX!*\n\n` +
    `Fitur ini membutuhkan sesi Xbox/PlayFab yang aktif.\n\n` +
    `*Solusi:* Silakan hubungi Owner bot untuk melakukan login ulang menggunakan perintah *${prefix}mcauth*.`
  )
}

async function sendImageWithCaption(ctx, imageUrl, caption) {
  if (!imageUrl) return false
  try {
    const imgBuf = await downloadUrlBuffer(imageUrl, { timeout: 6000 })
    const ft = await fileTypeFromBuffer(imgBuf).catch(() => null)
    const mimetype = ft?.mime?.startsWith('image/') ? ft.mime : 'image/jpeg'
    await ctx.client.message.send(
      ctx.chat,
      { type: 'image', media: imgBuf, mimetype, caption },
      quoteOpts(ctx)
    )
    return true
  } catch {
    return false
  }
}

async function sendLargeNotice(ctx, imageUrl, text) {
  if (await sendImageWithCaption(ctx, imageUrl, text)) return true

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ctx.client.message.send(ctx.chat, text, quoteOpts(ctx))
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  try {
    await ctx.reply(text)
    return true
  } catch {
    return false
  }
}

function formatMarketplaceList(items, headerLine, prefix) {
  let caption = `${headerLine}\n\n`
  const keys = {}

  items.forEach((item, i) => {
    keys[i + 1] = String(item.Id)
    caption += Toolcoin.formatItemText(item, i) + '\n'
  })

  caption += `━━━━━━━━━━━━━━━━\n`
  caption += `💡 *Cara Download:*\n`
  caption += `• Balas/Quote pesan ini dengan angka *(1 - ${items.length})*\n`
  caption += `• Atau ketik: *${prefix}mcdl <angka / ID / URL>*`

  return { caption: caption.trim(), keys }
}

function formatCurseForgeList(items, { header, limitDesc, compactMeta, footerHint }) {
  let caption = `${header}\n\n`
  const keys = {}

  items.forEach((item, i) => {
    keys[i + 1] = String(item.id)
    const creator = item.authors?.[0]?.name || 'Komunitas'
    const downloads = (item.downloadCount || 0).toLocaleString()
    const cat =
      (item.categories || [])
        .map((c) => c.name)
        .filter(Boolean)
        .slice(0, 2)
        .join(', ') || 'Bedrock Addon'
    const desc = (item.summary || '').replace(/<[^>]*>?/gm, '').slice(0, limitDesc).trim()

    caption += `*${i + 1}. ${item.name}*\n`
    if (compactMeta) {
      caption += `> 👤 Pembuat: ${creator} | 🏷️ ${cat} | 📥 ${downloads}x\n`
    } else {
      caption += `> 👤 Pembuat: ${creator} | 🏷️ ${cat}\n`
      caption += `> 📥 Unduhan: ${downloads}x diunduh\n`
    }
    caption += `> 📝 ${desc}...\n\n`
  })

  caption += `━━━━━━━━━━━━━━━━\n`
  caption += `💡 *Cara Download:*\n`
  caption += `• Balas/Quote pesan ini dengan angka *(1 - ${items.length})*\n`
  caption += footerHint

  return { caption: caption.trim(), keys }
}

/* ---------- Marketplace Search & Trending ---------- */
export async function runMcSearch(queryText, ctx) {
  const prefix = ctx.prefix || config.mainPrefix
  const command = ctx.command || 'mcsearch'
  const query = (queryText || '').trim()

  if (!query) {
    return replyQuoted(
      ctx,
      `🧱 *MINECRAFT MARKETPLACE SEARCH*\n\n` +
        `> Mau cari addon apa di Marketplace?\n\n` +
        `*Format:* \`${prefix}${command} <kata kunci>\`\n` +
        `*Contoh:* \`${prefix}${command} car\`\n` +
        `*Contoh:* \`${prefix}${command} furniture\``
    )
  }

  if (query.includes('curseforge.com') || /^cf:\d+$/i.test(query)) {
    return replyQuoted(
      ctx,
      `💡 Input terdeteksi sebagai CurseForge Bedrock. Gunakan perintah:\n\`${prefix}mcdl ${query}\``
    )
  }

  await safeReact(ctx, '🔍')
  await replyQuoted(ctx, `🔍 Sedang mencari *"${query}"* di Minecraft Marketplace...`)

  try {
    const items = await Toolcoin.search(query, 20)

    if (!items || items.length === 0) {
      const suggest = await findSuggestion(query, Toolcoin, cfEngine)
      if (suggest?.suggestedQuery) {
        setSession(ctx, {
          type: 'suggestion',
          suggestedQuery: suggest.suggestedQuery,
          source: 'marketplace',
          chat: ctx.chat
        })

        await safeReact(ctx, '❓')
        return replyQuoted(
          ctx,
          `*ADDON TIDAK DITEMUKAN*\n` +
            `Tidak ada addon Marketplace yang cocok untuk: *"${query}"*\n\n` +
            `💡 *Mungkin maksud kamu:* *"${suggest.suggestedQuery}"*?\n\n` +
            `• Balas pesan ini dengan *Y* untuk langsung mencari *"${suggest.suggestedQuery}"*\n` +
            `• Atau ketik: *${prefix}mcsearch ${suggest.suggestedQuery}*\n` +
            `• Atau ketik: *${prefix}cf ${suggest.suggestedQuery}* (CurseForge)`
        )
      }

      await safeReact(ctx, '❌')
      return replyQuoted(
        ctx,
        `❌ Tidak ada addon yang ditemukan untuk: *"${query}"*\n\nCoba cari dengan kata kunci lain dalam bahasa Inggris.`
      )
    }

    const { caption, keys } = formatMarketplaceList(
      items,
      `*MINECRAFT MARKETPLACE*\nHasil pencarian untuk: *"${query}"* (${items.length} Addon):`,
      prefix
    )

    setSession(ctx, {
      type: 'marketplace',
      query,
      keys,
      itemsCount: items.length,
      chat: ctx.chat
    })

    const first = Toolcoin.formatItem(items[0], 0)
    if (!(await sendImageWithCaption(ctx, first.imageUrl, caption))) {
      await replyQuoted(ctx, caption)
    }
    await safeReact(ctx, '✅')
  } catch (err) {
    console.error('[MCSearch Error]', err)
    await safeReact(ctx, '☢')
    if (err.message === 'NOT_LOGGED_IN') {
      return replyQuoted(ctx, authRequiredMessage(prefix))
    }
    await replyQuoted(ctx, `Terjadi kesalahan saat mencari di Marketplace: ${err.message}`)
  }
}

export async function runMcTrend(ctx) {
  const prefix = ctx.prefix || config.mainPrefix
  await safeReact(ctx, '🕕')
  await replyQuoted(ctx, 'Mengambil katalog 20 addon terbaru & terpopuler dari Marketplace...')

  try {
    const items = await Toolcoin.getTrending(20)
    if (!items || items.length === 0) {
      await safeReact(ctx, '❌')
      return replyQuoted(ctx, 'Katalog Marketplace sedang tidak dapat diakses atau kosong.')
    }

    const { caption, keys } = formatMarketplaceList(
      items,
      `*TOP / RECENT ADDONS MARKETPLACE* (${items.length} Teratas):`,
      prefix
    )

    setSession(ctx, {
      type: 'marketplace',
      query: 'trending',
      keys,
      itemsCount: items.length,
      chat: ctx.chat
    })

    const first = Toolcoin.formatItem(items[0], 0)
    if (!(await sendImageWithCaption(ctx, first.imageUrl, caption))) {
      await replyQuoted(ctx, caption)
    }
    await safeReact(ctx, '✅')
  } catch (err) {
    console.error('[MCTrend Error]', err)
    await safeReact(ctx, '☢')
    if (err.message === 'NOT_LOGGED_IN') {
      return replyQuoted(ctx, authRequiredMessage(prefix))
    }
    await replyQuoted(ctx, `Gagal mengambil katalog trending Marketplace: ${err.message}`)
  }
}

/* ---------- CurseForge Search & Trending ---------- */
export async function runCurseForgeSearch(queryText, ctx) {
  const prefix = ctx.prefix || config.mainPrefix
  const command = ctx.command || 'cf'
  const query = (queryText || '').trim()

  if (!query) {
    return replyQuoted(
      ctx,
      `🌐 *CURSEFORGE BEDROCK EDITION SEARCH*\n\n` +
        `> Mau cari addon Bedrock apa di CurseForge?\n\n` +
        `*Format:* \`${prefix}${command} <kata kunci>\`\n` +
        `*Contoh:* \`${prefix}${command} Better on Bedrock\`\n` +
        `*Contoh:* \`${prefix}${command} furniture\``
    )
  }

  if (query.includes('curseforge.com') || /^cf:\d+$/i.test(query) || /^\d{5,12}$/.test(query)) {
    return replyQuoted(
      ctx,
      `💡 Input terdeteksi sebagai Link/ID CurseForge. Gunakan perintah:\n\`${prefix}mcdl ${query}\``
    )
  }

  await safeReact(ctx, '🔍')
  await replyQuoted(ctx, `🔍 Sedang mencari *"${query}"* di CurseForge Bedrock Edition...`)

  try {
    const items = await cfEngine.searchBedrock({ searchFilter: query, pageSize: 15 })

    if (!items || items.length === 0) {
      const suggest = await findSuggestion(query, Toolcoin, cfEngine)
      if (suggest?.suggestedQuery) {
        setSession(ctx, {
          type: 'suggestion',
          suggestedQuery: suggest.suggestedQuery,
          source: 'curseforge',
          chat: ctx.chat
        })

        await safeReact(ctx, '❓')
        return replyQuoted(
          ctx,
          `*ADDON TIDAK DITEMUKAN*\n` +
            `Tidak ada addon CurseForge Bedrock yang ditemukan untuk: *"${query}"*\n\n` +
            `💡 *Mungkin maksud kamu:* *"${suggest.suggestedQuery}"*?\n\n` +
            `• Balas pesan ini dengan *Y* untuk langsung mencari *"${suggest.suggestedQuery}"*\n` +
            `• Atau ketik: *${prefix}cf ${suggest.suggestedQuery}*`
        )
      }

      await safeReact(ctx, '❌')
      return replyQuoted(
        ctx,
        `❌ Tidak ada addon CurseForge Bedrock yang ditemukan untuk: *"${query}"*`
      )
    }

    const { caption, keys } = formatCurseForgeList(items, {
      header: `*CURSEFORGE BEDROCK EDITION*\nHasil pencarian untuk: *"${query}"* (${items.length} Addon):`,
      limitDesc: 100,
      compactMeta: false,
      footerHint: `• Atau ketik: *${prefix}mcdl <angka / Link CurseForge / ID Mod>*`
    })

    setSession(ctx, {
      type: 'curseforge',
      query,
      keys,
      itemsCount: items.length,
      chat: ctx.chat
    })

    const imageUrl = items[0]?.logo?.thumbnailUrl || items[0]?.logo?.url || null
    if (!(await sendImageWithCaption(ctx, imageUrl, caption))) {
      await replyQuoted(ctx, caption)
    }
    await safeReact(ctx, '✅')
  } catch (err) {
    console.error('[CurseForge Search Error]', err)
    await safeReact(ctx, '☢')
    await replyQuoted(ctx, `Terjadi kesalahan saat mencari di CurseForge: ${err.message}`)
  }
}

export async function runCurseForgeTrend(ctx) {
  const prefix = ctx.prefix || config.mainPrefix
  await safeReact(ctx, '🕕')
  await replyQuoted(ctx, 'Mengambil katalog 15 addon paling populer di CurseForge Bedrock Edition...')

  try {
    const items = await cfEngine.getTrendingBedrock(15)
    if (!items || items.length === 0) {
      await safeReact(ctx, '❌')
      return replyQuoted(ctx, 'Katalog CurseForge sedang tidak dapat diakses saat ini.')
    }

    const { caption, keys } = formatCurseForgeList(items, {
      header: `*TOP POPULER CURSEFORGE BEDROCK*\nAddon paling banyak diunduh oleh komunitas:`,
      limitDesc: 90,
      compactMeta: true,
      footerHint: `• Atau ketik: *${prefix}mcdl <angka / ID / Link>*`
    })

    setSession(ctx, {
      type: 'curseforge',
      query: 'trending',
      keys,
      itemsCount: items.length,
      chat: ctx.chat
    })

    const imageUrl = items[0]?.logo?.thumbnailUrl || items[0]?.logo?.url || null
    if (!(await sendImageWithCaption(ctx, imageUrl, caption))) {
      await replyQuoted(ctx, caption)
    }
    await safeReact(ctx, '✅')
  } catch (err) {
    console.error('[CurseForge Trend Error]', err)
    await safeReact(ctx, '☢')
    await replyQuoted(ctx, `Gagal memuat trending CurseForge: ${err.message}`)
  }
}

/* ---------- Universal Downloader (CurseForge + Marketplace DRM Bypass) ---------- */
async function downloadCurseForgeAddon(ctx, { rawInput, cfModId }) {
  await safeReact(ctx, '🕕')
  await replyQuoted(
    ctx,
    'MCDL | CurseForge Bedrock Downloader\n\nMenghubungi edge CDN CurseForge & memeriksa berkas Bedrock...'
  )

  let localPath = null
  try {
    const mod = cfModId
      ? await cfEngine.getMod(cfModId)
      : await cfEngine.resolveBedrockMod(rawInput)

    if (!mod) {
      await safeReact(ctx, '❌')
      return replyQuoted(ctx, '❌ Addon CurseForge Bedrock tidak ditemukan.')
    }

    if (Number(mod.gameId) !== BEDROCK_GAME_ID) {
      await safeReact(ctx, '⚠️')
      return replyQuoted(
        ctx,
        '⚠️ *PERINGATAN: KONTEN JAVA EDITION TERDETEKSI*\n\n' +
          'Item ini adalah mod *Minecraft Java Edition (.jar)*, bukan untuk *Minecraft Bedrock*!\n' +
          'Bot ini khusus melayani konten *Minecraft Bedrock Edition (.mcaddon / .mcpack / .mcworld)*.'
      )
    }

    const files = await cfEngine.getModFiles(mod.id)
    const targetFile = files?.[0]
    if (!targetFile) {
      await safeReact(ctx, '❌')
      return replyQuoted(ctx, '❌ Tidak ada berkas unduhan yang tersedia untuk addon ini.')
    }

    const dlUrl = await cfEngine.getDownloadUrl(mod.id, targetFile.id)
    const fileName = targetFile.fileName || `${mod.slug || 'addon'}.mcaddon`
    const fileSizeMB = ((targetFile.fileLength || 0) / (1024 * 1024)).toFixed(2)

    await replyQuoted(
      ctx,
      `Sedang Mengunduh Addon CurseForge: *${mod.name}* (${fileSizeMB} MB)...\n` +
        `_Mohon tunggu sebentar, berkas sedang disiapkan langsung dari CDN resmi..._`
    )

    if (!fs.existsSync(TEMP_DL_DIR)) fs.mkdirSync(TEMP_DL_DIR, { recursive: true })
    const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
    localPath = path.join(TEMP_DL_DIR, `cf_${mod.id}_${uniqueSuffix}_${path.basename(fileName)}`)

    const dlRes = await Toolcoin.downloadFile(dlUrl, localPath)
    if (!dlRes.success) throw new Error(dlRes.error || 'Gagal mengunduh berkas dari CDN')

    const actualSize = fs.statSync(localPath).size
    const actualMB = (actualSize / (1024 * 1024)).toFixed(2)

    if (actualSize > MAX_WA_SIZE) {
      try {
        await replyQuoted(
          ctx,
          `Ukuran berkas (${actualMB} MB) melebihi batas 100 MB WhatsApp. Mengunggah ke GoFile (High-Speed)...`
        )
      } catch {}

      const upRes = await Toolcoin.uploadToGoFile(localPath, fileName)
      try {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
      } catch {}
      localPath = null

      await safeReact(ctx, '✅')
      if (upRes.success && upRes.downloadPage) {
        const cfText =
          `*BERKAS CURSEFORGE SIAP DIUNDUH (${(upRes.host || 'GOFILE').toUpperCase()})*\n\n` +
          `Judul: *${mod.name}*\n` +
          `Ukuran: *${actualMB} MB*\n` +
          `Format: *Minecraft Bedrock Ready*\n\n` +
          `📥 *Link Unduh (${upRes.host || 'GoFile'}):*\n${upRes.downloadPage}\n\n` +
          `*Panduan Download di HP:*\n` +
          `1. Buka link di atas di browser kamu.\n` +
          `2. Tekan tombol titik tiga *[⋮]* lalu pilih *Download*.\n` +
          `3. Ketuk berkas untuk langsung mengimpor ke Minecraft Bedrock!\n` +
          `💡 _Tips: Jika nama file berakhiran .zip, ganti nama (rename) dan hapus akhiran .zip tersebut._`
        await sendLargeNotice(ctx, null, cfText)
        return
      }

      const cfFallback =
        `*BERKAS BESAR (CURSEFORGE CDN)*\n\n` +
        `Judul: *${mod.name}* (${actualMB} MB)\n` +
        `Unduh langsung dari tautan CDN resmi berikut:\n${dlUrl}`
      await sendLargeNotice(ctx, null, cfFallback)
      return
    }

    const extLabel = fileName.endsWith('.mcpack')
      ? 'Resource / Texture Pack'
      : fileName.endsWith('.mcworld')
        ? 'World Template'
        : 'Addon Bedrock'

    const caption =
      `*ADDON CURSEFORGE BERHASIL DIUNDUH*\n\n` +
      `Judul: *${mod.name}*\n` +
      `Pembuat: *${mod.authors?.[0]?.name || 'Komunitas'}*\n` +
      `Kategori: *${extLabel}*\n` +
      `Ukuran: *${actualMB} MB*\n` +
      `Format: *Minecraft Bedrock Ready*\n\n` +
      `*Cara Pasang:*\nKetuk dokumen ini di HP/PC kamu untuk otomatis mengimpor ke Minecraft Bedrock!`

    await ctx.client.message.send(
      ctx.chat,
      {
        type: 'document',
        media: localPath,
        fileName,
        mimetype: 'application/octet-stream',
        caption
      },
      quoteOpts(ctx)
    )

    await safeReact(ctx, '✅')
  } catch (err) {
    if (err.message === 'JAVA_EDITION_DETECTED') {
      await safeReact(ctx, '⚠️')
      return replyQuoted(
        ctx,
        '⚠️ *PERINGATAN: KONTEN JAVA EDITION TERDETEKSI*\n\n' +
          'Item ini adalah mod *Minecraft Java Edition (.jar)*, bukan untuk *Minecraft Bedrock*!\n' +
          'Bot ini khusus melayani konten *Minecraft Bedrock Edition (.mcaddon / .mcpack / .mcworld)*.'
      )
    }
    console.error('[CurseForge DL Error]', err)
    await safeReact(ctx, '☢')
    return replyQuoted(ctx, 'Terjadi kesalahan saat mengunduh CurseForge: ' + err.message)
  } finally {
    if (localPath) {
      try {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
      } catch {}
    }
  }
}

async function downloadMarketplaceAddon(ctx, { rawInput, uuid, isExplicitUuid, prefix }) {
  const initialNotice = isExplicitUuid
    ? `MCDL | Minecraft Marketplace Downloader\n\nMemproses UUID: \`${uuid}\`\nMengambil metadata CDN dari PlayFab...`
    : `MCDL | Minecraft Marketplace Downloader\n\nMencari addon: *"${rawInput}"*\nMengambil metadata CDN dari PlayFab...`

  await safeReact(ctx, '🕕')
  await replyQuoted(ctx, initialNotice)

  let processedPath = null
  try {
    const result = await Toolcoin.getAddonInfo(uuid)
    if (!result.success) {
      await safeReact(ctx, '❌')
      return replyQuoted(ctx, 'Gagal mengambil info addon dari PlayFab:\n' + result.error)
    }

    const isLargeFile = result.fileSize > MAX_WA_SIZE
    const sizeMbText =
      result.fileSize > 0 ? `${(result.fileSize / 1024 / 1024).toFixed(1)} MB` : 'Menghitung...'

    const statusMsg = isLargeFile
      ? `Sedang Mengunduh & Memproses Addon (File Besar)...\nJudul: *${result.title}*\nUkuran: *${sizeMbText}*\n\n` +
        `_Ukuran CDN: ${sizeMbText}. Berkas sedang didekripsi AES-256-CFB8 & dikompresi siap pakai (jika hasil akhir > 100 MB akan diunggah ke GoFile, jika <= 100 MB langsung dikirim ke chat)..._`
      : `Sedang Mengunduh & Memproses...\nJudul: *${result.title}*\nUkuran: *${sizeMbText}*\n\n` +
        `_Proses unduh berkas dari CDN & dekripsi DRM sedang berjalan (estimasi 1–3 menit). Mohon tunggu ya..._`

    await replyQuoted(ctx, statusMsg)

    const procRes = await Toolcoin.downloadAndProcess(uuid, result.downloadUrl, result.fileName)
    if (!procRes.success) {
      await safeReact(ctx, '☢')
      return replyQuoted(ctx, 'Gagal memproses addon Marketplace:\n' + procRes.error)
    }

    if (!fs.existsSync(procRes.path)) {
      await safeReact(ctx, '☢')
      return replyQuoted(ctx, 'File hasil dekripsi tidak ditemukan di server bot.')
    }

    processedPath = procRes.path
    result.fileName = path.basename(procRes.path)

    const fileStats = fs.statSync(procRes.path)
    const actualMb = (fileStats.size / 1024 / 1024).toFixed(2)
    const drmLabel = procRes.isEncrypted
      ? procRes.decrypted
        ? 'Bypassed (Siap Pakai)'
        : 'Terkunci DRM'
      : 'Bebas DRM (Unencrypted)'
    const formatLabel = result.fileName.endsWith('.mcaddon')
      ? 'Minecraft Addon (.mcaddon)'
      : result.fileName.endsWith('.mctemplate')
        ? 'Minecraft World Template (.mctemplate)'
        : 'Minecraft Pack (.mcpack)'

    if (fileStats.size > MAX_WA_SIZE) {
      try {
        await replyQuoted(
          ctx,
          `Sedang mengunggah berkas terdekripsi (*${result.fileName}* - ${actualMb} MB) ke GoFile... Mohon tunggu.`
        )
      } catch {}

      const upRes = await Toolcoin.uploadToGoFile(procRes.path, result.fileName)
      Toolcoin.cleanupTempFile(procRes.path)
      processedPath = null

      if (upRes.success && upRes.downloadPage) {
        const text =
          `*DOWNLOAD BERHASIL (FILE BESAR)*\n\n` +
          `*Judul:* ${result.title}\n` +
          `*Tipe:* ${result.contentType}\n` +
          `*Ukuran:* ${actualMb} MB\n` +
          `*DRM:* ${drmLabel}\n` +
          `*Format:* ${formatLabel}\n\n` +
          `⚠️ _Ukuran berkas (${actualMb} MB) melebihi batas upload langsung WhatsApp (100 MB)._\n` +
          `_Berkas telah didekripsi penuh menjadi berkas asli siap pasang dan diunggah ke ${upRes.host || 'GoFile'}._\n\n` +
          `📥 *Link Unduh (${upRes.host || 'GoFile'}):*\n${upRes.downloadPage}\n\n` +
          `ℹ️ *Petunjuk Pengunduhan:*\n` +
          `1. Klik link di atas untuk membukanya di browser.\n` +
          `2. Di halaman download, klik tombol *Download* di samping berkas (jika lewat HP, tekan ikon titik tiga *[⋮]* lalu pilih *Download*).\n` +
          `3. Berkas akan langsung terunduh dan siap dibuka untuk dipasang ke Minecraft!\n` +
          `💡 *Tips Rename:* Jika nama file terunduh otomatis berakhiran *.zip*, cukup ubah nama (rename) file dan hapus *.zip* di ujungnya agar langsung bisa dibuka di Minecraft!`

        await sendLargeNotice(ctx, result.imageUrl, text)
        await safeReact(ctx, '✅')
        return
      }

      const fallbackText =
        `*DOWNLOAD BERHASIL (FILE BESAR)*\n\n` +
        `*Judul:* ${result.title}\n` +
        `*Tipe:* ${result.contentType}\n` +
        `*Ukuran:* ${actualMb} MB\n` +
        `*Format:* ${formatLabel}\n\n` +
        `📥 *Link Unduh Langsung (High-Speed CDN):*\n${result.downloadUrl}\n\n` +
        `ℹ️ *Petunjuk:* Buka link di atas melalui browser kamu untuk langsung mengunduh berkas.`

      await sendLargeNotice(ctx, result.imageUrl, fallbackText)
      await safeReact(ctx, '✅')
      return
    }

    let caption = '*DOWNLOAD BERHASIL*\n\n'
    caption += `*Judul:* ${result.title}\n`
    caption += `*Tipe:* ${result.contentType}\n`
    caption += `*Ukuran:* ${actualMb} MB\n`
    caption += `*DRM:* ${drmLabel}\n\n`
    if (procRes.warning) caption += `_${procRes.warning}_\n\n`
    caption += '_Klik berkas di bawah untuk langsung memasang ke game Minecraft kamu!_'

    try {
      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'document',
          media: procRes.path,
          mimetype: 'application/octet-stream',
          fileName: result.fileName,
          caption
        },
        quoteOpts(ctx)
      )
      await safeReact(ctx, '✅')
    } catch (sendErr) {
      console.warn('[WA-MCDL] Gagal kirim dokumen WhatsApp, fallback ke GoFile:', sendErr.message)
      try {
        await replyQuoted(
          ctx,
          `⚠️ Gagal mengirim dokumen langsung di chat WhatsApp (${sendErr.message}). Mengalihkan ke GoFile...`
        )
      } catch {}

      const upRes = await Toolcoin.uploadToGoFile(procRes.path, result.fileName)
      if (upRes.success && upRes.downloadPage) {
        const fbText =
          `*DOWNLOAD BERHASIL (VIA ${String(upRes.host || 'GOFILE').toUpperCase()})*\n\n` +
          `*Judul:* ${result.title}\n` +
          `*Ukuran:* ${actualMb} MB\n` +
          `*Format:* ${result.fileName}\n\n` +
          `📥 *Link Unduh (${upRes.host || 'GoFile'}):*\n${upRes.downloadPage}\n\n` +
          `ℹ️ *Petunjuk Pengunduhan:*\n` +
          `1. Buka link di atas di browser kamu.\n` +
          `2. Klik tombol *Download* di samping berkas (jika lewat HP, tekan ikon titik tiga *[⋮]* lalu pilih *Download*).\n` +
          `3. Berkas akan langsung terunduh dan siap dipasang ke game Minecraft!`
        await sendLargeNotice(ctx, null, fbText)
        await safeReact(ctx, '✅')
      } else {
        throw sendErr
      }
    }
  } catch (err) {
    console.error('[MCDL Error]', err)
    await safeReact(ctx, '☢')
    if (err.message === 'NOT_LOGGED_IN') {
      return replyQuoted(ctx, authRequiredMessage(prefix))
    }
    await replyQuoted(ctx, 'Terjadi kesalahan saat memproses download: ' + err.message)
  } finally {
    if (processedPath) Toolcoin.cleanupTempFile(processedPath)
  }
}

export async function downloadCore(input, ctx) {
  const prefix = ctx.prefix || config.mainPrefix
  let isCurseForge = false
  let cfModId = null
  let uuid = null
  let isExplicitUuid = false

  const rawInput = (input || '').trim()

  if (rawInput.includes('curseforge.com')) {
    isCurseForge = true
  } else if (/^cf:(\d+)$/i.test(rawInput)) {
    isCurseForge = true
    cfModId = parseInt(rawInput.replace(/^cf:/i, ''), 10)
  } else if (/^\d{5,12}$/.test(rawInput)) {
    isCurseForge = true
    cfModId = parseInt(rawInput, 10)
  } else if (/^[1-9][0-9]?$/.test(rawInput)) {
    const session = getSession(ctx)
    const keys = session?.keys || {}

    if (keys[rawInput]) {
      const val = keys[rawInput]
      if (typeof val === 'number' || /^\d+$/.test(String(val)) || String(val).startsWith('cf:')) {
        isCurseForge = true
        cfModId = parseInt(String(val).replace(/^cf:/i, ''), 10)
      } else {
        uuid = String(val)
        isExplicitUuid = true
      }
    } else {
      return replyQuoted(
        ctx,
        `❌ Nomor urut (*${rawInput}*) tidak ditemukan atau sesi sudah kedaluwarsa.\n\n` +
          `Silakan cari ulang dengan *${prefix}mcsearch <nama>* atau *${prefix}cf <nama>*`
      )
    }
  } else if (rawInput.includes('minecraft.net')) {
    const match = rawInput.match(UUID_RE)
    if (match?.[0]) {
      uuid = match[0]
      isExplicitUuid = true
    } else {
      return replyQuoted(
        ctx,
        '❌ URL Marketplace tidak valid! Tidak ditemukan UUID standar pada link tersebut.'
      )
    }
  } else {
    const match = rawInput.match(UUID_RE)
    if (match?.[0]) {
      uuid = match[0]
      isExplicitUuid = true
    } else if (rawInput.length > 0) {
      try {
        const mcItems = await Toolcoin.search(rawInput, 1)
        if (mcItems?.length > 0) {
          uuid = mcItems[0].Id
          isExplicitUuid = true
        }
      } catch {}

      if (!uuid) {
        try {
          const cfItems = await cfEngine.searchBedrock({ searchFilter: rawInput, pageSize: 1 })
          if (cfItems?.length > 0) {
            isCurseForge = true
            cfModId = cfItems[0].id
          }
        } catch {}
      }

      if (!uuid && !isCurseForge) {
        const suggest = await findSuggestion(rawInput, Toolcoin, cfEngine)
        if (suggest?.suggestedQuery) {
          setSession(ctx, {
            type: 'suggestion',
            suggestedQuery: suggest.suggestedQuery,
            source: 'mcdl',
            chat: ctx.chat
          })
          return replyQuoted(
            ctx,
            `Addon *"${rawInput}"* tidak ditemukan di katalog Marketplace maupun CurseForge Bedrock.\n\n` +
              `💡 *Mungkin maksud kamu:* *"${suggest.suggestedQuery}"*?\n\n` +
              `• Balas *Y* untuk langsung mengunduh *"${suggest.suggestedQuery}"*\n` +
              `• Atau ketik: *${prefix}mcdl ${suggest.suggestedQuery}*`
          )
        }
        return replyQuoted(
          ctx,
          `❌ Addon *"${rawInput}"* tidak ditemukan di katalog Marketplace maupun CurseForge Bedrock.`
        )
      }
    }
  }

  if (isCurseForge) {
    return downloadCurseForgeAddon(ctx, { rawInput, cfModId })
  }
  return downloadMarketplaceAddon(ctx, { rawInput, uuid, isExplicitUuid, prefix })
}
