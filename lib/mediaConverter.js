/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * mediaConverter.js — Helper FFmpeg, Sharp, dan Termai Stems untuk konversi media & efek audio
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE_BIN = process.env.FFPROBE_PATH || FFMPEG_BIN.replace(/ffmpeg(?=\.exe)?$/i, 'ffprobe')
const TERMAI_API_URL = (process.env.TERMAI_API_URL || 'https://api.termai.cc').replace(/\/+$/, '')
const TERMAI_API_KEY = process.env.TERMAI_API_KEY || 'Bell409'

function runFfprobe(args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE_BIN,
      args,
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        try {
          resolve(JSON.parse(stdout || '{}'))
        } catch (parseErr) {
          reject(parseErr)
        }
      }
    )
  })
}

/**
 * Periksa susunan box top-level ISO-BMFF (MP4) tanpa batasan 1 KB milik scanner internal zapo-js.
 * Mendeteksi kasus seperti box `uuid`/`free` besar sebelum `mdat` dengan `moov` di akhir file.
 */
export function inspectMp4Layout(input) {
  const buf = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
      : null

  if (!buf || buf.length < 12) {
    return { isMp4: false, hasMoovBeforeMdat: false, safeForZapoSidecar: false, boxes: [] }
  }

  if (buf.toString('ascii', 4, 8) !== 'ftyp') {
    return { isMp4: false, hasMoovBeforeMdat: false, safeForZapoSidecar: false, boxes: [] }
  }

  const boxes = []
  let offset = 0
  let moovOffset = -1
  let mdatOffset = -1

  while (offset + 8 <= buf.length && boxes.length < 64) {
    let size = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    let headerSize = 8

    if (size === 1) {
      if (offset + 16 > buf.length) break
      const bigSize = buf.readBigUInt64BE(offset + 8)
      if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) break
      size = Number(bigSize)
      headerSize = 16
    } else if (size === 0) {
      size = buf.length - offset
    }

    if (!Number.isFinite(size) || size < headerSize || offset + size > buf.length) break

    boxes.push({ type, offset, size })
    if (type === 'moov' && moovOffset === -1) moovOffset = offset
    if (type === 'mdat' && mdatOffset === -1) mdatOffset = offset
    offset += size
  }

  const hasMoovBeforeMdat = moovOffset !== -1 && (mdatOffset === -1 || moovOffset < mdatOffset)
  const safeForZapoSidecar = hasMoovBeforeMdat && moovOffset < 1024

  return { isMp4: true, hasMoovBeforeMdat, safeForZapoSidecar, moovOffset, mdatOffset, boxes }
}

/**
 * Pastikan file MP4 kompatibel untuk WhatsApp mobile:
 * - Memindahkan atom `moov` ke awal file (`+faststart`) dan membuang box `uuid`/metadata non-standar
 *   agar `streamingSidecar` zapo-js valid dan tidak memicu error "something is wrong with the video file".
 * - Melakukan transcode H.264/AAC otomatis jika codec/pixel format sumber tidak didukung Android/iOS.
 */
