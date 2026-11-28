/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * FACESWAP.js — Face Swap engine.
 */

async function getProxyList() {
  const axios = (await import('axios')).default

  try {
    const { data: rawData } = await axios.get('https://proxy.jhx.my.id/jh-proxy', { timeout: 8000 })
    let list = []
    if (Array.isArray(rawData)) {
      list = rawData
    } else if (typeof rawData === 'string') {
      list = rawData.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    } else if (Array.isArray(rawData?.proxies)) {
      list = rawData.proxies
    }

    return list
      .map((picked) => {
        const clean = String(picked || '').replace(/^https?:\/\//i, '').trim()
        const parts = clean.split(':')
        if (parts.length >= 4) {
          return {
            protocol: 'http',
            host: parts[0],
            port: Number.parseInt(parts[1], 10),
            auth: { username: parts[2], password: parts[3] }
          }
        }
        if (parts.length === 2) {
          return { protocol: 'http', host: parts[0], port: Number.parseInt(parts[1], 10) }
        }
        return null
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

async function toBuffer(input, proxy = false) {
  const axios = (await import('axios')).default

  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)

  if (typeof input === 'string' && /^https?:\/\//i.test(input)) {
    const res = await axios.get(input, {
      responseType: 'arraybuffer',
      timeout: 25_000,
      proxy: proxy || false
    })
    return Buffer.from(res.data)
  }

  throw new Error('Input image invalid')
}

export async function faceSwap({ target, swap } = {}) {
  const axios = (await import('axios')).default
  const crypto = (await import('crypto')).default
  const FormData = (await import('form-data')).default

  try {
    const proxies = await getProxyList()
    const candidates = []
    if (proxies.length) {
      const shuffled = [...proxies].sort(() => Math.random() - 0.5).slice(0, 3)
      candidates.push(...shuffled)
    } else {
      candidates.push(false)
    }

    const [targetBuf, swapBuf] = await Promise.all([
      toBuffer(target, candidates[0]),
      toBuffer(swap, candidates[0])
    ])

    let lastErr = null
    for (const proxy of candidates) {
      try {
        const rand1 = Math.floor(1000 + Math.random() * 9000)
        const rand2 = Math.floor(1000 + Math.random() * 9000)

        const form = new FormData()
        form.append('target_image', Buffer.from(targetBuf), {
          filename: `Hitori_target_${rand1}.jpg`,
          contentType: 'image/jpeg'
        })
        form.append('swap_image', Buffer.from(swapBuf), {
          filename: `Hitori_swap_${rand2}.png`,
          contentType: 'image/png'
        })
        form.append('version', '2')

        const reqHeaders = {
          ...form.getHeaders(),
          'Product-Code': '067003',
          'Product-Serial': crypto.randomBytes(16).toString('hex'),
          source: 'ai_face_vary',
          Authorization: ''
        }

        const { data: createRes } = await axios.post(
          'https://api.remaker.ai/api/pai/v3/ai-facevary/appapi/create-job',
          form,
          { headers: reqHeaders, proxy: proxy || false, timeout: 30_000 }
        )

        if (createRes.code !== 100000 || !createRes.result?.job_id) {
          throw new Error(`Gagal create job: ${JSON.stringify(createRes)}`)
        }

        const jobId = createRes.result.job_id
        let finalResult = null

        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 4000))

          const { data: pollRes } = await axios.get(
            `https://api.remaker.ai/api/pai/v3/ai-facevary/appapi/get-job/${jobId}`,
            { headers: reqHeaders, proxy: proxy || false, timeout: 20_000 }
          )

          if (pollRes.code === 300006) continue

          if (pollRes.code === 100000 && pollRes.result?.output_image_url) {
            finalResult = Array.isArray(pollRes.result.output_image_url)
              ? pollRes.result.output_image_url[0]
              : pollRes.result.output_image_url
            break
          }

          throw new Error(`Error polling: ${JSON.stringify(pollRes)}`)
        }

        if (!finalResult) throw new Error('Timeout nunggu render kelar!')

        return {
          success: true,
          resultUrl: finalResult
        }
      } catch (attemptErr) {
        lastErr = attemptErr
      }
    }

    throw lastErr || new Error('Semua node Face Swap gagal merespons.')
  } catch (err) {
    const errInfo = err.response?.data || err.message || err
    throw new Error(typeof errInfo === 'object' ? JSON.stringify(errInfo) : String(errInfo))
  }
}

export default faceSwap
