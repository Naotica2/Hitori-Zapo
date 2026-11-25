/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * UPSCALER.js — Multi-Engine HD Image Upscaler:
 *   1. Experimental-Bell (api.termai.cc /enhance & /remini)
 *   2. JHBigJPG (bigjpg.com — Skrep by JH a.k.a Dhika - Fiony Bot)
 *   3. ImgUpscaler (api-v2.imgupscaler.ai — legacy fallback)
 */
import axios from 'axios'
import FormData from 'form-data'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { imageSize } from 'image-size'
import uploadTop4Top from '../lib/t4t.js'

const TERMAI_API_URL = process.env.TERMAI_API_URL || 'https://api.termai.cc'
const TERMAI_API_KEY = process.env.TERMAI_API_KEY || 'Bell409'
const TERMAI_CDN_URL = process.env.TERMAI_CDN_URL || 'https://c.termai.cc/api/upload'
const TERMAI_CDN_KEY = process.env.TERMAI_CDN_KEY || 'AIzaBj7z2z3xBjsk'

export const TERMAI_ENHANCE_TYPES = new Set([
  'phox2',
  'phox4',
  'anix2',
  'anix4',
  'stdx2',
  'stdx4',
  'cf',
  'text'
])

async function minimizeForUpload(buffer) {
  try {
    const meta = await sharp(buffer).metadata()
    const maxEdge = Math.max(meta.width || 0, meta.height || 0)
    // Kecilkan hanya bila sudah terlalu besar (> 2048px) atau > 4 MB agar upload cepat
    if (maxEdge <= 2048 && buffer.length <= 4 * 1024 * 1024) {
      return buffer
    }
    return await sharp(buffer)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer()
  } catch {
    return buffer
  }
}

async function detectImageInfo(buffer) {
  try {
    const ft = await fileTypeFromBuffer(buffer)
    const dims = imageSize(buffer)
    return {
      ext: ft?.ext || dims?.type || 'jpg',
      mime: ft?.mime || 'image/jpeg',
      width: dims?.width || null,
      height: dims?.height || null
    }
  } catch {
    return { ext: 'jpg', mime: 'image/jpeg', width: null, height: null }
  }
}

async function downloadResultBuffer(url, headers = {}) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 45_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ...headers
    }
  })
  const buf = Buffer.from(res.data)
  if (!buf.length) throw new Error('Buffer hasil upscale kosong')
  return buf
}

async function uploadToPublicUrl(imgBuffer) {
  const prepared = await minimizeForUpload(imgBuffer)
  const { ext } = await detectImageInfo(prepared)

  try {
    const form = new FormData()
    form.append('file', prepared, { filename: `hitori_${Date.now()}.${ext}` })
    const { data } = await axios.post(`${TERMAI_CDN_URL}?key=${encodeURIComponent(TERMAI_CDN_KEY)}`, form, {
      headers: form.getHeaders(),
      timeout: 20_000
    })
    if (data?.path) return data.path
  } catch {}

  return uploadTop4Top(prepared)
}

/**
 * Engine 1A (Experimental-Bell): Termai Enhance (/api/tools/enhance/createTask)
 */
export async function upscaleTermaiEnhance(imgBuffer, { type = 'stdx4', uploadedUrl = null } = {}) {
  const enhanceType = TERMAI_ENHANCE_TYPES.has(type) ? type : 'stdx4'
  const imgUrl = uploadedUrl || (await uploadToPublicUrl(imgBuffer))

  const createRes = await axios.get(`${TERMAI_API_URL}/api/tools/enhance/createTask`, {
    params: { url: imgUrl, type: enhanceType, key: TERMAI_API_KEY },
    timeout: 20_000
  })
  const task = createRes.data
  if (!task?.status || !task?.id) {
    throw new Error(task?.msg || task?.cht || 'Termai enhance gagal membuat task')
  }

  let outputUrl = null
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 2500))
    const { data: s } = await axios.get(`${TERMAI_API_URL}/api/tools/enhance/taskStatus`, {
      params: { id: task.id },
      timeout: 15_000
    })
    if (s?.task_status === 'done' && s?.output) {
      outputUrl = s.output
      break
    }
    if (s?.task_status === 'failed' || s?.status === false) {
      throw new Error(s?.msg || s?.task_status || 'Termai enhance task gagal')
    }
  }
  if (!outputUrl) throw new Error('Termai enhance timeout menunggu hasil')

  const buffer = await downloadResultBuffer(outputUrl)
  const meta = await detectImageInfo(buffer)
  return {
    buffer,
    url: outputUrl,
    engine: `Experimental-Bell Enhance (${enhanceType})`,
    ...meta
  }
}

/**
 * Engine 1B (Experimental-Bell): Termai Remini (/api/tools/remini)
 */
