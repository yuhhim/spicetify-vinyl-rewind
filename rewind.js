// NAME: Vinyl Rewind
// AUTHOR: Parker
// VERSION: 1.2.0
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
    lyrics: true,
    nextUp: true,
    autoOpen: false,
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
/* synced lyric line, shown under the record in idle mode */
#vr-overlay .vr-lyric {
  position: absolute; left: 10vw; right: 10vw; top: 0; text-align: center; pointer-events: none;
  font-size: clamp(18px, 2.6vh, 28px); font-weight: 700; line-height: 1.3; color: #fff;
  text-shadow: 0 2px 12px rgba(0,0,0,0.35);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  opacity: 0; transform: translateY(6px); transition: opacity 0.35s ease, transform 0.35s ease;
}
#vr-overlay.idle .vr-lyric.show { opacity: 0.95; transform: none; }
/* the next song: off-screen on the right, glides in when the mouse comes near,
   and now and then peeks in for a moment so you know it is there */
#vr-overlay .vr-next {
  position: absolute; right: calc(var(--D) * -0.34); top: 0;
  width: calc(var(--D) * 0.62); height: calc(var(--D) * 0.62);
  padding: 0; border: none; border-radius: 50%; background: #111; cursor: pointer; touch-action: none;
  box-shadow: 0 12px 36px rgba(0,0,0,0.4);
  transform: translateX(calc(var(--D) * 0.4)) rotate(-30deg);
  transition: transform 0.7s cubic-bezier(0.22, 0.8, 0.2, 1), opacity 0.35s ease;
}
#vr-overlay .vr-next img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block; pointer-events: none; -webkit-user-drag: none; }
#vr-overlay .vr-next::after {
  content: ""; position: absolute; left: 50%; top: 50%; width: 7.5%; height: 7.5%;
  transform: translate(-50%, -50%); border-radius: 50%; background: #000;
}
#vr-overlay .vr-next.glimpse { transform: translateX(calc(var(--D) * 0.22)) rotate(-22deg); }
#vr-overlay .vr-next.near { transform: translateX(0) rotate(-16deg); }
#vr-overlay .vr-next:hover, #vr-overlay .vr-next:focus-visible { transform: translateX(calc(var(--D) * -0.08)) rotate(-8deg); }
#vr-overlay .vr-next.dragging { transition: none; }
#vr-overlay .vr-next.hidden, #vr-overlay.idle .vr-next { opacity: 0; pointer-events: none; transform: translateX(calc(var(--D) * 0.5)) rotate(-30deg); }
/* the outgoing record during a skip */
#vr-overlay .vr-ghost { position: absolute; border-radius: 50%; pointer-events: none; z-index: 2; box-shadow: 0 23px 65px rgba(0,0,0,0.35); }
#vr-overlay .vr-ghost-spin { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; background: #111; }
#vr-overlay .vr-ghost-spin img { width: 100%; height: 100%; object-fit: cover; display: block; }
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
.vr-home-card .vr-home-art { border-radius: 50%; }
.vr-home-card:hover .vr-home-art { animation: vr-home-spin 4s linear infinite; }
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
    <div class="vr-lyric" aria-hidden="true"></div>
    <button class="vr-next hidden" data-act="next-record" aria-label="Next song"><img alt="" /></button>
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
  // a Text node whose .data can change without replacing any DOM nodes
  const textSlot = (el) => {
    const t = document.createTextNode(el.textContent);
    el.textContent = "";
    el.appendChild(t);
    return t;
  };
  const crinkleEls = [...overlay.querySelectorAll(".vr-crinkle")];
  crinkleEls.forEach((el) => (el.style.backgroundImage = `url("${crumpleTexture()}")`));
  const discEl = $(".vr-disc");
  const slotEl = $(".vr-disc-slot");
  const progressEl = $(".vr-progress");
  const lyricEl = $(".vr-lyric");
  const lyricText = textSlot(lyricEl);
  const nextEl = $(".vr-next");
  const nextImg = $(".vr-next img");
  const spinEl = $(".vr-spin");
  const coverImg = $(".vr-spin img");
  const titleEl = $(".vr-title");
  const artistEl = $(".vr-artist");
  const curEl = $(".vr-time.cur");
  const durEl = $(".vr-time.dur");
  const curText = textSlot(curEl);
  const durText = textSlot(durEl);
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
        oldP.then((c) => { if (coverImg.src !== c.src && nextImg.src !== c.src) URL.revokeObjectURL(c.src); }).catch(() => {});
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
      arriveSwap();
    } else {
      arriveSwap();
      showCover(!!url);
      if (url) coverImg.src = url;
      const fallback = () => fallbackColor(uri).then((c) => token === trackToken && applyLook(uri, c));
      if (url) loadCover(url).then((c) => token === trackToken && applyLook(uri, c.color)).catch(fallback);
      else fallback();
    }
    updateRestrictions();
    loadLyrics(uri);
    updateNextUp();
    setTimeout(preloadUpcoming, 300);
  }

  // ---------- synced lyrics (idle mode) ----------
  const lyricsCache = new Map(); // track id -> Promise<[{ t, text }] | null>
  let lyrics = { uri: null, lines: null, failedAt: 0 };
  let lyricIndex = -1;

  async function accessToken() {
    const P = Spicetify.Platform || {};
    try {
      // Spotify keeps the current (refreshed) token here; the Session copy can be missing or stale
      const state = P.AuthorizationAPI && P.AuthorizationAPI.getState ? await P.AuthorizationAPI.getState() : null;
      return (state && state.token && state.token.accessToken) || (P.Session && P.Session.accessToken) || null;
    } catch {
      return null;
    }
  }

  async function requestLyrics(id) {
    const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`;
    const token = await accessToken();
    if (token) {
      const r = await fetch(url, { headers: { authorization: "Bearer " + token, "app-platform": "WebPlayer" } });
      if (r.status === 404) return null; // no lyrics for this song
      if (r.ok) return r.json();
    }
    // older Spotify versions: go through Spicetify
    if (Spicetify.CosmosAsync) return Spicetify.CosmosAsync.get(url, null, { "app-platform": "WebPlayer" });
    throw new Error("lyrics unavailable right now");
  }

  function fetchLyrics(uri) {
    const id = uri && uri.startsWith("spotify:track:") ? uri.split(":")[2] : null;
    if (!id) return Promise.resolve(null);
    if (!lyricsCache.has(id)) {
      const request = (async () => {
        const res = await requestLyrics(id);
        const l = res && res.lyrics;
        if (!l || l.syncType !== "LINE_SYNCED" || !Array.isArray(l.lines)) return null; // none, or not synced
        return l.lines.map((x) => ({ t: Number(x.startTimeMs) / 1000, text: String(x.words || "").trim() }));
      })();
      // a failed request (offline, expired sign-in, rate limit) is forgotten so the next play tries again
      request.catch(() => lyricsCache.delete(id));
      lyricsCache.set(id, request);
      if (lyricsCache.size > 40) lyricsCache.delete(lyricsCache.keys().next().value);
    }
    return lyricsCache.get(id).catch(() => undefined); // undefined = could not ask; null = no synced lyrics
  }

  function loadLyrics(uri) {
    if (lyrics.uri === uri && !lyrics.failedAt) return;
    if (lyrics.uri !== uri) {
      lyrics = { uri, lines: null, failedAt: 0 };
      showLyric(-1);
    }
    if (!settings.lyrics) return;
    lyrics.failedAt = 0;
    fetchLyrics(uri).then((lines) => {
      if (lyrics.uri !== uri) return;
      if (lines === undefined) lyrics.failedAt = performance.now(); // retried shortly, see renderFrame
      else lyrics.lines = lines;
    });
  }

  function showLyric(i) {
    if (i === lyricIndex) return;
    lyricIndex = i;
    const text = i >= 0 && lyrics.lines ? lyrics.lines[i].text : "";
    const visible = text && text !== "\u266a"; // instrumental breaks come through as a music note
    if (settings.reduceMotion) {
      lyricText.data = visible ? text : "";
      lyricEl.classList.toggle("show", !!visible);
      return;
    }
    lyricEl.classList.remove("show");
    clearTimeout(showLyric.timer);
    showLyric.timer = setTimeout(() => {
      lyricText.data = visible ? text : "";
      lyricEl.classList.toggle("show", !!visible);
    }, 180);
  }

  function updateLyric(pos) {
    const lines = settings.lyrics && idle ? lyrics.lines : null;
    if (!lines || !lines.length) return showLyric(-1);
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= pos + 0.15; k++) i = k;
    showLyric(i);
  }

  // ---------- the next song, as a record peeking in from the right ----------
  let nextUri = null;
  let nextQuietUntil = 0; // keep the next record out of the way while a skip animation plays

  // the next real song or episode (DJ narration, ads and queue markers are skipped over)
  function nextItem() {
    const d = Spicetify.Player.data || {};
    const q = Spicetify.Queue || {};
    const items = d.nextItems || (q.nextTracks || []).map((t) => t && (t.contextTrack || t));
    return items.find((it) => it && /^spotify:(track|episode|local):/.test(it.uri || "") && !isAd(it)) || null;
  }

  function layoutNextUp() {
    const size = nextEl.offsetHeight;
    const center = slotEl.offsetTop + slotEl.offsetHeight / 2;
    nextEl.style.top = center - size / 2 + "px";
    nextZone = null; // re-measured on the next mouse move
  }

  function updateNextUp() {
    const it = nextItem();
    const url = it && imageUrl(it.metadata);
    const r = restrictions();
    const roomy = overlay.clientWidth > slotEl.offsetWidth * 1.9;
    const quiet = performance.now() < nextQuietUntil;
    if (quiet) {
      clearTimeout(updateNextUp.timer);
      updateNextUp.timer = setTimeout(updateNextUp, nextQuietUntil - performance.now() + 20);
    }
    const show = settings.nextUp && !!url && r.canSkipNext !== false && roomy && !quiet;
    nextEl.classList.toggle("hidden", !show);
    nextEl.tabIndex = show ? 0 : -1;
    nextEl.setAttribute("aria-hidden", show ? "false" : "true");
    if (!show) return;
    const meta = it.metadata || {};
    nextEl.setAttribute("aria-label", `Next: ${meta.title || "next song"}${meta.artist_name ? " by " + meta.artist_name : ""}`);
    nextEl.title = nextEl.getAttribute("aria-label");
    if (it.uri !== nextUri) {
      if (nextUri !== null) scheduleGlimpse(3500);
      nextUri = it.uri;
      loadCover(url).then((c) => { if (nextUri === it.uri) nextImg.src = c.src; }).catch(() => { nextImg.src = url; });
    }
    layoutNextUp();
  }

  function takeNext() {
    if (nextEl.classList.contains("hidden")) return;
    // vanish on the spot (no slide back): the skip animation takes over from here
    nextEl.style.transition = "none";
    nextEl.classList.remove("dragging", "near", "glimpse");
    nextEl.style.transform = "";
    nextEl.classList.add("hidden");
    void nextEl.offsetWidth; // apply the hidden state before transitions come back
    nextEl.style.transition = "";
    nextEl.tabIndex = -1;
    nextUri = null;
    skip(1);
  }

  // ---------- skipping: the current record rolls off one side, the new one rolls in from the other ----------
  let swap = null; // { dir, ghost, timer }

  let prevPendingUntil = 0;

  function skip(dir) {
    nextQuietUntil = performance.now() + 1400;
    setNear(false);
    if (dir > 0) {
      if (restrictions().canSkipNext !== false) startSwap(1);
      Spicetify.Player.next();
    } else {
      // Previous may just restart the song, so only roll once Spotify really changes it (see songchange)
      prevPendingUntil = performance.now() + 1500;
      Spicetify.Player.back();
    }
    setTimeout(updateNextUp, 900);
  }

  function startSwap(dir) {
    if (!isOpen || settings.reduceMotion) return;
    endSwap();
    const r = discEl.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "vr-ghost";
    ghost.style.cssText = `left:${r.left - o.left}px;top:${r.top - o.top}px;width:${r.width}px;height:${r.height}px`;
    const spinBox = document.createElement("div");
    spinBox.className = "vr-ghost-spin";
    spinBox.style.transform = `rotate(${getAngle()}deg)`;
    if (coverImg.style.visibility !== "hidden" && coverImg.src) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = coverImg.src;
      spinBox.appendChild(img);
    }
    const hole = document.createElement("div");
    hole.className = "vr-hole";
    ghost.append(spinBox, hole);
    overlay.appendChild(ghost);
    // rolling away: moving left means turning counter-clockwise (and the reverse for Previous)
    ghost.animate(
      [{ transform: "none" }, { transform: `translateX(${dir > 0 ? -110 : 110}vw) rotate(${dir > 0 ? -150 : 150}deg)` }],
      { duration: 460, easing: "cubic-bezier(0.55, 0, 0.8, 0.25)", fill: "forwards" }
    ).finished.then(() => ghost.remove(), () => ghost.remove());
    slotEl.style.opacity = "0";
    // normally the new cover arrives well before this; it is only a safety net so the record never stays away
    swap = { dir, ghost, timer: setTimeout(arriveSwap, 1800) };
  }

  function arriveSwap() {
    if (!swap) return;
    const { dir } = swap;
    clearTimeout(swap.timer);
    swap = null;
    slotEl.style.opacity = "";
    slotEl.animate(
      [{ transform: `translateX(${dir > 0 ? 80 : -80}vw) rotate(${dir > 0 ? 170 : -170}deg)` }, { transform: "none" }],
      { duration: 640, easing: "cubic-bezier(0.16, 0.84, 0.3, 1)" }
    );
  }

  function endSwap() {
    if (!swap) return;
    clearTimeout(swap.timer);
    swap.ghost.remove();
    swap = null;
    slotEl.style.opacity = "";
  }

  // ---------- when the next record shows itself ----------
  let nearNext = false;
  let glimpseTimer = 0;

  function setNear(on) {
    if (nearNext === on) return;
    nearNext = on;
    nextEl.classList.toggle("near", on);
  }

  // where the next record lives, updated whenever the layout changes (not on every mouse move)
  let nextZone = null;

  function measureNextZone() {
    const size = nextEl.offsetHeight;
    const top = nextEl.offsetTop;
    nextZone = { left: overlay.clientWidth - Math.max(220, size * 0.75), top: top - size * 0.35, bottom: top + size * 1.35 };
  }

  overlay.addEventListener("pointermove", (e) => {
    if (idle || grabbing || nextEl.classList.contains("hidden") || performance.now() < nextQuietUntil) return setNear(false);
    if (!nextZone) measureNextZone();
    setNear(e.clientX > nextZone.left && e.clientY > nextZone.top && e.clientY < nextZone.bottom);
  });
  overlay.addEventListener("pointerleave", () => setNear(false));

  function glimpse() {
    if (!isOpen || idle || nearNext || settings.reduceMotion || nextEl.classList.contains("hidden")) return;
    nextEl.classList.add("glimpse");
    setTimeout(() => nextEl.classList.remove("glimpse"), 1300);
  }

  function scheduleGlimpse(delay) {
    clearTimeout(glimpseTimer);
    if (!isOpen) return;
    glimpseTimer = setTimeout(() => {
      glimpse();
      scheduleGlimpse();
    }, delay !== undefined ? delay : 20000 + Math.random() * 15000);
  }

  // drag the next record in (to the left) to skip; a plain click skips too
  let nextDrag = null;
  nextEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    nextEl.setPointerCapture(e.pointerId);
    nextDrag = { x: e.clientX, dx: 0 };
    nextEl.classList.add("dragging");
  });
  nextEl.addEventListener("pointermove", (e) => {
    if (!nextDrag) return;
    nextDrag.dx = Math.min(0, e.clientX - nextDrag.x);
    nextEl.style.transform = `translateX(${nextDrag.dx}px) rotate(${-8 + nextDrag.dx / 12}deg)`;
  });
  function endNextDrag(e) {
    if (!nextDrag) return;
    const dx = nextDrag.dx;
    nextDrag = null;
    nextEl.classList.remove("dragging");
    nextEl.style.transform = "";
    if (e && e.type === "pointerup" && (dx < -70 || Math.abs(dx) < 4)) takeNext();
  }
  nextEl.addEventListener("pointerup", endNextDrag);
  nextEl.addEventListener("pointercancel", endNextDrag);
  nextEl.addEventListener("lostpointercapture", () => endNextDrag(null));
  nextEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopImmediatePropagation();
      takeNext();
    }
  });

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

  function setIcon(el, name, size) {
    if (el.dataset.icon === name) return;
    el.dataset.icon = name;
    el.innerHTML = icon(name, size);
  }

  function renderPlayButton(playing) {
    setIcon(playBtn, playing ? "pause" : "play", 32);
  }

  function updateButtons() {
    renderPlayButton(isPlaying());
    updateRestrictions();
    const sh = Spicetify.Player.getShuffle();
    shuffleBtn.classList.toggle("on", !!sh);
    shuffleBtn.classList.toggle("off", !sh);
    const rp = Spicetify.Player.getRepeat();
    setIcon(repeatBtn, rp === 2 ? "repeat-once" : "repeat", 26);
    repeatBtn.classList.toggle("on", rp > 0);
    repeatBtn.classList.toggle("off", rp === 0);
  }

  // ---------- rewind sound: soft, low tape-rewind rumble that follows the hand's speed ----------
  const sfx = { ac: null, speed: 0, gain: 0, phase: 0, pitch: 1, nextJump: 0, lp: 0, lp2: 0, n1: 0, n2: 0, quietSince: 0 };

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
      const v = (sfx.lp2 * 0.8 + sfx.n2 * 0.9) * sfx.gain;
      outL[i] = v;
      outR[i] = v;
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
  let lastRender = 0;

  function frame(t) {
    if (!(t - lastRender < 15)) {
      lastRender = t;
      try {
        renderFrame();
      } catch (err) {
        console.error("[Vinyl Rewind]", err);
      }
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
      curText.data = fmt(pos);
      const text = `${fmt(pos)} of ${fmt(dur)}`;
      for (const el of [discEl, barEl]) {
        el.setAttribute("aria-valuemax", String(Math.round(dur)));
        el.setAttribute("aria-valuenow", String(sec));
        el.setAttribute("aria-valuetext", text);
      }
      lastSec = sec;
    }
    if (dur !== lastDur) { durText.data = fmt(dur); lastDur = dur; }
    const p = dur ? Math.min(1, Math.max(0, pos / dur)) : 0;
    if (Math.abs(p - lastP) > 0.0002) {
      fillEl.style.transform = `scaleX(${p})`;
      railEl.style.transform = `translateX(${p * 100}%)`;
      lastP = p;
    }
    syncVolume();
    if (sfx.ac) {
      // the sound engine sleeps whenever the record is not being held
      if (grabbing || sfx.gain > 0) {
        sfx.quietSince = 0;
      } else if (sfx.ac.state === "running") {
        if (!sfx.quietSince) sfx.quietSince = performance.now();
        else if (performance.now() - sfx.quietSince > 1500) sfx.ac.suspend();
      }
    }
    updateLyric(pos);
    const now = performance.now();
    if (!(now < renderFrame.nextCheck)) {
      renderFrame.nextCheck = now + 1000; // the queue can change at any time, playing or paused
      if (lyrics.failedAt && now - lyrics.failedAt > 10000) loadLyrics(lyrics.uri); // lyrics request failed earlier: try again
      const it = nextItem();
      if ((it && it.uri) !== nextUri || (!it && !nextEl.classList.contains("hidden"))) updateNextUp();
    }
  }

  // the record's centre is measured when it is grabbed (it is held still while grabbed)
  let discCenter = null;

  function angleAt(e) {
    if (!discCenter || !grabbing) {
      const r = discEl.getBoundingClientRect();
      discCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return (Math.atan2(e.clientY - discCenter.y, e.clientX - discCenter.x) * 180) / Math.PI;
  }

  let grabStartPos = 0;

  discEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || grabbing || swap) return;
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

    discCenter = null; // re-measure for this grab
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
    setIcon(muteBtn, name, 22);
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
    if (act === "prev") skip(-1);
    else if (act === "next") skip(1);
    else if (act === "shuffle") Spicetify.Player.toggleShuffle();
    else if (act === "repeat") Spicetify.Player.toggleRepeat();
    setTimeout(updateButtons, 120);
    setTimeout(updateButtons, 500);
  });

  Spicetify.Player.addEventListener("songchange", () => {
    if (performance.now() < prevPendingUntil) {
      prevPendingUntil = 0;
      startSwap(-1); // runs before updateTrack, so the outgoing record still shows the old cover
    }
    if (grabbing) release(null, false); // the position being scrubbed belongs to the old song
    barDrag = null;
    if (isOpen) updateTrack();
    else setTimeout(preloadUpcoming, 300);
  });
  // remember whether music was playing, so "Open when music starts" only reacts to paused -> playing
  let lastKnownPlaying = false;
  try { lastKnownPlaying = Spicetify.Player.isPlaying(); } catch {}

  Spicetify.Player.addEventListener("onplaypause", () => {
    let playing = false;
    try { playing = Spicetify.Player.isPlaying(); } catch {}
    const started = playing && !lastKnownPlaying;
    lastKnownPlaying = playing;
    if (!isOpen) {
      if (started && settings.autoOpen) open();
      return;
    }
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
    const withLyrics = settings.lyrics;
    const grow = Math.min(DISC_OVERSIZE, (H * (withLyrics ? 0.68 : 0.74)) / d);
    const center = H * (withLyrics ? 0.42 : 0.45);
    const dy = center - (slotEl.offsetTop + d / 2);
    discEl.style.transform = `translateY(${dy}px) scale(${grow / DISC_OVERSIZE})`;
    const barY = H * (withLyrics ? 0.915 : 0.9);
    const py = barY - (progressEl.offsetTop + progressEl.offsetHeight / 2);
    progressEl.style.transform = `translateY(${py}px)`;
    // lyric line sits in the gap between the record and the progress bar
    const discBottom = center + (d * grow) / 2;
    lyricEl.style.top = discBottom + (barY - discBottom) / 2 - lyricEl.offsetHeight / 2 + "px";
  }

  function setIdle(on) {
    if (idle === on) return;
    idle = on;
    overlay.classList.toggle("idle", on);
    layoutIdle();
    if (!on) showLyric(-1);
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
  window.addEventListener("resize", () => {
    if (idle) layoutIdle();
    if (isOpen) updateNextUp();
  });

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
    if (isOpen) {
      lyrics = { uri: null, lines: null, failedAt: 0 }; // reload (or drop) lyrics to match the setting
      const item = currentItem();
      loadLyrics(item && item.uri);
      updateNextUp();
      if (idle) layoutIdle();
    }
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
    requestAnimationFrame(updateNextUp);
    scheduleGlimpse(6000);
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
    showLyric(-1);
    clearTimeout(glimpseTimer);
    setNear(false);
    endSwap();
    if (sfx.ac) setTimeout(() => !isOpen && sfx.ac.suspend(), 200);
    button.active = false;
  }

  // ---------- Settings > Vinyl mode ----------
  const SETTING_ROWS = [
    ["autoOpen", "Open when music starts", "Open Vinyl mode automatically whenever you start playing music."],
    ["reduceMotion", "Reduce motion", "Keep the record still and turn off zoom and fade animations."],
    ["sound", "Rewind sound", "Play a soft rewind sound while you turn the record."],
    ["idle", "Hide controls when idle", "After a few seconds without the mouse, show only the record and the progress bar."],
    ["texture", "Background texture", "Add a faint paper texture behind the record."],
    ["lyrics", "Lyrics when idle", "Show the current line of synced lyrics under the record when the controls are hidden."],
    ["nextUp", "Show next song", "Show the next song as a record at the edge of the screen. Click or drag it in to skip."],
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
          <kbd>Tab</kbd><span>Reach the next-song record, then Enter to skip</span>
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

  // Grayscale crumpled-paper texture, centered on mid-gray so it only adds creases and facets to the color.
  function crumpleTexture() {
    return "data:image/webp;base64,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";
  }
})();
