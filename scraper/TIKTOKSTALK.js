/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * TIKTOKSTALK.js — Scraper profil TikTok via Mobile SSR (__UNIVERSAL_DATA_FOR_REHYDRATION__) + Puppeteer fallback
 */
import * as cheerio from 'cheerio'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

export function cleanTikTokUsername(input) {
  let s = String(input || '').trim()
  const urlMatch = s.match(/tiktok\.com\/@([a-zA-Z0-9._-]+)/i)
  if (urlMatch) return urlMatch[1]
  s = s.replace(/^@+/, '').split(/[/?\s]/)[0] || ''
  return s.trim()
}

function parseUniversalUserInfo(html) {
  const $ = cheerio.load(html)
  const raw = $('#__UNIVERSAL_DATA_FOR_REHYDRATION__').text()
  if (!raw) return null
  const json = JSON.parse(raw)
  const detail = json?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']
  const info = detail?.userInfo
  if (!info?.user?.uniqueId) return null
  return { user: info.user, stats: info.statsV2 || info.stats || {} }
}

async function fetchWithPuppeteer(username) {
  const { default: puppeteer } = await import('puppeteer')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  })
  try {
    const page = await browser.newPage()
    await page.setUserAgent(MOBILE_UA)
    await page.goto(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000
    })
    const html = await page.content()
    return parseUniversalUserInfo(html)
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function tiktokStalk(input) {
  const username = cleanTikTokUsername(input)
  if (!username) throw new Error('Username TikTok tidak valid.')

  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`
  let parsed = null

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': MOBILE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    })
    if (res.ok) {
      const html = await res.text()
      parsed = parseUniversalUserInfo(html)
    }
  } catch {}

  if (!parsed) {
    try {
      parsed = await fetchWithPuppeteer(username)
    } catch {}
  }

  if (!parsed) {
    throw new Error(`Profil TikTok "@${username}" tidak ditemukan atau sedang dibatasi.`)
  }

  const { user, stats } = parsed
  return {
    id: user.id || '-',
    secUid: user.secUid || '',
    uniqueId: user.uniqueId,
    nickname: user.nickname || user.uniqueId,
    signature: user.signature || '',
    verified: Boolean(user.verified),
    privateAccount: Boolean(user.privateAccount),
    region: user.region || '',
    bioLink: user.bioLink?.link || '',
    avatarUrl: user.avatarLarger || user.avatarMedium || user.avatarThumb || null,
    followers: Number(stats.followerCount ?? 0),
    following: Number(stats.followingCount ?? 0),
    hearts: Number(stats.heartCount ?? stats.heart ?? 0),
    videos: Number(stats.videoCount ?? 0),
    friends: Number(stats.friendCount ?? 0),
    profileUrl: `https://www.tiktok.com/@${user.uniqueId}`
  }
}
