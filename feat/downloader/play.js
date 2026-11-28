/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * play.js — Putar lagu kesukaanmu dengan cepat.
 */
import config from '../../config.js'
import { downloadUrlBuffer } from '../../lib/media.js'
import { ytdl } from '../../scraper/YT-DL.js'
import { searchYouTube, searchYouTubeMusic } from '../../scraper/YT-Search.js'
import { onRichReply } from '../../handlers/messageHandler.js'

const SESSIONS = (globalThis.HITORI_PLAY_SESSIONS ??= new Map())
const PER_PAGE = 2;

const cut = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};

const LINE = '━━━━━━━━━━━━━━━━━━━━';

async function ytSearch(query) {
  try {
    const res = await fetch('https://api.jhx.my.id/yt-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36',
        'Referer': 'https://jhx.my.id/ytdl/'
      },
      body: JSON.stringify({ q: query }),
      signal: AbortSignal.timeout(15_000)
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.Status && Array.isArray(json.data) && json.data.length) {
        return json.data;
      }
    }
  } catch {}

  const ytm = await searchYouTubeMusic(query, 8).catch(() => [])
  if (ytm.length) return ytm
  const yt = await searchYouTube(query, 8).catch(() => [])
  if (yt.length) return yt.map((v) => ({ ...v, artist: v.channel || '-' }))
  throw new Error('Lagu tidak ditemukan');
}

async function downloadAndSend(ctx, idx) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.play <judul>* lagi.');
  const v = sess.results[idx];
  if (!v) return ctx.reply('Nomor gak valid.');

  await ctx.react('⏳')
  try {
    let buf = null
    let dlTitle = v.title

    try {
      const data = await Promise.race([
        ytdl.download(v.url, 'mp3'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('savenow timeout')), 25_000))
      ])
      if (data?.status === 'success' && data.download_url) {
        dlTitle = data.title || v.title
        buf = await downloadUrlBuffer(data.download_url, { timeout: 180_000, maxBytes: 120 * 1024 * 1024 })
      }
    } catch {}

    if (!buf) {
      const jhxRes = await fetch('https://api.jhx.my.id/yt-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://jhx.my.id/ytdl/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
        },
        body: JSON.stringify({ url: v.url, format: 'mp3' }),
        signal: AbortSignal.timeout(30_000)
      }).then((r) => r.json()).catch(() => null)
      if (!jhxRes?.Status || !jhxRes?.data?.url) {
        throw new Error(jhxRes?.message || 'Gagal unduh audio dari semua provider.')
      }
      dlTitle = jhxRes.data.title || v.title
      buf = await downloadUrlBuffer(jhxRes.data.url, { timeout: 180_000, maxBytes: 120 * 1024 * 1024 })
    }

    await ctx.client.message.send(ctx.chat, {
      type: 'audio',
      media: buf,
      mimetype: 'audio/mpeg',
      fileName: dlTitle + '.mp3'
    });
    await ctx.react('🎧');
  } catch (e) {
    await ctx.react('❎');
    await ctx.reply('*Maaf Error:* ' + (e.message || e));
  }
}

async function sendPage(ctx, page) {
  const sess = SESSIONS.get(ctx.sender);
  if (!sess) return ctx.reply('Sesi habis. Ketik *.play <judul>* lagi.');

  const { results, query } = sess;
  const totalPages = Math.ceil(results.length / PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));

  const start = page * PER_PAGE;
  const items = results.slice(start, start + PER_PAGE);

  let text = `✦ ──『 🎧 PLAY MUSIC 』── ⚝\n\n`;
  text += `🔎 Query : *${cut(query, 38)}*\n`;
  text += `📄 Page  : ${page + 1}/${totalPages} • ${results.length} hasil\n\n`;
  text += LINE + '\n';

  items.forEach((v, i) => {
    text += `\n${start + i + 1} ─ ${cut(v.title, 40)}\n`;
    text += `    ⏱ ${v.duration || '-:--'}  •  ${cut(v.artist, 26)}\n`;
  });

  text += '\n' + LINE + '\n\n';
  text += `Tap tombol angka di bawah\nbuat langsung putar lagunya 🎶`;

  const buttons = items.map((v, i) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: String(start + i + 1),
      id: `hitoriplay:${ctx.sender}:pick:${start + i}`
    })
  }))

  if (page > 0) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: '◀ Prev',
        id: `hitoriplay:${ctx.sender}:prev:${page - 1}`
      })
    })
  }
  if (page < totalPages - 1) {
    buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: 'Next ▶',
        id: `hitoriplay:${ctx.sender}:next:${page + 1}`
      })
    })
  }

  items.forEach((v, i) => {
    onRichReply(`hitoriplay:${ctx.sender}:pick:${start + i}`, async (c2) => {
      await downloadAndSend(c2, start + i)
    })
  })
  if (page > 0) {
    onRichReply(`hitoriplay:${ctx.sender}:prev:${page - 1}`, async (c2) => {
      await sendPage(c2, page - 1)
    })
  }
  if (page < totalPages - 1) {
    onRichReply(`hitoriplay:${ctx.sender}:next:${page + 1}`, async (c2) => {
      await sendPage(c2, page + 1)
    })
  }

  await ctx.client.message.send(ctx.chat, {
    interactiveMessage: {
      body: { text },
      footer: { text: `🎧 ${config.botName} • Music Player` },
      nativeFlowMessage: {
        buttons,
        messageVersion: 1
      }
    }
  })
}

export default {
  name: 'play',
  aliases: ['ytplay', 'playyt', 'music'],
  tags: 'downloader',
  description: 'Search YouTube audio, pilih lewat button',

  async run(ctx) {
    const query = ctx.text
    if (!query) {
      return ctx.reply(
        `✦ ──『 🎧 ${config.botName.toUpperCase()} MUSIC 』── ⚝\n\n` +
        'Masukkan judul lagu yang\nmau dicari & diputar 🎶\n\n' +
        '*Contoh:*\n.play Bercinta Lewat Kata'
      )
    }

    await ctx.react('⏳');
    try {
      const results = (await ytSearch(query)).slice(0, 8);
      SESSIONS.set(ctx.sender, { query, results });
      await sendPage(ctx, 0);
      await ctx.react('✅');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('*Maaf Error:* ' + (e.message || e));
    }
  }
};