export async function upscaleTermaiRemini(imgBuffer, { uploadedUrl = null } = {}) {
  const imgUrl = uploadedUrl || (await uploadToPublicUrl(imgBuffer))
  const { data } = await axios.get(`${TERMAI_API_URL}/api/tools/remini`, {
    params: { url: imgUrl, key: TERMAI_API_KEY },
    timeout: 45_000
  })
  const outUrl = data?.data?.url
  if (!data?.status || !outUrl) {
    throw new Error(data?.msg || data?.message || 'Termai remini gagal memproses gambar')
  }

  const buffer = await downloadResultBuffer(outUrl)
  const meta = await detectImageInfo(buffer)
  return {
    buffer,
    url: outUrl,
    engine: 'Experimental-Bell Remini',
    ...meta
  }
}

/**
 * Engine 2: JHBigJPG (bigjpg.com)
 *
 * - HARGAI WOY JANGAN DIHAPUS!
 * - Skrep by *JH a.k.a DHIKA - FIONY BOT*
 * - Credits to all Fiony's Bot Admin.
 * - Maaf kalo kurang maksimal atau berantakan
 * - Hasil gabut saja xixixi.
 */
export async function upscaleBigJpg(imgBuffer, { scale = '2', style = 'photo', noise = '2', maxPolls = 25 } = {}) {
  const { width, height, mime, ext } = await detectImageInfo(imgBuffer)
  if (!width || !height) throw new Error('Gagal membaca dimensi gambar untuk BigJPG')

  const jantung = {
    accept: '*/*',
    origin: 'https://bigjpg.com',
    referer: 'https://bigjpg.com/',
    'user-agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'x-requested-with': 'XMLHttpRequest'
  }

  const fileName = `JHFiony_${Math.floor(1000 + Math.random() * 9000)}.${ext}`
  const { data: sign } = await axios.post(
    'https://bigjpg.com/api/sign_upload',
    `filename=${encodeURIComponent(fileName)}&filetype=${encodeURIComponent(mime)}`,
    { headers: { ...jantung, 'content-type': 'application/x-www-form-urlencoded' }, timeout: 15_000 }
  )
  if (sign?.status !== 'ok' || !sign?.url || !sign?.fileurl) {
    throw new Error('BigJPG gagal request sign upload')
  }

  await axios.put(sign.url, imgBuffer, {
    headers: { 'content-type': mime },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30_000
  })

  const conf = JSON.stringify({
    x2: String(scale),
    style: style === 'art' ? 'art' : 'photo',
    noise: String(noise),
    file_name: fileName,
    files_size: imgBuffer.length,
    file_height: height,
    file_width: width,
    input: sign.fileurl
  })

  const { data: task } = await axios.post('https://bigjpg.com/task', `conf=${encodeURIComponent(conf)}`, {
    headers: { ...jantung, 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 15_000
  })
  if (task?.status !== 'ok' || !task?.info) {
    throw new Error(`BigJPG task ditolak (${task?.status || 'unknown'})`)
  }

  const fid = task.info
  let resultUrl = null
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const { data: check } = await axios.get(
      `https://bigjpg.com/free?fids=[%22${fid}%22]&_=${Date.now()}`,
      { headers: jantung, timeout: 10_000 }
    )
    if (check?.[fid]?.[0] === 'success' && check[fid]?.[1]) {
      resultUrl = check[fid][1]
      break
    }
    if (check?.[fid]?.[0] === 'error') {
      throw new Error('BigJPG error saat rendering')
    }
  }
  if (!resultUrl) throw new Error('BigJPG timeout menunggu antrean render')

  const buffer = await downloadResultBuffer(resultUrl, { Referer: 'https://bigjpg.com/' })
  const meta = await detectImageInfo(buffer)
  return {
    buffer,
    url: resultUrl,
    engine: `BigJPG (${scale}x ${style})`,
    ...meta
  }
}

/**
 * Engine 3: ImgUpscaler (legacy api-v2.imgupscaler.ai)
 */
