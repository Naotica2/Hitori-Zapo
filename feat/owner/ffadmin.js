/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ffadmin.js — Kelola akun worker Free Fire (khusus Owner)
 */

import config from '../../config.js'
import { getEvent } from '../../lib/media.js'
import {
  addWorkerAccount,
  createGuest,
  createWorkerAccount,
  listWorkerAccounts,
  refreshActiveWorker,
  removeWorkerAccount,
  setActiveWorkerAccount
} from '../../scraper/FREEFIRE.js'

function formatExpiry(expiresAt) {
  const ts = Number(expiresAt || 0)
  if (!ts) return '-'
  const diffMin = Math.round((ts - Date.now()) / 60_000)
  if (diffMin <= 0) return 'expired'
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  return h > 0 ? `${h}j ${m}m lagi` : `${m}m lagi`
}

function buildAdminHelp(p) {
  return [
    '👑 *FREE FIRE WORKER ADMIN* _(Owner Only)_',
    '',
    `• *${p}ffaccounts* — daftar akun worker tersimpan`,
    `• *${p}fflogin <uid> <password>* — tambah & login akun worker`,
    `• *${p}ffcreate [nickname] [region]* — daftar akun game worker baru`,
    `• *${p}ffguest* — buat kredensial guest Garena baru`,
    `• *${p}ffadmin use <uid>* — ganti worker aktif`,
    `• *${p}ffadmin refresh* — perbarui token worker aktif`,
    `• *${p}ffadmin del <uid>* — hapus akun dari cache`
  ].join('\n')
}

function formatAccountList(p) {
  const { accounts } = listWorkerAccounts()
  if (!accounts.length) {
    return (
      `📭 *Belum ada akun worker Free Fire tersimpan.*\n` +
      `Bot akan otomatis membuat worker saat *.ffstalk* dipanggil, atau buat manual via *${p}ffcreate* / *${p}fflogin <uid> <password>*.`
    )
  }

  const lines = [`🔥 *WORKER FREE FIRE (${accounts.length} akun)*`, '']
  accounts.forEach((acc, i) => {
    const flag = acc.active ? '✅ [AKTIF]' : '⚪'
    const tokenInfo = acc.tokenValid ? `aktif (${formatExpiry(acc.expiresAt)})` : 'perlu refresh'
    lines.push(`${i + 1}. ${flag} UID \`${acc.uid}\` ${acc.nickname ? `• *${acc.nickname}*` : ''}`)
    lines.push(`   Region: ${acc.region} (${acc.cluster}) • ID Game: \`${acc.accountId || '-'}\``)
    lines.push(`   Token : ${tokenInfo}`)
  })
  lines.push('', `Gunakan *${p}ffadmin help* untuk semua perintah owner.`)
  return lines.join('\n')
}

