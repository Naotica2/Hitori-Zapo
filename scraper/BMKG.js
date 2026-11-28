/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * BMKG.js — Data Gempa & Prakiraan Cuaca Resmi BMKG + Pencarian Kode Wilayah adm4 + Fallback Open-Meteo
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGENCY_CACHE_PATH = path.resolve(__dirname, '..', 'session', 'wilayah_regencies.json')
const UA = 'Mozilla/5.0 (compatible; HitoriMD/1.0; +https://github.com)'

const MEMORY_CACHE = {
  regencies: null,
  districts: new Map(),
  villages: new Map(),
  adm4Index: new Map()
}

async function fetchJson(url, timeoutMs = 12_000) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${new URL(url).hostname}`)
  return res.json()
}

export async function getLatestGempa() {
  const data = await fetchJson('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json')
  const g = data?.Infogempa?.gempa
  if (!g) throw new Error('Data autogempa BMKG kosong.')
  return {
    tanggal: g.Tanggal || '-',
    jam: g.Jam || '-',
    dateTime: g.DateTime || '',
    coordinates: g.Coordinates || '-',
    lintang: g.Lintang || '-',
    bujur: g.Bujur || '-',
    magnitude: g.Magnitude || '-',
    kedalaman: g.Kedalaman || '-',
    wilayah: g.Wilayah || '-',
    potensi: g.Potensi || '-',
    dirasakan: g.Dirasakan || '-',
    shakemapUrl: g.Shakemap ? `https://static.bmkg.go.id/${g.Shakemap}` : null
  }
}

export async function getGempaList(mode = 'terkini') {
  const file = mode === 'dirasakan' ? 'gempadirasakan.json' : 'gempaterkini.json'
  const data = await fetchJson(`https://data.bmkg.go.id/DataMKG/TEWS/${file}`)
  const list = data?.Infogempa?.gempa
  if (!Array.isArray(list)) throw new Error('Daftar gempa BMKG tidak tersedia.')
  return list
}

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^(kota\s+administrasi|kota\s+adm\.?|kabupaten|kab\.?|kota|kecamatan|kec\.?|kelurahan|kel\.?|desa)\s+/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function loadAllRegencies() {
  if (Array.isArray(MEMORY_CACHE.regencies) && MEMORY_CACHE.regencies.length) {
    return MEMORY_CACHE.regencies
  }

  try {
    if (fs.existsSync(REGENCY_CACHE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(REGENCY_CACHE_PATH, 'utf8'))
      if (Array.isArray(parsed) && parsed.length > 400) {
        MEMORY_CACHE.regencies = parsed
        return parsed
      }
    }
  } catch {}

  const provRes = await fetchJson('https://wilayah.id/api/provinces.json')
  const provinces = provRes?.data || []
  if (!provinces.length) throw new Error('Gagal memuat daftar provinsi.')

  const regencies = []
  const chunks = []
  for (let i = 0; i < provinces.length; i += 8) {
    chunks.push(provinces.slice(i, i + 8))
  }
  for (const batch of chunks) {
    const results = await Promise.all(
      batch.map((prov) =>
        fetchJson(`https://wilayah.id/api/regencies/${prov.code}.json`, 10_000)
          .then((r) => (r?.data || []).map((item) => ({ ...item, provName: prov.name })))
          .catch(() => [])
      )
    )
    for (const rows of results) regencies.push(...rows)
  }

  if (regencies.length > 0) {
    MEMORY_CACHE.regencies = regencies
    try {
      fs.mkdirSync(path.dirname(REGENCY_CACHE_PATH), { recursive: true })
      fs.writeFileSync(REGENCY_CACHE_PATH, JSON.stringify(regencies))
    } catch {}
  }

  return regencies
}

async function getDistricts(regCode) {
  if (MEMORY_CACHE.districts.has(regCode)) return MEMORY_CACHE.districts.get(regCode)
  const res = await fetchJson(`https://wilayah.id/api/districts/${regCode}.json`)
  const rows = res?.data || []
  MEMORY_CACHE.districts.set(regCode, rows)
  return rows
}

async function getVillages(distCode) {
  if (MEMORY_CACHE.villages.has(distCode)) return MEMORY_CACHE.villages.get(distCode)
  const res = await fetchJson(`https://wilayah.id/api/villages/${distCode}.json`)
  const rows = res?.data || []
  MEMORY_CACHE.villages.set(distCode, rows)
  return rows
}

function bestMatch(list, queryNorm) {
  if (!list?.length || !queryNorm) return null
  let exact = null
  let prefix = null
  let contains = null
  for (const item of list) {
    const n = normText(item.name)
    if (!n) continue
    if (n === queryNorm) {
      exact = item
      break
    }
    if (!prefix && (n.startsWith(queryNorm) || (n.length >= 4 && queryNorm.split(' ').includes(n)))) {
      prefix = item
    }
    if (!contains && n.includes(queryNorm)) contains = item
  }
  return exact || prefix || contains
}

async function pickFirstAdm4FromRegency(regCode, subHint = '') {
  const districts = await getDistricts(regCode)
  if (!districts.length) return null
  const hintNorm = normText(subHint)
  let district = hintNorm ? bestMatch(districts, hintNorm) : null
  if (!district) {
    district = districts[Math.floor(districts.length / 2)] || districts[0]
  }
  const villages = await getVillages(district.code)
  if (!villages.length) return null
  const village = (hintNorm && bestMatch(villages, hintNorm)) || villages[0]
  return village?.code || null
}