export async function normalizeMp4ForWhatsApp(inputBuffer, { forceTranscode = false } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Buffer video kosong.')
  }

  const initialLayout = inspectMp4Layout(inputBuffer)

  return withTempWorkDir(async (dir) => {
    const inPath = path.join(dir, 'in.mp4')
    const outPath = path.join(dir, 'out.mp4')
    await fs.writeFile(inPath, inputBuffer)

    let probe = null
    try {
      probe = await runFfprobe(['-v', 'quiet', '-print_format', 'json', '-show_streams', inPath])
    } catch {
      probe = null
    }

    const streams = Array.isArray(probe?.streams) ? probe.streams : []
    const videoStream = streams.find((s) => s.codec_type === 'video')
    const audioStream = streams.find((s) => s.codec_type === 'audio')

    const isCompatibleVideo = Boolean(
      videoStream &&
        videoStream.codec_name === 'h264' &&
        videoStream.pix_fmt === 'yuv420p' &&
        Number(videoStream.width) > 0 &&
        Number(videoStream.height) > 0 &&
        Number(videoStream.width) % 2 === 0 &&
        Number(videoStream.height) % 2 === 0
    )
    const isCompatibleAudio = !audioStream || audioStream.codec_name === 'aac'
    const compatibleCodecs = isCompatibleVideo && isCompatibleAudio

    if (!forceTranscode && compatibleCodecs && initialLayout.safeForZapoSidecar) {
      return {
        buffer: inputBuffer,
        remuxed: false,
        transcoded: false,
        safeForZapoSidecar: true
      }
    }

    if (!forceTranscode && compatibleCodecs) {
      try {
        await runFfmpeg(
          [
            '-y', '-loglevel', 'error', '-nostdin',
            '-i', inPath,
            '-map', '0:v:0',
            '-map', '0:a?',
            '-dn', '-sn',
            '-c', 'copy',
            '-map_metadata', '-1',
            '-movflags', '+faststart',
            outPath
          ],
          { timeoutMs: 45_000 }
        )
        const remuxedBuf = await fs.readFile(outPath)
        const remuxedLayout = inspectMp4Layout(remuxedBuf)
        if (remuxedBuf.length > 0 && remuxedLayout.safeForZapoSidecar) {
          return {
            buffer: remuxedBuf,
            remuxed: true,
            transcoded: false,
            safeForZapoSidecar: true
          }
        }
      } catch {
        // Fallback ke full transcode di bawah
      }
    }

    await runFfmpeg(
      [
        '-y', '-loglevel', 'error', '-nostdin',
        '-i', inPath,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-dn', '-sn',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '22',
        '-profile:v', 'main',
        '-level', '4.0',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-map_metadata', '-1',
        '-movflags', '+faststart',
        outPath
      ],
      { timeoutMs: 90_000 }
    )

    const out = await fs.readFile(outPath)
    if (!out.length) throw new Error('Hasil normalisasi video kosong.')
    const finalLayout = inspectMp4Layout(out)
    return {
      buffer: out,
      remuxed: true,
      transcoded: true,
      safeForZapoSidecar: finalLayout.safeForZapoSidecar
    }
  })
}

async function withTempWorkDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hitori-conv-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function runFfmpeg(args, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG_BIN,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || err.message || '').trim().slice(-240)
          reject(new Error(`FFmpeg gagal: ${tail}`))
        } else {
          resolve({ stdout, stderr })
        }
      }
    )
  })
}

/**
 * Turunkan resolusi & kualitas gambar/stiker agar tampil "burik" (default width 50px).
 */
export async function burikImage(inputBuffer, { width = 50, quality = 3 } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Buffer gambar kosong.')
  }

  const parsedW = Number.parseInt(width, 10)
  const targetWidth = Math.max(12, Math.min(Number.isFinite(parsedW) ? parsedW : 50, 720))
  const qv = Math.max(2, Math.min(Number.parseInt(quality, 10) || 3, 31))

  // Pastikan WebP/PNG ber-alpha aman dikonversi menjadi JPEG terlebih dahulu agar FFmpeg tidak error
  const normalizedPng = await sharp(inputBuffer, { pages: 1 })
    .flatten({ background: '#121212' })
    .png()
    .toBuffer()

  return withTempWorkDir(async (dir) => {
    const inPath = path.join(dir, 'in.png')
    const outPath = path.join(dir, 'out.jpg')
    await fs.writeFile(inPath, normalizedPng)

    await runFfmpeg([
      '-y', '-loglevel', 'error', '-nostdin',
      '-i', inPath,
      '-vf', `scale='min(${targetWidth},iw)':-2`,
      '-q:v', String(qv),
      '-frames:v', '1',
      '-f', 'image2',
      outPath
    ])

    const out = await fs.readFile(outPath)
    if (!out.length) throw new Error('Hasil burik gambar kosong.')
    return { buffer: out, width: targetWidth }
  })
}

