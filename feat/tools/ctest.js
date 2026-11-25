/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * ctest.js — Demo carousel interaktif
 */
import config from '../../config.js'
import { sendCarousel, IMAGE_URLS } from '../../lib/carousel.js'

export default {
  name: 'carouseltest',
  aliases: ['ctest'],
  tags: 'tools',
  owner: true,
  description: 'Ujicoba carousel asli (gambar asli per card, sesuai spek resmi)',

  async run(ctx) {
    await ctx.react('⏳')
    try {
      const footer = `⚡ Powered by ${config.botName}`
      await sendCarousel(ctx, {
        text: `🧪 *UJICOBA CAROUSEL — ${config.botName.toUpperCase()}*\nPilih kartu:`,
        cards: [
          {
            imageUrl: IMAGE_URLS.slide1,
            body: `*Kartu 1 — ${config.botName}*\nDemo card carousel pertama.`,
            footer,
            buttons: [
              { type: 'url', displayText: '🌐 Zapo-JS Docs', url: 'https://zapo.to' },
              { type: 'reply', displayText: '👋 Tap Kartu 1', id: 'rich:carousel-sapa-1' }
            ]
          },
          {
            imageUrl: IMAGE_URLS.slide2,
            body: `*Kartu 2 — ${config.botName}*\nDemo card carousel kedua.`,
            footer,
            buttons: [
              { type: 'url', displayText: '🌐 Zapo-JS Docs', url: 'https://zapo.to' },
              { type: 'reply', displayText: '👋 Tap Kartu 2', id: 'rich:carousel-sapa-2' }
            ]
          },
          {
            imageUrl: IMAGE_URLS.slide3,
            body: `*Kartu 3 — ${config.botName}*\nDemo card carousel ketiga.`,
            footer,
            buttons: [
              { type: 'url', displayText: '🌐 Zapo-JS Docs', url: 'https://zapo.to' },
              { type: 'reply', displayText: '👋 Tap Kartu 3', id: 'rich:carousel-sapa-3' }
            ]
          }
        ]
      })

      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('❌ CTest gagal: ' + String(e.message || e).slice(0, 250))
    }
  }
}
