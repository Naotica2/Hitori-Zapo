/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * aicode.js — Ambil file lokal bot dengan mode Smart Hybrid (View Code + Dokumen utuh)
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../../config.js'
import { LANGS } from '../../lib/highlight.js'
import { deliverSmartCode, extractDeliveryMode } from '../../lib/aiRich.js'

export default {
  name: 'aicode',
  aliases: ['ambil'],
  tags: 'tools',
  owner: true,
  description: 'Ambil file & kirim kode Smart Hybrid (View Code / Dokumen utuh)',

  async run(ctx) {
    const rawInput = (ctx.text || '').replace(/^ambil\s+/i, '').trim()
    const { cleanText: targetPath, mode } = extractDeliveryMode(rawInput)

    if (!targetPath) {
      return ctx.reply(
        `🤖 *${config.botName.toUpperCase()} AI* — _File Protocol_\n\n` +
          'Mau ambil file apa, Bos?\n\n' +
          '*Contoh:*\n' +
          '• `.aicode feat/game/snake.js` _(auto Smart Hybrid)_\n' +
          '• `.aicode --file lib/minecraft/toolcoin.js` _(dokumen langsung)_\n' +
          '• `.aicode --split feat/general/menu.js` _(pecah View Code)_'
      )
    }

    const cwd = process.cwd()
    const safe = path.normalize(targetPath).replace(/^(\.\.[\/\\])+/, '')
    const full = path.resolve(cwd, safe)
    if (full !== cwd && !full.startsWith(cwd + path.sep)) {
      return ctx.reply('⚠️ Path di luar direktori bot gak diizinkan.')
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return ctx.reply('❌ File gak ditemukan: `' + safe + '`')
    }

    const raw = fs.readFileSync(full)
    if (raw.includes(0)) {
      return ctx.reply('📦 File terdeteksi biner, gak bisa ditampilkan.')
    }

    const code = raw.toString('utf8')
    const totalLen = code.length
    const totalLines = code.split('\n').length
    const ext = (path.extname(full).slice(1) || 'txt').toLowerCase()
    const lang = LANGS[ext] || ext
    const name = path.basename(full)

    await deliverSmartCode(ctx, {
      code,
      fileName: name,
      ext,
      mode,
      headerText:
        `🤖 *${config.botName.toUpperCase()} AI* — _File Protocol_\n` +
        '✅ File `' + name + '` siap!\n\n📄 *Isi File:*',
      summaryRows: [
        ['Properti', 'Nilai'],
        ['Nama', name],
        ['Path', safe],
        ['Bahasa', lang],
        ['Ukuran', `${(totalLen / 1024).toFixed(1)} KB`],
        ['Baris', String(totalLines)]
      ],
      footerText: `\n> _*Powered by ${config.botName}*_`
    })

    await ctx.react('🤖')
  }
}
