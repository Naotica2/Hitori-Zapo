/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * minecraftHandler.js — Handler balasan angka (1-99), konfirmasi typo (Y), & pembatalan sesi Minecraft
 */
import config from '../config.js'
import { logger } from '../core/logger.js'
import { buildContext } from '../core/context.js'
import { getUser } from '../core/database.js'
import { sendTyping } from '../core/presence.js'
import { getSession, clearSession } from '../lib/minecraft/session.js'
import {
  downloadCore,
  replyQuoted,
  runCurseForgeSearch,
  runMcSearch
} from '../lib/minecraft/workflow.js'

export async function checkMinecraftAnswer(client, event) {
  try {
    if (event.key.fromMe) return false

    const ctx = buildContext(client, event)
    const rawBody = (ctx.body ?? '').trim()
    if (!rawBody) return false
    if (config.prefixes.some((p) => rawBody.startsWith(p))) return false

    const session = getSession(ctx)
    if (!session) return false
    if (session.chat && ctx.chat !== session.chat) return false

    if (!ctx.isStaff) {
      const rowPn = getUser(ctx.sender)
      const rowLid = ctx.senderLid ? getUser(ctx.senderLid) : undefined
      if (rowPn?.banned || rowLid?.banned) return false
    }

    ctx.prefix = config.mainPrefix
    const text = rawBody.toLowerCase()

    if (text === 'batal' || text === 'cancel') {
      clearSession(ctx)
      await replyQuoted(ctx, '🚪 Sesi Minecraft telah dibatalkan.')
      return true
    }

    if (session.type === 'suggestion') {
      if (['y', 'ya', 'yes', 'ok', '1'].includes(text)) {
        const { suggestedQuery, source } = session
        clearSession(ctx)
        if (config.typingPresence) void sendTyping(client, ctx.chat)

        if (source === 'marketplace') {
          ctx.command = 'mcsearch'
          await runMcSearch(suggestedQuery, ctx)
          return true
        }
        if (source === 'curseforge') {
          ctx.command = 'cf'
          await runCurseForgeSearch(suggestedQuery, ctx)
          return true
        }
        ctx.command = 'mcdl'
        await downloadCore(suggestedQuery, ctx)
        return true
      }
      return false
    }

    if (/^[1-9][0-9]?$/.test(text)) {
      const choice = parseInt(text, 10)
      if (session.keys?.[choice]) {
        if (config.typingPresence) void sendTyping(client, ctx.chat)
        ctx.command = 'mcdl'
        await downloadCore(String(choice), ctx)
        return true
      }
    }

    return false
  } catch (err) {
    logger.warn({ err: err.message }, 'minecraft answer handler gagal')
    return false
  }
}
