/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * feat/minecraft/cftrend.js — Katalog addon paling populer di CurseForge Bedrock
 */
import { runCurseForgeTrend } from '../../lib/minecraft/workflow.js'

export default {
  name: 'cftrend',
  aliases: ['cfpopuler', 'cfnew'],
  tags: 'minecraft',
  description: 'Katalog addon paling populer di CurseForge Bedrock',
  cooldown: 8000,

  async run(ctx) {
    await runCurseForgeTrend(ctx)
  }
}
