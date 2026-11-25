/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tourl.js — Convert media (gambar/video/audio/dokumen) jadi link URL.
 */
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'
import uploadFile from '../../lib/uploadFile.js'
import uploadImage from '../../lib/uploadImage.js'

const IMAGE_HOST_MIME =
  /image\/(png|jpe?g|gif)|video\/mp4|audio\/mpeg|audio\/mp3|audio\/opus/

export default {
  name: 'tourl',
  aliases: ['upload'],
  tags: 'tools',
  description: 'Convert media (gambar/video/audio/dokumen) jadi link URL',

  async run(ctx) {
    const { event, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) {
      return ctx.reply(
        'Gak nemu raw message event di ctx. Cek properti yang bener di framework (ctx.message / ctx.event / dst).'
      )
    }

    if (!payload?.mimetype) {
      return ctx.reply(
        'Balas media (gambar/video/audio/dokumen) dengan perintah *.tourl* atau *.upload*'
      )
    }

    await ctx.react('⏳')

    try {
      const media = await downloadTargetBuffer(targetMessage)

      const isTele = IMAGE_HOST_MIME.test(payload.mimetype)
      const link = await (isTele ? uploadImage : uploadFile)(media)

      const caption =
        `📮 *L I N K :*\n${link}\n\n` +
        `📊 *S I Z E :* ${media.length} Byte\n` +
        `📛 *E x p i r e d :* ${isTele ? 'No Expiry Date' : 'Unknown'}`

      await ctx.react('✅')
      ctx.reply(caption)
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('Terjadi kesalahan saat mengunggah media: ' + (e.message || e))
    }
  }
}
