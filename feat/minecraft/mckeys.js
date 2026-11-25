/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/mckeys.js — Manajemen database kunci dekripsi DRM Marketplace (Owner Only)
 */
import config from '../../config.js'
import Toolcoin from '../../lib/minecraft/toolcoin.js'
import { replyQuoted } from '../../lib/minecraft/workflow.js'

export default {
  name: 'mckeys',
  aliases: ['mcloadkeys'],
  tags: 'minecraft',
  owner: true,
  description: 'Manajemen database kunci dekripsi DRM Marketplace (Owner Only)',
  cooldown: 5000,

  async run(ctx) {
    const prefix = ctx.prefix || config.mainPrefix
    const command = ctx.command || 'mckeys'
    const query = (ctx.text || '').trim()
    const currentKeys = Toolcoin.getKeysCount()

    if (!query) {
      return replyQuoted(
        ctx,
        `*DATABASE KUNCI DEKRIPSI DRM (TOOLCOIN)*\n\n` +
          `• Total Kunci Dimuat: *${currentKeys.toLocaleString()} keys*\n` +
          `• Lokasi Database: \`data/minecraft/keys.tsv\` & \`keys.json\`\n\n` +
          `*Cara Update Kunci:*\n` +
          `1. Ketik *${prefix}${command} <URL_TSV_ATAU_JSON>* untuk mengunduh database kunci dari tautan daring.\n` +
          `2. Atau letakkan file *keys.tsv* di folder \`data/minecraft/keys.tsv\` bot.`
      )
    }

    if (query.startsWith('http://') || query.startsWith('https://')) {
      await ctx.react('🕕')
      await replyQuoted(ctx, 'Sedang mengunduh dan memperbarui database kunci dekripsi dari URL...')

      try {
        const ok = await Toolcoin.importKeysFromUrl(query)
        if (ok) {
          const newCount = Toolcoin.getKeysCount()
          await ctx.react('✅')
          return replyQuoted(
            ctx,
            `*Database Kunci Berhasil Diperbarui!*\n\n` +
              `Total sekarang: *${newCount.toLocaleString()} keys* terdaftar dan siap digunakan.`
          )
        }
        await ctx.react('❌')
        return replyQuoted(
          ctx,
          'Gagal memperbarui database kunci. Pastikan URL mengarah ke file TSV atau JSON yang valid.'
        )
      } catch (err) {
        await ctx.react('☢')
        return replyQuoted(ctx, `Gagal memperbarui database kunci: ${err.message}`)
      }
    }

    return replyQuoted(ctx, 'Kirimkan URL valid yang berisi berkas database TSV atau JSON!')
  }
}
