/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * lib/minecraft/toolcoin.js — Toolcoin Engine (Minecraft Marketplace PlayFab + AES-256-CFB8 DRM Pipeline)
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { XboxAuth } from './xboxAuth.js'

const TITLE_ID = '20CA2'
const SCID = '4fc10100-5f7a-4470-899b-280835760c07'
const PLAYFAB_BASE = `https://${TITLE_ID}.playfabapi.com`
const MAGIC_HEADER = 0x9BCFB9FC
const HEADER_SKIP = 256
const CRED_AES_KEY = Buffer.alloc(32, 'toolcoin_secret_key_1234567890')
const CRED_AES_IV = Buffer.alloc(16, 0)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')

export class ToolcoinEngine {
  constructor() {
    this._guestEntityToken = null
    this._guestExpiration = null
    this._sessionTicket = null
    this._refreshToken = null
    this._customId = null
    this._playerSecret = null

    this._credPath = path.join(ROOT_DIR, 'data', 'minecraft', 'toolcoin_creds.json')
    this._keysJsonPath = path.join(ROOT_DIR, 'data', 'minecraft', 'keys.json')
    this._keysTsvPath = path.join(ROOT_DIR, 'data', 'minecraft', 'keys.tsv')
    this._apiJsonPath = path.join(ROOT_DIR, 'data', 'minecraft', 'api.json')
    this._downloadsDir = path.join(ROOT_DIR, 'storage', 'temp', 'minecraft')
    this._tmpDir = path.join(ROOT_DIR, 'storage', 'temp', 'mc_extract')

    this._manifestToKey = new Map()
    this._marketToKey = new Map()

    this.loadKeysDatabase()
  }

  /* ---------- 1. Credentials & Encryption ---------- */
  genCustomId() {
    return 'MCPF' + crypto.randomBytes(16).toString('hex').toUpperCase()
  }

  genPlayerSecret() {
    return crypto.randomBytes(32).toString('base64')
  }