export default {
  name: 'ffadmin',
  aliases: ['fflogin', 'ffguest', 'ffcreate', 'ffacc', 'ffaccounts'],
  tags: 'owner',
  owner: true,
  cooldown: 3000,
  description: 'Kelola akun worker & kredensial Free Fire (Owner Only)',

  async run(ctx) {
    const p = ctx.prefix || config.mainPrefix
    const cmd = String(ctx.command || 'ffadmin').toLowerCase()
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}
    const tokens = String(ctx.text || '').trim().split(/\s+/).filter(Boolean)

    let sub = (tokens[0] || '').toLowerCase()
    let args = tokens.slice(1)
    if (cmd === 'fflogin') {
      sub = 'login'
      args = tokens
    } else if (cmd === 'ffguest') {
      sub = 'guest'
      args = tokens
    } else if (cmd === 'ffcreate') {
      sub = 'create'
      args = tokens
    } else if (cmd === 'ffacc' || cmd === 'ffaccounts') {
      sub = 'list'
      args = tokens
    } else if (!sub) {
      sub = 'list'
    }

    if (sub === 'help') {
      return ctx.client.message.send(ctx.chat, buildAdminHelp(p), sendOpts)
    }

    if (sub === 'list') {
      return ctx.client.message.send(ctx.chat, formatAccountList(p), sendOpts)
    }

    await ctx.react('⏳')
    try {
      if (sub === 'login') {
        const [uid, password] = args
        if (!uid || !password) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `❌ Format: *${p}fflogin <uid> <password>*`, sendOpts)
        }
        const rec = await addWorkerAccount(uid, password, { setActive: true })
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `✅ *Login Worker Berhasil!*\n` +
            `• UID Garena : \`${rec.uid}\`\n` +
            `• Account ID : \`${rec.accountId}\`\n` +
            `• Region     : ${rec.region} (${rec.cluster})\n` +
            `• Server URL : ${rec.serverUrl}\n` +
            `• Masa Token : ${formatExpiry(rec.expiresAt)}`,
          sendOpts
        )
      }

      if (sub === 'create') {
        let nickname = args[0]
        let region = args[1] || 'ID'
        if (nickname && /^[a-z]{2,6}$/i.test(nickname) && !args[1] && ['id', 'ind', 'sg', 'vn', 'th', 'us', 'eu', 'europe', 'br'].includes(nickname.toLowerCase())) {
          region = nickname.toUpperCase()
          nickname = undefined
        }
        if (nickname && (nickname.length < 4 || nickname.length > 12)) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, '❌ Panjang nickname harus 4 sampai 12 karakter.', sendOpts)
        }
        const created = await createWorkerAccount({ nickname, region, setActive: true })
        const passDisplay = ctx.isGroup ? '_[disembunyikan di grup — cek via PC/private chat]_' : `\`${created.password}\``
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `✅ *Akun Worker Game Dibuat & Aktif!*\n` +
            `• Nickname   : *${created.nickname}*\n` +
            `• UID Garena : \`${created.uid}\`\n` +
            `• Password   : ${passDisplay}\n` +
            `• Account ID : \`${created.accountId}\`\n` +
            `• Region     : ${created.region} (${created.cluster})\n` +
            `• Server URL : ${created.serverUrl}`,
          sendOpts
        )
      }

      if (sub === 'guest') {
        const guest = await createGuest()
        const passDisplay = ctx.isGroup ? '_[disembunyikan di grup]_' : `\`${guest.password}\``
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `🎟️ *Guest Garena Baru*\n` +
            `• UID     : \`${guest.uid}\`\n` +
            `• OpenID  : \`${guest.openId}\`\n` +
            `• Password: ${passDisplay}\n\n` +
            `_Catatan: akun guest baru belum terdaftar di server game sampai didaftarkan via ${p}ffcreate atau login di client Free Fire._`,
          sendOpts
        )
      }

      if (sub === 'use' || sub === 'switch') {
        const targetUid = args[0]
        if (!targetUid) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `❌ Format: *${p}ffadmin use <uid>*`, sendOpts)
        }
        const rec = setActiveWorkerAccount(targetUid)
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `✅ Worker aktif dipindah ke UID \`${rec.uid}\` (${rec.region || rec.cluster}).`,
          sendOpts
        )
      }

      if (sub === 'del' || sub === 'remove' || sub === 'rm') {
        const targetUid = args[0]
        if (!targetUid) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `❌ Format: *${p}ffadmin del <uid>*`, sendOpts)
        }
        const ok = removeWorkerAccount(targetUid)
        await ctx.react(ok ? '✅' : '❎')
        return ctx.client.message.send(
          ctx.chat,
          ok ? `🗑️ Akun UID \`${targetUid}\` dihapus dari cache.` : `❌ UID \`${targetUid}\` tidak ditemukan di cache.`,
          sendOpts
        )
      }

      if (sub === 'refresh') {
        const rec = await refreshActiveWorker()
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `🔄 Token worker UID \`${rec.uid}\` diperbarui (${formatExpiry(rec.expiresAt)}).`,
          sendOpts
        )
      }

      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, buildAdminHelp(p), sendOpts)
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 260)}`, sendOpts)
    }
  }
}
