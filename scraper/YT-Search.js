/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * YT-Search.js — Scraper Mencari Video YouTube
 */

function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(jsonStart, i + 1);
    }
  }
  return null;
}

export async function searchYouTube(query, limit = 10) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!res.ok) throw new Error('Gagal fetch halaman YouTube: HTTP ' + res.status);

  const html = await res.text();
  const raw = extractJsonAfter(html, 'var ytInitialData = ');
  if (!raw) {
    throw new Error('Gagal nemu data pencarian di halaman YouTube (kemungkinan struktur halamannya berubah).');
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Gagal parse data pencarian YouTube.');
  }

  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];

  const results = [];

  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const v = item.videoRenderer;
      if (!v?.videoId) continue;

      results.push({
        videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Tanpa judul',
        duration: v.lengthText?.simpleText || 'LIVE',
        views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '-',
        channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '-',
        thumbnail: v.thumbnail?.thumbnails?.at(-1)?.url || null
      });

      if (results.length >= limit) return results;
    }
  }

  // YouTube WEB HTML occasionally returns backgroundPromoRenderer (age/consent gate)
  // with 0 videoRenderer entries; fall back to YouTube Music InnerTube in that case.
  return results.length > 0 ? results : searchYouTubeMusic(query, limit);
}

const runsText = (runs) =>
  (Array.isArray(runs) ? runs.map((r) => r?.text || '').join('') : '').trim();

function collectMusicRenderers(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 20) return out;
  if (node.musicCardShelfRenderer) {
    out.push({ kind: 'card', raw: node.musicCardShelfRenderer });
  } else if (node.musicResponsiveListItemRenderer) {
    out.push({ kind: 'item', raw: node.musicResponsiveListItemRenderer });
  }
  if (Array.isArray(node)) {
    for (const child of node) collectMusicRenderers(child, out, depth + 1);
  } else {
    for (const key of Object.keys(node)) collectMusicRenderers(node[key], out, depth + 1);
  }
  return out;
}

function parseMusicSubtitle(subText) {
  const parts = String(subText || '')
    .split('•')
    .map((s) => s.trim())
    .filter(Boolean);
  const typeLabel = /^(lagu|song|video|episode|podcast)$/i.test(parts[0] || '') ? parts[0] : '';
  const body = typeLabel ? parts.slice(1) : parts;
  const durationPart = [...body].reverse().find((p) => /^\d{1,2}[:.]\d{2}(?:[:.]\d{2})?$/.test(p));
  const viewsPart = body.find((p) => /ditonton|views|plays|diputar/i.test(p));
  const channel = body.find((p) => p !== durationPart && p !== viewsPart) || '-';
  return {
    type: typeLabel,
    channel,
    views: viewsPart || '-',
    duration: durationPart ? durationPart.replace(/\./g, ':') : '-'
  };
}

/**
 * Search YouTube Music via InnerTube WEB_REMIX. Reliable fallback when WEB HTML
 * hits backgroundPromoRenderer and yields cleaner song results for music reactions.
 */
export async function searchYouTubeMusic(query, limit = 10) {
  const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241120.01.00', hl: 'id', gl: 'ID' } },
      query: String(query ?? '')
    }),
    signal: AbortSignal.timeout(15_000)
  });

  if (!res.ok) {
    throw new Error(`YouTube Music InnerTube HTTP ${res.status}`);
  }

  const data = await res.json();
  const renderers = collectMusicRenderers(data);
  const results = [];
  const seen = new Set();

  for (const { kind, raw } of renderers) {
    let videoId = '';
    let title = '';
    let subText = '';
    let thumbnail = null;

    if (kind === 'card') {
      videoId =
        raw.onTap?.watchEndpoint?.videoId ||
        raw.title?.runs?.find((r) => r?.navigationEndpoint?.watchEndpoint?.videoId)?.navigationEndpoint
          ?.watchEndpoint?.videoId ||
        '';
      title = runsText(raw.title?.runs);
      subText = runsText(raw.subtitle?.runs);
      thumbnail = raw.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url || null;
    } else {
      const flex0Runs = raw.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      const flex1Runs = raw.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      videoId =
        raw.playlistItemData?.videoId ||
        flex0Runs?.find((r) => r?.navigationEndpoint?.watchEndpoint?.videoId)?.navigationEndpoint
          ?.watchEndpoint?.videoId ||
        '';
      title = runsText(flex0Runs);
      subText = runsText(flex1Runs);
      thumbnail = raw.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url || null;
    }

    if (!videoId || seen.has(videoId)) continue;
    const meta = parseMusicSubtitle(subText);
    if (/^(episode|podcast)$/i.test(meta.type)) continue;

    seen.add(videoId);
    results.push({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: title || 'Tanpa judul',
      duration: meta.duration,
      views: meta.views,
      channel: meta.channel,
      type: meta.type || (kind === 'card' ? 'Video' : 'Audio'),
      thumbnail
    });

    if (results.length >= limit) break;
  }

  return results;
}
