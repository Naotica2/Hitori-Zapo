/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * hapadmin.js — Kelola akun worker HAPGETA AI (khusus Owner)
 */

import config from '../../config.js'
import { getEvent } from '../../lib/media.js'
import {
  addWorkerAccount,
  createWorkerAccount,
  listWorkerAccounts,
  removeWorkerAccount,
  setActiveWorkerAccount
} from '../../scraper/HAPGETA.js'

function buildHelp(p) {
  return [
    '👑 *HAPGETA WORKER ADMIN* _(Owner Only)_',
    '',
    `• *${p}hapaccounts* — lihat akun tersimpan & status kredit`,
    `• *${p}haplogin <email> <password>* — tambah & aktifkan akun HAPGETA`,
    `• *${p}hapcreate [prefix]* — buat 1 akun baru lewat mail.tm`,
    `• *${p}hapadmin use <userId|email>* — pindah akun aktif`,
    `• *${p}hapadmin del <userId|email>* — hapus akun dari cache`
  ].join('\n')
}

function formatAccounts(p) {
  const { accounts } = listWorkerAccounts()
  if (!accounts.length) {
    return (
      `📭 *Belum ada akun HAPGETA tersimpan.*\n` +
      `Gunakan *${p}haplogin <email> <password>* atau *${p}hapcreate* untuk menyiapkan akun.`
    )
  }

  const lines = [`🤖 *AKUN HAPGETA AI (${accounts.length} akun)*`, '']
  accounts.forEach((acc, i) => {
    const flag = acc.active ? '✅ [AKTIF]' : '⚪'
    const state = acc.exhausted ? '⚠️ kredit habis' : 'siap dipakai'
    lines.push(`${i + 1}. ${flag} ID \`${acc.userId}\` • ${acc.email}`)
    lines.push(`   Status: ${state}${acc.hasPassword ? ' (auto-login aktif)' : ''}`)
  })
  lines.push('', `Gunakan *${p}hapadmin help* untuk semua perintah owner.`)
  return lines.join('\n')
}

export default {
  name: 'hapadmin',
  aliases: ['haplogin', 'hapcreate', 'hapacc', 'hapaccounts'],
  tags: 'owner',
  owner: true,
  cooldown: 3000,
  description: 'Kelola akun & sesi worker HAPGETA AI (Owner Only)',

  async run(ctx) {
    const p = ctx.prefix || config.mainPrefix
    const cmd = String(ctx.command || 'hapadmin').toLowerCase()
    const rawEvent = getEvent(ctx)
    const sendOpts = rawEvent ? { quote: rawEvent } : {}
    const tokens = String(ctx.text || '').trim().split(/\s+/).filter(Boolean)

    let sub = (tokens[0] || '').toLowerCase()
    let args = tokens.slice(1)
    if (cmd === 'haplogin') {
      sub = 'login'
      args = tokens
    } else if (cmd === 'hapcreate') {
      sub = 'create'
      args = tokens
    } else if (cmd === 'hapacc' || cmd === 'hapaccounts') {
      sub = 'list'
      args = tokens
    } else if (!sub) {
      sub = 'list'
    }

    if (sub === 'help') {
      return ctx.client.message.send(ctx.chat, buildHelp(p), sendOpts)
    }

    if (sub === 'list') {
      return ctx.client.message.send(ctx.chat, formatAccounts(p), sendOpts)
    }

    await ctx.react('⏳')
    try {
      if (sub === 'login') {
        const [email, password] = args
        if (!email || !password) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `❌ Format: *${p}haplogin <email> <password>*`, sendOpts)
        }
        const rec = await addWorkerAccount({ email, password, setActive: true })
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `✅ *Login HAPGETA Berhasil!*\n` +
            `• User ID : \`${rec.userId}\`\n` +
            `• Email   : ${rec.email}\n` +
            `• Nickname: ${rec.nickname || '-'}`,
          sendOpts
        )
      }

      if (sub === 'create') {
        const prefix = args[0] && /^[a-z0-9]{2,16}$/i.test(args[0]) ? args[0] : 'hapgeta'
        const created = await createWorkerAccount({ prefix, setActive: true })
        const passDisplay = ctx.isGroup ? '_[disembunyikan di grup — cek via private chat]_' : `\`${created.password}\``
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `✅ *Akun HAPGETA Dibuat & Aktif!*\n` +
            `• User ID : \`${created.userId}\`\n` +
            `• Email   : ${created.email}\n` +
            `• Password: ${passDisplay}`,
          sendOpts
        )
      }

      if (sub === 'use' || sub === 'switch') {
        const target = args[0]
        if (!target) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `❌ Format: *${p}hapadmin use <userId|email>*`, sendOpts)
        }
        const rec = setActiveWorkerAccount(target)
        await ctx.react('✅')
        return ctx.client.message.send(
          ctx.chat,
          `✅ Akun aktif HAPGETA dipindah ke \`${rec.userId}\` (${rec.email}).`,
          sendOpts
        )
      }

      if (sub === 'del' || sub === 'remove' || sub === 'rm') {
        const target = args[0]
        if (!target) {
          await ctx.react('❎')
          return ctx.client.message.send(ctx.chat, `❌ Format: *${p}hapadmin del <userId|email>*`, sendOpts)
        }
        const ok = removeWorkerAccount(target)
        await ctx.react(ok ? '✅' : '❎')
        return ctx.client.message.send(
          ctx.chat,
          ok ? `🗑️ Akun HAPGETA \`${target}\` dihapus.` : `❌ Akun \`${target}\` tidak ditemukan.`,
          sendOpts
        )
      }

      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, buildHelp(p), sendOpts)
    } catch (err) {
      await ctx.react('❎')
      return ctx.client.message.send(ctx.chat, `❌ ${String(err?.message || err).slice(0, 260)}`, sendOpts)
    }
  }
}
