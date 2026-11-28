/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * aivid.js — AI Video Generator (text-to-video & image-to-video via HAPGETA AI)
 */

import config from '../../config.js'
import {
  downloadTargetBuffer,
  downloadUrlBuffer,
  getEvent,
  resolveTargetMedia
} from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import {
  generateVideo,
  runWithWorkerSession,
  uploadPublicImage
} from '../../scraper/HAPGETA.js'

const VALID_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4'])
const MAX_VIDEO_BYTES = 25 * 1024 * 1024
const MAX_INPUT_IMAGE_BYTES = 15 * 1024 * 1024

function parseVideoArgs(rawText) {
  let text = String(rawText || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let duration = 5
  let ratio = '16:9'
  let audio = true

  text = text.replace(/(^|\s)--(?:dur|duration)(?:=|\s+)(\d+)/gi, (_, lead, val) => {
    const n = Number(val)
    if (n === 5 || n === 10) duration = n
    return lead
  })

  text = text.replace(/(^|\s)--ratio(?:=|\s+)([0-9]+:[0-9]+)/gi, (_, lead, val) => {
    if (VALID_RATIOS.has(val)) ratio = val
    return lead
  })

  text = text.replace(/(^|\s)--(no-?audio|audio)\b/gi, (_, lead, flag) => {
    audio = !flag.toLowerCase().startsWith('no')
    return lead
  })

  return { duration, ratio, audio, prompt: text.trim() }
}

function buildUsage(p) {
  return [
    '🎬 *AI VIDEO GENERATOR (HAPGETA)*',
    '',
    '*Dari Teks:*',
    `• *${p}aivid kucing berjalan di taman sakura*`,
    `• *${p}aivid astronaut di bulan --ratio 9:16 --dur 5*`,
    '',
    '*Dari Gambar (kirim/reply foto):*',
    `• *${p}aivid buat kamera perlahan zoom in*`,
    '_Catatan: Jika kirim foto sekaligus me-reply foto lain, keduanya dipakai sebagai 2-frame transition._',
    '',
    '*Opsi:* `--ratio 16:9|9:16|1:1`, `--dur 5|10`, `--noaudio`'
  ].join('\n')
}

export default {
  name: 'aivid',
  aliases: ['txt2vid', 'img2vid', 'hapvid'],
  tags: 'ai',
  cooldown: 30000,
  description: 'Buat video AI dari teks atau gambar (text/image-to-video)',

  async run(ctx) {
    const p = ctx.prefix || config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const rawText = String(ctx.text || '').trim()
    if (!rawText || /^(help|\?)$/i.test(rawText)) {
      return ctx.client.message.send(ctx.chat, buildUsage(p), sendOpts)
    }

    const { duration, ratio, audio, prompt } = parseVideoArgs(rawText)
    if (!prompt) {
      return ctx.client.message.send(ctx.chat, buildUsage(p), sendOpts)
    }

    const { rawMessage, quoted, selfPayload, quotedPayload } = resolveTargetMedia(ctx)
    const imagesToUpload = []
    if (quotedPayload?.mimetype?.startsWith('image/') && quoted) {
      imagesToUpload.push({ message: quoted, mimetype: quotedPayload.mimetype })
    }
    if (selfPayload?.mimetype?.startsWith('image/') && rawMessage) {
      imagesToUpload.push({ message: rawMessage, mimetype: selfPayload.mimetype })
    }

    const type = imagesToUpload.length >= 2 ? 'two' : imagesToUpload.length === 1 ? 'one' : 'text'

    await ctx.react('⏳')
    try {
      const imageUrls = []
      for (let i = 0; i < Math.min(2, imagesToUpload.length); i++) {
        const item = imagesToUpload[i]
        const buf = await downloadTargetBuffer(item.message)
        if (buf.length > MAX_INPUT_IMAGE_BYTES) {
          throw new Error(`Gambar #${i + 1} terlalu besar (${(buf.length / 1024 / 1024).toFixed(1)} MB, maks 15 MB).`)
        }
        const ext = String(item.mimetype).includes('png') ? 'png' : 'jpg'
        imageUrls.push(await uploadPublicImage(buf, `frame-${i + 1}.${ext}`, item.mimetype))
      }

      const generated = await runWithWorkerSession((session) =>
        generateVideo({
          prompt,
          type,
          images: imageUrls,
          duration,
          ratio,
          audio,
          session
        })
      )

      if (!generated.videoUrl) {
        throw new Error('Server AI tidak mengembalikan URL video.')
      }

      await assertSafePublicUrl(generated.videoUrl)
      const vidBuf = await downloadUrlBuffer(generated.videoUrl, { timeout: 120_000, maxBytes: MAX_VIDEO_BYTES })
      const caption = [
        '┌───「 🎬 *AI VIDEO GEN* 」───┐',
        '',
        `• Mode   : *${type}*`,
        `• Rasio  : ${ratio} • ${duration}s`,
        ...(generated.deduction != null ? [`• Kredit : ${generated.deduction}`] : []),
        `• Prompt : ${prompt.slice(0, 220)}`,
        '',
        '└───────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'video',
          media: vidBuf,
          mimetype: 'video/mp4',
          caption
        },
        sendOpts
      )
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      await ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 260)}`, sendOpts)
    }
  }
}
