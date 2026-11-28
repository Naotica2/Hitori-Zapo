/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ISLAM.js — Jadwal Sholat (myQuran v3) & Al-Qur'an Digital + Murottal (EQuran.id v2)
 */

const UA = 'Mozilla/5.0 (compatible; HitoriMD/1.0)'
let SURAT_LIST_CACHE = null

async function fetchJson(url, timeoutMs = 12_000) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function findSholatCity(keyword) {
  const kw = String(keyword || '').trim()
  if (!kw) throw new Error('Nama kota wajib diisi.')
  const res = await fetchJson(`https://api.myquran.com/v3/sholat/kabkota/find/${encodeURIComponent(kw)}`)
  if (!res?.status || !Array.isArray(res.data) || !res.data.length) {
    throw new Error(`Kota "${kw}" tidak ditemukan di database Kemenag/myQuran.`)
  }
  return res.data
}

export async function getPrayerSchedule(cityKeyword, { dateKey = 'today' } = {}) {
  const cities = await findSholatCity(cityKeyword)
  // Pilih kecocokan paling tepat ("KOTA BANDUNG" jika cari "bandung", dst.)
  const qNorm = String(cityKeyword || '').trim().toLowerCase()
  const picked =
    cities.find((c) => c.lokasi.toLowerCase() === `kota ${qNorm}`) ||
    cities.find((c) => c.lokasi.toLowerCase() === qNorm) ||
    cities[0]

  const pathDate = dateKey === 'today' ? 'today' : dateKey
  const res = await fetchJson(`https://api.myquran.com/v3/sholat/jadwal/${encodeURIComponent(picked.id)}/${pathDate}`)
  if (!res?.status || !res?.data?.jadwal) {
    throw new Error(`Jadwal sholat untuk "${picked.lokasi}" belum tersedia.`)
  }

  const dates = Object.keys(res.data.jadwal)
  if (!dates.length) throw new Error('Data jadwal sholat kosong.')
  const j = res.data.jadwal[dates[0]]

  return {
    id: res.data.id || picked.id,
    kabko: res.data.kabko || picked.lokasi,
    prov: res.data.prov || '',
    tanggal: j.tanggal || dates[0],
    times: {
      imsak: j.imsak,
      subuh: j.subuh,
      terbit: j.terbit,
      dhuha: j.dhuha,
      dzuhur: j.dzuhur,
      ashar: j.ashar,
      maghrib: j.maghrib,
      isya: j.isya
    },
    alternatives: cities.slice(0, 5).map((c) => c.lokasi)
  }
}

function normSurahName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^(qs\.?|surah|surat)\s+/gi, '')
    .replace(/[^a-z0-9]/g, '')
}

export async function getSurahList() {
  if (Array.isArray(SURAT_LIST_CACHE) && SURAT_LIST_CACHE.length === 114) {
    return SURAT_LIST_CACHE
  }
  const res = await fetchJson('https://equran.id/api/v2/surat')
  if (!Array.isArray(res?.data) || !res.data.length) {
    throw new Error('Gagal memuat daftar surah dari EQuran.id.')
  }
  SURAT_LIST_CACHE = res.data
  return SURAT_LIST_CACHE
}

export async function resolveSurahNumber(input) {
  const num = Number.parseInt(String(input || '').trim(), 10)
  if (Number.isInteger(num) && num >= 1 && num <= 114 && String(num) === String(input || '').trim()) {
    return num
  }
  const list = await getSurahList()
  const q = normSurahName(input)
  if (!q) return null

  const exact = list.find((s) => normSurahName(s.namaLatin) === q)
  if (exact) return exact.nomor
  const starts = list.find((s) => normSurahName(s.namaLatin).startsWith(q))
  if (starts) return starts.nomor
  const partial = list.find((s) => normSurahName(s.namaLatin).includes(q) || normSurahName(s.arti).includes(q))
  return partial ? partial.nomor : null
}

export async function getSurahDetail(surahInput) {
  const nomor = await resolveSurahNumber(surahInput)
  if (!nomor) throw new Error(`Surah "${surahInput}" tidak ditemukan.`)
  const res = await fetchJson(`https://equran.id/api/v2/surat/${nomor}`)
  if (!res?.data?.ayat) throw new Error(`Detail surah #${nomor} gagal dimuat.`)
  return res.data
}
