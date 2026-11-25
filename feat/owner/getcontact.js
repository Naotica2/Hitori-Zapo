/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * getcontact.js — Cek profil & tag nomor Getcontact + verifikasi VerifyKit (khusus Owner)
 */
import config from '../../config.js'
import { resolveLidToPn } from '../../core/lid.js'
import { extractTextFromMessage, getContextInfo, getQuotedMessage } from '../../lib/media.js'
import {
  checkAuth,
  getQuota,
  initAuth,
  lookupNumber,
  normalizePhone
} from '../../scraper/GETCONTACT.js'

function extractPhoneCandidate(raw) {
  const text = String(raw || '').trim()
  const m = text.match(/(\+?\d[\d\s\-().]{6,20}\d)/)
  return m ? m[1] : ''
}

function extractPhoneFromVcard(vcard) {
  const m = String(vcard || '').match(/TEL[^:]*:([^\r\n]+)/i)
  return m ? m[1].trim() : ''
}

async function resolveTargetPhone(ctx) {
  const rawMsg = ctx.event?.message
  const ctxInfo = getContextInfo(rawMsg)
  const quoted = getQuotedMessage(ctx)

  // 1. Jika ada @mention, prioritaskan resolve PN/LID agar angka @lid tidak salah dianggap nomor HP
  if (ctx.mentioned?.[0]) {
    const resolved = ctx.isGroup
      ? await resolveLidToPn(ctx.client, ctx.chat, ctx.mentioned[0])
      : ctx.mentioned[0]
    if (resolved?.endsWith('@s.whatsapp.net')) {
      const digits = resolved.split('@')[0].split(':')[0]
      if (digits) return normalizePhone(digits)
    }
    throw new Error('Tidak bisa membaca nomor asli dari user LID tersebut. Ketik nomornya langsung (mis. 0812xxx).')
  }

  // 2. Nomor telepon eksplisit di argumen teks
  const cleanArg = String(ctx.text || '').replace(/@\d+\b/g, ' ').trim()
  const argPhone = extractPhoneCandidate(cleanArg)
  if (argPhone) return normalizePhone(argPhone)

  // 3. Cek jika me-reply pesan kontak (vCard)
  const vcard =
    quoted?.contactMessage?.vcard ||
    quoted?.contactsArrayMessage?.contacts?.[0]?.vcard ||
    rawMsg?.contactMessage?.vcard
  const vcardPhone = extractPhoneFromVcard(vcard)
  if (vcardPhone) return normalizePhone(vcardPhone)

  // 4. Cek jika me-reply pesan teks yang berisi nomor telepon
  const quotedText = extractTextFromMessage(quoted)
  const textPhone = extractPhoneCandidate(quotedText)
  if (textPhone) return normalizePhone(textPhone)

  // 5. Fallback pengirim pesan yang di-reply (resolve LID -> PN bila di grup)
  if (ctxInfo?.participant) {
    const resolved = ctx.isGroup
      ? await resolveLidToPn(ctx.client, ctx.chat, ctxInfo.participant)
      : ctxInfo.participant
    if (resolved?.endsWith('@s.whatsapp.net')) {
      const digits = resolved.split('@')[0].split(':')[0]
      if (digits) return normalizePhone(digits)
    }
    throw new Error('Tidak bisa membaca nomor asli dari pengirim yang di-reply (LID). Ketik nomornya langsung.')
  }

  return ''
}

async function sendVerifyLinkCard(ctx, session, sendOpts) {
  const infoText =
    `🔐 *GETCONTACT VERIFYKIT*\n\n` +
    `• Nomor: *${session.phoneNumber}*\n` +
    `• Device ID: \`${session.clientDeviceId}\`\n\n` +
    `*Langkah verifikasi:*\n` +
    `1. Klik tombol di bawah (atau buka tautan berikut):\n${session.deeplink}\n` +
    `2. Kirim pesan kode yang muncul ke bot WhatsApp VerifyKit.\n` +
    `3. Setelah terkirim (centang dua), ketik *${config.mainPrefix}gtccheck*`

  try {
    await ctx.client.message.send(
      ctx.chat,
      {
        interactiveMessage: {
          body: { text: infoText },
          footer: { text: `${config.botName} • Owner Getcontact` },
          nativeFlowMessage: {
            messageVersion: 1,
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '📱 Buka Verifikasi WhatsApp',
                  url: session.deeplink,
                  merchant_url: session.deeplink
                })
              }
            ]
          }
        }
      },
      sendOpts
    )
  } catch {
    await ctx.client.message.send(ctx.chat, infoText, sendOpts)
  }
}

