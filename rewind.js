// NAME: Vinyl Rewind
// AUTHOR: Parker
// VERSION: 1.0.0
// DESCRIPTION: A fullscreen spinning record for Spotify. Grab and turn it to rewind or fast-forward the song like a real turntable.

(function VinylRewind() {
  const ButtonApi = window.Spicetify && ((Spicetify.Playbar && Spicetify.Playbar.Button) || (Spicetify.Topbar && Spicetify.Topbar.Button));
  if (!window.Spicetify || !Spicetify.Player || !Spicetify.Player.origin || !Spicetify.SVGIcons || !ButtonApi || !document.body) {
    setTimeout(VinylRewind, 300);
    return;
  }
  // never run twice (e.g. the file is listed twice, or reloaded by another extension manager)
  if (document.getElementById("vr-overlay")) return;

  // Record spins at 2.5 RPM (15 deg/s); one full turn = 24 seconds of the song.
  const DEG_PER_SEC = 15;
  const PERIOD_MS = (360 / DEG_PER_SEC) * 1000;
  const HAND_STILL_MS = 35; // no pointer movement for this long = hand is holding the record still
  const SEEK_STEP = 5; // seconds per arrow-key press

  // ---------- settings (Settings > Vinyl mode) ----------
  const SETTINGS_KEY = "vinyl-rewind:settings";
  const SETTINGS_DEFAULTS = {
    reduceMotion: !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches),
    sound: true,
    idle: true,
    texture: true,
    homeTip: true,
  };
  const settings = { ...SETTINGS_DEFAULTS };
  try {
    const saved = JSON.parse((Spicetify.LocalStorage ? Spicetify.LocalStorage.get(SETTINGS_KEY) : localStorage.getItem(SETTINGS_KEY)) || "{}");
    for (const k of Object.keys(SETTINGS_DEFAULTS)) if (typeof saved[k] === "boolean") settings[k] = saved[k];
  } catch {}

  function saveSettings() {
    try {
      const v = JSON.stringify(settings);
      Spicetify.LocalStorage ? Spicetify.LocalStorage.set(SETTINGS_KEY, v) : localStorage.setItem(SETTINGS_KEY, v);
    } catch {}
  }

  // ---------- styles ----------
  const style = document.createElement("style");
  style.id = "vinyl-rewind-style";
  style.textContent = `
body.vr-open > *:not(#vr-overlay) { visibility: hidden !important; }
.vr-playbar-btn {
  background: transparent !important; border: none !important; box-shadow: none !important;
  width: 32px !important; height: 32px !important; padding: 0 !important; border-radius: 50% !important;
  display: inline-flex !important; align-items: center; justify-content: center;
  color: var(--spice-subtext, #b3b3b3) !important; opacity: 1 !important; cursor: pointer;
  transition: color 0.1s, transform 0.1s;
}
.vr-playbar-btn:hover { color: var(--spice-text, #fff) !important; transform: scale(1.06); }
.vr-playbar-btn.main-genericButton-buttonActive { color: #1ed760 !important; }
.vr-playbar-btn span { display: flex; }
/* registered so the album color can fade smoothly between songs */
@property --vr-c { syntax: "<color>"; inherits: true; initial-value: #2a5db0; }
#vr-overlay {
  --vr-c: #2a5db0;
  transition: --vr-c 0.9s ease;
  --D: min(58vh, 72vw);
  position: fixed; inset: 0; z-index: 99999;
  display: none; flex-direction: column; align-items: center; justify-content: center;
  background:
    radial-gradient(ellipse at 50% 35%, color-mix(in srgb, var(--vr-c) 88%, #fff) 0%, var(--vr-c) 55%, color-mix(in srgb, var(--vr-c) 80%, #000) 100%);
  color: #fff; user-select: none; overflow: hidden;
  contain: strict;
}
#vr-overlay.open { display: flex; animation: vr-fade 0.2s ease-out; }
@keyframes vr-fade { from { opacity: 0; } to { opacity: 1; } }

#vr-overlay .vr-close {
  position: absolute; top: 80px; right: 28px; width: 40px; height: 40px;
  background: none; border: none; color: #fff; cursor: pointer; opacity: 0.9;
  display: flex; align-items: center; justify-content: center; border-radius: 50%;
}
#vr-overlay .vr-full { right: 76px; }
/* Windows draws its min/max/close buttons over the top-right corner; in full screen they are gone */
body:fullscreen #vr-overlay .vr-close, :fullscreen #vr-overlay .vr-close { top: 28px; }
#vr-overlay .vr-close:hover { opacity: 1; background: rgba(255,255,255,0.12); }

/* .vr-disc-slot reserves layout space. The disc itself is drawn 1.3x larger and scaled down,
   so growing it in idle mode stays sharp. Only .vr-spin rotates (GPU layer, rasterized once). */
#vr-overlay .vr-disc-slot { position: relative; width: var(--D); height: var(--D); flex: none; }
#vr-overlay .vr-disc {
  position: absolute; left: 50%; top: 50%;
  width: calc(var(--D) * 1.3); height: calc(var(--D) * 1.3);
  margin: calc(var(--D) * -0.65) 0 0 calc(var(--D) * -0.65);
  border-radius: 50%;
  box-shadow: 0 23px 65px rgba(0,0,0,0.35), 0 5px 16px rgba(0,0,0,0.25);
  cursor: grab; touch-action: none;
  transform: scale(0.769231);
  transition: transform 1.1s cubic-bezier(0.22, 0.8, 0.2, 1);
}
/* crumpled-paper texture over the background color. Two layers crossfade on song change,
   each showing a different flip/offset of the same paper so every song looks a little different. */
#vr-overlay .vr-crinkle {
  position: absolute; inset: -15%; z-index: -1; pointer-events: none;
  background: center / cover no-repeat;
  mix-blend-mode: soft-light; opacity: 0;
  transition: opacity 0.9s ease;
}
#vr-overlay .vr-crinkle.on { opacity: 0.03; }
#vr-overlay.vr-instant, #vr-overlay.vr-instant .vr-crinkle { transition: none !important; }
/* idle: everything but the record and the progress bar fades away */
#vr-overlay .vr-progress { transition: transform 1.1s cubic-bezier(0.22, 0.8, 0.2, 1); }
#vr-overlay .vr-meta, #vr-overlay .vr-controls, #vr-overlay .vr-close, #vr-overlay .vr-time { transition: opacity 0.45s ease; }
#vr-overlay.idle .vr-meta, #vr-overlay.idle .vr-controls, #vr-overlay.idle .vr-close, #vr-overlay.idle .vr-time { opacity: 0; pointer-events: none; }
#vr-overlay.idle, #vr-overlay.idle * { cursor: none !important; }
#vr-overlay .vr-disc.grabbing { cursor: grabbing; }
#vr-overlay .vr-spin {
  position: absolute; inset: 0; border-radius: 50%;
  will-change: transform; backface-visibility: hidden; transform: translateZ(0);
}
#vr-overlay .vr-spin img {
  width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%;
  pointer-events: none; -webkit-user-drag: none;
}
/* no cover art (local files, some podcasts): a plain black record with grooves and a label */
#vr-overlay .vr-spin {
  background:
    radial-gradient(circle, color-mix(in srgb, var(--vr-c) 70%, #fff) 0 17%, transparent 17.3%),
    repeating-radial-gradient(circle, #111 0 2px, #1b1b1b 2.5px 4px),
    #111;
}
#vr-overlay .vr-spin.has-cover { background: #111; }
#vr-overlay .vr-hole {
  position: absolute; left: 50%; top: 50%; width: 7.5%; height: 7.5%;
  transform: translate(-50%, -50%); border-radius: 50%;
  background: #000; pointer-events: none;
}

#vr-overlay .vr-meta { margin-top: calc(var(--D) * 0.1); text-align: center; max-width: 80vw; }
#vr-overlay .vr-title { font-size: 34px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vr-overlay .vr-artist { font-size: 21px; opacity: 0.6; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

#vr-overlay .vr-progress { display: flex; align-items: center; gap: 16px; margin-top: 22px; width: min(700px, 86vw); }
#vr-overlay .vr-time { font-size: 17px; font-variant-numeric: tabular-nums; min-width: 44px; opacity: 0.95; }
#vr-overlay .vr-time.cur { text-align: right; }
#vr-overlay .vr-bar { position: relative; flex: 1; height: 20px; cursor: pointer; touch-action: none; }
#vr-overlay .vr-track, #vr-overlay .vr-fill {
  position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px;
}
#vr-overlay .vr-track { background: rgba(255,255,255,0.35); }
#vr-overlay .vr-fill { background: #fff; transform-origin: 0 50%; transform: scaleX(0); will-change: transform; }
#vr-overlay .vr-thumb-rail { position: absolute; inset: 0; will-change: transform; pointer-events: none; }
#vr-overlay .vr-thumb {
  position: absolute; left: 0; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}

#vr-overlay .vr-controls { display: flex; align-items: center; gap: 40px; margin-top: 18px; }
#vr-overlay .vr-ctl {
  background: none; border: none; color: #fff; cursor: pointer; padding: 6px; opacity: 0.95;
  display: flex; align-items: center; justify-content: center; position: relative;
  transition: transform 0.08s ease-out;
}
#vr-overlay .vr-ctl:hover { opacity: 1; }
#vr-overlay .vr-ctl:active { transform: scale(0.94); }
#vr-overlay .vr-ctl.off { opacity: 0.55; }
#vr-overlay .vr-ctl:disabled { opacity: 0.25; cursor: default; transform: none; }
#vr-overlay .vr-disc.locked { cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) {
  #vr-overlay, #vr-overlay .vr-disc, #vr-overlay .vr-progress, #vr-overlay .vr-crinkle { transition-duration: 0.01s !important; }
}
#vr-overlay .vr-ctl.on::after {
  content: ""; position: absolute; bottom: -4px; left: 50%; width: 5px; height: 5px; margin-left: -2.5px;
  border-radius: 50%; background: #fff;
}
#vr-overlay .vr-play {
  width: 84px; height: 84px; border-radius: 50%; background: #fff;
  color: color-mix(in srgb, var(--vr-c) 55%, #000); opacity: 1;
  box-shadow: 0 6px 18px rgba(0,0,0,0.2);
}
#vr-overlay .vr-controls { position: relative; }
/* compact speaker icon that slides open into a slider on hover */
#vr-overlay .vr-volume {
  position: absolute; left: calc(100% + 32px); top: 50%; margin-top: -20px;
  box-sizing: border-box; height: 42px; width: 42px; padding: 0 10px;
  display: flex; align-items: center; gap: 12px; overflow: hidden;
  border-radius: 20px; background: rgba(255,255,255,0);
  transition: width 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.2s;
}
#vr-overlay .vr-volume:hover, #vr-overlay .vr-volume.dragging { width: 184px; background: rgba(255,255,255,0.12); }
#vr-overlay .vr-vol-btn { flex: none; width: 22px; background: none; border: none; color: #fff; cursor: pointer; padding: 0; opacity: 0.85; display: flex; }
#vr-overlay .vr-vol-btn:hover { opacity: 1; }
#vr-overlay .vr-vol-bar {
  position: relative; flex: none; width: 128px; height: 20px; cursor: pointer; touch-action: none;
  opacity: 0; transition: opacity 0.15s;
}
#vr-overlay .vr-volume:hover .vr-vol-bar, #vr-overlay .vr-volume.dragging .vr-vol-bar { opacity: 1; }
#vr-overlay svg { display: block; }
/* keyboard focus */
#vr-overlay button:focus-visible, #vr-overlay .vr-disc:focus-visible, #vr-overlay .vr-bar:focus-visible, #vr-overlay .vr-vol-bar:focus-visible {
  outline: 2px solid #fff; outline-offset: 4px;
}
#vr-overlay button:focus:not(:focus-visible), #vr-overlay .vr-disc:focus:not(:focus-visible), #vr-overlay .vr-bar:focus:not(:focus-visible) { outline: none; }
#vr-overlay .vr-volume:focus-within { width: 184px; background: rgba(255,255,255,0.12); }
#vr-overlay .vr-volume:focus-within .vr-vol-bar { opacity: 1; }
/* settings */
#vr-overlay.no-texture .vr-crinkle { display: none; }
#vr-overlay.reduce-motion, #vr-overlay.reduce-motion * { transition-duration: 0.01s !important; animation-duration: 0.01s !important; }
.vr-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* Home: our card sits under Spotify's own Getting started card */
.vr-home-card { margin-top: 12px; }
.vr-home-card .vr-home-art { animation: vr-home-spin 14s linear infinite; border-radius: 50%; }
.vr-home-card:hover .vr-home-art { animation-duration: 4s; }
@keyframes vr-home-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .vr-home-card .vr-home-art { animation: none; } }
.vr-home-card.reduce-motion .vr-home-art { animation: none; }
#vr-settings .x-settings-firstColumn { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
#vr-settings .vr-note { opacity: 0.8; }
.vr-settings-keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin-top: 4px; }
.vr-settings-keys kbd {
  font: inherit; font-size: 12px; padding: 1px 6px; border-radius: 4px; white-space: nowrap;
  background: var(--background-tinted-base, rgba(255,255,255,0.1)); color: var(--text-base, #fff); justify-self: start;
}
`;
  document.head.appendChild(style);

  const icon = (name, size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons[name] || ""}</svg>`;
  const FS_ENTER = `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h5v1.5H2.5V6H1V1zm9 0h5v5h-1.5V2.5H10V1zM1 10h1.5v3.5H6V15H1v-5zm13.5 0H15v5h-5v-1.5h3.5V10z"/></svg>`;
  const FS_EXIT = `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 1H6v5H1V4.5h3.5V1zm5 0H11v3.5h3.5V6h-5V1zM1 10h5v5H4.5v-3.5H1V10zm8.5 0h5v1.5H11V15H9.5v-5z"/></svg>`;

  // ---------- DOM ----------
  const overlay = document.createElement("div");
  overlay.id = "vr-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Vinyl mode");
  overlay.innerHTML = `
    <div class="vr-crinkle"></div><div class="vr-crinkle"></div>
    <button class="vr-close vr-full" data-act="fullscreen"></button>
    <button class="vr-close" data-act="close" aria-label="Close" title="Close">${icon("x", 22)}</button>
    <div class="vr-disc-slot"><div class="vr-disc" tabindex="0" role="slider" aria-label="Record. Turn to rewind or fast-forward" aria-valuemin="0">
      <div class="vr-spin">
        <img alt="" />
      </div>
      <div class="vr-hole"></div>
    </div></div>
    <div class="vr-meta">
      <div class="vr-title"></div>
      <div class="vr-artist"></div>
    </div>
    <div class="vr-progress">
      <span class="vr-time cur">0:00</span>
      <div class="vr-bar" tabindex="0" role="slider" aria-label="Song position" aria-valuemin="0">
        <div class="vr-track"></div><div class="vr-fill"></div>
        <div class="vr-thumb-rail"><div class="vr-thumb"></div></div>
      </div>
      <span class="vr-time dur">0:00</span>
    </div>
    <div class="vr-controls">
      <button class="vr-ctl" data-act="shuffle" aria-label="Shuffle">${icon("shuffle", 26)}</button>
      <button class="vr-ctl" data-act="prev" aria-label="Previous">${icon("skip-back", 30)}</button>
      <button class="vr-ctl vr-play" data-act="play" aria-label="Play/Pause"></button>
      <button class="vr-ctl" data-act="next" aria-label="Next">${icon("skip-forward", 30)}</button>
      <button class="vr-ctl" data-act="repeat" aria-label="Repeat">${icon("repeat", 26)}</button>
      <div class="vr-volume">
      <button class="vr-vol-btn" data-act="mute" aria-label="Mute"></button>
      <div class="vr-vol-bar" tabindex="0" role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="100">
        <div class="vr-track"></div><div class="vr-fill"></div>
        <div class="vr-thumb-rail"><div class="vr-thumb"></div></div>
      </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (s) => overlay.querySelector(s);
  const crinkleEls = [...overlay.querySelectorAll(".vr-crinkle")];
  crinkleEls.forEach((el) => (el.style.backgroundImage = `url("${crumpleTexture()}")`));
  const discEl = $(".vr-disc");
  const slotEl = $(".vr-disc-slot");
  const progressEl = $(".vr-progress");
  const spinEl = $(".vr-spin");
  const coverImg = $(".vr-spin img");
  const titleEl = $(".vr-title");
  const artistEl = $(".vr-artist");
  const curEl = $(".vr-time.cur");
  const durEl = $(".vr-time.dur");
  const barEl = $(".vr-bar");
  const fillEl = $(".vr-fill");
  const railEl = $(".vr-thumb-rail");
  const playBtn = $('[data-act="play"]');
  const shuffleBtn = $('[data-act="shuffle"]');
  const repeatBtn = $('[data-act="repeat"]');
  const nextBtn = $('[data-act="next"]');
  const fullBtn = $('[data-act="fullscreen"]');
  const muteBtn = $('[data-act="mute"]');
  const volBarEl = $(".vr-vol-bar");
  const volFillEl = $(".vr-vol-bar .vr-fill");
  const volRailEl = $(".vr-vol-bar .vr-thumb-rail");

  // ---------- spin: a compositor-driven animation, so it stays smooth no matter what the page is doing ----------
  const spin = spinEl.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
    duration: PERIOD_MS,
    iterations: Infinity,
    easing: "linear",
  });
  spin.pause();

  const getAngle = () => (((spin.currentTime || 0) % PERIOD_MS) / PERIOD_MS) * 360;
  const setAngle = (a) => { spin.currentTime = ((((a % 360) + 360) % 360) / 360) * PERIOD_MS; };

  function setSpinning(on) {
    if (settings.reduceMotion) on = false;
    if (on && spin.playState !== "running") spin.play();
    else if (!on && spin.playState === "running") spin.pause();
  }

  // ---------- track info & background color ----------
  function currentItem() {
    const d = Spicetify.Player.data;
    return d ? d.item || d.track : null;
  }

  function imageUrl(meta) {
    const raw = meta && (meta.image_xlarge_url || meta.image_large_url || meta.image_url);
    if (!raw) return "";
    return raw.startsWith("spotify:image:") ? "https://i.scdn.co/image/" + raw.slice(14) : raw;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }

  // Dominant color of the cover (favoring colorful areas), clamped so white text stays readable.
  function dominantColor(bmp) {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0, 48, 48);
    const px = ctx.getImageData(0, 0, 48, 48).data;
    const bins = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const [, s, l] = rgbToHsl(r, g, b);
      const w = 0.25 + s * (1 - Math.abs(l - 0.5) * 1.6);
      const e = bins.get(key) || { w: 0, r: 0, g: 0, b: 0, n: 0 };
      e.w += Math.max(0.05, w); e.r += r; e.g += g; e.b += b; e.n++;
      bins.set(key, e);
    }
    let best = null;
    for (const e of bins.values()) if (!best || e.w > best.w) best = e;
    let [h, s, l] = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n);
    l = Math.min(0.46, Math.max(0.2, l));
    s = Math.min(0.85, s);
    return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  // Cover art + its color are prepared together (and cached), then swapped in on the same frame.
  const coverCache = new Map(); // image url -> Promise<{ src, color }>

  function loadCover(url) {
    let p = coverCache.get(url);
    if (!p) {
      p = (async () => {
        const blob = await (await fetch(url)).blob();
        const bmp = await createImageBitmap(blob);
        const color = dominantColor(bmp);
        bmp.close?.();
        const src = URL.createObjectURL(blob);
        const img = new Image();
        img.src = src;
        try { await img.decode(); } catch {}
        return { src, color };
      })();
      p.catch(() => coverCache.delete(url));
      coverCache.set(url, p);
      if (coverCache.size > 24) {
        const [oldUrl, oldP] = coverCache.entries().next().value;
        coverCache.delete(oldUrl);
        oldP.then((c) => { if (coverImg.src !== c.src) URL.revokeObjectURL(c.src); }).catch(() => {});
      }
    }
    return p;
  }

  // Warm up the next couple of tracks (and the previous one) so skipping swaps instantly.
  function preloadUpcoming() {
    const d = Spicetify.Player.data || {};
    const q = Spicetify.Queue || {};
    const items = [
      ...(d.nextItems || []).slice(0, 2),
      ...(d.previousItems || []).slice(-1),
      ...(q.nextTracks || []).slice(0, 2).map((t) => t && (t.contextTrack || t)),
    ];
    const seen = new Set();
    for (const it of items) {
      const url = imageUrl((it && it.metadata) || null);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      loadCover(url).catch(() => {});
    }
  }

  // 12 looks from one texture: 4 flips x 3 offsets. The layers are 30% larger than the screen,
  // so the offsets never reveal an edge.
  const CRINKLE_LOOKS = [];
  for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]])
    for (const [dx, dy] of [[0, 0], [-8, 6], [7, -7]])
      CRINKLE_LOOKS.push(`scale(${fx}, ${fy}) translate(${dx}%, ${dy}%)`);
  let crinkleLook = -1;
  let crinkleFront = 0;
  let lookUri = null;

  // Background color and paper texture change together, fading over the same 0.9s.
  function applyLook(uri, color) {
    overlay.style.setProperty("--vr-c", color);
    if (uri === lookUri) return;
    lookUri = uri;
    crinkleLook = (crinkleLook + 5) % CRINKLE_LOOKS.length; // step 5 visits all 12 before repeating
    const from = crinkleEls[crinkleFront];
    const to = crinkleEls[1 - crinkleFront];
    to.style.transform = CRINKLE_LOOKS[crinkleLook];
    to.classList.add("on");
    from.classList.remove("on");
    crinkleFront = 1 - crinkleFront;
  }

  let trackToken = 0;
  async function updateTrack() {
    const item = currentItem();
    const meta = (item && item.metadata) || {};
    const title = meta.title || (item && item.name) || "Nothing playing";
    const artist = meta.artist_name || meta.album_title || meta.show_name || "";
    const url = imageUrl(meta);
    const token = ++trackToken;

    let cover = null;
    if (url) {
      try {
        // do not hold the title back forever on a slow network
        cover = await Promise.race([loadCover(url), new Promise((r) => setTimeout(() => r(null), 1500))]);
      } catch {}
    }
    if (token !== trackToken) return;

    titleEl.textContent = title;
    artistEl.textContent = artist;
    const uri = item && item.uri;
    if (cover) {
      coverImg.src = cover.src;
      showCover(true);
      applyLook(uri, cover.color);
    } else {
      showCover(!!url);
      if (url) coverImg.src = url;
      const fallback = () => fallbackColor(uri).then((c) => token === trackToken && applyLook(uri, c));
      if (url) loadCover(url).then((c) => token === trackToken && applyLook(uri, c.color)).catch(fallback);
      else fallback();
    }
    updateRestrictions();
    setTimeout(preloadUpcoming, 300);
  }

  function showCover(on) {
    coverImg.style.visibility = on ? "" : "hidden";
    spinEl.classList.toggle("has-cover", on);
  }

  // When the cover itself cannot be read, ask Spotify for its color; failing that, a neutral grey.
  async function fallbackColor(uri) {
    try {
      if (uri && Spicetify.colorExtractor) {
        const c = await Spicetify.colorExtractor(uri);
        const pick = c && (c.DARK_VIBRANT || c.PROMINENT || c.VIBRANT);
        if (pick) return pick;
      }
    } catch {}
    return "#3b3b44";
  }

  // ---------- what Spotify currently allows (ads, DJ, radio, restricted accounts) ----------
  function restrictions() {
    return (Spicetify.Player.data && Spicetify.Player.data.restrictions) || {};
  }

  function isAd(item) {
    if (!item) return false;
    const m = item.metadata || {};
    return item.type === "ad" || item.provider === "ad" || m.is_advertisement === "true";
  }

  function canScratch() {
    const item = currentItem();
    if (!item || isAd(item) || !durationSec()) return false;
    return restrictions().canSeek !== false;
  }

  function updateRestrictions() {
    const r = restrictions();
    shuffleBtn.disabled = r.canToggleShuffle === false;
    repeatBtn.disabled = r.canToggleRepeatContext === false && r.canToggleRepeatTrack === false;
    nextBtn.disabled = r.canSkipNext === false;
    const ok = canScratch();
    discEl.classList.toggle("locked", !ok);
    barEl.style.cursor = ok ? "" : "default";
  }

  function renderPlayButton(playing) {
    playBtn.innerHTML = icon(playing ? "pause" : "play", 32);
  }

  function updateButtons() {
    renderPlayButton(isPlaying());
    updateRestrictions();
    const sh = Spicetify.Player.getShuffle();
    shuffleBtn.classList.toggle("on", !!sh);
    shuffleBtn.classList.toggle("off", !sh);
    const rp = Spicetify.Player.getRepeat();
    repeatBtn.innerHTML = icon(rp === 2 ? "repeat-once" : "repeat", 26);
    repeatBtn.classList.toggle("on", rp > 0);
    repeatBtn.classList.toggle("off", rp === 0);
  }

  // ---------- rewind sound: soft, low tape-rewind rumble that follows the hand's speed ----------
  const sfx = { ac: null, speed: 0, gain: 0, phase: 0, pitch: 1, nextJump: 0, lp: 0, lp2: 0, n1: 0, n2: 0 };

  function startSfx() {
    if (sfx.ac) {
      if (sfx.ac.state === "suspended") sfx.ac.resume();
      return;
    }
    try {
      const ac = new AudioContext({ latencyHint: "interactive" });
      const node = ac.createScriptProcessor(512, 0, 2);
      node.onaudioprocess = renderSfx;
      node.connect(ac.destination);
      sfx.ac = ac;
    } catch {}
  }

  function renderSfx(e) {
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    const n = outL.length;
    const speed = Math.min(8, Math.abs(sfx.speed)); // multiples of normal playback speed
    const target = speed > 0.1 ? Math.min(0.06, 0.018 + speed * 0.008) : 0;
    if (target === 0 && sfx.gain === 0) {
      outL.fill(0);
      outR.fill(0);
      return;
    }
    const sr = sfx.ac.sampleRate;
    const gStep = 1 / (sr * 0.006); // ~6 ms fades: instant but click-free
    const toneCut = Math.min(1, ((260 + speed * 90) / sr) * 6.283);
    const hissCut = Math.min(1, ((500 + speed * 160) / sr) * 6.283);
    for (let i = 0; i < n; i++) {
      // garble: pitch hops like voices on a rewinding tape
      if (--sfx.nextJump <= 0) {
        sfx.pitch = 0.75 + Math.random() * 0.5;
        sfx.nextJump = sr * (0.04 + Math.random() * 0.06);
      }
      sfx.phase += ((55 + speed * 28) * sfx.pitch) / sr;
      if (sfx.phase > 1) sfx.phase -= 1;
      const saw = sfx.phase * 2 - 1;
      sfx.lp += (saw - sfx.lp) * toneCut;
      sfx.lp2 += (sfx.lp - sfx.lp2) * toneCut;
      // soft low hiss
      const noise = Math.random() * 2 - 1;
      sfx.n1 += (noise - sfx.n1) * hissCut;
      sfx.n2 += (sfx.n1 - sfx.n2) * hissCut;

      sfx.gain += target > sfx.gain ? Math.min(gStep, target - sfx.gain) : -Math.min(gStep, sfx.gain - target);
      const s = (sfx.lp2 * 0.8 + sfx.n2 * 0.9) * sfx.gain;
      outL[i] = s;
      outR[i] = s;
    }
  }

  // ---------- turntable state ----------
  let isOpen = false;
  let raf = 0;
  let grabbing = false;
  let wasPlaying = false;  // playback state before the hand touched the record
  let vPos = 0;            // record position in the song (seconds) while grabbed
  let handVel = 0;         // deg/s
  let pointerAngle = 0;
  let lastMoveAt = 0;
  let barDrag = null;      // seconds while dragging the progress bar
  let pendingPos = null;   // position shown right after a seek until Spotify catches up
  let lastSec = -1, lastDur = -1, lastP = -1;

  // Spotify takes a moment to report play/pause; trust what we just asked for until it catches up.
  let intent = null;
  function isPlaying() {
    const real = Spicetify.Player.isPlaying();
    if (intent && performance.now() < intent.until && real !== intent.playing) return intent.playing;
    intent = null;
    return real;
  }
  function setPlaying(playing) {
    intent = { playing, until: performance.now() + 1500 };
    playing ? Spicetify.Player.play() : Spicetify.Player.pause();
  }

  const durationSec = () => (Spicetify.Player.getDuration() || 0) / 1000;
  const clampPos = (p) => Math.max(0, Math.min(p, Math.max(0, durationSec() - 0.3)));

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function seekTo(sec) {
    const pos = clampPos(sec);
    const now = performance.now();
    pendingPos = { pos, at: now, until: now + 1200 };
    Spicetify.Player.seek(Math.round(pos * 1000));
  }

  function displayPos() {
    if (barDrag !== null) return barDrag;
    if (grabbing) return vPos;
    const real = Spicetify.Player.getProgress() / 1000;
    if (pendingPos) {
      const now = performance.now();
      const expected = pendingPos.pos + (isPlaying() ? (now - pendingPos.at) / 1000 : 0);
      if (now > pendingPos.until || Math.abs(real - expected) < 0.5) pendingPos = null;
      else return expected;
    }
    return real;
  }

  // UI loop: only touches the DOM when something visible changed
  function frame() {
    try {
      renderFrame();
    } catch (err) {
      console.error("[Vinyl Rewind]", err);
    }
    if (isOpen) raf = requestAnimationFrame(frame);
  }

  function renderFrame() {
    if (grabbing) {
      sfx.speed = !settings.sound || performance.now() - lastMoveAt > HAND_STILL_MS ? 0 : handVel / DEG_PER_SEC;
    } else {
      sfx.speed = 0;
      setSpinning(isPlaying());
    }

    const dur = durationSec();
    const pos = displayPos();
    const sec = Math.floor(pos);
    if (sec !== lastSec || dur !== lastDur) {
      curEl.textContent = fmt(pos);
      const text = `${fmt(pos)} of ${fmt(dur)}`;
      for (const el of [discEl, barEl]) {
        el.setAttribute("aria-valuemax", String(Math.round(dur)));
        el.setAttribute("aria-valuenow", String(sec));
        el.setAttribute("aria-valuetext", text);
      }
      lastSec = sec;
    }
    if (dur !== lastDur) { durEl.textContent = fmt(dur); lastDur = dur; }
    const p = dur ? Math.min(1, Math.max(0, pos / dur)) : 0;
    if (Math.abs(p - lastP) > 0.0002) {
      fillEl.style.transform = `scaleX(${p})`;
      railEl.style.transform = `translateX(${p * 100}%)`;
      lastP = p;
    }
    syncVolume();
  }

  function angleAt(e) {
    const r = discEl.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  }

  let grabStartPos = 0;

  discEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || grabbing) return;
    e.preventDefault();
    if (!canScratch()) return;
    // hold the record exactly where it is (it may be mid-way through the idle zoom) so it cannot slide out from under the hand
    const here = getComputedStyle(discEl).transform;
    discEl.style.transition = "none";
    discEl.style.transform = here === "none" ? "" : here;
    discEl.setPointerCapture(e.pointerId);
    discEl.classList.add("grabbing");
    setSpinning(false); // hand on the record: it stops right now
    if (settings.sound) startSfx();

    wasPlaying = isPlaying();
    vPos = grabStartPos = displayPos();
    if (wasPlaying) setPlaying(false);
    grabbing = true;
    handVel = 0;
    pointerAngle = angleAt(e);
    lastMoveAt = 0;
  });

  discEl.addEventListener("pointermove", (e) => {
    if (!grabbing) return;
    const a = angleAt(e);
    let d = a - pointerAngle;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    pointerAngle = a;
    if (d === 0) return;

    const next = clampPos(vPos + d / DEG_PER_SEC);
    const applied = (next - vPos) * DEG_PER_SEC; // the record "sticks" at the start/end of the song
    vPos = next;
    setAngle(getAngle() + applied); // record follows the hand 1:1, immediately

    const now = performance.now();
    const dt = lastMoveAt ? Math.max(4, now - lastMoveAt) / 1000 : 0.016;
    lastMoveAt = now;
    handVel = handVel * 0.4 + (applied / dt) * 0.6;
  });

  // seek = false when the grab is abandoned (the song changed underneath the hand)
  function release(e, seek = true) {
    if (!grabbing) return;
    try { if (e && e.pointerId !== undefined) discEl.releasePointerCapture(e.pointerId); } catch {}
    discEl.classList.remove("grabbing");
    grabbing = false;
    discEl.style.transition = "";
    layoutIdle();
    wake();
    sfx.speed = 0;
    if (seek && Math.abs(vPos - grabStartPos) > 0.05) seekTo(vPos); // a plain tap should not stutter the audio
    if (wasPlaying) {
      setSpinning(true); // let go: back to full speed instantly
      setPlaying(true);
    }
  }
  discEl.addEventListener("pointerup", release);
  discEl.addEventListener("pointercancel", release);
  discEl.addEventListener("lostpointercapture", release);
  window.addEventListener("blur", () => {
    release(null);
    barUp();
    volUp();
  });

  // ---------- progress bar ----------
  function barPos(e) {
    const r = barEl.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * durationSec();
  }
  barEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !canScratch()) return;
    barEl.setPointerCapture(e.pointerId);
    barDrag = barPos(e);
  });
  barEl.addEventListener("pointermove", (e) => {
    if (barDrag !== null) barDrag = barPos(e);
  });
  function barUp() {
    if (barDrag === null) return;
    seekTo(barDrag);
    barDrag = null;
  }
  barEl.addEventListener("pointerup", barUp);
  barEl.addEventListener("pointercancel", barUp);
  barEl.addEventListener("lostpointercapture", barUp);

  // ---------- volume ----------
  let volDrag = false;
  let lastVol = -1;
  let volBeforeMute = 0.5;

  function renderVolume(v) {
    if (v === lastVol) return;
    lastVol = v;
    volFillEl.style.transform = `scaleX(${v})`;
    volRailEl.style.transform = `translateX(${v * 100}%)`;
    const name = v === 0 ? "volume-off" : v < 0.34 ? "volume-one-wave" : v < 0.67 ? "volume-two-wave" : "volume";
    muteBtn.innerHTML = icon(name, 22);
    muteBtn.title = v === 0 ? "Unmute" : "Mute";
    muteBtn.setAttribute("aria-label", muteBtn.title);
    volBarEl.setAttribute("aria-valuenow", String(Math.round(v * 100)));
  }

  let volSent = 0, volPending = null, volTimer = 0, volHoldUntil = 0;
  function flushVolume() {
    volTimer = 0;
    if (volPending === null) return;
    Spicetify.Player.setVolume(volPending);
    volPending = null;
    volSent = performance.now();
  }

  function setVolume(v) {
    v = Math.min(1, Math.max(0, v));
    if (v > 0) volBeforeMute = v;
    renderVolume(v); // slider moves right away
    volHoldUntil = performance.now() + 700;
    // Spotify volume calls are slow; send at most one every ~40 ms, always ending on the latest value
    volPending = v;
    const wait = 40 - (performance.now() - volSent);
    if (wait <= 0) flushVolume();
    else if (!volTimer) volTimer = setTimeout(flushVolume, wait);
  }

  function syncVolume() {
    if (volDrag || volPending !== null || performance.now() < volHoldUntil) return;
    renderVolume(Spicetify.Player.getVolume());
  }

  function volAt(e) {
    const r = volBarEl.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  }
  volBarEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    volBarEl.setPointerCapture(e.pointerId);
    volDrag = true;
    volBarEl.parentElement.classList.add("dragging");
    setVolume(volAt(e));
  });
  volBarEl.addEventListener("pointermove", (e) => {
    if (volDrag) setVolume(volAt(e));
  });
  function volUp() {
    volDrag = false;
    volBarEl.parentElement.classList.remove("dragging");
  }
  volBarEl.addEventListener("pointerup", volUp);
  volBarEl.addEventListener("pointercancel", volUp);
  volBarEl.addEventListener("lostpointercapture", volUp);
  overlay.querySelector(".vr-volume").addEventListener("wheel", (e) => {
    e.preventDefault();
    setVolume((lastVol < 0 ? Spicetify.Player.getVolume() : lastVol) + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });

  // ---------- controls ----------
  overlay.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "close") return close();
    if (act === "fullscreen") return toggleFullscreen();
    if (act === "mute") return setVolume(lastVol > 0 ? 0 : volBeforeMute || 0.5);
    if (act === "play") {
      // update the record and button immediately; Spotify catches up a moment later
      const playing = !isPlaying();
      setSpinning(playing);
      renderPlayButton(playing);
      setPlaying(playing);
      return;
    }
    if (act === "prev") Spicetify.Player.back();
    else if (act === "next") Spicetify.Player.next();
    else if (act === "shuffle") Spicetify.Player.toggleShuffle();
    else if (act === "repeat") Spicetify.Player.toggleRepeat();
    setTimeout(updateButtons, 120);
    setTimeout(updateButtons, 500);
  });

  Spicetify.Player.addEventListener("songchange", () => {
    if (grabbing) release(null, false); // the position being scrubbed belongs to the old song
    barDrag = null;
    if (isOpen) updateTrack();
    else setTimeout(preloadUpcoming, 300);
  });
  Spicetify.Player.addEventListener("onplaypause", () => {
    if (!isOpen) return;
    if (!grabbing) setSpinning(isPlaying());
    updateButtons();
  });

  // ---------- fullscreen ----------
  let weWentFullscreen = false;

  function updateFullBtn() {
    const fs = !!document.fullscreenElement;
    fullBtn.innerHTML = fs ? FS_EXIT : FS_ENTER;
    fullBtn.setAttribute("aria-label", fs ? "Exit full screen" : "Full screen");
    fullBtn.title = fs ? "Exit full screen" : "Full screen";
  }
  updateFullBtn();
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) weWentFullscreen = false;
    updateFullBtn();
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().then(() => (weWentFullscreen = true)).catch(() => {});
  }

  // Rewind / fast-forward from the keyboard; the record turns by the same amount.
  function stepSeek(delta) {
    if (!canScratch()) return;
    const from = displayPos();
    const to = clampPos(from + delta);
    setAngle(getAngle() + (to - from) * DEG_PER_SEC);
    seekTo(to);
  }

  function isTyping(e) {
    const t = e.target;
    return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const focusedButton = e.target && e.target.closest && e.target.closest("#vr-overlay button");
    let handled = true;
    switch (e.key) {
      case "Escape":
        // first Esc leaves full screen, second closes
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else close();
        break;
      case "ArrowLeft":
        stepSeek(e.shiftKey ? -SEEK_STEP * 3 : -SEEK_STEP);
        break;
      case "ArrowRight":
        stepSeek(e.shiftKey ? SEEK_STEP * 3 : SEEK_STEP);
        break;
      case "ArrowUp":
        setVolume((lastVol < 0 ? Spicetify.Player.getVolume() : lastVol) + 0.05);
        break;
      case "ArrowDown":
        setVolume((lastVol < 0 ? Spicetify.Player.getVolume() : lastVol) - 0.05);
        break;
      case " ":
      case "Enter":
        if (focusedButton) { handled = false; break; } // let the focused button activate itself
        if (e.key === "Enter") { handled = false; break; }
        playBtn.click();
        break;
      case "m":
      case "M":
        muteBtn.click();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      default:
        handled = false;
    }
    if (handled) {
      // keep Spotify's own shortcuts (e.g. its Space = play/pause) from acting twice
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    wake();
  }

  // Alt+Shift+V opens and closes Vinyl mode from anywhere in Spotify.
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyV" && !isTyping(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      isOpen ? close() : open();
    }
  }, true);

  // ---------- idle: after a few seconds without the mouse, the record takes center stage ----------
  const IDLE_MS = 3000;
  const DISC_OVERSIZE = 1.3; // matches the CSS: disc is drawn 1.3x and scaled down
  let idle = false;
  let idleTimer = 0;
  let lastMouse = null;

  function layoutIdle() {
    if (!idle) {
      discEl.style.transform = "";
      progressEl.style.transform = "";
      return;
    }
    const H = overlay.clientHeight;
    const d = slotEl.offsetHeight;
    const grow = Math.min(DISC_OVERSIZE, (H * 0.74) / d);
    const dy = H * 0.45 - (slotEl.offsetTop + d / 2);
    discEl.style.transform = `translateY(${dy}px) scale(${grow / DISC_OVERSIZE})`;
    const py = H * 0.9 - (progressEl.offsetTop + progressEl.offsetHeight / 2);
    progressEl.style.transform = `translateY(${py}px)`;
  }

  function setIdle(on) {
    if (idle === on) return;
    idle = on;
    overlay.classList.toggle("idle", on);
    layoutIdle();
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (!settings.idle) return;
    idleTimer = setTimeout(() => {
      if (!isOpen) return;
      if (grabbing || barDrag !== null || volDrag) return armIdle();
      setIdle(true);
    }, IDLE_MS);
  }

  function wake() {
    if (grabbing) return armIdle(); // the record stays put while held; release() wakes the UI
    setIdle(false);
    armIdle();
  }

  overlay.addEventListener("pointermove", (e) => {
    // ignore sub-pixel jitter so a resting mouse does not keep waking the UI
    if (lastMouse && Math.abs(e.clientX - lastMouse[0]) < 3 && Math.abs(e.clientY - lastMouse[1]) < 3) return;
    lastMouse = [e.clientX, e.clientY];
    wake();
  });
  overlay.addEventListener("pointerdown", wake);
  overlay.addEventListener("wheel", wake, { passive: true });
  window.addEventListener("resize", () => idle && layoutIdle());

  // ---------- open / close ----------
  let returnFocus = null;

  function applySettings() {
    overlay.classList.toggle("reduce-motion", settings.reduceMotion);
    overlay.classList.toggle("no-texture", !settings.texture);
    if (isOpen) {
      setSpinning(!grabbing && isPlaying());
      if (settings.idle) armIdle();
      else { clearTimeout(idleTimer); setIdle(false); }
    }
    if (!settings.sound) sfx.speed = 0;
    syncHomeCard();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    document.body.classList.add("vr-open");
    overlay.classList.add("open");
    lastSec = lastDur = lastP = -1;
    setSpinning(isPlaying());
    // show the current song's look immediately on open; fades are only for song changes
    overlay.classList.add("vr-instant");
    updateTrack().finally(() => requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.remove("vr-instant"))));
    updateButtons();
    window.addEventListener("keydown", onKey, true);
    applySettings();
    returnFocus = document.activeElement;
    requestAnimationFrame(() => playBtn.focus({ preventScroll: true }));
    raf = requestAnimationFrame(frame);
    lastMouse = null;
    armIdle();
    button.active = true;
  }

  function close() {
    if (!isOpen) return;
    release(null);
    barUp();
    volUp();
    isOpen = false;
    document.body.classList.remove("vr-open");
    overlay.classList.remove("open");
    setSpinning(false);
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    if (returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    clearTimeout(idleTimer);
    setIdle(false);
    if (weWentFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    sfx.speed = 0;
    if (sfx.ac) setTimeout(() => !isOpen && sfx.ac.suspend(), 100);
    button.active = false;
  }

  // ---------- Settings > Vinyl mode ----------
  const SETTING_ROWS = [
    ["reduceMotion", "Reduce motion", "Keep the record still and turn off zoom and fade animations."],
    ["sound", "Rewind sound", "Play a soft rewind sound while you turn the record."],
    ["idle", "Hide controls when idle", "After a few seconds without the mouse, show only the record and the progress bar."],
    ["texture", "Background texture", "Add a faint paper texture behind the record."],
    ["homeTip", "Show tip on Home", "Show the Vinyl mode card in Getting started."],
  ];

  function injectSettings() {
    if (document.getElementById("vr-settings")) return;
    const sections = document.querySelectorAll(".x-settings-section");
    if (!sections.length) return;
    // borrow Spotify's own text classes so the section matches the current design
    const headingCls = (sections[0].querySelector("h2") || {}).className || "";
    const labelCls = (document.querySelector(".x-settings-firstColumn label") || {}).className || "";
    const noteCls = (document.querySelector(".x-settings-firstColumn span") || {}).className || "";

    const sec = document.createElement("div");
    sec.className = "x-settings-section";
    sec.id = "vr-settings";
    const h = document.createElement("h2");
    h.className = headingCls;
    h.textContent = "Vinyl mode";
    sec.appendChild(h);

    for (const [key, label, note] of SETTING_ROWS) {
      const id = "vinyl-rewind." + key;
      const row = document.createElement("div");
      row.className = "x-settings-row";
      row.innerHTML = `
        <div class="x-settings-firstColumn">
          <label class="${labelCls}" for="${id}"></label>
          <span class="${noteCls} vr-note"></span>
        </div>
        <div class="x-settings-secondColumn">
          <label class="x-toggle-wrapper">
            <input id="${id}" class="x-toggle-input" type="checkbox">
            <span class="x-toggle-indicatorWrapper"><span class="x-toggle-indicator"></span></span>
          </label>
        </div>`;
      row.querySelector("label[for]").textContent = label;
      row.querySelector(".x-settings-firstColumn span").textContent = note;
      const input = row.querySelector("input");
      input.checked = settings[key];
      input.addEventListener("change", () => {
        settings[key] = input.checked;
        saveSettings();
        applySettings();
      });
      sec.appendChild(row);
    }

    const keys = document.createElement("div");
    keys.className = "x-settings-row";
    keys.innerHTML = `
      <div class="x-settings-firstColumn">
        <span class="${labelCls}">Keyboard shortcuts</span>
        <div class="vr-settings-keys ${noteCls}" style="margin-top: 8px">
          <kbd>Alt + Shift + V</kbd><span>Open or close Vinyl mode</span>
          <kbd>← →</kbd><span>Rewind / fast-forward 5 seconds (hold Shift for 15)</span>
          <kbd>Space</kbd><span>Play / pause</span>
          <kbd>↑ ↓</kbd><span>Volume</span>
          <kbd>M</kbd><span>Mute</span>
          <kbd>F</kbd><span>Full screen</span>
          <kbd>Esc</kbd><span>Leave full screen, then close</span>
        </div>
      </div>`;
    sec.appendChild(keys);

    // after the Display section if there is one (it holds similar options), otherwise at the end
    const display = [...sections].find((x) => /display/i.test((x.querySelector("h2") || {}).textContent || ""));
    const anchor = display || sections[sections.length - 1];
    anchor.after(sec);
  }

  // ---------- Home > Getting started card ----------
  const HOME_ART = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#2a2a2a"/><stop offset="1" stop-color="#0d0d0d"/></radialGradient></defs>
    <circle cx="100" cy="100" r="98" fill="url(#g)"/>
    ${[88, 80, 72, 64, 56, 48].map((r) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="1"/>`).join("")}
    <path d="M100 4a96 96 0 0 1 83 48" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="3" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="34" fill="#509BF5"/>
    <circle cx="100" cy="100" r="34" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
    <path d="M100 74a26 26 0 0 1 22 12" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="5" fill="#0d0d0d"/>
  </svg>`);

  function syncHomeCard() {
    const existing = document.querySelector(".vr-home-card");
    if (!settings.homeTip) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.classList.toggle("reduce-motion", settings.reduceMotion);
      return;
    }
    // Spotify's onboarding card, found by structure rather than its (translated) text
    const trigger = document.querySelector("[data-onboarding-open-checklist-trigger]");
    const theirs = trigger && trigger.closest('[style*="--onboarding-card-color-dark"]');
    if (!theirs || !theirs.parentElement) return;

    const card = theirs.cloneNode(true);
    card.classList.add("vr-home-card");
    card.classList.toggle("reduce-motion", settings.reduceMotion);
    card.style.setProperty("--onboarding-card-color-dark", "#0D2A4A");
    card.style.setProperty("--background-base", "#0D2A4A");
    card.style.setProperty("--text-subdued", "#9BC3FF");
    card.style.setProperty("--essential-subdued", "#9BC3FF");
    const light = card.querySelector('[style*="--onboarding-card-color-light"]');
    if (light) light.style.setProperty("--onboarding-card-color-light", "#1E5FA8");

    const title = card.querySelector("p");
    if (title) title.textContent = "Try Vinyl mode";
    const sub = title && title.nextElementSibling;
    if (sub) sub.textContent = "Grab the record to scratch, rewind and fast-forward your music.";

    const buttons = card.querySelectorAll("button");
    const tryBtn = buttons[0];
    const notNow = buttons[1];
    if (tryBtn) {
      const inner = tryBtn.querySelector("span") || tryBtn;
      inner.textContent = "Try it";
      tryBtn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    }
    if (notNow) {
      notNow.removeAttribute("data-onboarding-open-checklist-trigger");
      notNow.textContent = "Not now";
      notNow.addEventListener("click", (e) => {
        e.stopPropagation();
        settings.homeTip = false;
        saveSettings();
        syncHomeCard();
      });
    }
    for (const b of [...buttons].slice(2)) b.remove();

    const img = card.querySelector("img");
    if (img) {
      img.src = HOME_ART;
      img.alt = "";
      img.removeAttribute("loading");
      img.classList.add("vr-home-art");
    }

    theirs.after(card);
  }

  // Spotify rebuilds its pages as you navigate; keep our additions in place on Home and Settings.
  function onRoute(pathname) {
    clearInterval(onRoute.timer);
    const isHome = pathname === "/" || pathname === "";
    const isSettings = pathname.startsWith("/preferences");
    if (!isHome && !isSettings) return;
    const tick = () => {
      try {
        if (isHome) syncHomeCard();
        if (isSettings) injectSettings();
      } catch (err) {
        console.error("[Vinyl Rewind]", err);
      }
    };
    tick();
    onRoute.timer = setInterval(tick, 800);
  }
  const history = Spicetify.Platform && Spicetify.Platform.History;
  if (history && history.listen) {
    // older routers pass the location, newer ones pass { location, action }
    history.listen((a) => onRoute((a && (a.pathname || (a.location && a.location.pathname))) || ""));
    onRoute((history.location && history.location.pathname) || "");
  }

  // ---------- playbar button ----------
  const ICON = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M0.75 8a7.25 7.25 0 1 0 14.5 0a7.25 7.25 0 1 0 -14.5 0zM2.6 8a5.4 5.4 0 1 0 10.8 0a5.4 5.4 0 1 0 -10.8 0zM3.25 8a4.75 4.75 0 1 0 9.5 0a4.75 4.75 0 1 0 -9.5 0zM5.4 8a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0zM7.15 8a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0z"/></svg>`;
  const button = new ButtonApi("Vinyl mode", ICON, () => (isOpen ? close() : open()), false, false);
  (button.button || button.element)?.classList.add("vr-playbar-btn");

  // Grayscale crumpled-paper texture (procedurally generated), centered on mid-gray so it only adds creases and facets to the color.
  function crumpleTexture() {
    return "data:image/webp;base64,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";
  }
})();
