/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * lib/minecraft/curseforge.js — CurseForge Minecraft Bedrock Engine (gameId: 78022)
 */

const DEFAULT_CF_KEY = '$2a$10$FBf6EAOCrRsoq.K/Ps73EuBviuN9kg2cnLaIK1LZYL9KY/wk4NTje'
export const BEDROCK_GAME_ID = 78022
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const BEDROCK_CLASSES = {
  ADDON: 4984,
  MAP: 6913,
  TEXTURE: 6929,
  SKIN: 6925,
  SCRIPT: 6940
}

export class CurseForgeEngine {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.CURSEFORGE_API_KEY || DEFAULT_CF_KEY
    this.officialBase = 'https://api.curseforge.com/v1'
    this.proxyBase = 'https://api.curse.tools/v1/cf'
  }

  async _fetchJson(baseUrl, endpointPath, withApiKey = false) {
    const headers = {
      Accept: 'application/json',
      'User-Agent': DEFAULT_USER_AGENT
    }
    if (withApiKey) headers['x-api-key'] = this.apiKey

    const res = await fetch(`${baseUrl}${endpointPath}`, { headers })
    if (!res.ok) return null
    return res.json()
  }

  async _fetchOfficialThenProxy(endpointPath, validate = (d) => d !== undefined && d !== null) {
    try {
      const official = await this._fetchJson(this.officialBase, endpointPath, true)
      if (official && validate(official.data)) return official.data
    } catch {}

    try {
      const proxy = await this._fetchJson(this.proxyBase, endpointPath, false)
      if (proxy && validate(proxy.data)) return proxy.data
    } catch {}

    return null
  }

  async searchBedrock({
    searchFilter = '',
    classId,
    categoryId,
    sortField = 6,
    sortOrder = 'desc',
    pageSize = 10,
    index = 0
  } = {}) {
    const params = new URLSearchParams({
      gameId: String(BEDROCK_GAME_ID),
      pageSize: String(pageSize),
      index: String(index),
      sortField: String(sortField),
      sortOrder: String(sortOrder)
    })

    if (searchFilter) params.append('searchFilter', searchFilter.trim())
    if (classId) params.append('classId', String(classId))
    if (categoryId) params.append('categoryId', String(categoryId))

    const items = await this._fetchOfficialThenProxy(
      `/mods/search?${params.toString()}`,
      (data) => Array.isArray(data)
    )

    if (!items) {
      throw new Error('Gagal menghubungkan ke server CurseForge (Official & Proxy tidak merespons).')
    }

    return items.filter((item) => Number(item.gameId) === BEDROCK_GAME_ID)
  }

  async getTrendingBedrock(limit = 10, classId = null) {
    return this.searchBedrock({
      sortField: 6,
      sortOrder: 'desc',
      pageSize: limit,
      classId
    })
  }

  async getMod(modId) {
    const mod = await this._fetchOfficialThenProxy(`/mods/${modId}`)
    if (!mod) {
      throw new Error(`Mod CurseForge dengan ID ${modId} tidak ditemukan.`)
    }

    if (Number(mod.gameId) !== BEDROCK_GAME_ID) {
      throw new Error('JAVA_EDITION_DETECTED')
    }

    return mod
  }

  async getModFiles(modId) {
    const files = await this._fetchOfficialThenProxy(
      `/mods/${modId}/files`,
      (data) => Array.isArray(data) && data.length > 0
    )
    return files || []
  }

  async getDownloadUrl(modId, fileId) {
    try {
      const direct = await this._fetchJson(
        this.officialBase,
        `/mods/${modId}/files/${fileId}/download-url`,
        true
      )
      if (direct?.data) return direct.data
    } catch {}

    const files = await this.getModFiles(modId)
    const targetFile = files.find((f) => f.id === fileId) || files[0]
    if (targetFile?.downloadUrl) return targetFile.downloadUrl

    try {
      const proxy = await this._fetchJson(
        this.proxyBase,
        `/mods/${modId}/files/${fileId}/download-url`,
        false
      )
      if (proxy?.data) return proxy.data
    } catch {}

    if (fileId) {
      const idStr = String(fileId)
      const part1 = idStr.slice(0, 4)
      const part2 = idStr.slice(4)
      const encodedName = encodeURIComponent(targetFile?.fileName || 'download.mcaddon')
      return `https://edge.forgecdn.net/files/${part1}/${part2}/${encodedName}`
    }

    throw new Error('Gagal mendapatkan tautan unduhan dari CurseForge.')
  }

  parseInput(input) {
    if (!input) return null
    const str = input.trim()

    if (/^cf:(\d+)$/i.test(str)) {
      return { type: 'id', id: parseInt(str.replace(/^cf:/i, ''), 10) }
    }

    if (/^\d{5,9}$/.test(str)) {
      return { type: 'id', id: parseInt(str, 10) }
    }

    const projMatch = str.match(/curseforge\.com\/projects\/(\d+)/i)
    if (projMatch) {
      return { type: 'id', id: parseInt(projMatch[1], 10) }
    }

    const bedrockMatch = str.match(
      /curseforge\.com\/minecraft-bedrock\/(?:addons|texture-packs|worlds|maps|skins|scripts)\/([a-zA-Z0-9-_]+)/i
    )
    if (bedrockMatch) {
      return { type: 'slug', slug: bedrockMatch[1], isBedrockUrl: true }
    }

    const javaMatch = str.match(/curseforge\.com\/minecraft\/mc-mods\/([a-zA-Z0-9-_]+)/i)
    if (javaMatch) {
      return { type: 'slug', slug: javaMatch[1], isJavaUrl: true }
    }

    const genericMatch = str.match(/curseforge\.com\/[^/]+\/[^/]+\/([a-zA-Z0-9-_]+)/i)
    if (genericMatch) {
      return { type: 'slug', slug: genericMatch[1] }
    }

    return null
  }

  async resolveBedrockMod(input) {
    const parsed = this.parseInput(input)
    if (!parsed) return null

    if (parsed.isJavaUrl) {
      throw new Error('JAVA_EDITION_DETECTED')
    }

    if (parsed.type === 'id') {
      return this.getMod(parsed.id)
    }

    if (parsed.type === 'slug') {
      const searchResults = await this.searchBedrock({ searchFilter: parsed.slug, pageSize: 5 })
      const exact = searchResults.find((m) => m.slug.toLowerCase() === parsed.slug.toLowerCase())
      if (exact) return exact
      if (searchResults.length > 0) return searchResults[0]
      throw new Error('NOT_FOUND_BEDROCK')
    }

    return null
  }
}

export const cfEngine = new CurseForgeEngine()
export default cfEngine