export default {
  name: 'getcontact',
  aliases: ['gtc', 'gtcauth', 'gtccheck', 'gtcquota'],
  tags: 'owner',
  owner: true,
  cooldown: 3000,
  description: 'Cek tag & profil nomor Getcontact (khusus Owner, anti-limit)',

  async run(ctx) {
    const p = config.mainPrefix
    const sendOpts = ctx.event ? { quote: ctx.event } : {}
    const tokens = (ctx.text || '').trim().split(/\s+/).filter(Boolean)
    const cmd = String(ctx.command || 'getcontact').toLowerCase()
    const sub = cmd === 'gtcauth'
      ? 'auth'
      : cmd === 'gtccheck'
        ? 'check'
        : cmd === 'gtcquota'
          ? 'quota'
          : (tokens[0] || '').toLowerCase()

    const argTail =
      ['auth', 'login', 'check', 'quota'].includes(sub) && !['gtcauth', 'gtccheck', 'gtcquota'].includes(cmd)
        ? tokens.slice(1).join(' ').trim()
        : (ctx.text || '').trim()

    if (sub === 'help' || (cmd !== 'gtccheck' && cmd !== 'gtcquota' && !ctx.text && !ctx.mentioned?.length && !getQuotedMessage(ctx))) {
      return ctx.client.message.send(
        ctx.chat,
        `🔎 *GETCONTACT LOOKUP* _(Owner Only)_\n\n` +
          `*Setup Login (sekali):*\n` +
          `• *${p}gtcauth <nomor_wa_kamu>* — buat link verifikasi VerifyKit\n` +
          `• *${p}gtccheck* — simpan sesi setelah pesan VerifyKit centang dua\n\n` +
          `*Pemakaian:*\n` +
          `• *${p}gtc <nomor>* — cek profil & tag nomor\n` +
          `• *${p}gtc @user* / reply pesan/kontak — ambil nomor otomatis\n` +
          `• *${p}gtcquota* — cek sisa kuota harian`,
        sendOpts
      )
    }

    await ctx.react('⏳')

    try {
      if (sub === 'auth' || sub === 'login') {
        const phoneInput = argTail || ctx.senderNumber
        const session = await initAuth(phoneInput)
        await sendVerifyLinkCard(ctx, session, sendOpts)
        await ctx.react('✅')
        return
      }

      if (sub === 'check') {
        const res = await checkAuth()
        if (!res.verified) {
          await ctx.react('⏱️')
          await ctx.client.message.send(ctx.chat, `⏳ ${res.message}`, sendOpts)
          return
        }
        await ctx.client.message.send(
          ctx.chat,
          `✅ *Sesi Getcontact Aktif!*\n` +
            `• Nomor: ${res.credentials.phoneNumber}\n` +
            `• Device ID: \`${res.credentials.clientDeviceId}\`\n` +
            `• Validated: ${res.credentials.validationDate}\n\n` +
            `Sekarang bisa pakai *${p}gtc <nomor>* dan *${p}gtcquota*.`,
          sendOpts
        )
        await ctx.react('✅')
        return
      }

      if (sub === 'quota') {
        const q = await getQuota()
        await ctx.client.message.send(
          ctx.chat,
          `📊 *KUOTA GETCONTACT*\n\n` +
            `• Search : *${q.searchRemaining} / ${q.searchLimit}*\n` +
            `• Detail Tags : *${q.detailRemaining} / ${q.detailLimit}*\n` +
            `• Reset : ${q.renewDate || '-'}`,
          sendOpts
        )
        await ctx.react('✅')
        return
      }

      const targetPhone = await resolveTargetPhone(ctx)
      if (!targetPhone) {
        await ctx.react('❎')
        await ctx.client.message.send(
          ctx.chat,
          `❌ Nomor target tidak ditemukan. Gunakan *${p}gtc 08123456789*, @tag, atau reply pesan/kontak.`,
          sendOpts
        )
        return
      }

      const data = await lookupNumber(targetPhone)
      const fullName = [data.name, data.surname].filter(Boolean).join(' ').trim()

      const lines = [
        '┌───「 🔎 *GETCONTACT* 」───┐',
        '',
        `• Nomor : ${data.phone}`,
        `• Display Name : *${data.displayName || '-'}*`
      ]
      if (fullName && fullName !== data.displayName) {
        lines.push(`• Nama Akun : ${fullName}`)
      }
      if (data.email) {
        lines.push(`• Email : ${data.email}`)
      }
      lines.push(`• Jumlah Tag : *${data.tagCount}*`)

      if (data.tags.length > 0) {
        lines.push('')
        lines.push('🏷️ *Daftar Tag:*')
        for (const t of data.tags.slice(0, 35)) {
          lines.push(`  ▸ ${t.tag}${t.count > 1 ? ` _(${t.count}x)_` : ''}`)
        }
        if (data.tags.length > 35) {
          lines.push(`  _...dan ${data.tags.length - 35} tag lainnya_`)
        }
      } else if (data.tagCount > 0 && data.tagsError) {
        lines.push('')
        lines.push(`ℹ️ _Detail list tag dibatasi kuota/akun (${data.tagsError.slice(0, 100)})._`)
      }

      lines.push('')
      lines.push('└──────────────────────────┘')
      lines.push('')
      lines.push(`> ✨ _*Powered by ${config.botName}*_`)

      await ctx.client.message.send(ctx.chat, lines.join('\n'), sendOpts)
      await ctx.react('✅')
    } catch (err) {
      await ctx.react('❎')
      await ctx.client.message.send(
        ctx.chat,
        `❌ ${String(err?.message || err).slice(0, 260)}`,
        sendOpts
      )
    }
  }
}