export async function upscaleImgUpscaler(imgBuffer) {
  const jantung = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    Origin: 'https://imgupscaler.ai',
    Referer: 'https://imgupscaler.ai/',
    Accept: '*/*',
    'Accept-Language': 'id-ID'
  }

  const fileName = `Hitori_${Math.floor(1000 + Math.random() * 9000)}.jpg`
  const form1 = new FormData()
  form1.append('file_name', fileName)

  const { data: uploadInit } = await axios.post(
    'https://api-v2.imgupscaler.ai/api/common/upload/upload-image',
    form1,
    { headers: { ...jantung, ...form1.getHeaders() }, timeout: 15_000 }
  )

  const putUrl = uploadInit?.result?.url
  const objectName = uploadInit?.result?.object_name
  if (!putUrl || !objectName) throw new Error('ImgUpscaler gagal mendapatkan URL upload')

  await axios.put(putUrl, imgBuffer, {
    headers: { ...jantung, 'Content-Type': 'image/jpeg' },
    timeout: 25_000
  })

  const form2 = new FormData()
  form2.append('object_name', objectName)
  const { data: signData } = await axios.post(
    'https://api-v2.imgupscaler.ai/api/common/upload/sign-object',
    form2,
    { headers: { ...jantung, ...form2.getHeaders() }, timeout: 15_000 }
  )

  const signedUrl = signData?.result?.url
  if (!signedUrl) throw new Error('ImgUpscaler gagal sign object')

  const productSerial = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

  const form3 = new FormData()
  form3.append('target_pixel', '3.6')
  form3.append('original_image_file', signedUrl)
  form3.append('output_format', 'jpg')

  const { data: jobData } = await axios.post(
    'https://api-v2.imgupscaler.ai/api/runtime/jobs/create-job',
    form3,
    {
      headers: {
        ...jantung,
        ...form3.getHeaders(),
        'product-code': 'magiceraser',
        'product-serial': productSerial,
        'router-key': 'image_enhance_v1',
        timezone: 'Asia/Jakarta'
      },
      timeout: 20_000
    }
  )

  const jobId = jobData?.result?.job_id
  if (!jobId) throw new Error('ImgUpscaler gagal membuat job')

  let outputUrl = null
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const { data: pollData } = await axios.get(
      `https://api-v2.imgupscaler.ai/api/runtime/jobs/get-job/${jobId}`,
      { headers: jantung, timeout: 12_000 }
    )
    if (pollData?.result?.status === 1 && pollData?.result?.output_url) {
      outputUrl = pollData.result.output_url
      break
    }
    if (pollData?.result?.status === -1) {
      throw new Error('ImgUpscaler job gagal diproses')
    }
  }
  if (!outputUrl) throw new Error('ImgUpscaler timeout')

  const buffer = await downloadResultBuffer(outputUrl, jantung)
  const meta = await detectImageInfo(buffer)
  return {
    buffer,
    url: outputUrl,
    engine: 'ImgUpscaler',
    ...meta
  }
}

/**
 * Multi-engine HD upscaler dengan fallback berurutan:
 *   Default: Experimental-Bell (Enhance stdx4 -> Remini) -> BigJPG -> ImgUpscaler
 *   Option `mode`: 'auto' | 'enhance' | 'remini' | 'bigjpg' | 'anime' | 'imgupscaler' | Termai type
 */
export async function upscaleImage(imgBuffer, options = {}) {
  const baseRes = {
    status: true,
    author: 'Hitori-MD',
    data: {}
  }

  if (!imgBuffer || !Buffer.isBuffer(imgBuffer)) {
    return { ...baseRes, status: false, error: 'Input harus berupa Buffer gambar.' }
  }

  const mode = String(options.mode || 'auto').trim().toLowerCase()
  let sharedTermaiUrl = null
  const getSharedUrl = async () => {
    if (!sharedTermaiUrl) sharedTermaiUrl = await uploadToPublicUrl(imgBuffer)
    return sharedTermaiUrl
  }

  const runners = {
    enhance: async () =>
      upscaleTermaiEnhance(imgBuffer, {
        type: TERMAI_ENHANCE_TYPES.has(mode) ? mode : options.type || 'stdx4',
        uploadedUrl: await getSharedUrl()
      }),
    remini: async () => upscaleTermaiRemini(imgBuffer, { uploadedUrl: await getSharedUrl() }),
    bigjpg: async () =>
      upscaleBigJpg(imgBuffer, {
        scale: options.scale || '2',
        style: mode === 'anime' ? 'art' : options.style || 'photo',
        noise: options.noise || '2'
      }),
    imgupscaler: async () => upscaleImgUpscaler(imgBuffer)
  }

  let order
  if (mode === 'bigjpg' || mode === 'anime') {
    order = ['bigjpg', 'enhance', 'remini', 'imgupscaler']
  } else if (mode === 'remini') {
    order = ['remini', 'enhance', 'bigjpg', 'imgupscaler']
  } else if (mode === 'imgupscaler' || mode === 'v1' || mode === 'old') {
    order = ['imgupscaler', 'enhance', 'remini', 'bigjpg']
  } else {
    // Default (auto / enhance / phox4 / anix4 / stdx4 / dll): prioritaskan Experimental-Bell yang tajam & cepat
    order = ['enhance', 'remini', 'bigjpg', 'imgupscaler']
  }

  const errors = []
  for (const key of order) {
    try {
      const out = await runners[key]()
      if (out?.buffer?.length) {
        return { ...baseRes, data: out }
      }
    } catch (err) {
      errors.push(`${key}: ${err?.message || err}`)
    }
  }

  return {
    ...baseRes,
    status: false,
    error: errors.join(' | ').slice(0, 350) || 'Semua engine upscaler gagal memproses gambar.'
  }
}

export default upscaleImage
