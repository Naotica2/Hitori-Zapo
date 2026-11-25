/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * igstory.js — Fitur download Instagram Story dengan Username
 */
import config from '../../config.js'
import { downloadUrlBuffer, getEvent } from '../../lib/media.js'
import { igStoryDownload } from '../../scraper/IGSTORY.js'
import { sendCarousel } from '../../lib/carousel.js'

export default {
  name: 'igstory',
  aliases: ['igs', 'storyig'],
  tags: 'downloader',
  description: 'Download Instagram Story (Video & Image via Carousel)',

  async run(ctx) {
    const text = (ctx.text || '').trim()
    const uname = text.replace(/^@/, '').split(/\s+/)[0]

    if (!uname) {
      return ctx.reply(
        '✦ *IG STORY DOWNLOADER* ✦\n\n' +
        'Kirim username Instagram yang mau di-download story-nya.\n' +
        '*Contoh:*\n' +
        '`.igs username`'
      )
    }

    await ctx.react('⏳')

    try {
      const res = await igStoryDownload(uname)

      if (!res.status) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal: ' + res.error)
      }

      const { username, stories } = res.data
      const rawQuote = getEvent(ctx)

      const videos = stories.filter((s) => s.type === 'video')
      const images = stories.filter((s) => s.type === 'image')

      await ctx.reply(`✅ Menemukan ${stories.length} story dari @${username}. Sedang memproses...`)

      for (const story of videos) {
        const dateObj = new Date(story.taken_at)
        const timeStr = isNaN(dateObj.getTime()) ? story.taken_at : dateObj.toLocaleString('id-ID')
        const videoBuffer = await downloadUrlBuffer(story.url, { timeout: 120_000 })

        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'video',
            media: videoBuffer,
            mimetype: 'video/mp4',
            caption: `🎬 *Video Story* • @${username}\n🕒 _${timeStr}_`
          },
          { quote: rawQuote }
        )

        await new Promise((r) => setTimeout(r, 1500))
      }

      if (images.length >= 2) {
        const cards = images.map((img, index) => {
          const dateObj = new Date(img.taken_at)
          const timeStr = isNaN(dateObj.getTime()) ? img.taken_at : dateObj.toLocaleString('id-ID')

          return {
            imageUrl: img.url,
            body: [
              `*Image ${index + 1} dari ${images.length}*`,
              `🕒 _${timeStr}_`,
              `📸 @${username}`
            ].join('\n'),
            footer: `Powered by ${config.botName}`,
            buttons: [
              { type: 'url', displayText: '🌐 Buka di Instagram', url: `https://instagram.com/${username}` }
            ]
          }
        })

        await sendCarousel(ctx, {
          text: `🖼️ *Kumpulan Photo Story @${username}:*`,
          cards
        })
      } else if (images.length === 1) {
        const img = images[0]
        const dateObj = new Date(img.taken_at)
        const timeStr = isNaN(dateObj.getTime()) ? img.taken_at : dateObj.toLocaleString('id-ID')
        const imgBuffer = await downloadUrlBuffer(img.url, { timeout: 120_000 })

        await ctx.client.message.send(
          ctx.chat,
          {
            type: 'image',
            media: imgBuffer,
            mimetype: 'image/jpeg',
            caption: `🖼️ *Photo Story* • @${username}\n🕒 _${timeStr}_`
          },
          { quote: rawQuote }
        )
      }

      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      return ctx.reply('❌ Error sistem: ' + String(error.message || error).slice(0, 150))
    }
  }
}
