/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/mcdl.js — Download & bypass DRM addon Minecraft Marketplace & CurseForge Bedrock
 */
import config from '../../config.js'
import { downloadCore, replyQuoted } from '../../lib/minecraft/workflow.js'

export default {
  name: 'mcdl',
  aliases: ['mcdownload'],
  tags: 'minecraft',
  description: 'Download & bypass DRM addon Minecraft Marketplace & CurseForge Bedrock',
  cooldown: 5000,

  async run(ctx) {
    const prefix = ctx.prefix || config.mainPrefix
    const input = (ctx.text || '').trim()

    if (!input) {
      return replyQuoted(
        ctx,
        `🧱 *MINECRAFT BEDROCK DOWNLOADER (MCDL)*\n\n` +
          `Kirimkan UUID, Link Addon, atau Nomor Urut yang mau didownload!\n\n` +
          `*Contoh:* \`${prefix}mcdl 1\`\n` +
          `*Contoh:* \`${prefix}mcdl 16151822-0370-4844-bd7c-3aea5dc6c44e\`\n` +
          `*Contoh:* \`${prefix}mcdl Realism VFX\`\n` +
          `*Contoh:* \`${prefix}mcdl https://www.curseforge.com/.../addons/...\``
      )
    }

    await downloadCore(input, ctx)
  }
}
