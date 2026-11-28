/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * genimg.js — AI Image Generator & Image Editor (HAPGETA AI)
 */

import config from '../../config.js'
import {
  downloadTargetBuffer,
  downloadUrlBuffer,
  extractTextFromMessage,
  getEvent,
  getQuotedMessage,
  resolveTargetMedia
} from '../../lib/media.js'
import { assertSafePublicUrl } from '../../lib/security.js'
import {
  IMAGE_FEATURES,
  generateImage,
  runWithWorkerSession,
  uploadPublicImage
} from '../../scraper/HAPGETA.js'

const VALID_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'])
const MAX_IMAGE_BYTES = 18 * 1024 * 1024

function parseGenImgArgs(rawText) {
  let text = String(rawText || '')
    .trim()
    .replace(/(^|\s)[—–](?=[a-z])/gi, '$1--')

  let feature = ''
  let ratio = '1:1'

  text = text.replace(/(^|\s)--(?:mode|feature|style)(?:=|\s+)([a-z0-9_-]+)/gi, (_, lead, val) => {
    const clean = val.toLowerCase()
    if (IMAGE_FEATURES.includes(clean)) feature = clean
    return lead
  })

  text = text.replace(/(^|\s)--ratio(?:=|\s+)([0-9]+:[0-9]+)/gi, (_, lead, val) => {
    if (VALID_RATIOS.has(val)) ratio = val
    return lead
  })

  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (!feature && tokens.length >= 1 && IMAGE_FEATURES.includes(tokens[0].toLowerCase())) {
    feature = tokens.shift().toLowerCase()
  }

  return { feature, ratio, prompt: tokens.join(' ').trim() }
}

function buildUsage(p) {
  return [
    '🎨 *AI IMAGE GENERATOR (HAPGETA)*',
    '',
    `*Pakai Teks:*`,
    `• *${p}genimg <prompt>*`,
    `• *${p}genimg poster <prompt>*`,
    `• *${p}genimg logo <prompt>* --ratio 1:1`,
    `• *${p}genimg portrait <prompt>* --ratio 9:16`,
    '',
    '*Edit Gambar (kirim/reply foto):*',
    `• *${p}genimg editor <instruksi edit>*`,
    '',
    `*Mode tersedia:* ${IMAGE_FEATURES.join(', ')}`,
    `*Rasio:* ${[...VALID_RATIOS].join(', ')}`
  ].join('\n')
}

export default {
  name: 'genimg',
  aliases: ['aiimg', 'hapimg', 'txt2img'],
  tags: 'ai',
  cooldown: 15000,
  description: 'Buat gambar/poster/logo AI atau edit foto dengan prompt',

  async run(ctx) {
    const p = ctx.prefix || config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const rawText = String(ctx.text || '').trim()
    if (!rawText || /^(help|\?)$/i.test(rawText)) {
      return ctx.client.message.send(ctx.chat, buildUsage(p), sendOpts)
    }

    const { feature: parsedFeature, ratio, prompt: parsedPrompt } = parseGenImgArgs(rawText)
    let prompt = parsedPrompt
    if (!prompt) {
      const quotedText = extractTextFromMessage(getQuotedMessage(ctx)).trim()
      if (quotedText) prompt = quotedText
    }
    if (!prompt) {
      return ctx.client.message.send(ctx.chat, buildUsage(p), sendOpts)
    }

    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const hasImage = Boolean(payload?.mimetype?.startsWith('image/'))
    const feature = parsedFeature || (hasImage ? 'editor' : 'comic')

    await ctx.react('⏳')
    try {
      const files = []
      if (hasImage && targetMessage) {
        const imgBuf = await downloadTargetBuffer(targetMessage)
        if (imgBuf.length > MAX_IMAGE_BYTES) {
          throw new Error(`Ukuran gambar terlalu besar (${(imgBuf.length / 1024 / 1024).toFixed(1)} MB, maks 18 MB).`)
        }
        const ext = String(payload.mimetype || '').includes('png') ? 'png' : 'jpg'
        const uploadedUrl = await uploadPublicImage(imgBuf, `input.${ext}`, payload.mimetype || 'image/jpeg')
        files.push(uploadedUrl)
      }

      const generated = await runWithWorkerSession((session) =>
        generateImage({
          prompt,
          feature,
          ratio,
          files,
          session
        })
      )

      const imgUrl = generated.urls?.[0]
      if (!imgUrl) {
        throw new Error('Server AI tidak mengembalikan URL gambar.')
      }

      await assertSafePublicUrl(imgUrl)
      const outBuf = await downloadUrlBuffer(imgUrl, { timeout: 90_000, maxBytes: 25 * 1024 * 1024 })
      const caption = [
        '┌───「 🎨 *AI IMAGE GEN* 」───┐',
        '',
        `• Mode   : *${feature}*`,
        `• Rasio  : ${ratio}`,
        ...(generated.cost != null ? [`• Kredit : ${generated.cost}`] : []),
        `• Prompt : ${prompt.slice(0, 220)}`,
        '',
        '└───────────────────────────┘',
        '',
        `> ✨ _*Powered by ${config.botName}*_`
      ].join('\n')

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'image',
          media: outBuf,
          mimetype: 'image/jpeg',
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
