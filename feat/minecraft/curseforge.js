/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/curseforge.js — Cari mod & addon Minecraft Bedrock Edition di CurseForge
 */
import { runCurseForgeSearch } from '../../lib/minecraft/workflow.js'

export default {
  name: 'curseforge',
  aliases: ['cf', 'cfsearch', 'cfs'],
  tags: 'minecraft',
  description: 'Cari ribuan mod & addon Bedrock Edition di CurseForge',
  cooldown: 5000,

  async run(ctx) {
    await runCurseForgeSearch(ctx.text, ctx)
  }
}
