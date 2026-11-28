/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ROBLOX.js — Profil lengkap akun Roblox via official public Roblox JSON APIs
 */

const UA = 'Mozilla/5.0 (compatible; HitoriMD/1.0)'

async function reqJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Accept: 'application/json', 'User-Agent': UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(12_000)
  })
  if (!res.ok) throw new Error(`Roblox HTTP ${res.status}`)
  return res.json()
}

export async function robloxStalk(usernameOrId) {
  const raw = String(usernameOrId || '').trim().replace(/^@/, '')
  if (!raw) throw new Error('Masukkan username atau User ID Roblox.')

  let userId = null
  if (/^\d{1,15}$/.test(raw)) {
    userId = Number(raw)
  } else {
    const lookup = await reqJson('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: [raw], excludeBannedUsers: false })
    })
    const hit = lookup?.data?.[0]
    if (!hit?.id) throw new Error(`Akun Roblox "${raw}" tidak ditemukan.`)
    userId = hit.id
  }

  const [profile, friends, followers, followings, avatar, presence, groups] = await Promise.all([
    reqJson(`https://users.roblox.com/v1/users/${userId}`),
    reqJson(`https://friends.roblox.com/v1/users/${userId}/friends/count`).catch(() => ({ count: null })),
    reqJson(`https://friends.roblox.com/v1/users/${userId}/followers/count`).catch(() => ({ count: null })),
    reqJson(`https://friends.roblox.com/v1/users/${userId}/followings/count`).catch(() => ({ count: null })),
    reqJson(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=720x720&format=Png&isCircular=false`).catch(() => null),
    reqJson('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userIds: [userId] })
    }).catch(() => null),
    reqJson(`https://groups.roblox.com/v1/users/${userId}/groups/roles?includeLocked=false&limit=5`).catch(() => null)
  ])

  const pres = presence?.userPresences?.[0] || null
  const presMap = {
    0: 'Offline ⚫',
    1: 'Online (Website) 🔵',
    2: 'In Game 🎮',
    3: 'In Studio 🛠️'
  }

  return {
    id: profile.id,
    name: profile.name,
    displayName: profile.displayName || profile.name,
    description: profile.description || '',
    created: profile.created || '',
    isBanned: Boolean(profile.isBanned),
    hasVerifiedBadge: Boolean(profile.hasVerifiedBadge),
    friendsCount: friends?.count ?? '-',
    followersCount: followers?.count ?? '-',
    followingsCount: followings?.count ?? '-',
    presenceStatus: pres ? presMap[pres.userPresenceType] || 'Offline ⚫' : 'Tidak diketahui',
    lastLocation: pres?.lastLocation || '',
    avatarUrl: avatar?.data?.[0]?.imageUrl || null,
    groups: (groups?.data || []).slice(0, 5).map((g) => ({
      name: g.group?.name,
      role: g.role?.name
    })),
    profileUrl: `https://www.roblox.com/users/${profile.id}/profile`
  }
}
