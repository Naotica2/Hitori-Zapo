/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * WHATMUSIC.js — Identifikasi judul & penyanyi lagu dari audio, voice note, atau video
 * (ekstrak + potong audio via FFmpeg, lalu query WhatMusic endpoint + enrich YouTube)
 */
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { searchYouTube } from './YT-Search.js'

const TERMAI_API_URL = (process.env.TERMAI_API_URL || 'https://api.termai.cc').replace(/\/+$/, '')
const TERMAI_API_KEY = process.env.TERMAI_API_KEY || 'Bell409'

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE_BIN = process.env.FFPROBE_PATH || 'ffprobe'
const CLIP_DURATION_SECONDS = 15
const API_TIMEOUT_MS = 30_000
const FFMPEG_TIMEOUT_MS = 40_000

const MIME_EXT_MAP = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/3gpp': '3gp'
}

function guessExtension(mimetype = '', isVideo = false) {
  const clean = String(mimetype || '').split(';')[0].trim().toLowerCase()
  if (MIME_EXT_MAP[clean]) return MIME_EXT_MAP[clean]
  if (clean.startsWith('video/')) return clean.slice(6).replace(/[^a-z0-9]/g, '') || 'mp4'
  if (clean.startsWith('audio/')) return clean.slice(6).replace(/[^a-z0-9]/g, '') || 'mp3'
  return isVideo ? 'mp4' : 'mp3'
}

