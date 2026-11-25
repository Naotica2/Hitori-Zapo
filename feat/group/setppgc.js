/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * setppgc.js — Ganti foto profil grup.
 */
import sharp from 'sharp'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'
import { isGroupAdmin } from '../../core/permission.js'

async function generateFullProfilePicture(buffer) {
  return sharp(buffer)
    .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer()
}

export default {
  name: 'setppgc',
  aliases: ['setppgrup', 'setppgroup'],
  tags: 'group',
  description: 'Ganti foto profil grup',

  async run(ctx) {
    if (!ctx.isGroup) return ctx.reply('🚫 Khusus grup.')
    if (!(await isGroupAdmin(ctx))) return ctx.reply('🚫 Khusus Admin grup / Staff bot.')

    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const isImage = payload?.mimetype?.startsWith('image/') && !payload.mimetype.includes('webp')

    if (!payload || !isImage) {
      return ctx.reply('Balas sebuah gambar dengan perintah *.setppgc* buat ganti foto profil grup.')
    }

    await ctx.react('⏳')

    try {
      const media = await downloadTargetBuffer(targetMessage)
      const processed = await generateFullProfilePicture(media)

      if (ctx.client.core?.updateProfilePicture) {
        await ctx.client.core.updateProfilePicture(ctx.chat, processed)
      } else if (ctx.client.group?.updateProfilePicture) {
        await ctx.client.group.updateProfilePicture(ctx.chat, processed)
      } else {
        await ctx.client.profile.setProfilePicture(processed, ctx.chat)
      }

      await ctx.react('✅')
      await ctx.reply('Foto profil grup berhasil diganti, Kak.')
    } catch (e) {
      await ctx.react('❎')
      await ctx.reply(`😵 Gagal ganti foto profil grup: ${String(e.message || e).slice(0, 120)}`)
    }
  }
}
