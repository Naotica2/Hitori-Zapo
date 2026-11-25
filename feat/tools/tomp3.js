/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * tomp3.js — Fitur Pengubah Video/Voice Note Menjadi MP3
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js'

export default {
  name: 'tomp3',
  aliases: ['toaudio', 'mp3', 'audio'],
  tags: 'tools',
  description: 'Convert Video atau Voice Note menjadi MP3',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx)
    if (!event) return ctx.reply('Gagal mendapatkan event pesan dari sistem.')

    if (!payload || (!payload.mimetype?.includes('video') && !payload.mimetype?.includes('audio'))) {
      return ctx.reply(
        '✦ *VIDEO TO MP3* ✦\n\n' +
        'Reply video atau Voice Note dengan perintah `.tomp3` buat ngekstrak suaranya doang.'
      )
    }

    await ctx.react('⏳')

    const randName = crypto.randomBytes(5).toString('hex')
    const ext = payload.mimetype.includes('video') ? 'mp4' : 'ogg'
    const inputPath = path.join(os.tmpdir(), `${randName}.${ext}`)
    const outputPath = path.join(os.tmpdir(), `${randName}.mp3`)

    try {
      const mediaBuffer = await downloadTargetBuffer(targetMessage)
      await fs.writeFile(inputPath, mediaBuffer)

      await new Promise((resolve, reject) => {
        execFile('ffmpeg', ['-i', inputPath, '-q:a', '0', '-map', 'a', outputPath], (err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      const audioBuffer = await fs.readFile(outputPath)

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'audio',
          media: audioBuffer,
          mimetype: 'audio/mpeg',
          ptt: false
        },
        { quote: rawMessage }
      )

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal convert ke MP3: Pastikan FFmpeg terinstall di server! Error: ' + String(error.message || error).slice(0, 150))
    } finally {
      await fs.unlink(inputPath).catch(() => {})
      await fs.unlink(outputPath).catch(() => {})
    }
  }
}
