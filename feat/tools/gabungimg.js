/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * gabungimg.js — Gabung Dua Gambar (Vertical / Horizontal)
 */
import { spawn } from 'node:child_process'
import sizeOf from 'image-size'
import { resolveTargetMedia, tryDownloadImageBuffer } from '../../lib/media.js'

const MEM = (globalThis.HITORI_GABUNGIMG_MEM ??= new Map())

const processFfmpeg = (img1, img2, filter) => {
  return new Promise((resolve, reject) => {
    const bufs = []
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-i', 'pipe:3',
        '-i', 'pipe:4',
        '-filter_complex', filter,
        '-map', '[v]',
        '-f', 'image2',
        '-vcodec', 'png',
        'pipe:1'
      ],
      { stdio: ['ignore', 'pipe', 'ignore', 'pipe', 'pipe'] }
    )

    ffmpeg.stdout.on('data', chunk => bufs.push(chunk))
    ffmpeg.on('error', err => reject(err))
    ffmpeg.on('close', code => {
      if (code !== 0) reject(new Error('ffmpeg exited with code ' + code))
      else resolve(Buffer.concat(bufs))
    })

    ffmpeg.stdio[3].write(img1)
    ffmpeg.stdio[3].end()
    ffmpeg.stdio[4].write(img2)
    ffmpeg.stdio[4].end()
  })
}

export default {
  name: 'gabungimg',
  aliases: ['combineimg'],
  tags: 'tools',
  description: 'Gabung dua gambar menjadi satu (Vertical/Horizontal)',

  async run(ctx) {
    const raw = (ctx.text || '').trim().toLowerCase()
    
    if (/^(reset|batal|cancel)$/.test(raw)) {
      MEM.delete(ctx.sender)
      return ctx.reply('🗑️ Sesi gabung gambar dibatalkan.')
    }

    const { rawMessage, quoted } = resolveTargetMedia(ctx)

    const quotedBuf = await tryDownloadImageBuffer(quoted)
    const attachedBuf = await tryDownloadImageBuffer(rawMessage)
    const imgBuf = quotedBuf || attachedBuf

    if (!imgBuf) {
      return ctx.reply('⚠️ Reply gambar atau kirim gambar dengan command ini.\n\nKetik `.gabungimg --h` untuk menggabung secara horizontal, atau langsung `.gabungimg` untuk vertikal.')
    }

    await ctx.react('⏳')

    const session = MEM.get(ctx.sender)

    if (!session) {
      const timeout = setTimeout(() => {
        MEM.delete(ctx.sender)
      }, 5 * 60 * 1000)

      MEM.set(ctx.sender, { img: imgBuf, timeout })
      await ctx.react('✅')
      return ctx.reply('✅ Gambar pertama tersimpan. Sekarang kirim/reply gambar kedua dengan command yang sama.\n\n_(Sesi berlaku 5 menit, ketik `.gabungimg reset` untuk membatalkan)_')
    }

    clearTimeout(session.timeout)
    MEM.delete(ctx.sender)

    try {
      const img1 = session.img
      const img2 = imgBuf

      const size1 = sizeOf(img1)
      const size2 = sizeOf(img2)

      const isHorizontal = raw.includes('--h')
      let filter

      if (isHorizontal) {
        const targetHeight = Math.min(size1.height, size2.height)
        filter = `[0:v]scale=-1:${targetHeight}[img1];[1:v]scale=-1:${targetHeight}[img2];[img1][img2]hstack=inputs=2[v]`
      } else {
        const targetWidth = Math.min(size1.width, size2.width)
        filter = `[0:v]scale=${targetWidth}:-1[img1];[1:v]scale=${targetWidth}:-1[img2];[img1][img2]vstack=inputs=2[v]`
      }

      const resultImage = await processFfmpeg(img1, img2, filter)

      await ctx.client.message.send(ctx.chat, {
        type: 'image',
        media: resultImage,
        mimetype: 'image/png',
        caption: 'Ini dia hasil gabungannya, Kak!'
      })
      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal menggabungkan gambar: ' + String(e.message || e).slice(0, 150))
    }
  }
}