/**
 * Turunkan kualitas & resolusi video dengan efek piksel burik via FFmpeg (default width 96px).
 */
export async function burikVideo(inputBuffer, { width = 96 } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Buffer video kosong.')
  }

  const parsedW = Number.parseInt(width, 10)
  let targetWidth = Math.max(16, Math.min(Number.isFinite(parsedW) ? parsedW : 96, 720))
  targetWidth = Math.trunc(targetWidth / 2) * 2 || 16

  return withTempWorkDir(async (dir) => {
    const inPath = path.join(dir, 'in.mp4')
    const outPath = path.join(dir, 'out.mp4')
    await fs.writeFile(inPath, inputBuffer)

    const vf =
      `fps=15,scale='min(${targetWidth},iw)':-2:flags=neighbor,` +
      `scale=w='trunc(iw*ceil(320/min(iw,ih))/2)*2':h='trunc(ih*ceil(320/min(iw,ih))/2)*2':flags=neighbor,format=yuv420p`

    await runFfmpeg(
      [
        '-y', '-loglevel', 'error', '-nostdin',
        '-i', inPath,
        '-vf', vf,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '36',
        '-threads', '1',
        '-c:a', 'aac',
        '-b:a', '32k',
        '-ar', '22050',
        '-movflags', '+faststart',
        outPath
      ],
      { timeoutMs: 50_000 }
    )

    const out = await fs.readFile(outPath)
    if (!out.length) throw new Error('Hasil burik video kosong.')
    return { buffer: out, width: targetWidth }
  })
}

/**
 * Konversi WebP/gambar menjadi JPEG atau PNG.
 */
export async function webpToImage(inputBuffer, format = 'jpg') {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Buffer gambar kosong.')
  }
  const cleanFmt = String(format).toLowerCase() === 'png' ? 'png' : 'jpg'
  if (cleanFmt === 'png') {
    const buffer = await sharp(inputBuffer, { pages: 1 }).png().toBuffer()
    return { buffer, mimetype: 'image/png', format: 'png' }
  }
  const buffer = await sharp(inputBuffer, { pages: 1 })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer()
  return { buffer, mimetype: 'image/jpeg', format: 'jpg' }
}

/**
 * Konversi stiker (WebP statis/animasi) atau video menjadi MP4 siap kirim WhatsApp (dan GIF playback jika mute).
 */
export async function mediaToMp4(inputBuffer, { isVideo = false, asGif = false } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Buffer media kosong.')
  }

  return withTempWorkDir(async (dir) => {
    const outPath = path.join(dir, 'out.mp4')

    if (isVideo) {
      if (!asGif) {
        return { buffer: inputBuffer, mimetype: 'video/mp4', isAnimated: true }
      }
      const inVid = path.join(dir, 'in.mp4')
      await fs.writeFile(inVid, inputBuffer)
      await runFfmpeg([
        '-y', '-loglevel', 'error', '-nostdin',
        '-i', inVid,
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '24',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-movflags', '+faststart',
        outPath
      ])
      const out = await fs.readFile(outPath)
      return { buffer: out, mimetype: 'video/mp4', isAnimated: true }
    }

    const meta = await sharp(inputBuffer, { animated: true }).metadata()
    const isAnimated = (meta?.pages || 1) > 1

    if (isAnimated) {
      const gifBuf = await sharp(inputBuffer, { animated: true })
        .flatten({ background: '#111111' })
        .gif()
        .toBuffer()
      const inGif = path.join(dir, 'anim.gif')
      await fs.writeFile(inGif, gifBuf)

      await runFfmpeg([
        '-y', '-loglevel', 'error', '-nostdin',
        '-i', inGif,
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '24',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-movflags', '+faststart',
        outPath
      ])
    } else {
      const pngBuf = await sharp(inputBuffer)
        .flatten({ background: '#111111' })
        .png()
        .toBuffer()
      const inPng = path.join(dir, 'still.png')
      await fs.writeFile(inPng, pngBuf)

      await runFfmpeg([
        '-y', '-loglevel', 'error', '-nostdin',
        '-loop', '1',
        '-i', inPng,
        '-t', '2',
        '-an',
        '-r', '15',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-movflags', '+faststart',
        outPath
      ])
    }

    const out = await fs.readFile(outPath)
    if (!out.length) throw new Error('Hasil konversi MP4 kosong.')
    return { buffer: out, mimetype: 'video/mp4', isAnimated }
  })
}