async function resolveAdm4FromQuery(query) {
  const clean = String(query || '').trim()
  if (/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(clean)) return clean

  const key = normText(clean)
  if (MEMORY_CACHE.adm4Index.has(key)) return MEMORY_CACHE.adm4Index.get(key)

  const regencies = await loadAllRegencies()
  const parts = clean.split(',').map((s) => normText(s)).filter(Boolean)

  // 1. Cek kecocokan langsung terhadap Kota/Kabupaten (contoh: "bandung", "jakarta pusat", "sleman")
  for (const cand of [...parts].reverse()) {
    const reg = bestMatch(regencies, cand)
    if (reg) {
      const subHint = parts.find((p) => p !== cand) || ''
      const adm4 = await pickFirstAdm4FromRegency(reg.code, subHint)
      if (adm4) {
        MEMORY_CACHE.adm4Index.set(key, adm4)
        return adm4
      }
    }
  }

  // 2. Jika nama adalah kecamatan/desa (contoh: "Kemayoran", "Coblong"), pakai Nominatim hanya untuk wilayah administratif
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&countrycodes=id&format=jsonv2&addressdetails=1&limit=5`
    const places = await fetchJson(nomUrl, 8000)
    if (Array.isArray(places) && places.length) {
      for (const pl of places) {
        if (pl.category !== 'boundary' && pl.category !== 'place') continue
        const addr = pl.address || {}
        const adminNames = [addr.village, addr.suburb, addr.city_district, addr.district, addr.town, addr.city, addr.county]
          .filter(Boolean)
          .map(normText)
        if (!adminNames.some((an) => an === key || an.includes(key))) continue

        const regCandidates = [addr.city, addr.county, addr.municipality, addr.town, addr.state_district]
          .filter(Boolean)
          .map(normText)
        const subCandidates = [addr.village, addr.suburb, addr.city_district, addr.district, clean]
          .filter(Boolean)
          .map(normText)

        for (const rc of regCandidates) {
          const reg = bestMatch(regencies, rc)
          if (reg) {
            for (const sc of subCandidates) {
              const adm4 = await pickFirstAdm4FromRegency(reg.code, sc)
              if (adm4) {
                MEMORY_CACHE.adm4Index.set(key, adm4)
                return adm4
              }
            }
          }
        }
      }
    }
  } catch {}

  return null
}

function wmoCodeToDesc(code) {
  const map = {
    0: 'Cerah ☀️',
    1: 'Cerah Berawan 🌤️',
    2: 'Berawan Sebagian ⛅',
    3: 'Mendung ☁️',
    45: 'Berkabut 🌫️',
    48: 'Kabut Tebal 🌫️',
    51: 'Gerimis Ringan 🌦️',
    53: 'Gerimis 🌦️',
    55: 'Gerimis Lebat 🌧️',
    61: 'Hujan Ringan 🌧️',
    63: 'Hujan Sedang 🌧️',
    65: 'Hujan Lebat ⛈️',
    80: 'Hujan Lokal 🌦️',
    81: 'Hujan Sedang 🌧️',
    82: 'Hujan Deras ⛈️',
    95: 'Hujan Petir ⛈️',
    96: 'Badai Petir ⛈️',
    99: 'Badai Petir Hebat ⛈️'
  }
  return map[code] || `Kode Cuaca ${code}`
}

async function getOpenMeteoFallback(query) {
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=id&format=json`
  )
  const hit = geo?.results?.[0]
  if (!hit) throw new Error(`Wilayah "${query}" tidak ditemukan.`)

  const fc = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}` +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
      '&hourly=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&forecast_days=2&timezone=auto'
  )

  const cur = fc.current || {}
  const slots = []
  const times = fc.hourly?.time || []
  for (let i = 0; i < Math.min(times.length, 24); i += 3) {
    slots.push({
      localDatetime: times[i].replace('T', ' '),
      tempC: fc.hourly.temperature_2m?.[i],
      humidity: fc.hourly.relative_humidity_2m?.[i],
      desc: wmoCodeToDesc(fc.hourly.weather_code?.[i]),
      windKmh: fc.hourly.wind_speed_10m?.[i],
      windDir: ''
    })
  }

  return {
    source: 'Open-Meteo',
    location: {
      desa: hit.name,
      kecamatan: hit.admin2 || '',
      kotkab: hit.admin1 || '',
      provinsi: hit.country || '',
      adm4: ''
    },
    current: {
      localDatetime: String(cur.time || '').replace('T', ' '),
      tempC: cur.temperature_2m,
      humidity: cur.relative_humidity_2m,
      desc: wmoCodeToDesc(cur.weather_code),
      windKmh: cur.wind_speed_10m,
      windDir: ''
    },
    slots
  }
}

export async function getWeatherForecast(query) {
  const q = String(query || '').trim()
  if (!q) throw new Error('Nama kota atau kelurahan wajib diisi.')

  try {
    const adm4 = await resolveAdm4FromQuery(q)
    if (adm4) {
      const data = await fetchJson(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${encodeURIComponent(adm4)}`)
      const entry = data?.data?.[0]
      const lokasi = entry?.lokasi || data?.lokasi
      const nested = Array.isArray(entry?.cuaca) ? entry.cuaca.flat() : []
      if (lokasi && nested.length) {
        const slots = nested.slice(0, 8).map((s) => ({
          localDatetime: s.local_datetime || s.utc_datetime || '-',
          tempC: s.t,
          humidity: s.hu,
          desc: s.weather_desc || '-',
          windKmh: s.ws,
          windDir: s.wd || '',
          cloudPct: s.tcc,
          rainMm: s.tp
        }))
        return {
          source: 'BMKG RI',
          location: {
            desa: lokasi.desa || '',
            kecamatan: lokasi.kecamatan || '',
            kotkab: lokasi.kotkab || '',
            provinsi: lokasi.provinsi || '',
            adm4: lokasi.adm4 || adm4
          },
          current: slots[0],
          slots
        }
      }
    }
  } catch {}

  return getOpenMeteoFallback(q)
}
