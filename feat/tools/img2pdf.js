/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * img2pdf.js — Gabungkan 1 atau banyak gambar menjadi 1 file PDF siap unduh/cetak
 */
import sharp from 'sharp'
import config from '../../config.js'
import { downloadTargetBuffer, getEvent, resolveTargetMedia } from '../../lib/media.js'

const SESSION_TTL_MS = 15 * 60 * 1000
const MAX_IMAGES = 30
const MAX_INPUT_BYTES = 12 * 1024 * 1024
const PDF_SESSIONS = (globalThis.HITORI_IMG2PDF_MEM ??= new Map())

function getSessionKey(ctx) {
  return `${ctx.chat}::${ctx.senderNumber || ctx.sender}`
}

function getCart(ctx) {
  const key = getSessionKey(ctx)
  const item = PDF_SESSIONS.get(key)
  if (!item) return null
  if (Date.now() - item.updatedAt > SESSION_TTL_MS) {
    PDF_SESSIONS.delete(key)
    return null
  }
  return item
}

function saveCart(ctx, cart) {
  const key = getSessionKey(ctx)
  if (PDF_SESSIONS.size >= 80 && !PDF_SESSIONS.has(key)) {
    const oldest = PDF_SESSIONS.keys().next().value
    if (oldest) PDF_SESSIONS.delete(oldest)
  }
  cart.updatedAt = Date.now()
  PDF_SESSIONS.set(key, cart)
}

/**
 * Bangun dokumen PDF 1.4 valid secara langsung di memori dari array Buffer gambar (JPEG/PNG/WebP -> DCTDecode JPEG).
 */
export async function buildPdfFromImages(imageBuffers) {
  if (!Array.isArray(imageBuffers) || !imageBuffers.length) {
    throw new Error('Minimal butuh 1 gambar untuk membuat PDF.')
  }

  const pages = await Promise.all(
    imageBuffers.map(async (raw) => {
      const jpeg = await sharp(raw, { pages: 1 })
        .flatten({ background: '#ffffff' })
        .resize(1654, 2339, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer()
      const meta = await sharp(jpeg).metadata()
      const width = meta.width || 595
      const height = meta.height || 842
      return { jpeg, width, height }
    })
  )

  const objects = []
  const addObj = (bodyBuf) => {
    objects.push(Buffer.isBuffer(bodyBuf) ? bodyBuf : Buffer.from(bodyBuf, 'latin1'))
    return objects.length
  }

  const catalogNum = 1
  const pagesNum = 2
  addObj('') // placeholder catalog
  addObj('') // placeholder pages

  const pageObjNums = []
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i]
    const wPt = pg.width
    const hPt = pg.height

    const imgHeader = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
      'latin1'
    )
    const imgFooter = Buffer.from('\nendstream', 'latin1')
    const imgNum = addObj(Buffer.concat([imgHeader, pg.jpeg, imgFooter]))

    const contentStream = `q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ\n`
    const contentNum = addObj(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`)

    const pageNum = addObj(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
    )
    pageObjNums.push(pageNum)
  }

  objects[catalogNum - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`, 'latin1')
  objects[pagesNum - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>`,
    'latin1'
  )

  const chunks = [Buffer.from('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n', 'latin1')]
  const offsets = [0]
  let cursor = chunks[0].length

  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor)
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1')
    const tail = Buffer.from('\nendobj\n', 'latin1')
    chunks.push(head, objects[i], tail)
    cursor += head.length + objects[i].length + tail.length
  }

  const xrefOffset = cursor
  const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`]
  for (let i = 1; i <= objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  }
  xrefLines.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  )
  chunks.push(Buffer.from(xrefLines.join(''), 'latin1'))

  return Buffer.concat(chunks)
}

