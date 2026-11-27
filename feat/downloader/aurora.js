/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * aurora.js — AURORA DECK: Music & Video Player
 */

import config from '../../config.js';
import { sendRichHtml } from '../../lib/richHtml.js';
import { ytdl } from '../../scraper/YT-DL.js';

const API_BASE = 'https://api.jhx.my.id';
const API_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.199 Mobile Safari/537.36',
  'Referer': 'https://jhx.my.id/ytdl/'
};

const WS_WORKER = config.wsWorkerUrl || 'wss://audio.jhx.my.id/wss/audio';

async function ytSearch(query) {
  const res = await fetch(API_BASE + '/yt-search', {
    method: 'POST', headers: API_HEADERS,
    body: JSON.stringify({ q: query }),
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok || !json || !json.Status || !Array.isArray(json.data) || !json.data.length) {
    throw new Error(`Search gagal: HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  return json.data;
}

async function ytDownload(url, format) {
  let primaryErr = null;
  try {
    const res = await fetch(API_BASE + '/yt-download', {
      method: 'POST', headers: API_HEADERS,
      body: JSON.stringify({ url, format }),
      signal: AbortSignal.timeout(90000)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (res.ok && json && json.Status && json.data && json.data.url) {
      return json.data;
    }
    primaryErr = json?.error || `HTTP ${res.status} ${text.slice(0, 120)}`;
  } catch (err) {
    primaryErr = err?.message || String(err);
  }

  // Fallback ke scraper YT-DL (savenow) bila api.jhx.my.id gagal/timeout
  const fallback = await ytdl.download(url, format).catch(() => null);
  if (fallback && !fallback.error && fallback.download_url) {
    return {
      url: fallback.download_url,
      title: fallback.title || '',
      thumbnail: fallback.image || '',
      format
    };
  }

  throw new Error(`Download format "${format}" gagal: ${primaryErr || fallback?.error || 'unknown error'}`);
}

function inferMimeFromFormat(format, mediaUrl = '') {
  const f = String(format || '').toLowerCase();
  if (f === 'mp3') return 'audio/mpeg';
  if (f === 'm4a' || f === 'aac') return 'audio/mp4';
  if (f === 'ogg' || f === 'opus') return 'audio/ogg';
  if (f === 'wav') return 'audio/wav';
  if (f === 'flac') return 'audio/flac';
  if (/^\d{3,4}$/.test(f) || f === '4k') return 'video/mp4';
  const cleanUrl = String(mediaUrl).split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.mp3')) return 'audio/mpeg';
  if (cleanUrl.endsWith('.m4a')) return 'audio/mp4';
  if (cleanUrl.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

async function thumbDataUri(url) {
  if (!url) return '';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return '';
    const b = Buffer.from(await r.arrayBuffer());
    if (!b.length) return '';
    const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return 'data:' + ct + ';base64,' + b.toString('base64');
  } catch { return ''; }
}

const escapeAttrJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function buildHtml({ finalTitle, finalChannel, finalDuration, videoUrl, thumbnailb64, wsUrl, mime, isAudio }) {
  const cfg = {
    title: finalTitle,
    channel: finalChannel,
    duration: finalDuration,
    videoUrl,
    wsUrl,
    mime: mime || 'video/mp4',
    isAudio: Boolean(isAudio),
    autoplay: false,
    volume: 0.8,
    loop: false
  };

  const htmlPayload = `<style>
*{
-webkit-tap-highlight-color:transparent;
-webkit-user-select:none;
user-select:none;
-webkit-touch-callout:none;
box-sizing:border-box
}
body{
margin:0;
background:#04090b;
font-family:Arial,Helvetica,sans-serif;
color:#eafff5;
touch-action:manipulation;
cursor:pointer
}
input[type=range]{
width:100%;
height:4px;
accent-color:#00ff88;
cursor:pointer
}
.player-wrap{
width:100%;
max-width:440px;
margin:auto;
padding:12px
}
.aurora-head{
text-align:center;
margin:2px 0 10px
}
.aurora-title{
display:inline-block;
font-size:12px;
font-weight:800;
letter-spacing:2.5px;
background:linear-gradient(90deg,#00ff88,#22d3ee,#7dd3fc,#00ff88);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 6s linear infinite;
text-shadow:0 0 18px rgba(0,255,136,.25)
}
.player{
position:relative;
overflow:hidden;
background:#0b1512;
border:1px solid rgba(0,255,136,.16);
border-radius:20px;
box-shadow:0 10px 40px rgba(0,0,0,.55),0 0 24px rgba(0,255,136,.06) inset
}
.bg{
position:absolute;
inset:-25px;
background-position:center;
background-size:cover;
filter:blur(22px) saturate(1.1);
opacity:.30;
transform:scale(1.15);
pointer-events:none
}
.bg-overlay{
position:absolute;
inset:0;
background:linear-gradient(
180deg,
rgba(4,9,11,.40),
rgba(4,9,11,.78)
);
pointer-events:none
}
.content{
position:relative;
padding:18px;
z-index:2
}
.top{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:15px;
position:relative;
z-index:5
}
.top-title{
font-size:13px;
font-weight:700;
letter-spacing:.8px;
color:#5cffb0;
opacity:.9
}
.top-sub{
font-size:10px;
color:#7fa896;
opacity:.7;
margin-top:3px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
max-width:260px
}
.icon-btn{
width:34px;
height:34px;
border:0;
border-radius:50%;
background:rgba(0,255,136,.10);
color:#eafff5;
display:flex;
align-items:center;
justify-content:center;
padding:0;
flex-shrink:0;
cursor:pointer;
position:relative;
z-index:6;
touch-action:manipulation
}
.icon-btn.is-active{
background:rgba(0,255,136,.24);
color:#00ff88;
box-shadow:0 0 12px rgba(0,255,136,.22)
}
.icon-btn.is-muted{
background:rgba(255,77,109,.18);
color:#ff6b81
}
.icon-btn svg{
width:17px;
height:17px;
fill:none;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round;
pointer-events:none
}
.video-frame{
position:relative;
width:100%;
aspect-ratio:16/9;
border-radius:15px;
overflow:hidden;
background:#000;
box-shadow:0 12px 35px rgba(0,0,0,.45),0 0 0 1px rgba(34,211,238,.14);
cursor:pointer;
touch-action:manipulation
}
.video-frame video{
width:100%;
height:100%;
display:block;
background:#000;
object-fit:contain;
pointer-events:none
}
.big-play{
position:absolute;
inset:0;
display:flex;
align-items:center;
justify-content:center;
background:rgba(0,0,0,.18);
transition:opacity .2s;
z-index:5
}
.big-btn{
width:64px;
height:64px;
border:0;
border-radius:50%;
background:linear-gradient(135deg,#00ff88,#22d3ee);
color:#041008;
display:flex;
align-items:center;
justify-content:center;
padding:0;
cursor:pointer;
position:relative;
z-index:6;
touch-action:manipulation;
box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 22px rgba(0,255,136,.35)
}
.big-btn svg{
width:26px;
height:26px;
fill:currentColor;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round;
pointer-events:none
}
.frame-playing .big-play{
opacity:0;
pointer-events:none
}
.info{
padding-top:15px
}
.song-title{
font-size:19px;
font-weight:700;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
color:#f2fff8
}
.artist{
font-size:13px;
color:#7fa896;
opacity:.8;
margin-top:5px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis
}
.progress{
margin-top:18px;
position:relative;
z-index:5
}
.times{
display:flex;
justify-content:space-between;
font-size:10px;
color:#7fa896;
opacity:.75;
margin-top:7px
}
.controls{
display:flex;
align-items:center;
justify-content:center;
gap:18px;
margin-top:13px;
position:relative;
z-index:5
}
.side-btn{
width:38px;
height:38px;
border:0;
background:transparent;
color:#b9ffd9;
display:flex;
align-items:center;
justify-content:center;
padding:0;
opacity:.85;
cursor:pointer;
position:relative;
z-index:6;
touch-action:manipulation
}
.side-btn svg{
width:19px;
height:19px;
fill:none;
stroke:currentColor;
stroke-width:2;
stroke-linecap:round;
stroke-linejoin:round;
pointer-events:none
}
.bottom{
display:flex;
align-items:center;
justify-content:space-between;
margin-top:15px;
gap:12px;
position:relative;
z-index:5
}
.bottom-left,
.bottom-right{
display:flex;
align-items:center;
gap:9px
}
.volume{
width:85px
}
.debug-wrap{
margin-top:12px;
background:#0b1512;
border:1px solid rgba(34,211,238,.16);
border-radius:16px;
padding:12px;
font-family:monospace
}
.debug-head{
display:flex;
align-items:center;
justify-content:space-between;
margin-bottom:8px
}
.debug-title{
font-size:11px;
font-weight:700;
letter-spacing:.8px;
color:#67e8f9;
opacity:.9
}
.debug-state{
font-size:10px;
font-weight:700;
padding:3px 8px;
border-radius:20px;
background:rgba(0,255,136,.10);
color:#5cffb0;
letter-spacing:.5px
}
.debug-server{
font-size:9px;
color:#7fa896;
opacity:.6;
word-break:break-all;
margin-bottom:8px;
line-height:1.4
}
.debug-grid{
display:grid;
grid-template-columns:repeat(3,1fr);
gap:6px;
margin-bottom:8px
}
.debug-cell{
background:rgba(0,255,136,.05);
border-radius:8px;
padding:6px 8px
}
.debug-cell span{
display:block;
font-size:8px;
color:#7fa896;
opacity:.7;
letter-spacing:.5px
}
.debug-cell b{
display:block;
font-size:11px;
color:#eafff5;
margin-top:2px;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis
}
.debug-bar{
height:4px;
border-radius:4px;
background:rgba(0,255,136,.10);
overflow:hidden;
margin-bottom:8px
}
.debug-bar-fill{
height:100%;
width:0;
background:linear-gradient(90deg,#00ff88,#22d3ee);
transition:width .3s
}
.debug-log{
height:110px;
overflow-y:auto;
background:rgba(0,0,0,.35);
border-radius:8px;
padding:6px 8px;
font-size:9px;
line-height:1.6;
color:#9be8c4;
word-break:break-all;
-webkit-overflow-scrolling:touch
}
.log-line{
white-space:pre-wrap
}
.aurora-foot{
margin-top:12px;
text-align:center;
display:flex;
flex-direction:column;
gap:3px
}
.made,
.powered{
font-size:11px;
color:rgba(234,255,245,.66)
}
.heart{
display:inline-block;
color:#ff4d6d;
animation:beat 1.1s ease-in-out infinite
}
.brand{
font-weight:800;
background:linear-gradient(90deg,#22d3ee,#818cf8,#00ff88,#22d3ee);
background-size:300% 100%;
-webkit-background-clip:text;
background-clip:text;
-webkit-text-fill-color:transparent;
color:transparent;
animation:shine 4.5s linear infinite
}
.copy{
font-size:9.5px;
color:rgba(234,255,245,.34);
letter-spacing:.8px;
margin-top:2px
}
@keyframes shine{
to{background-position:300% 0}
}
@keyframes beat{
0%,100%{transform:scale(1)}
30%{transform:scale(1.35)}
55%{transform:scale(1)}
75%{transform:scale(1.2)}
}
</style>

<body>
	<div class="player-wrap">
		<div class="aurora-head">
			<span class="aurora-title">AURORA — UR SPECIAL PLAYER</span>
		</div>
		<div class="player">
			<div class="bg" id="background"></div>
			<div class="bg-overlay"></div>
			<div class="content">
				<div class="top">
					<div>
						<div class="top-title" id="playlistTitle">${cfg.isAudio ? 'NOW PLAYING AUDIO' : 'NOW PLAYING VIDEO'}</div>
						<div class="top-sub" id="playlistSub">${escapeHtml(finalTitle)}</div>
					</div>
					<button class="icon-btn" type="button" id="muteButton" aria-label="Mute">
						<svg id="volumeIcon" viewBox="0 0 24 24">
							<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
							<path d="M19 9a5 5 0 0 1 0 6"></path>
							<path d="M16 6.5a9 9 0 0 1 0 11"></path>
						</svg>
					</button>
				</div>

				<div class="video-frame" id="videoFrame">
					<video id="videoPlayer" playsinline webkit-playsinline preload="metadata" poster="${escapeHtml(thumbnailb64)}"></video>
					<audio id="audioPlayer" playsinline webkit-playsinline preload="metadata" style="display:none"></audio>
					<div class="big-play" id="bigPlay">
						<button class="big-btn" type="button" id="bigBtn" aria-label="Play or Pause">
							<svg id="playIcon" viewBox="0 0 24 24">
								<path d="M8 5v14l11-7z"></path>
							</svg>
							<svg id="pauseIcon" viewBox="0 0 24 24" style="display:none">
								<path d="M7 5v14"></path>
								<path d="M17 5v14"></path>
							</svg>
						</button>
					</div>
				</div>

				<div class="info">
					<div class="song-title" id="songTitle">${escapeHtml(cfg.title || 'Unknown Video')}</div>
					<div class="artist" id="artist">${escapeHtml(cfg.channel || 'Unknown Channel')}</div>
				</div>

				<div class="progress">
					<input id="progress" type="range" min="0" max="100" value="0" step="0.1">
					<div class="times">
						<span id="currentTime">0:00</span>
						<span id="duration">${escapeHtml(cfg.duration || '0:00')}</span>
					</div>
				</div>

				<div class="controls">
					<button class="side-btn" type="button" id="prevBtn" aria-label="Mundur 10 detik">
						<svg viewBox="0 0 24 24">
							<path d="M19 20 9 12l10-8v16z"></path>
							<path d="M5 19V5"></path>
						</svg>
					</button>
					<button class="side-btn" type="button" id="playPauseBtn" aria-label="Play atau Pause">
						<svg id="smallPlayIcon" viewBox="0 0 24 24">
							<path d="M8 5v14l11-7z"></path>
						</svg>
						<svg id="smallPauseIcon" viewBox="0 0 24 24" style="display:none">
							<path d="M7 5v14"></path>
							<path d="M17 5v14"></path>
						</svg>
					</button>
					<button class="side-btn" type="button" id="nextBtn" aria-label="Maju 10 detik">
						<svg viewBox="0 0 24 24">
							<path d="m5 4 10 8-10 8V4z"></path>
							<path d="M19 5v14"></path>
						</svg>
					</button>
				</div>

				<div class="bottom">
					<div class="bottom-left">
						<button class="icon-btn" type="button" id="repeatButton" aria-label="Loop">
							<svg viewBox="0 0 24 24">
								<path d="M17 2l4 4-4 4"></path>
								<path d="M3 11V9a3 3 0 0 1 3-3h15"></path>
								<path d="m7 22-4-4 4-4"></path>
								<path d="M21 13v2a3 3 0 0 1-3 3H3"></path>
							</svg>
						</button>
					</div>
					<div class="bottom-right">
						<button class="icon-btn" type="button" id="muteButtonBottom" aria-label="Mute">
							<svg viewBox="0 0 24 24">
								<path d="M11 5 6 9H2v6h4l5 4V5z"></path>
								<path d="m19 9-5 6"></path>
								<path d="m14 9 5 6"></path>
							</svg>
						</button>
						<input class="volume" id="volume" type="range" min="0" max="1" step="0.01" value="1">
					</div>
				</div>
			</div>
		</div>

		<div class="debug-wrap">
			<div class="debug-head">
				<div class="debug-title">MEDIA PROCESS</div>
				<div class="debug-state" id="wsState">CONNECTING</div>
			</div>
			<div class="debug-server" id="wsServer">-</div>
			<div class="debug-grid">
				<div class="debug-cell">
					<span>MIME</span>
					<b id="dbgMime">-</b>
				</div>
				<div class="debug-cell">
					<span>Downloaded</span>
					<b id="dbgDownloaded">0.00 MB</b>
				</div>
				<div class="debug-cell">
					<span>Total</span>
					<b id="dbgTotal">-</b>
				</div>
				<div class="debug-cell">
					<span>Progress</span>
					<b id="dbgProgress">0%</b>
				</div>
				<div class="debug-cell">
					<span>Chunks</span>
					<b id="dbgChunks">0</b>
				</div>
				<div class="debug-cell">
					<span>Loop</span>
					<b id="dbgLoop">OFF</b>
				</div>
			</div>
			<div class="debug-bar">
				<div class="debug-bar-fill" id="dbgBarFill"></div>
			</div>
			<div class="debug-log" id="debugLog"></div>
		</div>

		<div class="aurora-foot">
			<div class="powered">Powered by <span class="brand">${config.botName}</span></div>
			<div class="copy">© <span id="year"></span> - ${config.botName}</div>
		</div>
	</div>

	<script>
(function () {
	var config = ${escapeAttrJson(cfg)};
	try { window.VIDEO_CONFIG = config; } catch (e) {}

	var video = document.getElementById("videoPlayer");
	var audioEl = document.getElementById("audioPlayer");
	var frame = document.getElementById("videoFrame");
	var songTitle = document.getElementById("songTitle");
	var artist = document.getElementById("artist");
	var progress = document.getElementById("progress");
	var currentTime = document.getElementById("currentTime");
	var durationLabel = document.getElementById("duration");
	var volume = document.getElementById("volume");
	var bigBtn = document.getElementById("bigBtn");
	var playPauseBtn = document.getElementById("playPauseBtn");
	var prevBtn = document.getElementById("prevBtn");
	var nextBtn = document.getElementById("nextBtn");
	var playIcon = document.getElementById("playIcon");
	var pauseIcon = document.getElementById("pauseIcon");
	var smallPlayIcon = document.getElementById("smallPlayIcon");
	var smallPauseIcon = document.getElementById("smallPauseIcon");
	var repeatButton = document.getElementById("repeatButton");
	var muteButton = document.getElementById("muteButton");
	var muteButtonBottom = document.getElementById("muteButtonBottom");
	var playlistSub = document.getElementById("playlistSub");
	var background = document.getElementById("background");

	var activeMedia = video;
	var isLoop = Boolean(config.loop);
	var userPressed = false;
	var audioFallbackTried = false;
	var corsFetchAttempted = false;
	var wsAttempted = false;
	var wsVideo = null;
	var wsChunks = [];
	var wsDownloaded = 0;
	var wsTotal = null;
	var wsMime = config.mime || "audio/mpeg";
	var wsObjectUrl = null;
	var wsDone = false;
	var wsLastLog = 0;

	function getMedia() {
		return activeMedia || video;
	}

	function fmtSize(bytes) {
		if (!isFinite(bytes)) return "0 B";
		if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
		if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
		return bytes + " B";
	}

	function formatTime(seconds) {
		if (!isFinite(seconds) || seconds < 0) return "0:00";
		var min = Math.floor(seconds / 60);
		var sec = Math.floor(seconds % 60);
		if (sec < 10) sec = "0" + sec;
		return min + ":" + sec;
	}

	function setWsState(state) {
		var el = document.getElementById("wsState");
		if (el) el.textContent = state;
	}

	function writeLog(line) {
		var box = document.getElementById("debugLog");
		if (!box) return;
		var div = document.createElement("div");
		div.className = "log-line";
		div.textContent = line;
		box.appendChild(div);
		while (box.childNodes.length > 80) {
			box.removeChild(box.firstChild);
		}
		box.scrollTop = box.scrollHeight;
	}

	function updateMuteUI() {
		var m = getMedia();
		var muted = Boolean(m && (m.muted || m.volume === 0));
		if (muteButton) muteButton.classList.toggle("is-muted", muted);
		if (muteButtonBottom) muteButtonBottom.classList.toggle("is-muted", muted);
	}

	function updateLoopUI() {
		var el = document.getElementById("dbgLoop");
		if (el) el.textContent = isLoop ? "ON" : "OFF";
		if (repeatButton) {
			repeatButton.style.opacity = isLoop ? "1" : ".65";
			repeatButton.classList.toggle("is-active", isLoop);
			repeatButton.title = isLoop ? "Loop ON" : "Loop OFF";
		}
	}

	function updateUI() {
		var m = getMedia();
		var paused = !m || m.paused;
		if (smallPlayIcon) smallPlayIcon.style.display = paused ? "block" : "none";
		if (smallPauseIcon) smallPauseIcon.style.display = paused ? "none" : "block";
		if (playIcon) playIcon.style.display = paused ? "block" : "none";
		if (pauseIcon) pauseIcon.style.display = paused ? "none" : "block";
		if (frame) {
			if (paused) frame.classList.remove("frame-playing");
			else frame.classList.add("frame-playing");
		}
		updateMuteUI();
	}

	function syncTimeUI() {
		var m = getMedia();
		if (!m || !isFinite(m.duration) || m.duration <= 0) return;
		var value = (m.currentTime / m.duration) * 100;
		if (progress) progress.value = String(value);
		if (currentTime) currentTime.textContent = formatTime(m.currentTime);
		if (durationLabel) durationLabel.textContent = formatTime(m.duration);
	}

	function updateBufferedUI() {
		var m = getMedia();
		if (!m || !m.buffered || m.buffered.length === 0 || !isFinite(m.duration) || m.duration <= 0) return;
		var end = m.buffered.end(m.buffered.length - 1);
		var pct = Math.min(100, Math.max(0, (end / m.duration) * 100));
		var el = document.getElementById("dbgProgress");
		if (el && !wsDone && !corsFetchAttempted) el.textContent = pct.toFixed(0) + "%";
		el = document.getElementById("dbgBarFill");
		if (el && !wsDone && !corsFetchAttempted) el.style.width = pct.toFixed(1) + "%";
	}

	function updateWsProgress() {
		var el = document.getElementById("dbgDownloaded");
		if (el) el.textContent = fmtSize(wsDownloaded);
		if (wsTotal !== null && wsTotal > 0) {
			var pct = Math.min(100, (wsDownloaded / wsTotal) * 100);
			el = document.getElementById("dbgTotal");
			if (el) el.textContent = fmtSize(wsTotal);
			el = document.getElementById("dbgProgress");
			if (el) el.textContent = pct.toFixed(1) + "%";
			el = document.getElementById("dbgBarFill");
			if (el) el.style.width = pct.toFixed(1) + "%";
		}
		el = document.getElementById("dbgChunks");
		if (el) el.textContent = String(wsChunks.length);
	}

	function syncMediaSettings(target) {
		if (!target) return;
		var vol = volume ? Number(volume.value) : (config.volume !== undefined ? config.volume : 0.8);
		target.volume = isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.8;
		target.loop = isLoop;
		target.muted = activeMedia ? activeMedia.muted : false;
	}

	function playMediaNow() {
		var m = getMedia();
		if (!m) return;
		if (!m.src && config.videoUrl) {
			m.src = config.videoUrl;
		}
		try {
			var result = m.play();
			if (result && typeof result.then === "function") {
				result.then(function () {
					setWsState("PLAYING");
					updateUI();
				}).catch(function (err) {
					var msg = err && err.message ? err.message : String(err || "play rejected");
					writeLog("Play gagal: " + msg);
					setWsState("PLAY BLOCKED");
					updateUI();
				});
			}
		} catch (err) {
			writeLog("Play error: " + (err && err.message ? err.message : err));
			setWsState("PLAY ERROR");
		}
		updateUI();
	}

	function toggleVideo() {
		var m = getMedia();
		if (!m) return;
		if (m.paused) {
			userPressed = true;
			writeLog("Tombol Play ditekan");
			playMediaNow();
		} else {
			userPressed = false;
			m.pause();
			setWsState("PAUSED");
			writeLog("Paused");
			updateUI();
		}
	}

	function previousVideo() {
		var m = getMedia();
		if (!m || !isFinite(m.duration) || m.duration <= 0) {
			writeLog("Media belum siap (-10s menunggu durasi)");
			return;
		}
		m.currentTime = Math.max(0, m.currentTime - 10);
		syncTimeUI();
		writeLog("Mundur -10s -> " + formatTime(m.currentTime));
	}

	function nextVideo() {
		var m = getMedia();
		if (!m || !isFinite(m.duration) || m.duration <= 0) {
			writeLog("Media belum siap (+10s menunggu durasi)");
			return;
		}
		m.currentTime = Math.min(m.duration, m.currentTime + 10);
		syncTimeUI();
		writeLog("Maju +10s -> " + formatTime(m.currentTime));
	}

	function seekVideo(value) {
		var m = getMedia();
		if (!m || !isFinite(m.duration) || m.duration <= 0) return;
		m.currentTime = (Number(value) / 100) * m.duration;
		syncTimeUI();
	}

	function changeVolume(value) {
		var val = Math.min(1, Math.max(0, Number(value)));
		if (!isFinite(val)) return;
		video.volume = val;
		if (audioEl) audioEl.volume = val;
		if (val > 0) {
			video.muted = false;
			if (audioEl) audioEl.muted = false;
		}
		updateMuteUI();
	}

	function toggleMute() {
		var m = getMedia();
		var nextMuted = !m.muted;
		video.muted = nextMuted;
		if (audioEl) audioEl.muted = nextMuted;
		updateMuteUI();
		writeLog(nextMuted ? "Mute ON" : "Mute OFF");
	}

	function toggleRepeat() {
		isLoop = !isLoop;
		video.loop = isLoop;
		if (audioEl) audioEl.loop = isLoop;
		updateLoopUI();
		writeLog(isLoop ? "Loop ON" : "Loop OFF");
	}

	function finishBlobDownload(mimeType) {
		if (wsDone || !wsChunks.length || wsDownloaded <= 0) return;
		wsDone = true;
		setWsState("COMPLETE");
		writeLog("Download complete (" + fmtSize(wsDownloaded) + ")");
		var blob = new Blob(wsChunks, { type: mimeType || config.mime || "audio/mpeg" });
		if (wsObjectUrl) URL.revokeObjectURL(wsObjectUrl);
		wsObjectUrl = URL.createObjectURL(blob);
		wsChunks = [];
		var m = getMedia();
		m.src = wsObjectUrl;
		m.load();
		writeLog("Blob attached to player");
		if (userPressed) playMediaNow();
	}

	function startCorsFetchFallback() {
		if (corsFetchAttempted || !config.videoUrl || typeof fetch !== "function") {
			if (!wsAttempted && config.wsUrl) startWsProxy(config);
			return;
		}
		corsFetchAttempted = true;
		wsChunks = [];
		wsDownloaded = 0;
		wsTotal = null;
		wsDone = false;
		setWsState("FETCH BLOB");
		writeLog("Coba download via fetch...");
		fetch(config.videoUrl, { mode: "cors" })
			.then(function (res) {
				if (!res.ok) throw new Error("HTTP " + res.status);
				var ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
				if (ct && ct !== "application/octet-stream") wsMime = ct;
				var cl = Number(res.headers.get("content-length") || 0);
				if (cl > 0) wsTotal = cl;
				updateWsProgress();
				if (res.body && typeof res.body.getReader === "function") {
					var reader = res.body.getReader();
					function pump() {
						return reader.read().then(function (step) {
							if (step.done) {
								finishBlobDownload(wsMime);
								return;
							}
							var val = step.value;
							if (val && val.byteLength) {
								wsChunks.push(val);
								wsDownloaded += val.byteLength;
								updateWsProgress();
							}
							return pump();
						});
					}
					return pump();
				}
				return res.arrayBuffer().then(function (buf) {
					wsChunks.push(buf);
					wsDownloaded += buf.byteLength;
					updateWsProgress();
					finishBlobDownload(wsMime);
				});
			})
			.catch(function (err) {
				writeLog("Fetch fallback gagal: " + (err && err.message ? err.message : "CORS/net"));
				if (!wsAttempted && config.wsUrl) startWsProxy(config);
				else setWsState("ERROR");
			});
	}

	function startWsProxy(cfg) {
		wsAttempted = true;
		var wsUrl = cfg.wsUrl || "";
		if (!wsUrl || typeof WebSocket === "undefined") {
			setWsState("ERROR");
			return;
		}
		wsChunks = [];
		wsDownloaded = 0;
		wsTotal = null;
		wsDone = false;
		writeLog("Connecting WS proxy...");
		setWsState("CONNECTING WS");
		try {
			wsVideo = new WebSocket(wsUrl);
		} catch (e) {
			writeLog("WS init gagal: " + e.message);
			setWsState("WS ERROR");
			return;
		}
		wsVideo.binaryType = "arraybuffer";
		var wsHandshakeTimer = setTimeout(function () {
			if (!wsDone && wsDownloaded === 0) {
				try { wsVideo.close(); } catch (e) {}
				writeLog("WS proxy timeout");
				setWsState("WS TIMEOUT");
			}
		}, 10000);
		wsVideo.onopen = function () {
			writeLog("WebSocket OPEN");
			setWsState("CONNECTED");
		};
		wsVideo.onmessage = function (event) {
			if (typeof event.data === "string") {
				var message = null;
				try { message = JSON.parse(event.data); } catch (e) {}
				if (!message) return;
				if (message.type === "start") {
					clearTimeout(wsHandshakeTimer);
					if (message.mime && message.mime !== "application/octet-stream") wsMime = message.mime;
					if (message.contentLength != null) wsTotal = Number(message.contentLength);
					var mimeEl = document.getElementById("dbgMime");
					if (mimeEl) mimeEl.textContent = wsMime;
					setWsState("DOWNLOADING");
					updateWsProgress();
					return;
				}
				if (message.type === "end") {
					clearTimeout(wsHandshakeTimer);
					finishBlobDownload(wsMime);
					try { wsVideo.close(); } catch (e) {}
					return;
				}
				if (message.type === "error") {
					clearTimeout(wsHandshakeTimer);
					writeLog("WS error: " + (message.message || "unknown"));
					setWsState("WS ERROR");
					return;
				}
				return;
			}
			clearTimeout(wsHandshakeTimer);
			wsChunks.push(event.data);
			var bytes = event.data.byteLength || 0;
			wsDownloaded += bytes;
			var now = Date.now();
			if (now - wsLastLog > 400) {
				wsLastLog = now;
				writeLog("Binary chunk: " + fmtSize(bytes));
			}
			updateWsProgress();
		};
		wsVideo.onerror = function () {
			clearTimeout(wsHandshakeTimer);
			writeLog("WebSocket error");
			if (!wsDone) setWsState("WS ERROR");
		};
		wsVideo.onclose = function (event) {
			clearTimeout(wsHandshakeTimer);
			if (!wsDone) writeLog("WebSocket closed (" + event.code + ")");
		};
	}

	function handleMediaError(el) {
		if (el !== activeMedia) return;
		var code = el.error ? el.error.code : 0;
		writeLog("Media element error (code=" + code + ")");

		if (config.isAudio && activeMedia === video && audioEl && !audioFallbackTried && config.videoUrl) {
			audioFallbackTried = true;
			try { video.pause(); video.removeAttribute("src"); } catch (e) {}
			activeMedia = audioEl;
			syncMediaSettings(audioEl);
			audioEl.src = config.videoUrl;
			writeLog("Switch ke <audio> player fallback...");
			setWsState("AUDIO MODE");
			if (userPressed) playMediaNow();
			return;
		}

		if (!corsFetchAttempted) {
			startCorsFetchFallback();
		} else if (!wsAttempted && config.wsUrl) {
			startWsProxy(config);
		} else {
			setWsState("MEDIA ERROR");
		}
	}

	function attachMediaListeners(el) {
		if (!el) return;
		el.addEventListener("loadedmetadata", function () {
			if (el !== activeMedia) return;
			syncTimeUI();
			updateBufferedUI();
			setWsState(el.paused ? "READY" : "PLAYING");
			writeLog("Metadata siap (" + formatTime(el.duration) + ")");
		});
		el.addEventListener("durationchange", function () {
			if (el === activeMedia) syncTimeUI();
		});
		el.addEventListener("canplay", function () {
			if (el === activeMedia && el.paused) setWsState("READY");
		});
		el.addEventListener("progress", function () {
			if (el === activeMedia) updateBufferedUI();
		});
		el.addEventListener("timeupdate", function () {
			if (el === activeMedia) syncTimeUI();
		});
		el.addEventListener("playing", function () {
			if (el !== activeMedia) return;
			setWsState("PLAYING");
			updateUI();
		});
		el.addEventListener("waiting", function () {
			if (el === activeMedia) setWsState("BUFFERING");
		});
		el.addEventListener("play", function () {
			if (el === activeMedia) updateUI();
		});
		el.addEventListener("pause", function () {
			if (el === activeMedia) updateUI();
		});
		el.addEventListener("ended", function () {
			if (el !== activeMedia) return;
			if (!isLoop) {
				if (progress) progress.value = "0";
				if (currentTime) currentTime.textContent = "0:00";
				el.currentTime = 0;
				setWsState("ENDED");
			}
			updateUI();
		});
		el.addEventListener("error", function () {
			handleMediaError(el);
		});
	}

	function bindControls() {
		if (bigBtn) {
			bigBtn.addEventListener("click", function (e) {
				e.stopPropagation();
				toggleVideo();
			});
		}
		if (frame) {
			frame.addEventListener("click", function (e) {
				if (e.target && e.target.closest && e.target.closest("#bigBtn")) return;
				toggleVideo();
			});
		}
		if (playPauseBtn) {
			playPauseBtn.addEventListener("click", function (e) {
				e.stopPropagation();
				toggleVideo();
			});
		}
		if (prevBtn) {
			prevBtn.addEventListener("click", function (e) {
				e.stopPropagation();
				previousVideo();
			});
		}
		if (nextBtn) {
			nextBtn.addEventListener("click", function (e) {
				e.stopPropagation();
				nextVideo();
			});
		}
		if (repeatButton) {
			repeatButton.addEventListener("click", function (e) {
				e.stopPropagation();
				toggleRepeat();
			});
		}
		if (muteButton) {
			muteButton.addEventListener("click", function (e) {
				e.stopPropagation();
				toggleMute();
			});
		}
		if (muteButtonBottom) {
			muteButtonBottom.addEventListener("click", function (e) {
				e.stopPropagation();
				toggleMute();
			});
		}
		if (progress) {
			progress.addEventListener("input", function () { seekVideo(this.value); });
			progress.addEventListener("change", function () { seekVideo(this.value); });
		}
		if (volume) {
			volume.addEventListener("input", function () { changeVolume(this.value); });
			volume.addEventListener("change", function () { changeVolume(this.value); });
		}
	}

	function init() {
		if (songTitle) songTitle.textContent = config.title || "Unknown Video";
		if (artist) artist.textContent = config.channel || "Unknown Channel";
		if (playlistSub) playlistSub.textContent = config.title || "Unknown Video";
		if (config.duration && durationLabel) durationLabel.textContent = config.duration;

		var yearEl = document.getElementById("year");
		if (yearEl) yearEl.textContent = String(new Date().getFullYear());

		if (video.poster && background) {
			background.style.backgroundImage = "url('" + video.poster + "')";
		}

		if (config.volume !== undefined && volume) {
			volume.value = String(config.volume);
		}
		syncMediaSettings(video);
		updateLoopUI();
		updateUI();

		var mimeEl = document.getElementById("dbgMime");
		if (mimeEl) mimeEl.textContent = wsMime;
		var serverEl = document.getElementById("wsServer");
		if (serverEl) {
			var host = "-";
			try { host = new URL(config.videoUrl || config.wsUrl).host; } catch (e) {}
			serverEl.textContent = host || "-";
		}

		attachMediaListeners(video);
		attachMediaListeners(audioEl);
		bindControls();

		if (config.videoUrl) {
			video.src = config.videoUrl;
			setWsState("STREAM READY");
			writeLog("Stream langsung terpasang (" + wsMime + ")");
			if (config.autoplay) {
				userPressed = true;
				playMediaNow();
			}
		} else if (config.wsUrl) {
			startWsProxy(config);
		} else {
			setWsState("ERROR");
			writeLog("No media URL tersedia");
		}

		window.addEventListener("beforeunload", function () {
			if (wsVideo) { try { wsVideo.close(); } catch (e) {} }
			if (wsObjectUrl) { URL.revokeObjectURL(wsObjectUrl); }
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
</script>
</body>`;

  return htmlPayload;
}

export default {
  name: 'aurora',
  aliases: ['splay', 'streamplay', 'deck', 'vplay'],
  tags: 'downloader',
  description: 'Aurora Deck — Player Music/Video',

  async run(ctx) {
    let query = (ctx.text || '').trim();
    if (!query) {
      return ctx.reply(
        '🎧 *AURORA — UR SPECIAL PLAYER*\n\n' +
        '`.aurora <judul>` — audio mp3\n' +
        '`.aurora <judul> 720` — video\n' +
        '`.aurora <url youtube>` — direct'
      );
    }

    let customFormat = null;
    const mFmt = query.match(/^(.*?)\s+(mp3|m4a|144|240|360|480|720|1080|1440|2160)$/i);
    if (mFmt) { customFormat = mFmt[2].toLowerCase(); query = mFmt[1].trim(); }
    const format = customFormat || 'mp3';

    await ctx.react('🎧');

    try {
      let info;
      if (/^https?:\/\//i.test(query)) {
        info = { url: query, title: 'Aurora Stream', artist: `${config.botName} Stream`, thumbnail: '', duration: '' };
      } else {
        const results = await ytSearch(query);
        const v = results[0];
        info = {
          url: v.url,
          title: v.title || 'Unknown',
          artist: v.artist || `${config.botName} Stream`,
          thumbnail: v.thumbnail || '',
          duration: v.duration || ''
        };
      }
      if (!info?.url) throw new Error('URL YouTube gak ketemu');

      const data = await ytDownload(info.url, format);
      if (!data?.url) throw new Error('Link final gak dapet');

      const finalTitle = data.title || info.title || 'Unknown Video';
      const finalChannel = info.artist || 'Unknown Channel';
      const finalDuration = data.duration || info.duration || '';
      const mime = inferMimeFromFormat(format, data.url);
      const isAudio = mime.startsWith('audio/');
      const thumbnailb64 = await thumbDataUri(data.thumbnail || info.thumbnail);

      const wsUrl = WS_WORKER
        ? `${WS_WORKER}?url=${encodeURIComponent(data.url)}&mime=${encodeURIComponent(mime)}`
        : '';

      const htmlPayload = buildHtml({
        finalTitle,
        finalChannel,
        finalDuration,
        videoUrl: data.url,
        thumbnailb64,
        wsUrl,
        mime,
        isAudio
      });

      const sent = await sendRichHtml(ctx, htmlPayload);

      console.log('[Aurora] sent via richHtml | id=' + (sent?.id || '?'));
      await ctx.react('🎛️');
    } catch (e) {
      await ctx.react('❎');
      ctx.reply('*Aurora Error:* ' + String(e.message || e).slice(0, 250));
    }
  }
};
