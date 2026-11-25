/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * setpp.js — Ganti foto profil bot sesuai gambar yang di-reply.
 */
import sharp from 'sharp'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'

async function generateProfilePicture(buffer) {
  return sharp(buffer)
    .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer()
}

export default {
  name: 'setpp',
  aliases: ['setprofile', 'setppbot'],
  tags: 'owner',
  owner: true,
  description: 'Ganti foto profil bot sesuai gambar yang di-reply',

  async run(ctx) {
    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const isImage = payload?.mimetype?.startsWith('image/') && !payload.mimetype.includes('webp')

    if (!payload || !isImage) {
      return ctx.reply(
        'Balas sebuah gambar (bukan stiker/webp) dengan perintah *.setpp* buat ganti foto profil bot.'
      )
    }

    await ctx.react('⏳')

    try {
      const media = await downloadTargetBuffer(targetMessage)
      const processed = await generateProfilePicture(media)

      await ctx.client.profile.setProfilePicture(processed)

      await ctx.react('✅')
      ctx.reply('Foto profil bot berhasil diganti, Kak.')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('Gagal ganti foto profil: ' + (e.message || e))
    }
  }
}
