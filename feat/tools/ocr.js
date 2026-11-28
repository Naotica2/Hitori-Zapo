/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ocr.js — Ekstrak teks dari gambar / stiker via Tesseract lokal, OCR.space, & fallback AI Vision
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'
import { chatVision, runWithWorkerSession, uploadPublicImage } from '../../scraper/HAPGETA.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function runTesseract(filePath, lang = 'ind+eng') {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.TESSERACT_PATH || 'tesseract',
      [filePath, 'stdout', '-l', lang, '--psm', '6'],
      { timeout: 25_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        resolve(String(stdout || '').trim())
      }
    )
  })
}

async function runOcrSpace(pngBuf, lang = 'eng') {
  const form = new FormData()
  form.append('file', new Blob([pngBuf], { type: 'image/png' }), 'ocr.png')
  form.append('apikey', process.env.OCR_SPACE_APIKEY || 'helloworld')
  form.append('language', lang)
  form.append('OCREngine', '2')
  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(25_000)
  })
  if (!res.ok) throw new Error(`OCR.space HTTP ${res.status}`)
  const data = await res.json()
  if (data?.IsErroredOnProcessing) {
    throw new Error(data?.ErrorMessage?.[0] || 'OCR.space processing error')
  }
  const text = (data?.ParsedResults || []).map((r) => r?.ParsedText || '').join('\n').trim()
  return text
}

async function runAiVisionOcr(jpgBuf) {
  const imageUrl = await uploadPublicImage(jpgBuf, 'ocr.jpg', 'image/jpeg')
  const res = await runWithWorkerSession((session) =>
    chatVision({
      prompt: 'Extract and transcribe ALL visible text in this image verbatim, preserving line breaks. Reply with the extracted text only, no commentary.',
      imageUrl,
      session
    })
  )
  return String(res?.text || '').trim()
}

export default {
  name: 'ocr',
  aliases: ['totext', 'img2text', 'bacateks', 'scanocr'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Salin teks dari gambar atau screenshot (Tesseract + fallback OCR.space / AI Vision)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const useAi = /--ai\b/i.test(String(ctx.text || ''))
    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const mime = String(payload?.mimetype || '')
    const isImageLike =
      payload &&
      (payload.mediaType === 'image' || payload.mediaType === 'sticker' || mime.startsWith('image/'))

    if (!targetMessage || !isImageLike) {
      return ctx.client.message.send(
        ctx.chat,
        '📝 *OCR (GAMBAR KE TEKS)*\n\n' +
          '*Cara pakai:*\n' +
          `• Kirim atau reply gambar dengan *${p}ocr*\n` +
          `• *${p}ocr --ai* → pakai AI Vision (lebih akurat untuk tulisan tangan / screenshot kode)`,
        sendOpts
      )
    }

    await ctx.react('⏳')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hitori-ocr-'))
    try {
      const rawBuf = await downloadTargetBuffer(targetMessage)
      if (rawBuf.length > MAX_IMAGE_BYTES) throw new Error('Ukuran gambar maksimal 10 MB.')

      const [pngBuf, jpgBuf] = await Promise.all([
        sharp(rawBuf, { pages: 1 }).flatten({ background: '#ffffff' }).png().toBuffer(),
        sharp(rawBuf, { pages: 1 }).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer()
      ])

      let text = ''
      let engine = ''

      if (useAi) {
        text = await runAiVisionOcr(jpgBuf)
        engine = 'AI Vision'
      } else {
        const imgPath = path.join(tmpDir, 'ocr.png')
        await fs.writeFile(imgPath, pngBuf)
        try {
          text = await runTesseract(imgPath, 'ind+eng')
          engine = 'Tesseract (ID+EN)'
        } catch {
          try {
            text = await runTesseract(imgPath, 'eng')
            engine = 'Tesseract (EN)'
          } catch {}
        }

        if (!text) {
          try {
            text = await runOcrSpace(pngBuf, 'eng')
            engine = 'OCR.space'
          } catch {}
        }

        if (!text) {
          text = await runAiVisionOcr(jpgBuf)
          engine = 'AI Vision'
        }
      }

      if (!text) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, '❌ Tidak ada teks yang terbaca dari gambar tersebut.', sendOpts)
      }

      await ctx.client.message.send(
        ctx.chat,
        `📝 *HASIL OCR* _(${engine})_\n\n${text.slice(0, 3800)}`,
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ Gagal memproses OCR: ${String(err?.message || err).slice(0, 220)}`, sendOpts)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
