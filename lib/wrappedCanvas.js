/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * wrappedCanvas.js — Renderer kartu editorial Group Wrapped (.wrapped) berbasis @napi-rs/canvas
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawTextWithEmojis, loadEmojiMap, measureTextWithEmojis } from './emojiRenderer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ASSETS_DIR = path.join(__dirname, 'assets')

const FONT_REGULAR_URL = 'https://github.com/rsms/inter/raw/refs/heads/master/docs/font-files/Inter-Regular.woff2'
const FONT_BOLD_URL = 'https://github.com/rsms/inter/raw/refs/heads/master/docs/font-files/Inter-Bold.woff2'
const FONT_REGULAR_PATH = path.join(ASSETS_DIR, 'Inter-Regular.woff2')
const FONT_BOLD_PATH = path.join(ASSETS_DIR, 'Inter-Bold.woff2')
const FALLBACK_FONT_PATH = path.join(ROOT, 'assets', 'fonts', 'LiberationSans-Bold.ttf')

const W = 1080
const H = 1350

let fontRegularFamily = 'sans-serif'
let fontBoldFamily = 'sans-serif'
let fontsChecked = false
let emojiMapReady = null

async function ensureFonts() {
  if (fontsChecked) return
  fontsChecked = true
  try {
    fs.mkdirSync(ASSETS_DIR, { recursive: true })
    if (!fs.existsSync(FONT_REGULAR_PATH)) {
      const r = await fetch(FONT_REGULAR_URL, { signal: AbortSignal.timeout(8_000) })
      if (r.ok) fs.writeFileSync(FONT_REGULAR_PATH, Buffer.from(await r.arrayBuffer()))
    }
    if (!fs.existsSync(FONT_BOLD_PATH)) {
      const r = await fetch(FONT_BOLD_URL, { signal: AbortSignal.timeout(8_000) })
      if (r.ok) fs.writeFileSync(FONT_BOLD_PATH, Buffer.from(await r.arrayBuffer()))
    }
  } catch {}

  try {
    if (fs.existsSync(FONT_REGULAR_PATH) && (GlobalFonts.registerFromPath(FONT_REGULAR_PATH, 'WrappedInter') || GlobalFonts.has('WrappedInter'))) {
      fontRegularFamily = 'WrappedInter'
    }
  } catch {}

  try {
    if (fs.existsSync(FONT_BOLD_PATH) && (GlobalFonts.registerFromPath(FONT_BOLD_PATH, 'WrappedInterBold') || GlobalFonts.has('WrappedInterBold'))) {
      fontBoldFamily = 'WrappedInterBold'
    } else if (fs.existsSync(FALLBACK_FONT_PATH) && (GlobalFonts.registerFromPath(FALLBACK_FONT_PATH, 'WrappedLibBold') || GlobalFonts.has('WrappedLibBold'))) {
      fontBoldFamily = 'WrappedLibBold'
    }
  } catch {}
}