export default {
  name: 'img2pdf',
  aliases: ['topdf', 'jpg2pdf', 'pdf'],
  tags: 'tools',
  cooldown: 4000,
  description: 'Ubah 1 atau banyak gambar menjadi dokumen PDF (dukung mode kumpul multi-halaman)',

  async run(ctx) {
    const p = config.mainPrefix
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}

    const raw = String(ctx.text || '').trim()
    const sub = String(ctx.args[0] || '').toLowerCase()
    const rest = raw.slice((ctx.args[0] || '').length).trim()

    if (/^(help|\?)$/i.test(raw)) {
      return ctx.client.message.send(
        ctx.chat,
        '📄 *IMAGE TO PDF*\n\n' +
          '*1. Langsung 1 gambar:*\n' +
          `• Kirim/reply gambar dengan *${p}img2pdf [nama_file]*\n\n` +
          '*2. Gabung banyak halaman:*\n' +
          `• Reply/kirim tiap gambar dengan *${p}img2pdf add*\n` +
          `• *${p}img2pdf list* — cek jumlah halaman\n` +
          `• *${p}img2pdf send [nama_file]* — gabungkan & kirim PDF\n` +
          `• *${p}img2pdf reset* — kosongkan antrean`,
        sendOpts
      )
    }

    if (sub === 'reset' || sub === 'clear' || sub === 'batal') {
      PDF_SESSIONS.delete(getSessionKey(ctx))
      return ctx.client.message.send(ctx.chat, '🗑️ Antrean halaman PDF dikosongkan.', sendOpts)
    }

    if (sub === 'list' || sub === 'cek') {
      const cart = getCart(ctx)
      if (!cart?.pages?.length) {
        return ctx.client.message.send(ctx.chat, `📭 Belum ada gambar di antrean. Pakai *${p}img2pdf add* dulu.`, sendOpts)
      }
      return ctx.client.message.send(
        ctx.chat,
        `📄 Antrean PDF saat ini berisi *${cart.pages.length}/${MAX_IMAGES}* halaman.\nKetik *${p}img2pdf send [NamaFile]* untuk membuat PDF.`,
        sendOpts
      )
    }

    if (['send', 'build', 'done', 'kirim'].includes(sub)) {
      const cart = getCart(ctx)
      if (!cart?.pages?.length) {
        return ctx.client.message.send(ctx.chat, `📭 Antrean PDF masih kosong. Tambahkan gambar via *${p}img2pdf add*.`, sendOpts)
      }
      const baseName = (rest || `Hitori-${Date.now()}`).replace(/[^\w.-]+/g, '_').replace(/\.pdf$/i, '')
      const fileName = `${baseName}.pdf`
      await ctx.react('⏳')
      try {
        const pdfBuf = await buildPdfFromImages(cart.pages)
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'document',
            media: pdfBuf,
            mimetype: 'application/pdf',
            fileName,
            caption: `📄 *${fileName}* (${cart.pages.length} halaman)`
          },
          sendOpts
        )
        PDF_SESSIONS.delete(getSessionKey(ctx))
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ Gagal membuat PDF: ${String(err?.message || err).slice(0, 200)}`, sendOpts)
      }
      return
    }

    const { targetMessage, payload } = resolveTargetMedia(ctx)
    const mime = String(payload?.mimetype || '')
    const isImageLike =
      payload &&
      (payload.mediaType === 'image' || payload.mediaType === 'sticker' || mime.startsWith('image/'))

    if (sub === 'add' || sub === 'tambah') {
      if (!targetMessage || !isImageLike) {
        return ctx.client.message.send(ctx.chat, `❌ Kirim/reply gambar dengan *${p}img2pdf add*.`, sendOpts)
      }
      const cart = getCart(ctx) || { pages: [] }
      if (cart.pages.length >= MAX_IMAGES) {
        return ctx.client.message.send(ctx.chat, `⚠️ Maksimal ${MAX_IMAGES} halaman per PDF.`, sendOpts)
      }
      await ctx.react('⏳')
      try {
        const buf = await downloadTargetBuffer(targetMessage)
        if (buf.length > MAX_INPUT_BYTES) throw new Error('Ukuran gambar maksimal 12 MB.')
        cart.pages.push(buf)
        saveCart(ctx, cart)
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `✅ Halaman *#${cart.pages.length}* ditambahkan ke PDF.\nTambah gambar lagi atau ketik *${p}img2pdf send [NamaFile]*.`,
          sendOpts
        )
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 200)}`, sendOpts)
      }
    }

    const existingCart = getCart(ctx)
    if (targetMessage && isImageLike) {
      await ctx.react('⏳')
      try {
        const buf = await downloadTargetBuffer(targetMessage)
        if (buf.length > MAX_INPUT_BYTES) throw new Error('Ukuran gambar maksimal 12 MB.')
        const pages = [...(existingCart?.pages || []), buf].slice(0, MAX_IMAGES)
        const baseName = (raw || `Hitori-${Date.now()}`).replace(/[^\w.-]+/g, '_').replace(/\.pdf$/i, '')
        const fileName = `${baseName}.pdf`
        const pdfBuf = await buildPdfFromImages(pages)
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'document',
            media: pdfBuf,
            mimetype: 'application/pdf',
            fileName,
            caption: `📄 *${fileName}* (${pages.length} halaman)`
          },
          sendOpts
        )
        if (existingCart) PDF_SESSIONS.delete(getSessionKey(ctx))
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 200)}`, sendOpts)
      }
      return
    }

    if (existingCart?.pages?.length) {
      const baseName = (raw || `Hitori-${Date.now()}`).replace(/[^\w.-]+/g, '_').replace(/\.pdf$/i, '')
      const fileName = `${baseName}.pdf`
      await ctx.react('⏳')
      try {
        const pdfBuf = await buildPdfFromImages(existingCart.pages)
        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'document',
            media: pdfBuf,
            mimetype: 'application/pdf',
            fileName,
            caption: `📄 *${fileName}* (${existingCart.pages.length} halaman)`
          },
          sendOpts
        )
        PDF_SESSIONS.delete(getSessionKey(ctx))
        await ctx.react('✅')
      } catch (err) {
        await ctx.react('❎')
        return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 200)}`, sendOpts)
      }
      return
    }

    return ctx.client.message.send(
      ctx.chat,
      `📄 Ketik *${p}img2pdf help* untuk cara mengubah 1 atau banyak gambar jadi PDF.`,
      sendOpts
    )
  }
}
