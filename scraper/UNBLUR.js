/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * UNBLUR.js — Scraper AI Unblur Image (+ fallback Experimental-Bell / BigJPG / ImgUpscaler)
 */

import axios from 'axios'
import crypto from 'crypto'
import FormData from 'form-data'
import { upscaleImage } from './UPSCALER.js'

export async function unblurImage(imgBuffer) {
  const baseRes = { status: true, author: 'Hitori-MD', data: { result_url: '', buffer: null } }

  if (!imgBuffer || !Buffer.isBuffer(imgBuffer)) {
    return { ...baseRes, status: false, error: 'Input harus berupa Buffer gambar.' }
  }

  let primaryError = ''
  const controller = new AbortController()
  const hardTimer = setTimeout(() => controller.abort(new Error('Proxy unblur timeout')), 15_000)

  try {
    const proxyAttempt = (async () => {
      const { data: rawProxies } = await axios.get('https://proxy.jhx.my.id/jh-proxy', {
        timeout: 5000,
        signal: controller.signal
      })
      const proxyList = Array.isArray(rawProxies)
        ? rawProxies
        : typeof rawProxies === 'string'
          ? rawProxies.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          : Array.isArray(rawProxies?.proxies)
            ? rawProxies.proxies
            : []

      if (!proxyList.length) return null

      const proxies = [...proxyList]
      const randIndex = Math.floor(Math.random() * proxies.length)
      const randPx = proxies.splice(randIndex, 1)[0]
      const parts = String(randPx).replace(/^https?:\/\//i, '').split(':')
      const proxy =
        parts.length >= 4
          ? { protocol: 'http', host: parts[0], port: parseInt(parts[1], 10), auth: { username: parts[2], password: parts[3] } }
          : parts.length === 2
            ? { protocol: 'http', host: parts[0], port: parseInt(parts[1], 10) }
            : false

      const randomSerial = crypto.randomBytes(3).toString('hex')
      const reqHeaders = {
        accept: '*/*',
        'product-code': '067003',
        'product-serial': randomSerial,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Origin: 'https://unblurimage.ai',
        Referer: 'https://unblurimage.ai/'
      }

      const form = new FormData()
      form.append('original_image_file', Buffer.from(imgBuffer), 'image.jpg')

      const { data: createRes } = await axios.post(
        'https://api.unwatermark.ai/api/web/unblurimage/v1/image-unblur-v2/create-job',
        form,
        { headers: { ...reqHeaders, ...form.getHeaders() }, proxy, timeout: 7_000, signal: controller.signal }
      )

      if (createRes?.code !== 300000 || !createRes?.result?.job_id) {
        throw new Error('Node server limit atau gagal antre: ' + JSON.stringify(createRes))
      }

      const jobId = createRes.result.job_id

      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        if (controller.signal.aborted) throw new Error('Proxy unblur timeout')
        const { data: pollRes } = await axios.get(
          `https://api.unwatermark.ai/api/web/unblurimage/v1/image-unblur-v2/get-job/${jobId}`,
          { headers: reqHeaders, proxy, timeout: 5_000, signal: controller.signal }
        )

        if (pollRes?.code === 100000 && pollRes?.result?.status === 1) {
          if (pollRes.result.output_url?.length > 0) {
            baseRes.data.result_url = pollRes.result.output_url[0]
            return baseRes
          }
        } else if (
          pollRes?.code !== 300006 &&
          pollRes?.code !== 100000 &&
          pollRes?.code !== 300000
        ) {
          throw new Error('Render gagal di server AI.')
        }
      }
      throw new Error('Timeout saat menunggu hasil render AI.')
    })()

    const primaryRes = await Promise.race([
      proxyAttempt,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Proxy unblur timeout')), 15_000))
    ])
    if (primaryRes) return primaryRes
  } catch (err) {
    controller.abort()
    primaryError = err.response?.data?.message || err.message
  } finally {
    clearTimeout(hardTimer)
  }

  // Fallback ke multi-engine Upscaler (Experimental-Bell Remini / Enhance / BigJPG)
  try {
    const up = await upscaleImage(imgBuffer, { mode: 'remini' })
    if (up?.status && up?.data?.buffer?.length) {
      return {
        status: true,
        author: 'Hitori-MD',
        data: {
          result_url: up.data.url || '',
          buffer: up.data.buffer,
          engine: up.data.engine || 'Remini AI'
        }
      }
    }
    throw new Error(up?.error || 'Fallback enhancer gagal.')
  } catch (fallbackErr) {
    const rawMsg = primaryError || fallbackErr?.message || 'Gagal memproses gambar.'
    const cleanMsg = String(rawMsg).replace(/unblurimage|unwatermark/gi, 'HitoriAI')
    return { ...baseRes, status: false, error: cleanMsg }
  }
}