async function ensureEmojiMapSafe() {
  if (emojiMapReady !== null) return emojiMapReady
  try {
    await Promise.race([
      loadEmojiMap(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
    ])
    emojiMapReady = true
  } catch {
    emojiMapReady = false
  }
  return emojiMapReady
}

function setFont(ctx, size, bold = false) {
  const family = bold ? fontBoldFamily : fontRegularFamily
  ctx.font = `${bold ? 'bold ' : ''}${size}px "${family}", sans-serif`
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.arcTo(x + w, y, x + w, y + rad, rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad)
  ctx.lineTo(x + rad, y + h)
  ctx.arcTo(x, y + h, x, y + h - rad, rad)
  ctx.lineTo(x, y + rad)
  ctx.arcTo(x, y, x + rad, y, rad)
  ctx.closePath()
}

function fillCard(ctx, x, y, w, h, r, { fill = '#131822', stroke = 'rgba(255,255,255,0.08)', lineWidth = 1.5 } = {}) {
  drawRoundedRect(ctx, x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
}

function stripEmojiIfOffline(str, hasEmojiMap) {
  if (hasEmojiMap) return String(str || '')
  return String(str || '')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function measureMixed(ctx, text, fontSize, hasEmojiMap) {
  if (hasEmojiMap) return measureTextWithEmojis(ctx, text, fontSize)
  return ctx.measureText(text).width
}

function fitText(ctx, rawText, maxW, fontSize, hasEmojiMap) {
  const text = stripEmojiIfOffline(rawText, hasEmojiMap) || String(rawText || '-')
  if (measureMixed(ctx, text, fontSize, hasEmojiMap) <= maxW) return text

  const chars = [...text]
  while (chars.length > 1) {
    chars.pop()
    const cand = `${chars.join('').trimEnd()}…`
    if (measureMixed(ctx, cand, fontSize, hasEmojiMap) <= maxW) return cand
  }
  return '…'
}

async function drawMixedText(ctx, text, x, y, fontSize, color, hasEmojiMap) {
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  if (hasEmojiMap) {
    await drawTextWithEmojis(ctx, text, x, y, fontSize)
  } else {
    ctx.fillText(text, x, y)
  }
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('id-ID')
}

function fmtHourRange(h) {
  const start = String(h).padStart(2, '0')
  const end = String((h + 1) % 24).padStart(2, '0')
  return `${start}:00–${end}:00`
}

export async function renderGroupWrappedCard(stats, { groupName = 'Grup WhatsApp', botName = 'Hitori-MD' } = {}) {
  await ensureFonts()
  const hasEmojiMap = await ensureEmojiMapSafe()

  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // 1. Latar Midnight Editorial + ambient glow halus
  ctx.fillStyle = '#0B0E14'
  ctx.fillRect(0, 0, W, H)

  const glowTop = ctx.createRadialGradient(940, 110, 20, 940, 110, 480)
  glowTop.addColorStop(0, 'rgba(30, 215, 96, 0.11)')
  glowTop.addColorStop(1, 'rgba(30, 215, 96, 0)')
  ctx.fillStyle = glowTop
  ctx.fillRect(0, 0, W, H)

  const glowBottom = ctx.createRadialGradient(130, 1230, 20, 130, 1230, 440)
  glowBottom.addColorStop(0, 'rgba(56, 189, 248, 0.07)')
  glowBottom.addColorStop(1, 'rgba(56, 189, 248, 0)')
  ctx.fillStyle = glowBottom
  ctx.fillRect(0, 0, W, H)

  // Grid hairline super tipis untuk tekstur editorial
  ctx.strokeStyle = 'rgba(255,255,255,0.022)'
  ctx.lineWidth = 1
  for (let gx = 48; gx <= W - 48; gx += 82) {
    ctx.beginPath()
    ctx.moveTo(gx, 0)
    ctx.lineTo(gx, H)
    ctx.stroke()
  }

  // 2. Masthead (y: 48..206)
  fillCard(ctx, 48, 48, 224, 34, 17, {
    fill: 'rgba(30, 215, 96, 0.12)',
    stroke: 'rgba(30, 215, 96, 0.36)',
    lineWidth: 1.2
  })
  ctx.beginPath()
  ctx.arc(70, 65, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = '#1ED760'
  ctx.fill()

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  setFont(ctx, 13, true)
  ctx.fillStyle = '#1ED760'
  ctx.fillText('GROUP WRAPPED • WIB', 84, 65.5)

  ctx.textAlign = 'right'
  setFont(ctx, 16, true)
  ctx.fillStyle = '#9AA4B2'
  ctx.fillText(stats.monthLabel || stats.month, W - 48, 65.5)

  setFont(ctx, 42, true)
  const fittedGroup = fitText(ctx, groupName, W - 96, 42, hasEmojiMap)
  await drawMixedText(ctx, fittedGroup, 48, 102, 42, '#F3F6FA', hasEmojiMap)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  setFont(ctx, 19, false)
  ctx.fillStyle = '#8B949E'
  ctx.fillText(
    `${fmtNum(stats.totals.activeMembers)} member aktif berkontribusi bulan ini`,
    48,
    162
  )

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(48, 206)
  ctx.lineTo(W - 48, 206)
  ctx.stroke()

  // 3. Hero Card: Total Aktivitas + Bar Chart 24 Jam WIB (y: 230..516)
  fillCard(ctx, 48, 230, 984, 286, 22, { fill: '#131822' })

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  setFont(ctx, 13, true)
  ctx.fillStyle = '#8B949E'
  ctx.fillText('TOTAL AKTIVITAS BULAN INI', 80, 260)

  setFont(ctx, 64, true)
  ctx.fillStyle = '#F3F6FA'
  ctx.fillText(fmtNum(stats.totals.messages), 80, 286)

  setFont(ctx, 19, false)
  ctx.fillStyle = '#9AA4B2'
  ctx.fillText('pesan tercatat di grup', 80, 362)

  const miniStats = [
    { label: 'Stiker', value: fmtNum(stats.totals.stickers) },
    { label: 'Media', value: fmtNum(stats.totals.media) },
    { label: 'Cmd Bot', value: fmtNum(stats.totals.commands) }
  ]
  miniStats.forEach((st, idx) => {
    const mx = 80 + idx * 124
    setFont(ctx, 25, true)
    ctx.fillStyle = '#F3F6FA'
    ctx.fillText(st.value, mx, 420)
    setFont(ctx, 14, false)
    ctx.fillStyle = '#8B949E'
    ctx.fillText(st.label, mx, 454)
  })

  // Divider vertikal di dalam Hero Card
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(470, 260)
  ctx.lineTo(470, 486)
  ctx.stroke()

  // Chart 24 Jam (kanan Hero Card)
  setFont(ctx, 13, true)
  ctx.fillStyle = '#8B949E'
  ctx.fillText('JAM AKTIF (WIB)', 504, 260)

  const peakLabel =
    stats.totals.peakHourCount > 0
      ? `Puncak ${fmtHourRange(stats.totals.peakHour)}`
      : 'Belum ada data'
  setFont(ctx, 13, true)
  const pillTextW = ctx.measureText(peakLabel).width + 26
  fillCard(ctx, 1000 - pillTextW, 252, pillTextW, 28, 14, {
    fill: 'rgba(30, 215, 96, 0.14)',
    stroke: 'rgba(30, 215, 96, 0.35)',
    lineWidth: 1
  })
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1ED760'
  ctx.fillText(peakLabel, 1000 - pillTextW / 2, 266.5)

  const chartX = 504
  const chartBottomY = 446
  const chartMaxH = 132
  const maxHourVal = Math.max(1, stats.totals.peakHourCount || 0)
  const sortedHours = [...stats.hourly].sort((a, b) => b.count - a.count)
  const top3Set = new Set(sortedHours.slice(0, 3).filter((h) => h.count > 0).map((h) => h.hour))

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(chartX, chartBottomY + 4)
  ctx.lineTo(1000, chartBottomY + 4)
  ctx.stroke()

  const barW = 13
  const barGap = 7.7
  for (let i = 0; i < 24; i++) {
    const val = stats.hourly[i]?.count || 0
    const ratio = val / maxHourVal
    const barH = val > 0 ? Math.max(10, Math.round(ratio * chartMaxH)) : 6
    const bx = Math.round(chartX + i * (barW + barGap))
    const by = chartBottomY - barH

    let fill = 'rgba(255,255,255,0.08)'
    if (val > 0) {
      if (i === stats.totals.peakHour) fill = '#1ED760'
      else if (top3Set.has(i)) fill = 'rgba(30, 215, 96, 0.45)'
      else fill = 'rgba(255,255,255,0.20)'
    }

    drawRoundedRect(ctx, bx, by, barW, barH, 5)
    ctx.fillStyle = fill
    ctx.fill()
  }

  ctx.textBaseline = 'top'
  ctx.fillStyle = '#6E7681'
  setFont(ctx, 13, false)
  for (const hMark of [0, 6, 12, 18, 23]) {
    const lx = chartX + hMark * (barW + barGap) + barW / 2
    ctx.textAlign = hMark === 0 ? 'left' : hMark === 23 ? 'right' : 'center'
    ctx.fillText(`${String(hMark).padStart(2, '0')}:00`, hMark === 0 ? chartX : hMark === 23 ? 1000 : lx, 458)
  }

  // 4. Split Columns: Top Yappers (kiri) & Group Awards (kanan) (y: 540..1070)
  // Kolom Kiri: Top Yappers
  fillCard(ctx, 48, 540, 504, 530, 22, { fill: '#131822' })
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  setFont(ctx, 14, true)
  ctx.fillStyle = '#8B949E'
  ctx.fillText('TOP YAPPERS', 80, 572)

  ctx.textAlign = 'right'
  setFont(ctx, 14, false)
  ctx.fillStyle = '#6E7681'
  ctx.fillText('Peringkat Keaktifan', 520, 572)

  const rankColors = ['#F5B742', '#1ED760', '#38BDF8']
  const maxYapperMsg = Math.max(1, stats.topYappers[0]?.msgCount || 1)

  for (let i = 0; i < 3; i++) {
    const ry = 616 + i * 144
    const item = stats.topYappers[i]
    const isFirst = i === 0 && Boolean(item)

    fillCard(ctx, 76, ry, 448, 124, 16, {
      fill: '#181F2C',
      stroke: isFirst ? 'rgba(245, 183, 66, 0.38)' : 'rgba(255,255,255,0.06)',
      lineWidth: 1.4
    })

    // Rank badge
    fillCard(ctx, 96, ry + 20, 36, 36, 10, {
      fill: item ? (i === 0 ? '#F5B742' : '#242D3E') : '#1E2430',
      stroke: null
    })
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setFont(ctx, 16, true)
    ctx.fillStyle = i === 0 && item ? '#0B0E14' : '#E6EDF3'
    ctx.fillText(`#${i + 1}`, 114, ry + 38.5)

    if (!item) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      setFont(ctx, 18, false)
      ctx.fillStyle = '#6E7681'
      ctx.fillText('Belum ada data member', 148, ry + 38)
      continue
    }

    // Count kanan atas
    const countLabel = fmtNum(item.msgCount)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    setFont(ctx, 21, true)
    ctx.fillStyle = rankColors[i]
    const numW = ctx.measureText(countLabel).width
    ctx.fillText(countLabel, 504, ry + 18)

    setFont(ctx, 13, false)
    ctx.fillStyle = '#8B949E'
    ctx.fillText(`${item.pct}% share`, 504, ry + 45)

    // Display name
    const maxNameW = Math.max(120, 504 - numW - 22 - 148)
    setFont(ctx, 22, true)
    const fittedName = fitText(ctx, item.displayName, maxNameW, 22, hasEmojiMap)
    await drawMixedText(ctx, fittedName, 148, ry + 17, 22, '#F3F6FA', hasEmojiMap)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    setFont(ctx, 14, false)
    ctx.fillStyle = '#8B949E'
    ctx.fillText(
      `${item.activeDaysCount} hari aktif • ${fmtNum(item.stickerCount)} stiker`,
      148,
      ry + 50
    )

    // Progress bar
    const trackX = 96
    const trackY = ry + 92
    const trackW = 408
    drawRoundedRect(ctx, trackX, trackY, trackW, 9, 4.5)
    ctx.fillStyle = '#0D121B'
    ctx.fill()

    const fillW = Math.max(14, Math.round((item.msgCount / maxYapperMsg) * trackW))
    drawRoundedRect(ctx, trackX, trackY, fillW, 9, 4.5)
    ctx.fillStyle = rankColors[i]
    ctx.fill()
  }

  // Kolom Kanan: Group Awards
  fillCard(ctx, 576, 540, 456, 530, 22, { fill: '#131822' })
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  setFont(ctx, 14, true)
  ctx.fillStyle = '#8B949E'
  ctx.fillText('GROUP AWARDS', 608, 572)

  ctx.textAlign = 'right'
  setFont(ctx, 14, false)
  ctx.fillStyle = '#6E7681'
  ctx.fillText('Sorotan Spesial', 1000, 572)

  const thirdAward = stats.awards.botBestie
    ? {
        title: 'SOBAT BOT',
        tag: 'CMD TERBANYAK',
        accent: '#1ED760',
        tint: 'rgba(30, 215, 96, 0.14)',
        winner: stats.awards.botBestie,
        unit: 'command dijalankan'
      }
    : {
        title: 'MEDIA PLUG',
        tag: 'FOTO & VIDEO',
        accent: '#1ED760',
        tint: 'rgba(30, 215, 96, 0.14)',
        winner: stats.awards.mediaPlug,
        unit: 'file media dikirim'
      }

  const awardCards = [
    {
      title: 'RAJA STIKER',
      tag: 'STICKER SPAMMER',
      accent: '#38BDF8',
      tint: 'rgba(56, 189, 248, 0.14)',
      winner: stats.awards.stickerKing,
      unit: 'stiker dikirim'
    },
    {
      title: 'KALONG GRUP',
      tag: '23:00–04:59 WIB',
      accent: '#A78BFA',
      tint: 'rgba(167, 139, 250, 0.14)',
      winner: stats.awards.nightOwl,
      unit: 'pesan larut malam'
    },
    thirdAward
  ]

  for (let i = 0; i < awardCards.length; i++) {
    const ay = 616 + i * 144
    const aw = awardCards[i]

    fillCard(ctx, 604, ay, 400, 124, 16, {
      fill: '#181F2C',
      stroke: 'rgba(255,255,255,0.06)',
      lineWidth: 1.4
    })

    // Pill kategori
    setFont(ctx, 12, true)
    const titlePillW = ctx.measureText(aw.title).width + 24
    fillCard(ctx, 624, ay + 18, titlePillW, 24, 12, { fill: aw.tint, stroke: null })
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = aw.accent
    ctx.fillText(aw.title, 624 + titlePillW / 2, ay + 30.5)

    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    setFont(ctx, 12, false)
    ctx.fillStyle = '#6E7681'
    ctx.fillText(aw.tag, 984, ay + 30.5)

    if (aw.winner) {
      setFont(ctx, 24, true)
      const wName = fitText(ctx, aw.winner.displayName, 360, 24, hasEmojiMap)
      await drawMixedText(ctx, wName, 624, ay + 53, 24, '#F3F6FA', hasEmojiMap)

      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      setFont(ctx, 15, true)
      ctx.fillStyle = aw.accent
      ctx.fillText(`${fmtNum(aw.winner.count)} ${aw.unit}`, 624, ay + 89)
    } else {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      setFont(ctx, 20, true)
      ctx.fillStyle = '#6E7681'
      ctx.fillText('Belum ada pemenang', 624, ay + 56)

      setFont(ctx, 14, false)
      ctx.fillStyle = '#4E5663'
      ctx.fillText(`Menunggu ${aw.unit}`, 624, ay + 89)
    }
  }

  // 5. Trending Words Band (y: 1094..1268)
  fillCard(ctx, 48, 1094, 984, 174, 22, { fill: '#131822' })
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  setFont(ctx, 14, true)
  ctx.fillStyle = '#8B949E'
  ctx.fillText('KATA PALING SERING DIPAKAI', 80, 1122)

  ctx.textAlign = 'right'
  setFont(ctx, 13, false)
  ctx.fillStyle = '#6E7681'
  ctx.fillText('Non-stopword & tanpa URL', 1000, 1122)

  if (!stats.topWords?.length) {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    setFont(ctx, 18, false)
    ctx.fillStyle = '#6E7681'
    ctx.fillText('Belum cukup kosakata terekam di grup ini bulan ini.', 80, 1168)
  } else {
    let px = 80
    let py = 1156
    const maxRight = 1000
    const rowStep = 48

    for (let i = 0; i < stats.topWords.length; i++) {
      const w = stats.topWords[i]
      const rankTag = `#${i + 1}`
      const wordLabel = String(w.word || '')
      const countLabel = `${fmtNum(w.count)}x`

      setFont(ctx, 17, true)
      const rankW = ctx.measureText(rankTag).width
      const wordW = ctx.measureText(wordLabel).width
      setFont(ctx, 15, false)
      const cntW = ctx.measureText(countLabel).width

      const pillW = Math.ceil(16 + rankW + 10 + wordW + 10 + cntW + 16)
      if (px + pillW > maxRight) {
        px = 80
        py += rowStep
        if (py > 1220) break
      }

      const isTop = i === 0
      fillCard(ctx, px, py, pillW, 38, 19, {
        fill: isTop ? 'rgba(30, 215, 96, 0.14)' : '#1B2230',
        stroke: isTop ? 'rgba(30, 215, 96, 0.38)' : 'rgba(255,255,255,0.08)',
        lineWidth: 1.2
      })

      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      setFont(ctx, 15, true)
      ctx.fillStyle = isTop ? '#1ED760' : '#8B949E'
      ctx.fillText(rankTag, px + 16, py + 19.5)

      setFont(ctx, 17, true)
      ctx.fillStyle = '#F3F6FA'
      ctx.fillText(wordLabel, px + 16 + rankW + 10, py + 19.5)

      setFont(ctx, 14, false)
      ctx.fillStyle = isTop ? '#1ED760' : '#9AA4B2'
      ctx.fillText(countLabel, px + 16 + rankW + 10 + wordW + 10, py + 19.5)

      px += pillW + 12
    }
  }

  // 6. Editorial Footer (y: 1296)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  setFont(ctx, 14, true)
  ctx.fillStyle = '#6E7681'
  ctx.fillText(`${String(botName || 'HITORI-MD').toUpperCase()}  •  GROUP WRAPPED`, 48, 1304)

  ctx.textAlign = 'right'
  setFont(ctx, 14, false)
  ctx.fillStyle = '#6E7681'
  ctx.fillText(`Periode ${stats.month} • Asia/Jakarta`, W - 48, 1304)

  return canvas.toBuffer('image/png')
}
