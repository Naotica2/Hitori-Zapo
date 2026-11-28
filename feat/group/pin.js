/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * pin.js — Pin / Unpin / Keep pesan langsung di chat/grup WhatsApp
 */
import config from '../../config.js'
import { isGroupAdmin } from '../../core/permission.js'
import { getEvent } from '../../lib/media.js'

const PRESET_SECS = {
  '24h': 86_400,
  '24j': 86_400,
  '1d': 86_400,
  '1h': 86_400,
  '7d': 604_800,
  '7h': 604_800,
  '1w': 604_800,
  '30d': 2_592_000,
  '30h': 2_592_000,
  '1mo': 2_592_000
}

function resolveQuotedKey(ctx) {
  const event = getEvent(ctx)
  const rawMessage = event?.message
  if (!rawMessage) return null

  const unwrapped =
    rawMessage.ephemeralMessage?.message ??
    rawMessage.viewOnceMessage?.message ??
    rawMessage.viewOnceMessageV2?.message ??
    rawMessage

  let ctxInfo = null
  for (const key of Object.keys(unwrapped)) {
    const node = unwrapped[key]
    if (node && typeof node === 'object' && node.contextInfo) {
      ctxInfo = node.contextInfo
      break
    }
  }

  if (!ctxInfo?.stanzaId) return null

  const meJid = ctx.client.getCurrentCredentials?.()?.meJid || ''
  const meLid = ctx.client.getCurrentCredentials?.()?.meLid || ''
  const meNum = meJid.split('@')[0].split(':')[0]
  const meLidNum = meLid.split('@')[0].split(':')[0]
  const qPart = ctxInfo.participant || (ctx.isGroup ? undefined : ctx.chat)
  const qNum = String(qPart || '').split('@')[0].split(':')[0]
  const fromMe = Boolean(qNum && (qNum === meNum || (meLidNum && qNum === meLidNum)))

  return {
    remoteJid: ctx.chat,
    id: ctxInfo.stanzaId,
    fromMe,
    ...(ctx.isGroup && ctxInfo.participant ? { participant: ctxInfo.participant } : {})
  }
}

export async function runPinCommand(ctx, { forceMode = null } = {}) {
  const p = config.mainPrefix
  const rawEvent = getEvent(ctx)
  const sendOpts = rawEvent ? { quote: rawEvent } : {}

  if (ctx.isGroup && !(await isGroupAdmin(ctx))) {
    return ctx.client.message.send(ctx.chat, '🚫 Pin/Unpin pesan di grup khusus Admin / Staff bot.', sendOpts)
  }

  const targetKey = resolveQuotedKey(ctx)
  const cmd = forceMode || String(ctx.command || '').toLowerCase()
  const arg = String(ctx.text || '').trim().toLowerCase()

  if (!targetKey || /^help$/i.test(arg)) {
    return ctx.client.message.send(
      ctx.chat,
      '📌 *PIN & KEEP PESAN WHATSAPP*\n\n' +
        '*Cara pakai (reply pesan target):*\n' +
        `• *${p}pin* atau *${p}pinmsg 24h* — pin selama 24 jam\n` +
        `• *${p}pin 7d* — pin selama 7 hari\n` +
        `• *${p}pin 30d* — pin selama 30 hari\n` +
        `• *${p}unpin* — lepas pin pesan\n` +
        `• *${p}keepmsg* / *${p}unkeepmsg* — simpan/batal simpan pesan disappearing`,
      sendOpts
    )
  }

  const isKeep = cmd.includes('keep')
  const isUndo = cmd.startsWith('un') || arg === 'off' || arg === 'batal'

  await ctx.react('⏳')
  try {
    if (isKeep) {
      await ctx.client.message.send(ctx.chat, {
        type: isUndo ? 'unkeep' : 'keep',
        target: targetKey
      })
    } else if (isUndo) {
      await ctx.client.message.send(ctx.chat, {
        type: 'unpin',
        target: targetKey
      })
    } else {
      const durationSecs = PRESET_SECS[arg] ?? 86_400
      await ctx.client.message.send(ctx.chat, {
        type: 'pin',
        target: targetKey,
        durationSecs
      })
    }
    await ctx.react('✅')
  } catch (err) {
    await ctx.react('❎')
    return ctx.client.message.send(
      ctx.chat,
      `❌ Gagal memproses pin pesan: ${String(err?.message || err).slice(0, 220)}`,
      sendOpts
    )
  }
}

export default {
  name: 'pinmsg',
  aliases: ['pinpesan', 'pinchat', 'unpin', 'unpinmsg', 'keepmsg', 'unkeepmsg'],
  tags: 'group',
  cooldown: 3000,
  description: 'Pin/Unpin pesan di chat atau grup (24h, 7d, 30d) dan Keep pesan',

  async run(ctx) {
    return runPinCommand(ctx)
  }
}
