/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * IGSTALK.js — Instagram Profile Stalker
 * Base scraper credit: Ryza (https://whatsapp.com/channel/0029VbE4NyXFSAt8jKbRHt2o)
 */
import axios from 'axios'
import * as cheerio from 'cheerio'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const RESERVED_IG_SEGMENTS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv'])
const USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/

export function cleanUsername(input) {
  if (!input || typeof input !== 'string') return ''
  let str = input.trim()
  const isIgUrl = /^https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\//i.test(str) || str.includes('instagram.com/')
  if (isIgUrl) {
    const urlMatch = str.match(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/([^/?#\s]+)/i)
    if (!urlMatch) return ''
    str = urlMatch[1]
  } else if (/[\\/]/.test(str)) {
    return ''
  }

  str = str.replace(/^@+/, '').split(/[\s?#]/)[0].trim()
  if (
    !str ||
    str === '.' ||
    str === '..' ||
    str.startsWith('.') ||
    str.endsWith('.') ||
    str.includes('..') ||
    RESERVED_IG_SEGMENTS.has(str.toLowerCase()) ||
    !USERNAME_RE.test(str)
  ) {
    return ''
  }
  return str
}

function unescapeJsonField(raw) {
  if (!raw) return ''
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw
  }
}

function parseDirectInstagramHtml(html, user) {
  const $ = cheerio.load(html)
  const ogTitle = $('meta[property="og:title"]').attr('content') || ''
  const ogDesc =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    ''
  const ogImage = $('meta[property="og:image"]').attr('content') || ''

  let fullName = ''
  let biography = ''
  let followerCount = null
  let followingCount = null
  let postsCount = null

  if (ogDesc) {
    const statMatch = ogDesc.match(
      /([\d.,KMkm]+(?:\s*(?:rb|jt|m|k))?)\s+(?:Followers|Pengikut),\s*([\d.,KMkm]+(?:\s*(?:rb|jt|m|k))?)\s+(?:Following|Mengikuti),\s*([\d.,KMkm]+(?:\s*(?:rb|jt|m|k))?)\s+(?:Posts|Kiriman)/i
    )
    if (statMatch) {
      followerCount = statMatch[1].trim()
      followingCount = statMatch[2].trim()
      postsCount = statMatch[3].trim()
    }
    const bioMatch = ogDesc.match(/(?:on Instagram|di Instagram):\s*"(.*?)"\.?$/)
    if (bioMatch) biography = bioMatch[1]
  }

  if (ogTitle && !/^instagram$/i.test(ogTitle.trim())) {
    fullName = ogTitle.split('(@')[0].trim()
  }

  const mFn = html.match(/["']full_name["']:\s*["'](.*?)["']/)
  if (mFn) fullName = unescapeJsonField(mFn[1]) || fullName

  const mBio = html.match(/["']biography["']:\s*["'](.*?)["']/)
  if (mBio && !biography) biography = unescapeJsonField(mBio[1])

  const mId =
    html.match(/["']pk["']:\s*["'](\d+)["']/) ||
    html.match(/["']user_id["']:\s*["'](\d+)["']/)
  const userId = mId ? mId[1] : null

  const isVerified = /["']is_verified["']:\s*true/.test(html)
  const isPrivate = /["']is_private["']:\s*true/.test(html)

  const mExt = html.match(/["']external_url["']:\s*["'](.*?)["']/)
  const externalUrl = mExt ? mExt[1].replace(/\\/g, '') : null

  const seenCodes = new Set()
  const uniquePosts = []
  const mediaMatches =
    html.match(/\{\s*"__typename":\s*"XIGPolaris(?:Image|Video)Media"[\s\S]*?"id":\s*"POLARIS_\d+"\}/g) ||
    []

  for (const nodeStr of mediaMatches) {
    try {
      const code = nodeStr.match(/["']code["']:\s*["'](.*?)["']/)?.[1] || null
      if (!code || seenCodes.has(code)) continue
      seenCodes.add(code)

      const pk = nodeStr.match(/["']pk["']:\s*["'](.*?)["']/)?.[1] || null
      const typeVal = nodeStr.match(/["']__typename["']:\s*["'](.*?)["']/)?.[1] || ''
      const productType = nodeStr.match(/["']product_type["']:\s*["'](.*?)["']/)?.[1] || 'feed'
      const disp = nodeStr.match(/["']display_uri["']:\s*["'](.*?)["']/)?.[1] || null
      const capRaw = nodeStr.match(/["']caption["']:\s*\{\s*["']text["']:\s*["'](.*?)["']\s*\}/)?.[1]
      const altRaw = nodeStr.match(/["']accessibility_caption["']:\s*["'](.*?)["']/)?.[1]

      const postUrl =
        productType === 'clips'
          ? `https://www.instagram.com/reel/${code}/`
          : `https://www.instagram.com/p/${code}/`

      uniquePosts.push({
        id: pk,
        code,
        url: postUrl,
        type: typeVal.includes('Video') ? 'video' : 'image',
        product_type: productType,
        caption: capRaw ? unescapeJsonField(capRaw) : null,
        accessibility_caption: altRaw ? unescapeJsonField(altRaw) : null,
        thumbnail: disp ? disp.replace(/\\\//g, '/').replace(/\\u0025/g, '%') : null
      })
    } catch {}
  }

  // Abaikan halaman login shell Instagram yang kosong tanpa data profil
  const hasRealProfile = Boolean(userId || followerCount !== null || fullName || uniquePosts.length)
  if (!hasRealProfile) return null

  return {
    status: true,
    source: 'instagram',
    data: {
      user: {
        id: userId,
        username: user,
        full_name: fullName || user,
        biography: biography || '',
        external_url: externalUrl,
        profile_pic_url: ogImage || null,
        is_verified: isVerified,
        is_private: isPrivate,
        stats: {
          followers: followerCount,
          following: followingCount,
          posts: postsCount
        }
      },
      recent_posts: {
        count: uniquePosts.length,
        items: uniquePosts
      }
    }
  }
}

function parseInstaStoriesViewerHtml(html, user) {
  const $ = cheerio.load(html)

  const idMatch = html.match(/USER_ID\s*=\s*["']?(\d+)["']?/i)
  const userId = idMatch ? idMatch[1] : null

  const postsText = $('.profile__stats-posts').first().text().trim()
  const followersText = $('.profile__stats-followers').first().text().trim()
  const followingText = $('.profile__stats-follows').first().text().trim()

  const statsText = $('.profile__stats, .stats, .counts').text().replace(/\s+/g, ' ').trim()
  const postsCount = postsText || statsText.match(/([\d.,KMkm]+)\s*Posts/i)?.[1] || null
  const followerCount = followersText || statsText.match(/([\d.,KMkm]+)\s*Followers/i)?.[1] || null
  const followingCount = followingText || statsText.match(/([\d.,KMkm]+)\s*Following/i)?.[1] || null

  const rawAvatar =
    $('.profile__avatar-pic, .profile__avatar img, .avatar img, img[alt*="profile"]')
      .first()
      .attr('src') || ''
  const hasRealAvatar = Boolean(
    rawAvatar && /^https?:\/\//i.test(rawAvatar) && !/no-avatar\.png/i.test(rawAvatar)
  )

  if ((!userId || userId === '0') && !hasRealAvatar && (!followerCount || followerCount === '0')) {
    return null
  }

  const nickClone = $('.profile__nickname').first().clone()
  nickClone.find('.profile__nickname-anon, .profile__nickname-is-verify, svg').remove()
  const fullName =
    nickClone.text().trim() ||
    $('.profile__name, .profile-title, h1')
      .first()
      .text()
      .replace(/\(Anonymous profile view\)/gi, '')
      .trim() ||
    user

  const bio = $('.profile__description, .profile__bio, .bio, .description').first().text().trim()

  return {
    status: true,
    source: 'insta-stories-viewer',
    data: {
      user: {
        id: userId && userId !== '0' ? userId : null,
        username: user,
        full_name: fullName,
        biography: bio,
        external_url: null,
        profile_pic_url: hasRealAvatar ? rawAvatar : null,
        is_verified: null,
        is_private: null,
        stats: {
          followers: followerCount,
          following: followingCount,
          posts: postsCount
        }
      },
      recent_posts: {
        count: 0,
        items: []
      }
    }
  }
}

export async function igStalk(username, { httpGet = axios.get } = {}) {
  const user = cleanUsername(username)
  if (!user) {
    return {
      status: false,
      message: 'Username Instagram tidak valid! Contoh: .igstalk jokowi'
    }
  }

  let directResult = null
  try {
    const directRes = await httpGet(`https://www.instagram.com/${encodeURIComponent(user)}/`, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 12_000
    })
    directResult = parseDirectInstagramHtml(String(directRes?.data || ''), user)
  } catch {}

  const needsFallback =
    !directResult ||
    directResult.data.user.stats.followers === null ||
    directResult.data.user.stats.following === null

  if (!needsFallback) return directResult

  try {
    const res = await httpGet(`https://insta-stories-viewer.com/${encodeURIComponent(user)}/`, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15_000
    })

    const parsedFallback = parseInstaStoriesViewerHtml(String(res?.data || ''), user)

    if (directResult && parsedFallback) {
      const du = directResult.data.user
      const fu = parsedFallback.data.user
      return {
        status: true,
        source: 'instagram+viewer',
        data: {
          user: {
            ...du,
            id: du.id || fu.id,
            full_name: du.full_name || fu.full_name,
            biography: du.biography || fu.biography,
            profile_pic_url: du.profile_pic_url || fu.profile_pic_url,
            stats: {
              followers: du.stats.followers ?? fu.stats.followers,
              following: du.stats.following ?? fu.stats.following,
              posts: du.stats.posts ?? fu.stats.posts ?? (directResult.data.recent_posts.count || null)
            }
          },
          recent_posts: directResult.data.recent_posts
        }
      }
    }

    if (directResult) {
      if (directResult.data.user.stats.posts === null && directResult.data.recent_posts.count > 0) {
        directResult.data.user.stats.posts = directResult.data.recent_posts.count
      }
      return directResult
    }

    if (parsedFallback) return parsedFallback

    return {
      status: false,
      message: `Profil @${user} tidak ditemukan, akun private, atau belum terindeks.`
    }
  } catch (err) {
    if (directResult) return directResult
    return {
      status: false,
      message: `Gagal mengambil data profil @${user}: ${err?.message || err}`
    }
  }
}

export default igStalk
