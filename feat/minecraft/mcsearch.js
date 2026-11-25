/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/mcsearch.js — Cari addon, skin, & world di Minecraft Marketplace
 */
import { runMcSearch } from '../../lib/minecraft/workflow.js'

export default {
  name: 'mcsearch',
  aliases: ['mcs', 'mcari'],
  tags: 'minecraft',
  description: 'Cari addon, skin, world di Minecraft Marketplace',
  cooldown: 5000,

  async run(ctx) {
    await runMcSearch(ctx.text, ctx)
  }
}
