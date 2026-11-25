/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * lib/minecraft/xboxAuth.js — Microsoft OAuth2 & Xbox Live SISU/DeviceToken Auth untuk PlayFab
 */
import crypto from 'node:crypto'
import axios from 'axios'

const CLIENT_ID = '00000000402b5328'
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL'
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const RELYING_PARTY = 'https://b980a380.minecraft.playfabapi.com/'

export class XboxAuth {
  constructor() {
    this.oauthToken = null
    this.keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    this.jwk = { ...this.keyPair.publicKey.export({ format: 'jwk' }), alg: 'ES256', use: 'sig' }
  }

  getAuthUrl() {
    return (
      `https://login.live.com/oauth20_authorize.srf` +
      `?client_id=${CLIENT_ID}&response_type=code&approval_prompt=auto` +
      `&scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    )
  }

  async _exchangeOAuth(fields, errorLabel) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      ...fields
    })

    try {
      const res = await axios.post('https://login.live.com/oauth20_token.srf', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
      this.oauthToken = res.data.access_token
      return res.data
    } catch (err) {
      throw new Error(`${errorLabel}: ${err.response?.data?.error_description || err.message}`)
    }
  }

  async exchangeCode(code) {
    return this._exchangeOAuth({ grant_type: 'authorization_code', code }, 'Gagal tukar kode OAuth')
  }

  async exchangeRefreshToken(refreshToken) {
    return this._exchangeOAuth(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'Gagal tukar refresh token'
    )
  }

  _signRequest(url, method, headers, body) {
    const ts = BigInt(Date.now()) * 10000n + 116444736000000000n
    const uri = new URL(url)
    const pathAndQuery = uri.pathname + uri.search
    const authHeader = headers.Authorization || ''

    const policy = Buffer.alloc(5)
    policy.writeUInt32BE(1, 0)

    const timestampBuf = Buffer.alloc(9)
    timestampBuf.writeBigUInt64BE(ts, 0)

    const signBuf = Buffer.concat([
      policy,
      timestampBuf,
      Buffer.from(`${method}\0`),
      Buffer.from(`${pathAndQuery}\0`),
      Buffer.from(`${authHeader}\0`),
      Buffer.concat([body ? Buffer.from(body) : Buffer.alloc(0), Buffer.alloc(1)])
    ])

    const sig = crypto.sign('SHA256', signBuf, {
      key: this.keyPair.privateKey,
      dsaEncoding: 'ieee-p1363'
    })

    const headerPolicy = Buffer.alloc(4)
    headerPolicy.writeUInt32BE(1, 0)
    const headerTs = Buffer.alloc(8)
    headerTs.writeBigUInt64BE(ts, 0)

    return Buffer.concat([headerPolicy, headerTs, sig]).toString('base64')
  }

  async _signedXboxPost(url, payload, errorLabel) {
    const body = JSON.stringify(payload)
    const signature = this._signRequest(url, 'POST', {}, body)

    try {
      const res = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'x-xbl-contract-version': '1',
          Signature: signature
        }
      })
      return res.data
    } catch (err) {
      throw new Error(`${errorLabel}: ${JSON.stringify(err.response?.data) || err.message}`)
    }
  }

  async getDeviceToken() {
    const data = await this._signedXboxPost(
      'https://device.auth.xboxlive.com/device/authenticate',
      {
        Properties: {
          AuthMethod: 'ProofOfPossession',
          Id: `{${crypto.randomUUID()}}`,
          DeviceType: 'Win32',
          SerialNumber: `{${crypto.randomUUID()}}`,
          Version: '10.0.19041',
          ProofKey: this.jwk
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      },
      'DeviceToken Auth Gagal'
    )
    return data.Token
  }

  async getSisuToken(deviceToken) {
    if (!this.oauthToken) throw new Error('OAuth token tidak tersedia!')
    const data = await this._signedXboxPost(
      'https://sisu.xboxlive.com/authorize',
      {
        AccessToken: `t=${this.oauthToken}`,
        AppId: CLIENT_ID,
        DeviceToken: deviceToken,
        Sandbox: 'RETAIL',
        UseModernGamertag: true,
        SiteName: 'user.auth.xboxlive.com',
        RelyingParty: RELYING_PARTY,
        ProofKey: this.jwk
      },
      'Sisu Auth Gagal'
    )
    return {
      token: data.AuthorizationToken.Token,
      uhs: data.AuthorizationToken.DisplayClaims.xui[0].uhs
    }
  }

  async fullAuth(code) {
    const res = await this.exchangeCode(code)
    const dt = await this.getDeviceToken()
    const sisu = await this.getSisuToken(dt)
    return { ...sisu, refreshToken: res.refresh_token }
  }

  async fullAuthFromRefresh(refreshToken) {
    const res = await this.exchangeRefreshToken(refreshToken)
    const dt = await this.getDeviceToken()
    const sisu = await this.getSisuToken(dt)
    return { ...sisu, refreshToken: res.refresh_token }
  }
}

export default XboxAuth
