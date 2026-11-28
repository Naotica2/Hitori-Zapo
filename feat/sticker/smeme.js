/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * smeme.js — Bikin Gambar Menjadi Stiker Meme
 */
import { loadImage, createCanvas } from '@napi-rs/canvas';
import config from '../../config.js';
import { resolveTargetMedia, downloadTargetBuffer } from '../../lib/media.js';
import { applyStickerExif } from '../../lib/sticker.js';

function isEmojiSegment(segment) {
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(segment);
}

function splitTextSegments(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('id', {
      granularity: 'grapheme'
    });
    return Array.from(segmenter.segment(text), item => item.segment);
  }
  return Array.from(text);
}

function getTextWidth(ctx, text, fontSize) {
  const segments = splitTextSegments(text);
  let width = 0;

  for (const segment of segments) {
    if (isEmojiSegment(segment)) {
      ctx.font = `${fontSize}px "Noto Color Emoji"`;
    } else {
      ctx.font = `900 ${fontSize}px "Impact", "Arial Black", sans-serif`;
    }
    width += ctx.measureText(segment).width;
  }

  return width;
}

function drawMixedText(ctx, text, centerX, centerY, fontSize, maxWidth) {
  if (!text) return;

  const segments = splitTextSegments(text);
  const textWidth = getTextWidth(ctx, text, fontSize);
  const scale = textWidth > maxWidth ? maxWidth / textWidth : 1;
  const finalFontSize = Math.max(Math.floor(fontSize * scale), 12);
  const finalTextWidth = getTextWidth(ctx, text, finalFontSize);

  let currentX = centerX - finalTextWidth / 2;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(Math.floor(finalFontSize / 6), 3);
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';

  for (const segment of segments) {
    const emoji = isEmojiSegment(segment);

    if (emoji) {
      ctx.font = `${finalFontSize}px "Noto Color Emoji"`;
    } else {
      ctx.font = `900 ${finalFontSize}px "Impact", "Arial Black", sans-serif`;
    }

    const segmentWidth = ctx.measureText(segment).width;

    if (!emoji) {
      ctx.strokeText(segment, currentX, centerY);
    }
    ctx.fillText(segment, currentX, centerY);

    currentX += segmentWidth;
  }
}

async function createMeme(imageBuffer, topText, bottomText) {
  const img = await loadImage(imageBuffer);
  const size = 512;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;

  const x = (size - w) / 2;
  const y = (size - h) / 2;

  ctx.drawImage(img, x, y, w, h);

  const fontSize = Math.max(Math.floor(h / 8), 24);
  const maxWidth = w * 0.95;

  drawMixedText(
    ctx,
    topText,
    size / 2,
    y + (fontSize / 2) + 10,
    fontSize,
    maxWidth
  );

  drawMixedText(
    ctx,
    bottomText,
    size / 2,
    y + h - (fontSize / 2) - 10,
    fontSize,
    maxWidth
  );

  return canvas.encode('webp');
}

export default {
  name: 'smeme',
  aliases: ['stickermeme', 'stikermeme', 'sm'],
  tags: 'sticker',
  description: 'Bikin stiker meme dari gambar (.smeme atas | bawah)',

  async run(ctx) {
    const { event, rawMessage, targetMessage, payload } = resolveTargetMedia(ctx);

    if (!event) {
      return ctx.reply('Gagal mendapatkan event pesan dari sistem.');
    }

    if (
      !payload ||
      !payload.mimetype ||
      !payload.mimetype.includes('image')
    ) {
      return ctx.reply(
        '✦ *STICKER MEME* ✦\n\n' +
        'Kirim/reply gambar dengan format:\n' +
        '`.smeme teks atas | teks bawah`\n' +
        '`.smeme teks atas doang`\n' +
        '`.smeme | teks bawah doang`'
      );
    }

    const text = (ctx.text || '').trim();

    if (!text) {
      return ctx.reply(
        `Teksnya mana Kak? Contoh: *.smeme ${config.botName} | Bot WhatsApp*`
      );
    }

    let topText = '';
    let bottomText = '';

    if (text.includes('|')) {
      const parts = text.split('|');

      topText = parts[0].trim().toUpperCase();
      bottomText = parts.slice(1).join('|').trim().toUpperCase();
    } else {
      topText = text.toUpperCase();
    }

    await ctx.react('⏳');

    try {
      const imgBuffer = await downloadTargetBuffer(targetMessage);

      const rawWebp = await createMeme(
        imgBuffer,
        topText,
        bottomText
      );

      const finalSticker = applyStickerExif(rawWebp, {
        packName: config.sticker.packName,
        author: config.sticker.author,
        packId: 'hitori-smeme',
        emojis: ['✨']
      });

      await ctx.client.message.send(
        ctx.chat,
        {
          type: 'sticker',
          media: finalSticker,
          mimetype: 'image/webp'
        },
        {
          quote: rawMessage
        }
      );

      await ctx.react('✅');
    } catch (error) {
      await ctx.react('❎');

      return ctx.reply(
        '❌ Gagal membuat sticker meme: ' +
        String(error.message || error).slice(0, 250)
      );
    }
  }
};