function runExecFile(bin, args, timeout = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

async function probeMediaStreams(filePath) {
  try {
    const { stdout } = await runExecFile(
      FFPROBE_BIN,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      12_000
    )
    const parsed = JSON.parse(String(stdout || '{}'))
    const streams = Array.isArray(parsed.streams) ? parsed.streams : []
    const hasAudio = streams.some((s) => s?.codec_type === 'audio')
    const hasVideo = streams.some((s) => s?.codec_type === 'video')
    const durationRaw = Number.parseFloat(parsed?.format?.duration)
    const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null
    return { probed: true, hasAudio, hasVideo, durationSeconds }
  } catch {
    return { probed: false, hasAudio: true, hasVideo: false, durationSeconds: null }
  }
}

/**
 * Ekstrak / normalisasi cuplikan audio MP3 dari buffer audio atau video menggunakan FFmpeg.
 */
export async function extractAudioClip(
  mediaBuffer,
  { isVideo = false, mimetype = '', startSeconds = 0, durationSeconds = CLIP_DURATION_SECONDS } = {}
) {
  if (!Buffer.isBuffer(mediaBuffer) || !mediaBuffer.length) {
    throw new Error('Buffer media kosong.')
  }

  const id = crypto.randomBytes(6).toString('hex')
  const ext = guessExtension(mimetype, isVideo)
  const inputPath = path.join(os.tmpdir(), `hitori-wm-in-${id}.${ext}`)
  const outputPath = path.join(os.tmpdir(), `hitori-wm-out-${id}.mp3`)

  await fs.writeFile(inputPath, mediaBuffer)

  try {
    const probe = await probeMediaStreams(inputPath)
    if (probe.probed && !probe.hasAudio) {
      throw new Error('Video tidak memiliki stream audio untuk dikenali.')
    }

    const args = ['-y']
    if (startSeconds > 0) {
      args.push('-ss', String(startSeconds))
    }
    args.push(
      '-i',
      inputPath,
      '-vn',
      '-t',
      String(durationSeconds),
      '-ac',
      '2',
      '-ar',
      '44100',
      '-b:a',
      '128k',
      '-f',
      'mp3',
      outputPath
    )

    try {
      await runExecFile(FFMPEG_BIN, args, FFMPEG_TIMEOUT_MS)
      const clipBuffer = await fs.readFile(outputPath)
      if (!clipBuffer.length) {
        throw new Error('Hasil ekstrak audio kosong.')
      }
      return {
        clipBuffer,
        extractedWithFfmpeg: true,
        durationSeconds: probe.durationSeconds,
        hasVideo: isVideo || probe.hasVideo
      }
    } catch (err) {
      const stderr = String(err?.stderr || err?.message || '')
      if (/does not contain any stream|no audio/i.test(stderr)) {
        throw new Error('Media tidak memiliki stream audio untuk dikenali.')
      }
      // Fallback hanya bila input sudah audio murni dan cukup kecil
      if (!isVideo && !probe.hasVideo && startSeconds === 0 && mediaBuffer.length <= 4 * 1024 * 1024) {
        return {
          clipBuffer: mediaBuffer,
          extractedWithFfmpeg: false,
          durationSeconds: probe.durationSeconds,
          hasVideo: false
        }
      }
      throw new Error('FFmpeg gagal mengekstrak audio: ' + stderr.slice(-180))
    }
  } finally {
    await fs.unlink(inputPath).catch(() => {})
    await fs.unlink(outputPath).catch(() => {})
  }
}

function parseWhatMusicPayload(json) {
  const data = json?.data
  if (!data || typeof data !== 'object') return null

  const title = String(data.title || '').trim()
  const artists = String(data.artists || data.artist || '').trim()
  const acrid = data.acrid ? String(data.acrid).trim() : null

  const titleUnknown = !title || /^unknown$/i.test(title)
  const artistUnknown = !artists || /^unknown$/i.test(artists)
  if (!acrid && titleUnknown && artistUnknown) return null
  if (titleUnknown) return null

  return {
    acrid,
    title,
    artists: artistUnknown ? null : artists,
    album: data.album ? String(data.album).trim() : null,
    releaseDate: data.release_date || data.releaseDate || null
  }
}

/**
 * Kirim buffer audio ke endpoint WhatMusic (`api.termai.cc`).
 */
export async function queryTermaiWhatMusic(audioBuffer) {
  if (!TERMAI_API_KEY) {
    throw new Error('TERMAI_API_KEY belum dikonfigurasi.')
  }

  const endpoint = `${TERMAI_API_URL}/api/audioProcessing/whatmusic?key=${encodeURIComponent(TERMAI_API_KEY)}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })

  const rawText = await res.text()
  let json
  try {
    json = JSON.parse(rawText)
  } catch {
    throw new Error(`Respons API bukan JSON valid (HTTP ${res.status}).`)
  }

  if (!res.ok || json?.status === false) {
    throw new Error(json?.msg || json?.message || `HTTP ${res.status} dari WhatMusic API`)
  }

  return parseWhatMusicPayload(json)
}

async function lookupYouTubeBestEffort(match) {
  try {
    const q = [match.artists, match.title, 'audio'].filter(Boolean).join(' ')
    const hits = await Promise.race([
      searchYouTube(q, 1),
      new Promise((resolve) => setTimeout(() => resolve([]), 4500))
    ])
    return Array.isArray(hits) && hits.length ? hits[0] : null
  } catch {
    return null
  }
}

/**
 * Kenali lagu dari buffer audio, voice note, atau video.
 * Jika durasi >= 24 detik dan segmen awal belum ketemu, otomatis coba ulang 1x dari bagian tengah.
 */
export async function recognizeMusic(mediaBuffer, { isVideo = false, mimetype = '' } = {}) {
  const first = await extractAudioClip(mediaBuffer, {
    isVideo,
    mimetype,
    startSeconds: 0,
    durationSeconds: CLIP_DURATION_SECONDS
  })

  let match = await queryTermaiWhatMusic(first.clipBuffer)

  if (!match && first.extractedWithFfmpeg && first.durationSeconds && first.durationSeconds >= 24) {
    const midStart = Math.min(
      Math.max(12, Math.floor(first.durationSeconds / 3)),
      Math.max(12, Math.floor(first.durationSeconds) - CLIP_DURATION_SECONDS)
    )
    if (midStart > 2) {
      try {
        const second = await extractAudioClip(mediaBuffer, {
          isVideo: first.hasVideo,
          mimetype,
          startSeconds: midStart,
          durationSeconds: CLIP_DURATION_SECONDS
        })
        match = await queryTermaiWhatMusic(second.clipBuffer)
      } catch {
        // Biarkan hasil tetap not-found bila retry segmen tengah gagal
      }
    }
  }

  if (!match) {
    return {
      status: true,
      found: false,
      extractedFromVideo: first.hasVideo,
      durationSeconds: first.durationSeconds,
      match: null,
      youtube: null
    }
  }

  const youtube = await lookupYouTubeBestEffort(match)
  return {
    status: true,
    found: true,
    extractedFromVideo: first.hasVideo,
    durationSeconds: first.durationSeconds,
    match,
    youtube
  }
}
