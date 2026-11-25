/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/mctrend.js — Katalog addon Minecraft Marketplace terbaru & terpopuler
 */
import { runMcTrend } from '../../lib/minecraft/workflow.js'

export default {
  name: 'mctrend',
  aliases: ['mctrending', 'mcnew'],
  tags: 'minecraft',
  description: 'Katalog addon Marketplace terbaru & terpopuler',
  cooldown: 8000,

  async run(ctx) {
    await runMcTrend(ctx)
  }
}