  _encryptCreds(data) {
    const cipher = crypto.createCipheriv('aes-256-cbc', CRED_AES_KEY, CRED_AES_IV)
    return Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]).toString('base64')
  }

  _decryptCreds(b64) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', CRED_AES_KEY, CRED_AES_IV)
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString()
    )
  }

  async _saveCreds() {
    const data = {
      entityToken: this._guestEntityToken,
      expiration: this._guestExpiration,
      sessionTicket: this._sessionTicket,
      refreshToken: this._refreshToken
    }
    try {
      const dir = path.dirname(this._credPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this._credPath, this._encryptCreds(data))
    } catch {}
  }

  async _loadCreds() {
    try {
      if (fs.existsSync(this._credPath)) {
        const encrypted = fs.readFileSync(this._credPath, 'utf-8')
        const data = this._decryptCreds(encrypted)
        if (data.refreshToken) this._refreshToken = data.refreshToken

        if (data.entityToken && data.expiration && new Date(data.expiration) > new Date()) {
          this._guestEntityToken = data.entityToken
          this._guestExpiration = data.expiration
          this._sessionTicket = data.sessionTicket
          return true
        }
      }
    } catch {}

    try {
      if (fs.existsSync(this._apiJsonPath)) {
        const apiData = JSON.parse(fs.readFileSync(this._apiJsonPath, 'utf8'))
        const token = apiData['20ca2_GUEST_ENTITY_TOKEN'] || apiData.entityToken
        const exp = apiData['20ca2_GUEST_TOKEN_EXPIRATION'] || apiData.expiration
        this._customId = apiData['20ca2_CUSTOM_ID'] || apiData.customId
        this._playerSecret = apiData['20ca2_PLAYER_SECRET'] || apiData.playerSecret
        if (token && (!exp || new Date(exp) > new Date())) {
          this._guestEntityToken = token
          this._guestExpiration = exp
          return true
        }
      }
    } catch {}

    return false
  }

  /* ---------- 2. Xbox Auth & Refresh ---------- */
  async _loginPlayFabWithXbox({ token, uhs, refreshToken }) {
    if (refreshToken) this._refreshToken = refreshToken

    const res = await axios.post(
      `${PLAYFAB_BASE}/Client/LoginWithXbox`,
      {
        TitleId: TITLE_ID,
        XboxToken: `XBL3.0 x=${uhs};${token}`,
        CreateAccount: true
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    )

    const data = res.data?.data
    if (!data?.EntityToken?.EntityToken) throw new Error('No EntityToken in PlayFab response')

    this._guestEntityToken = data.EntityToken.EntityToken
    this._guestExpiration = data.EntityToken.TokenExpiration
    this._sessionTicket = data.SessionTicket
    await this._saveCreds()
    return true
  }

  async loginWithXboxCode(authCode) {
    try {
      const auth = new XboxAuth()
      const sisu = await auth.fullAuth(authCode)
      return await this._loginPlayFabWithXbox(sisu)
    } catch (err) {
      console.error('[Toolcoin] Xbox login failed:', err?.response?.data || err.message)
      throw new Error(err?.response?.data?.errorMessage || err.message)
    }
  }

  async loginWithRefreshToken() {
    if (!this._refreshToken) return false
    try {
      const auth = new XboxAuth()
      const sisu = await auth.fullAuthFromRefresh(this._refreshToken)
      return await this._loginPlayFabWithXbox(sisu)
    } catch (err) {
      console.error('[Toolcoin] Auto-refresh failed:', err.message)
      return false
    }
  }

  async refreshGuestToken() {
    if (!this._customId || !this._playerSecret) {
      try {
        if (fs.existsSync(this._apiJsonPath)) {
          const apiData = JSON.parse(fs.readFileSync(this._apiJsonPath, 'utf8'))
          this._customId = apiData['20ca2_CUSTOM_ID'] || apiData.customId
          this._playerSecret = apiData['20ca2_PLAYER_SECRET'] || apiData.playerSecret
        }
      } catch {}
    }
    if (!this._customId || !this._playerSecret) return false

    try {
      const payload = {
        TitleId: TITLE_ID,
        CustomId: this._customId,
        CreateAccount: false,
        InfoRequestParameters: {
          GetPlayerProfile: true,
          GetUserAccountInfo: true
        }
      }
      const bodyStr = JSON.stringify(payload)
      const timestamp = new Date().toISOString()
      const message = `${bodyStr}.${timestamp}.${this._playerSecret}`
      const signature = crypto.createHash('sha256').update(message).digest('base64')

      const res = await axios.post(`${PLAYFAB_BASE}/Client/LoginWithCustomID`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-PlayFab-Signature': signature,
          'X-PlayFab-Timestamp': timestamp,
          'User-Agent': 'libhttpclient/1.0.0.0'
        },
        timeout: 15000
      })

      const data = res.data?.data
      if (!data?.SessionTicket) throw new Error('No SessionTicket in LoginWithCustomID response')

      const getEntityRes = await axios.post(
        `${PLAYFAB_BASE}/Authentication/GetEntityToken`,
        { Entity: { Id: data.PlayFabId, Type: 'master_player_account' } },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Authorization': data.SessionTicket,
            'User-Agent': 'libhttpclient/1.0.0.0'
          },
          timeout: 15000
        }
      )

      const entityData = getEntityRes.data?.data
      if (!entityData?.EntityToken) throw new Error('No master EntityToken in GetEntityToken response')

      this._guestEntityToken = entityData.EntityToken
      this._guestExpiration = entityData.TokenExpiration
      this._sessionTicket = data.SessionTicket

      try {
        let current = {}
        if (fs.existsSync(this._apiJsonPath)) {
          current = JSON.parse(fs.readFileSync(this._apiJsonPath, 'utf8'))
        }
        current['20ca2_GUEST_ENTITY_TOKEN'] = this._guestEntityToken
        current['20ca2_GUEST_TOKEN_EXPIRATION'] = this._guestExpiration
        fs.mkdirSync(path.dirname(this._apiJsonPath), { recursive: true })
        fs.writeFileSync(this._apiJsonPath, JSON.stringify(current, null, 2))
      } catch {}

      return true
    } catch (err) {
      console.error('[Toolcoin] PlayFab guest token refresh failed:', err?.response?.data || err.message)
      return false
    }
  }

  async _ensureAuth() {
    if (!this._guestEntityToken || (this._guestExpiration && new Date(this._guestExpiration) <= new Date())) {
      const ok = await this._loadCreds()
      if (!ok) {
        if (await this.refreshGuestToken()) return
        if (this._refreshToken && (await this.loginWithRefreshToken())) return
        throw new Error('NOT_LOGGED_IN')
      }
    }
  }

  _guestHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-EntityToken': this._guestEntityToken
    }
  }

  /* ---------- 3. Catalog Search ---------- */
  async search(keyword, top = 10, skip = 0, filter = '') {
    await this._ensureAuth()
    try {
      let filterStr = "(contentType eq 'MarketplaceDurableCatalog_V1.2')"
      if (filter) filterStr += ` and ${filter}`

      const cleanKeyword = (keyword || '').trim()
      const body = {
        count: true,
        filter: filterStr,
        scid: SCID,
        select: 'contents',
        top,
        skip
      }

      if (cleanKeyword) body.search = cleanKeyword
      else body.orderBy = 'startDate DESC'

      const res = await axios.post(`${PLAYFAB_BASE}/Catalog/Search`, body, {
        headers: this._guestHeaders(),
        timeout: 15000
      })

      const items = res.data?.data?.Items || []

      if (cleanKeyword && items.length > 0) {
        const queryLower = cleanKeyword.toLowerCase()
        const queryWords = queryLower.split(/\s+/).filter(Boolean)

        items.sort((a, b) => {
          const titleA = (a.Title?.neutral || a.Title?.NEUTRAL || '').toLowerCase()
          const titleB = (b.Title?.neutral || b.Title?.NEUTRAL || '').toLowerCase()

          if ((titleA === queryLower) !== (titleB === queryLower)) return titleA === queryLower ? -1 : 1
          if (titleA.startsWith(queryLower) !== titleB.startsWith(queryLower)) {
            return titleA.startsWith(queryLower) ? -1 : 1
          }
          if (titleA.includes(queryLower) !== titleB.includes(queryLower)) {
            return titleA.includes(queryLower) ? -1 : 1
          }

          const countWords = (t) => queryWords.filter((w) => t.includes(w)).length
          const diff = countWords(titleB) - countWords(titleA)
          return diff !== 0 ? diff : 0
        })
      }

      return items
    } catch (err) {
      console.error('[Toolcoin] Search error:', err?.response?.data || err.message)
      return []
    }
  }

  async uuidSearch(dlcId) {
    await this._ensureAuth()

    try {
      const res = await axios.post(
        `${PLAYFAB_BASE}/Catalog/GetPublishedItem`,
        { ETag: '', ItemId: dlcId },
        { headers: this._guestHeaders(), timeout: 15000 }
      )
      const item = res.data?.data?.Item || res.data?.data
      if (item && (item.Id || item.Title)) return item
    } catch {}

    try {
      const itemRes = await axios.post(
        `${PLAYFAB_BASE}/Catalog/GetItem`,
        { Id: dlcId },
        { headers: this._guestHeaders(), timeout: 15000 }
      )
      const item = itemRes.data?.data?.Item || itemRes.data?.data
      if (item && (item.Id || item.Title)) return item
    } catch {}

    try {
      const res = await axios.post(
        `${PLAYFAB_BASE}/Catalog/Search`,
        {
          count: true,
          filter: `id eq '${dlcId}'`,
          scid: SCID,
          select: 'contents',
          top: 1
        },
        { headers: this._guestHeaders(), timeout: 15000 }
      )
      const items = res.data?.data?.Items || []
      if (items.length > 0) return items[0]
    } catch (err) {
      console.error('[Toolcoin] UUID search error:', err.message)
    }

    return null
  }

  async getTrending(top = 10) {
    return this.search('', top, 0)
  }

  async searchCreator(creatorId, tag = '', top = 10, skip = 0) {
    let filter = `creatorId eq '${creatorId}'`
    if (tag) filter += ` and tags/any(t: t eq '${tag}')`
    return this.search('', top, skip, filter)
  }

  /* ---------- 4. Keys Database Management ---------- */
  loadKeysDatabase() {
    try {
      if (fs.existsSync(this._keysJsonPath)) {
        const data = JSON.parse(fs.readFileSync(this._keysJsonPath, 'utf8'))
        if (data.manifest && data.market) {
          this._manifestToKey = new Map(Object.entries(data.manifest))
          this._marketToKey = new Map(Object.entries(data.market))
          return true
        }
      }

      if (fs.existsSync(this._keysTsvPath)) {
        const tsv = fs.readFileSync(this._keysTsvPath, 'utf8')
        return this.parseTsv(tsv)
      }
    } catch (e) {
      console.error('[Toolcoin] Failed to load keys database:', e.message)
    }
    return false
  }

  parseTsv(tsvString) {
    if (!tsvString || typeof tsvString !== 'string') return false
    let count = 0
    const lines = tsvString.split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || (i === 0 && line.toLowerCase().startsWith('marketuuid'))) continue

      const parts = line.split('\t')
      if (parts.length >= 4) {
        const marketUuid = parts[0]?.trim()
        const manifestUuid = parts[1]?.trim()
        const key = parts[3]?.trim()

        if (manifestUuid && key) {
          this._manifestToKey.set(manifestUuid, key)
          count++
        }
        if (marketUuid && key) {
          this._marketToKey.set(marketUuid, key)
        }
      }
    }

    this.saveKeysCache()
    return count > 0
  }

  saveKeysCache() {
    try {
      const cacheData = {
        updatedAt: new Date().toISOString(),
        manifest: Object.fromEntries(this._manifestToKey),
        market: Object.fromEntries(this._marketToKey)
      }
      const dir = path.dirname(this._keysJsonPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this._keysJsonPath, JSON.stringify(cacheData), 'utf8')
    } catch (e) {
      console.error('[Toolcoin] Failed to save keys cache:', e.message)
    }
  }

  async importKeysFromUrl(url) {
    try {
      const res = await axios.get(url, { responseType: 'text', timeout: 30000 })
      const text = res.data
      if (typeof text === 'object' && text?.manifest && text?.market) {
        this._manifestToKey = new Map(Object.entries(text.manifest))
        this._marketToKey = new Map(Object.entries(text.market))
        this.saveKeysCache()
        return true
      }
      if (typeof text === 'string' && text.trimStart().startsWith('{')) {
        const json = JSON.parse(text)
        if (json.manifest && json.market) {
          this._manifestToKey = new Map(Object.entries(json.manifest))
          this._marketToKey = new Map(Object.entries(json.market))
          this.saveKeysCache()
          return true
        }
      }
      return this.parseTsv(text)
    } catch (e) {
      console.error('[Toolcoin] Failed to import keys from URL:', e.message)
      return false
    }
  }

  getKey(uuidOrManifest) {
    if (!uuidOrManifest) return null
    const clean = uuidOrManifest.trim()
    const lower = clean.toLowerCase()
    return (
      this._manifestToKey.get(lower) ||
      this._marketToKey.get(lower) ||
      this._manifestToKey.get(clean) ||
      this._marketToKey.get(clean) ||
      null
    )
  }

  getKeysCount() {
    return this._manifestToKey.size
  }

  /* ---------- 5. AES-256-CFB8 Decryption & ZIP Pipeline ---------- */
  decryptBuffer(buf, keyInput) {
    if (!buf || buf.length === 0) return buf

    let keyBuf
    if (typeof keyInput === 'string') {
      if (keyInput.length === 64 && /^[0-9a-fA-F]+$/.test(keyInput)) {
        keyBuf = Buffer.from(keyInput, 'hex')
      } else {
        keyBuf = Buffer.from(keyInput, 'utf8')
      }
    } else {
      keyBuf = keyInput
    }

    if (keyBuf.length < 32) {
      const padded = Buffer.alloc(32, 0)
      keyBuf.copy(padded)
      keyBuf = padded
    } else if (keyBuf.length > 32) {
      keyBuf = keyBuf.subarray(0, 32)
    }

    let payload = buf
    if (buf.length >= 8) {
      const version = buf.readUInt32LE(0)
      const magic = buf.readUInt32LE(4)
      if (version === 0 && magic === MAGIC_HEADER && buf.length >= HEADER_SKIP) {
        payload = buf.subarray(HEADER_SKIP)
      }
    }

    const iv = keyBuf.subarray(0, 16)
    const decipher = crypto.createDecipheriv('aes-256-cfb8', keyBuf, iv)
    return Buffer.concat([decipher.update(payload), decipher.final()])
  }

  async processDlcArchive(inputZipPath, outputFilePath, marketUuid = null) {
    try {
      const outerZip = new AdmZip(inputZipPath)
      const outerEntries = outerZip.getEntries()
      const innerZipEntries = outerEntries.filter(
        (e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.zip')
      )

      const processSinglePackArchive = async (zipInstance, cleanZipTarget, subfolderPrefix = '') => {
        const entries = zipInstance.getEntries()

        let manifestUuid = null
        let parsedManifest = null
        for (const mode of ['exact', 'nested']) {
          if (manifestUuid) break
          for (const entry of entries) {
            const lower = entry.entryName.replace(/\\/g, '/').toLowerCase()
            const matched = mode === 'exact' ? lower === 'manifest.json' : lower.endsWith('/manifest.json')
            if (!matched) continue
            try {
              const text = entry.getData().toString('utf8').replace(/^\uFEFF/, '')
              parsedManifest = JSON.parse(text)
              manifestUuid = parsedManifest?.header?.uuid
              if (manifestUuid) break
            } catch {}
          }
        }

        const contentsEntries = entries.filter((e) => {
          const lower = e.entryName.replace(/\\/g, '/').toLowerCase()
          return lower === 'contents.json' || lower.endsWith('/contents.json')
        })

        let packKey = manifestUuid ? this.getKey(manifestUuid) : null
        if (!packKey && parsedManifest?.modules) {
          for (const mod of parsedManifest.modules) {
            if (mod.uuid) {
              packKey = this.getKey(mod.uuid)
              if (packKey) break
            }
          }
        }
        if (!packKey && marketUuid) packKey = this.getKey(marketUuid)

        const fileKeyMap = new Map()
        for (const cEntry of contentsEntries) {
          try {
            const cName = cEntry.entryName.replace(/\\/g, '/')
            const lastSlash = cName.lastIndexOf('/')
            const dirPrefix = lastSlash !== -1 ? cName.substring(0, lastSlash + 1) : ''

            const rawBuf = cEntry.getData()
            let contentsJson = null

            try {
              const plainText = rawBuf.toString('utf8').replace(/^\uFEFF/, '').trim()
              if (plainText.startsWith('{')) {
                const testObj = JSON.parse(plainText)
                if (testObj && (Array.isArray(testObj.content) || Array.isArray(testObj.contents))) {
                  contentsJson = testObj
                }
              }
            } catch {}

            if (!contentsJson && packKey) {
              try {
                const decryptedBuf = this.decryptBuffer(rawBuf, packKey)
                const decText = decryptedBuf.toString('utf8').replace(/^\uFEFF/, '').trim()
                contentsJson = JSON.parse(decText)
              } catch (e) {
                console.warn('[Toolcoin] Gagal parse contents.json setelah dekripsi:', e.message)
              }
            }

            const list = contentsJson?.content || contentsJson?.contents || []
            if (Array.isArray(list)) {
              for (const item of list) {
                if (item.path && item.key) {
                  const norm = item.path.replace(/\\/g, '/').replace(/^\/+/, '')
                  if (!dirPrefix) fileKeyMap.set(norm.toLowerCase(), item.key)
                  fileKeyMap.set((dirPrefix + norm).toLowerCase(), item.key)
                }
              }
            }
          } catch (e) {
            console.warn('[Toolcoin] Error saat memproses contents.json:', e.message)
          }
        }

        let entryCount = 0
        for (const entry of entries) {
          if (entry.isDirectory) continue
          if (++entryCount % 40 === 0) await new Promise((r) => setImmediate(r))

          const rawName = entry.entryName.replace(/\\/g, '/')
          const lower = rawName.toLowerCase()

          if (
            lower.endsWith('contents.json') ||
            lower.endsWith('signatures.json') ||
            lower.endsWith('manifest.json.sig')
          ) {
            continue
          }

          let fileData = entry.getData()
          const lookup = rawName.replace(/^\/+/, '').toLowerCase()
          const entryKey =
            fileKeyMap.get(lookup) ||
            fileKeyMap.get(lower) ||
            fileKeyMap.get(rawName.toLowerCase()) ||
            fileKeyMap.get('/' + lookup)

          if (entryKey) {
            fileData = this.decryptBuffer(fileData, entryKey)
          }

          if (lower.endsWith('skins.json')) {
            try {
              const skinObj = JSON.parse(fileData.toString('utf8').replace(/^\uFEFF/, ''))
              if (Array.isArray(skinObj.skins)) {
                let patched = false
                for (const s of skinObj.skins) {
                  if (s.type === 'paid') {
                    s.type = 'free'
                    patched = true
                  }
                }
                if (patched) fileData = Buffer.from(JSON.stringify(skinObj, null, 2), 'utf8')
              }
            } catch {}
          }

          if (lower.endsWith('level.dat')) {
            try {
              const pridBuf = Buffer.from('prid', 'utf8')
              const priaBuf = Buffer.from('pria', 'utf8')
              let idx = fileData.indexOf(pridBuf)
              while (idx !== -1) {
                priaBuf.copy(fileData, idx)
                idx = fileData.indexOf(pridBuf, idx + 4)
              }
            } catch {}
          }

          const targetEntryPath = subfolderPrefix ? `${subfolderPrefix}/${rawName}` : rawName
          cleanZipTarget.addFile(targetEntryPath, fileData)
        }

        return {
          isEncrypted: contentsEntries.length > 0,
          decrypted: !!packKey
        }
      }

      const cleanZip = new AdmZip()
      let overallEncrypted = false
      let overallDecrypted = true

      if (innerZipEntries.length > 0) {
        const isMultiPack =
          innerZipEntries.length > 1 &&
          !outputFilePath.endsWith('.mctemplate') &&
          !outputFilePath.endsWith('.mcworld')

        if (isMultiPack) {
          if (outputFilePath.toLowerCase().endsWith('.mcpack')) {
            outputFilePath = outputFilePath.replace(/\.mcpack$/i, '.mcaddon')
          }

          const baseOutName = path.parse(outputFilePath).name
          const usedPackNames = new Set()

          for (const innerEntry of innerZipEntries) {
            const innerZip = new AdmZip(innerEntry.getData())
            const packStem = path.parse(innerEntry.entryName).name
            const singlePackZip = new AdmZip()

            const packRes = await processSinglePackArchive(innerZip, singlePackZip, '')
            if (packRes.isEncrypted) overallEncrypted = true
            if (!packRes.decrypted) overallDecrypted = false

            let packSuffix = ''
            try {
              const manifestEntry = singlePackZip.getEntry('manifest.json')
              if (manifestEntry) {
                const manifestJson = JSON.parse(
                  manifestEntry.getData().toString('utf8').replace(/^\uFEFF/, '')
                )
                const modTypes = (manifestJson.modules || []).map((m) => m.type)
                if (modTypes.includes('data')) packSuffix = '_BP'
                else if (modTypes.includes('resources')) packSuffix = '_RP'
                else if (modTypes.includes('skin_pack')) packSuffix = '_Skin'
              }
            } catch {}

            let packFilename = `${baseOutName}${packSuffix || '_' + packStem}.mcpack`
            if (usedPackNames.has(packFilename.toLowerCase())) {
              packFilename = `${baseOutName}_${packStem}.mcpack`
            }
            if (usedPackNames.has(packFilename.toLowerCase())) {
              packFilename = `${baseOutName}_${packStem}_${Math.random().toString(36).substring(2, 6)}.mcpack`
            }
            usedPackNames.add(packFilename.toLowerCase())

            const packBuf =
              typeof singlePackZip.toBufferPromise === 'function'
                ? await singlePackZip.toBufferPromise()
                : singlePackZip.toBuffer()
            cleanZip.addFile(packFilename, packBuf)
            await new Promise((r) => setImmediate(r))
          }
        } else {
          const innerZip = new AdmZip(innerZipEntries[0].getData())
          const packRes = await processSinglePackArchive(innerZip, cleanZip, '')
          if (packRes.isEncrypted) overallEncrypted = true
          if (!packRes.decrypted) overallDecrypted = false
        }

        for (const outerEntry of outerEntries) {
          if (outerEntry.isDirectory) continue
          const name = outerEntry.entryName.replace(/\\/g, '/')
          const lower = name.toLowerCase()
          if (
            lower.endsWith('.zip') ||
            lower.endsWith('contents.json') ||
            lower.endsWith('signatures.json') ||
            lower.endsWith('manifest.json.sig')
          ) {
            continue
          }
          if (isMultiPack) continue
          if (cleanZip.getEntry(name)) continue
          cleanZip.addFile(name, outerEntry.getData())
        }
      } else {
        const packRes = await processSinglePackArchive(outerZip, cleanZip, '')
        overallEncrypted = packRes.isEncrypted
        overallDecrypted = packRes.decrypted
      }

      const outDir = path.dirname(outputFilePath)
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

      await new Promise((resolve, reject) => {
        cleanZip.writeZip(outputFilePath, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      return {
        success: true,
        path: outputFilePath,
        isEncrypted: overallEncrypted,
        decrypted: overallDecrypted,
        warning:
          !overallDecrypted && overallEncrypted
            ? 'Kunci dekripsi belum ada di database keys.tsv. File dikirim dalam format terenkripsi.'
            : null
      }
    } catch (err) {
      console.error('[Toolcoin] Processing error:', err)
      return { success: false, error: err.message }
    }
  }

  /* ---------- 6. Download Service ---------- */
  async downloadFile(url, outputPath, headers = {}) {
    try {
      const dir = path.dirname(outputPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      const writer = fs.createWriteStream(outputPath)
      const res = await axios.get(url, {
        responseType: 'stream',
        headers: {
          'User-Agent': 'libhttpclient/1.0.0.0',
          Accept: '*/*',
          ...headers
        },
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      })

      await pipeline(res.data, writer)
      const stats = fs.statSync(outputPath)
      return { success: true, size: stats.size, path: outputPath }
    } catch (err) {
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      } catch {}
      return { success: false, error: err.message }
    }
  }

  /* ---------- 7. Format Helpers & MCDL ---------- */
  formatItem(item, idx) {
    const title = item?.Title?.neutral || item?.Title?.NEUTRAL || item?.Title || 'Unknown'
    const id = item?.Id || 'N/A'
    const desc = item?.Description?.neutral || item?.Description?.NEUTRAL || ''
    const creator = item?.DisplayProperties?.creatorName || item?.CreatorEntity?.Id || 'Unknown'

    let price = 'Free'
    const amounts = item?.PriceOptions?.Prices?.[0]?.Amounts
    if (amounts?.length > 0) {
      price = `${amounts[0].Amount} Minecoins`
    }

    const imageUrl = item?.Images?.[0]?.Url || ''
    const tags = item?.Tags || []
    let contentType = tags[0] || 'DLC'
    if (tags.includes('resourcepack')) contentType = 'Resource Pack'
    else if (tags.includes('worldtemplate')) contentType = 'World'
    else if (tags.includes('skinpack')) contentType = 'Skin Pack'
    else if (tags.includes('mashup')) contentType = 'Mash-up'
    else if (tags.includes('addon')) contentType = 'Add-on'
    else if (tags.includes('persona')) contentType = 'Persona'

    return { title, id, desc, creator, price, imageUrl, contentType, idx }
  }

  formatItemText(item, idx) {
    const f = this.formatItem(item, idx)
    return (
      `*${idx + 1}. ${f.title}*\n` +
      `Tipe: _${f.contentType}_\n` +
      `Harga: ${f.price}\n` +
      `ID: \`${f.id}\`\n`
    )
  }

  sanitizeFileName(rawTitle, fallbackId = 'addon') {
    if (!rawTitle || typeof rawTitle !== 'string') return fallbackId

    let clean = rawTitle
      .replace(/[/\\?%*:|"<>]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')

    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) {
      clean = `${clean}_addon`
    }

    return clean || fallbackId
  }

  getFileExtension(item) {
    const tags = item?.Tags || []
    if (tags.includes('worldtemplate')) return '.mctemplate'
    if (tags.includes('addon')) return '.mcaddon'
    return '.mcpack'
  }

  async getAddonInfo(uuid) {
    await this._ensureAuth()
    try {
      const item = await this.uuidSearch(uuid)
      if (!item) return { success: false, error: 'Addon tidak ditemukan di katalog PlayFab.' }

      const contents = item.Contents || []
      if (contents.length === 0) {
        return { success: false, error: 'URL Download tidak tersedia dari PlayFab untuk item ini.' }
      }

      const downloadUrl = contents[0].Url
      if (!downloadUrl) return { success: false, error: 'URL Download tidak tersedia.' }

      let fileSize = 0
      try {
        const headRes = await axios.head(downloadUrl, {
          headers: { 'User-Agent': 'libhttpclient/1.0.0.0' },
          timeout: 10000
        })
        fileSize = parseInt(headRes.headers['content-length'] || '0', 10)
      } catch {}

      const f = this.formatItem(item, 0)
      const ext = this.getFileExtension(item)

      return {
        success: true,
        item,
        title: f.title,
        contentType: f.contentType,
        price: f.price,
        imageUrl: f.imageUrl,
        downloadUrl,
        fileSize,
        fileName: `${this.sanitizeFileName(f.title, item.Id || item.id || uuid)}${ext}`
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  async downloadAndProcess(uuid, downloadUrl, fileName) {
    const jobId = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
    const rawZipPath = path.join(this._tmpDir, `raw_${uuid}_${jobId}.zip`)
    const safeName = path.basename(fileName || `addon_${uuid}.zip`)
    const finalOutPath = path.join(this._downloadsDir, jobId, safeName)

    try {
      if (!fs.existsSync(this._tmpDir)) fs.mkdirSync(this._tmpDir, { recursive: true })
      if (!fs.existsSync(path.dirname(finalOutPath))) {
        fs.mkdirSync(path.dirname(finalOutPath), { recursive: true })
      }

      const dlRes = await this.downloadFile(downloadUrl, rawZipPath)
      if (!dlRes.success) return dlRes

      return await this.processDlcArchive(rawZipPath, finalOutPath, uuid)
    } catch (err) {
      return { success: false, error: err.message }
    } finally {
      try {
        if (fs.existsSync(rawZipPath)) fs.unlinkSync(rawZipPath)
      } catch {}
    }
  }

  cleanupTempFile(filePath) {
    if (!filePath) return
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      const parentDir = path.dirname(filePath)
      if (
        parentDir.startsWith(this._downloadsDir) &&
        parentDir !== this._downloadsDir &&
        fs.existsSync(parentDir)
      ) {
        fs.rmSync(parentDir, { recursive: true, force: true })
      }
    } catch {}
  }

  async uploadToGoFile(filePath, customName = null) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Berkas lokal tidak ditemukan untuk diunggah.' }
      }

      const name = customName || path.basename(filePath)
      const blob =
        typeof fs.openAsBlob === 'function'
          ? await fs.openAsBlob(filePath)
          : new Blob([fs.readFileSync(filePath)])

      try {
        let serversToTry = ['store3', 'store1']
        try {
          const sRes = await fetch('https://api.gofile.io/servers')
          const sData = await sRes.json()
          const serverList = sData.data?.servers || []
          if (serverList.length > 0) {
            serversToTry = serverList.slice(0, 3).map((s) => s.name).filter(Boolean)
          }
        } catch {}

        for (const srv of serversToTry) {
          try {
            const formData = new FormData()
            formData.append('file', blob, name)

            const upRes = await fetch(`https://${srv}.gofile.io/contents/uploadfile`, {
              method: 'POST',
              body: formData
            })
            const upData = await upRes.json()

            if (upData.status === 'ok' && upData.data?.downloadPage) {
              return {
                success: true,
                downloadPage: upData.data.downloadPage,
                fileName: name,
                size: upData.data.size,
                fileId: upData.data.id,
                host: 'GoFile'
              }
            }
          } catch (e) {
            console.warn(`[Toolcoin] Unggah ke GoFile ${srv} gagal:`, e.message)
          }
        }
      } catch {}

      try {
        const litForm = new FormData()
        litForm.append('reqtype', 'fileupload')
        litForm.append('time', '72h')
        litForm.append('fileToUpload', blob, name)

        const litRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
          method: 'POST',
          body: litForm
        })
        const litUrl = (await litRes.text())?.trim()

        if (litUrl && litUrl.startsWith('https://')) {
          return {
            success: true,
            downloadPage: litUrl,
            fileName: name,
            size: fs.statSync(filePath).size,
            host: 'Litterbox'
          }
        }
      } catch {}

      return { success: false, error: 'Semua server penyimpanan (GoFile & Litterbox) sementara sibuk.' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

const defaultInstance = new ToolcoinEngine()
export default defaultInstance