/**
 * Terapkan efek audio 8D (`apulsator`) pada audio atau video.
 */
export async function apply8dAudio(inputBuffer, { isVideo = false, hz = 0.125 } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Buffer audio/video kosong.')
  }

  const parsedHz = Number.parseFloat(hz)
  const safeHz = Number.isFinite(parsedHz) ? Math.max(0.05, Math.min(parsedHz, 2.0)) : 0.125

  return withTempWorkDir(async (dir) => {
    const inPath = path.join(dir, isVideo ? 'in.mp4' : 'in.audio')
    const outPath = path.join(dir, isVideo ? 'out.mp4' : 'out.mp3')
    await fs.writeFile(inPath, inputBuffer)

    const args = isVideo
      ? [
          '-y', '-loglevel', 'error', '-nostdin',
          '-i', inPath,
          '-c:v', 'copy',
          '-af', `apulsator=hz=${safeHz}`,
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          outPath
        ]
      : [
          '-y', '-loglevel', 'error', '-nostdin',
          '-i', inPath,
          '-vn',
          '-af', `apulsator=hz=${safeHz}`,
          '-ar', '44100',
          '-ac', '2',
          '-b:a', '128k',
          '-codec:a', 'libmp3lame',
          outPath
        ]

    await runFfmpeg(args, { timeoutMs: 60_000 })
    const out = await fs.readFile(outPath)
    if (!out.length) throw new Error('Hasil audio 8D kosong.')
    return {
      buffer: out,
      hz: safeHz,
      mimetype: isVideo ? 'video/mp4' : 'audio/mpeg'
    }
  })
}

export function resolve16dMode(rawMode = '') {
  const m = String(rawMode || '').toLowerCase().trim()
  if (['reverse', 'balik', 'kiri', 'left', 'swap', 'flip', 'r'].some((k) => m.includes(k))) {
    return 'reverse'
  }
  if (['8d', 'motion', 'rotate', 'putar', 'spin', 'm'].some((k) => m.includes(k))) {
    return '8d'
  }
  return 'default'
}

/**
 * Gabungkan stem instrumental + vokal menjadi output 16D (default, reverse, atau 8D motion).
 */
export async function mix16dStems(instBuffer, vocBuffer, { mode = 'default', isVideo = false, videoSource = null } = {}) {
  const detectedMode = resolve16dMode(mode)

  let filterComplex
  if (detectedMode === 'reverse') {
    filterComplex =
      '[0:a]pan=mono|c0=0.5*c0+0.5*c1[inst];' +
      '[1:a]pan=mono|c0=0.5*c0+0.5*c1[voc];' +
      '[voc][inst]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[out]'
  } else if (detectedMode === '8d') {
    filterComplex =
      '[0:a]apulsator=hz=0.125:offset_l=0:offset_r=0.5[inst];' +
      '[1:a]apulsator=hz=0.125:offset_l=0.5:offset_r=0[voc];' +
      '[inst][voc]amix=inputs=2:normalize=0[out]'
  } else {
    filterComplex =
      '[0:a]pan=mono|c0=0.5*c0+0.5*c1[inst];' +
      '[1:a]pan=mono|c0=0.5*c0+0.5*c1[voc];' +
      '[inst][voc]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[out]'
  }

  return withTempWorkDir(async (dir) => {
    const instPath = path.join(dir, 'inst.mp3')
    const vocPath = path.join(dir, 'voc.mp3')
    const outPath = path.join(dir, isVideo ? 'out16d.mp4' : 'out16d.mp3')
    await Promise.all([fs.writeFile(instPath, instBuffer), fs.writeFile(vocPath, vocBuffer)])

    let args
    if (isVideo && Buffer.isBuffer(videoSource)) {
      const vidPath = path.join(dir, 'src.mp4')
      await fs.writeFile(vidPath, videoSource)
      const vidFilter = filterComplex.replace(/\[0:a\]/g, '[1:a]').replace(/\[1:a\]/g, '[2:a]')
      args = [
        '-y', '-loglevel', 'error', '-nostdin',
        '-i', vidPath,
        '-i', instPath,
        '-i', vocPath,
        '-filter_complex', vidFilter,
        '-map', '0:v:0',
        '-map', '[out]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outPath
      ]
    } else {
      args = [
        '-y', '-loglevel', 'error', '-nostdin',
        '-i', instPath,
        '-i', vocPath,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        outPath
      ]
    }

    await runFfmpeg(args, { timeoutMs: 90_000 })
    const out = await fs.readFile(outPath)
    if (!out.length) throw new Error('Hasil audio 16D kosong.')
    return {
      buffer: out,
      mode: detectedMode,
      mimetype: isVideo ? 'video/mp4' : 'audio/mpeg'
    }
  })
}

