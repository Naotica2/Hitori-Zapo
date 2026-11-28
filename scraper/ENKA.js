/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ENKA.js — Client Genshin Impact (Enka.Network) & Honkai: Star Rail (Mihomo / Enka)
 */

const UA = 'Hitori-MD/1.0 (WhatsApp Bot)'
const ENKA_STORE_TTL_MS = 24 * 60 * 60 * 1000

const GI_STORE_CACHE = {
  loadedAt: 0,
  characters: null,
  pfps: null,
  locEn: null
}

async function fetchJson(url, timeoutMs = 15_000) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (res.status === 404) {
    const err = new Error('UID tidak ditemukan.')
    err.status = 404
    throw err
  }
  if (res.status === 424) {
    const err = new Error('Server game sedang maintenance.')
    err.status = 424
    throw err
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function ensureGenshinStore() {
  if (
    GI_STORE_CACHE.characters &&
    GI_STORE_CACHE.locEn &&
    Date.now() - GI_STORE_CACHE.loadedAt < ENKA_STORE_TTL_MS
  ) {
    return GI_STORE_CACHE
  }

  try {
    const [chars, pfps, loc] = await Promise.all([
      fetchJson('https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/characters.json', 15_000),
      fetchJson('https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/pfps.json', 15_000),
      fetchJson('https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/loc.json', 15_000)
    ])
    GI_STORE_CACHE.characters = chars || {}
    GI_STORE_CACHE.pfps = pfps || {}
    GI_STORE_CACHE.locEn = loc?.en || loc?.id || {}
    GI_STORE_CACHE.loadedAt = Date.now()
  } catch {}
  return GI_STORE_CACHE
}

function getFightProp(map, id) {
  if (!map || typeof map !== 'object') return null
  const val = map[String(id)] ?? map[id]
  return typeof val === 'number' && Number.isFinite(val) ? val : null
}

function resolveGenshinRegion(uid) {
  const first = String(uid || '')[0]
  if (first === '6') return 'America'
  if (first === '7') return 'Europe'
  if (first === '8' || first === '1') return 'Asia'
  if (first === '9') return 'TW/HK/MO'
  return 'Official'
}

export async function stalkGenshin(uidInput) {
  const uid = String(uidInput || '').replace(/\D+/g, '')
  if (!/^\d{9,10}$/.test(uid)) {
    throw new Error('UID Genshin harus berupa 9–10 digit angka (contoh: 800000001).')
  }

  const [data, store] = await Promise.all([
    fetchJson(`https://enka.network/api/uid/${uid}`),
    ensureGenshinStore()
  ])

  const p = data?.playerInfo
  if (!p) throw new Error(`Data UID ${uid} tidak ditemukan.`)

  const chars = store.characters || {}
  const loc = store.locEn || {}
  const pfps = store.pfps || {}

  let avatarUrl = null
  const pfpId = p.profilePicture?.id
  const avatarId = p.profilePicture?.avatarId
  if (pfpId && pfps[String(pfpId)]?.iconPath) {
    avatarUrl = `https://enka.network/ui/${pfps[String(pfpId)].iconPath}.png`
  } else if (avatarId && chars[String(avatarId)]?.SideIconName) {
    const iconName = String(chars[String(avatarId)].SideIconName).replace('_Side_', '_')
    avatarUrl = `https://enka.network/ui/${iconName}.png`
  }

  const showcaseList = Array.isArray(data.avatarInfoList) && data.avatarInfoList.length
    ? data.avatarInfoList.map((av) => {
        const meta = chars[String(av.avatarId)] || {}
        const charName = loc[String(meta.NameTextMapHash)] || `Character ${av.avatarId}`
        const lv = av.propMap?.['4001']?.val || '?'
        const cons = Array.isArray(av.talentIdList) ? av.talentIdList.length : 0
        const fp = av.fightPropMap || {}
        const hp = getFightProp(fp, 2000)
        const atk = getFightProp(fp, 2001)
        const cr = getFightProp(fp, 20)
        const cd = getFightProp(fp, 22)
        const em = getFightProp(fp, 28)
        const er = getFightProp(fp, 23)
        return {
          name: charName,
          level: lv,
          constellation: cons,
          element: meta.Element || '',
          hp: hp !== null ? Math.round(hp) : null,
          atk: atk !== null ? Math.round(atk) : null,
          critRate: cr !== null ? (cr * 100).toFixed(1) : null,
          critDmg: cd !== null ? (cd * 100).toFixed(1) : null,
          em: em !== null ? Math.round(em) : null,
          er: er !== null ? (er * 100).toFixed(1) : null
        }
      })
    : Array.isArray(p.showAvatarInfoList)
      ? p.showAvatarInfoList.map((av) => {
          const meta = chars[String(av.avatarId)] || {}
          return {
            name: loc[String(meta.NameTextMapHash)] || `Character ${av.avatarId}`,
            level: av.level || '?',
            constellation: null,
            element: meta.Element || ''
          }
        })
      : []

  return {
    uid,
    region: data.region || resolveGenshinRegion(uid),
    nickname: p.nickname || '-',
    level: p.level ?? '-',
    worldLevel: p.worldLevel ?? '-',
    signature: p.signature || '',
    achievements: p.finishAchievementNum ?? '-',
    spiralAbyss: p.towerFloorIndex ? `${p.towerFloorIndex}-${p.towerLevelIndex ?? '?'}` : '-',
    theater: p.theaterActIndex ? `Act ${p.theaterActIndex}` : '-',
    friendshipMax: p.fetterCount ?? '-',
    avatarUrl,
    showcaseHidden: !Array.isArray(data.avatarInfoList) && !p.showAvatarInfoList?.length,
    showcase: showcaseList
  }
}

export async function stalkHsr(uidInput) {
  const uid = String(uidInput || '').replace(/\D+/g, '')
  if (!/^\d{9,10}$/.test(uid)) {
    throw new Error('UID Honkai: Star Rail harus 9–10 digit angka (contoh: 800000002).')
  }

  let mihomo = null
  try {
    mihomo = await fetchJson(`https://api.mihomo.me/sr_info_parsed/${uid}?lang=id`)
  } catch (e) {
    if (e.status === 404) throw e
  }

  if (mihomo?.player) {
    const pl = mihomo.player
    const sp = pl.space_info || {}
    const chars = Array.isArray(mihomo.characters)
      ? mihomo.characters.map((c) => {
          const findAttr = (field) =>
            (c.attributes || []).find((a) => a.field === field)?.display || null
          return {
            name: c.name || c.id,
            level: c.level ?? '?',
            rarity: c.rarity ?? 5,
            eidolon: c.rank ?? 0,
            path: c.path?.name || '',
            element: c.element?.name || '',
            lightCone: c.light_cone ? `${c.light_cone.name} (Lv.${c.light_cone.level} S${c.light_cone.rank})` : '',
            hp: findAttr('hp'),
            atk: findAttr('atk'),
            spd: findAttr('spd'),
            critRate: findAttr('crit_rate'),
            critDmg: findAttr('crit_dmg')
          }
        })
      : []

    return {
      uid,
      nickname: pl.nickname || '-',
      level: pl.level ?? '-',
      equilibriumLevel: pl.world_level ?? '-',
      friendCount: pl.friend_count ?? 0,
      signature: pl.signature || '',
      achievements: sp.achievement_count ?? '-',
      charactersOwned: sp.avatar_count ?? '-',
      lightConesOwned: sp.light_cone_count ?? '-',
      memoryOfChaos: sp.memory_data?.level ? `Stage ${sp.memory_data.level}` : '-',
      avatarUrl: pl.avatar?.icon
        ? `https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/${pl.avatar.icon}`
        : null,
      showcase: chars
    }
  }

  // Fallback langsung ke Enka HSR bila Mihomo sedang bermasalah
  const enka = await fetchJson(`https://enka.network/api/hsr/uid/${uid}`)
  const d = enka?.detailInfo
  if (!d) throw new Error(`UID HSR ${uid} tidak ditemukan.`)
  return {
    uid,
    nickname: d.nickname || '-',
    level: d.level ?? '-',
    equilibriumLevel: d.worldLevel ?? '-',
    friendCount: d.friendCount ?? 0,
    signature: d.signature || '',
    achievements: d.recordInfo?.achievementCount ?? '-',
    charactersOwned: d.recordInfo?.avatarCount ?? '-',
    lightConesOwned: d.recordInfo?.equipmentCount ?? '-',
    memoryOfChaos: '-',
    avatarUrl: null,
    showcase: []
  }
}
