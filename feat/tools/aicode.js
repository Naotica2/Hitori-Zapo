/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * aicode.js — Ambil file lokal bot & kirim sebagai rich response
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../../config.js'
import { tokenize, LANGS } from '../../lib/highlight.js'
import { subText, subTable, sendSubRich } from '../../lib/aiRich.js'

export default {
  name: 'aicode',
  aliases: ['ambil'],
  tags: 'tools',
  owner: true,
  description: 'Ambil file & kirim kode dengan format rich response',

  async run(ctx) {
    let input = (ctx.text || '').trim()
    input = input.replace(/^ambil\s+/i, '')
    if (!input) {
      return ctx.reply(
        `🤖 *${config.botName.toUpperCase()} AI* — _File Protocol_\n\n` +
        'Mau ambil file apa, Bos?\n\n' +
        '*Contoh:*\n.aicode feat/game/snake.js'
      )
    }

    const cwd = process.cwd()
    const safe = path.normalize(input).replace(/^(\.\.[\/\\])+/, '')
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

    let code = raw.toString('utf8')
    const totalLen = code.length
    const totalLines = code.split('\n').length

    const MAX = 6000
    let truncated = false
    if (code.length > MAX) {
      code = code.slice(0, MAX)
      truncated = true
    }

    const blocks = tokenize(code)
    if (truncated) {
      blocks.push({
        highlightType: 5,
        codeContent: '\n// … (terpotong — file asli ' + totalLen + ' karakter)'
      })
    }

    const ext = (path.extname(full).slice(1) || 'txt').toLowerCase()
    const lang = LANGS[ext] || ext
    const name = path.basename(full)

    await sendSubRich(ctx, [
      subText(
        `🤖 *${config.botName.toUpperCase()} AI* — _File Protocol_\n` +
        '✅ File `' + name + '` sudah diambil lengkap!\n\n' +
        '📄 *Isi File:*'
      ),
      {
        messageType: 5,
        codeMetadata: { codeLanguage: lang, codeBlocks: blocks }
      },
      subTable(
        [
          ['Properti', 'Nilai'],
          ['Nama', name],
          ['Path', safe],
          ['Bahasa', lang],
          ['Ukuran', (totalLen / 1024).toFixed(1) + ' KB'],
          ['Baris', String(totalLines)]
        ],
        'Ringkasan File'
      ),
      subText(`\n> _*Powered by ${config.botName}*_`)
    ])

    await ctx.react('🤖')
  }
}