async function extractMp3FromVideo(videoBuffer) {
  return withTempWorkDir(async (dir) => {
    const inPath = path.join(dir, 'src.mp4')
    const outPath = path.join(dir, 'audio.mp3')
    await fs.writeFile(inPath, videoBuffer)
    await runFfmpeg([
      '-y', '-loglevel', 'error', '-nostdin',
      '-i', inPath,
      '-vn', '-ac', '2', '-ar', '44100', '-b:a', '128k',
      '-f', 'mp3',
      outPath
    ])
    const out = await fs.readFile(outPath)
    if (!out.length) throw new Error('Gagal mengekstrak audio dari video.')
    return out
  })
}

/**
 * Pisahkan stem vokal + instrumen via `api.termai.cc/api/audioProcessing/stems`, lalu proses 16D.
 */
export async function apply16dAudio(inputBuffer, { isVideo = false, mode = 'default' } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    throw new Error('Buffer audio/video kosong.')
  }
  if (!TERMAI_API_KEY) {
    throw new Error('TERMAI_API_KEY belum dikonfigurasi untuk pemisahan stems 16D.')
  }

  const audioToSeparate = isVideo ? await extractMp3FromVideo(inputBuffer) : inputBuffer

  const endpoint = `${TERMAI_API_URL}/api/audioProcessing/stems?key=${encodeURIComponent(TERMAI_API_KEY)}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audioToSeparate,
    signal: AbortSignal.timeout(90_000)
  })

  const rawText = await res.text()
  let json
  try {
    json = JSON.parse(rawText)
  } catch {
    throw new Error(`Respons server stems bukan JSON valid (HTTP ${res.status}).`)
  }

  if (!res.ok || !json?.status || !Array.isArray(json.data) || json.data.length < 2) {
    throw new Error(json?.msg || json?.message || 'Gagal memisahkan vokal & instrumen untuk 16D.')
  }

  const instItem =
    json.data.find((x) => /accompaniment|inst/i.test(x?.filename || '')) || json.data[0]
  const vocItem =
    json.data.find((x) => /vocals?/i.test(x?.filename || '')) || json.data[1]

  const [instBuf, vocBuf] = await Promise.all([
    fetch(instItem.link, { signal: AbortSignal.timeout(45_000) }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} unduh stem instrumen`)
      return Buffer.from(await r.arrayBuffer())
    }),
    fetch(vocItem.link, { signal: AbortSignal.timeout(45_000) }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} unduh stem vokal`)
      return Buffer.from(await r.arrayBuffer())
    })
  ])

  return mix16dStems(instBuf, vocBuf, {
    mode,
    isVideo,
    videoSource: isVideo ? inputBuffer : null
  })
}
