// NAME: Vinyl Rewind
// AUTHOR: Parker
// VERSION: 1.7.13.0
// DESCRIPTION: A fullscreen spinning record for Spotify. Grab and turn it to rewind or fast-forward the song like a real turntable.

(function VinylRewind() {
  const ButtonApi = window.Spicetify && ((Spicetify.Playbar && Spicetify.Playbar.Button) || (Spicetify.Topbar && Spicetify.Topbar.Button));
  // wait for Spicetify's player; the button API gets ~10 s more, after which Vinyl mode starts without a
  // button (Alt+Shift+V and the Home card still open it)
  VinylRewind.tries = (VinylRewind.tries || 0) + 1;
  const buttonLate = !ButtonApi && VinylRewind.tries < 35;
  if (!window.Spicetify || !Spicetify.Player || !Spicetify.Player.origin || buttonLate || !document.body) {
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
  // Grayscale crumpled-paper texture, centred on mid-grey so it only adds creases and facets to the colour.
  // Loaded from the CDN at the exact upload (a commit, so it never goes stale); offline it is simply left out.
  const PAPER_URL = "https://cdn.jsdelivr.net/gh/yuhhim/spicetify-vinyl-rewind@bc379278e687ffdcf2c878942916c64625e37127/paper.webp";

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
    remaining: false, // click the song length to show the time left instead (like Spotify's own bar)
  };
  const settings = { ...SETTINGS_DEFAULTS };
  try {
    const saved = JSON.parse((Spicetify.LocalStorage ? Spicetify.LocalStorage.get(SETTINGS_KEY) : localStorage.getItem(SETTINGS_KEY)) || "{}");
    for (const k of Object.keys(SETTINGS_DEFAULTS)) if (typeof saved[k] === "boolean") settings[k] = saved[k];
  } catch {}

  // only choices that differ from the defaults are stored, so improved defaults (and the system's
  // reduced-motion preference) still reach everyone who never changed that setting
  function saveSettings() {
    try {
      const changed = {};
      for (const k of Object.keys(SETTINGS_DEFAULTS)) if (settings[k] !== SETTINGS_DEFAULTS[k]) changed[k] = settings[k];
      const v = JSON.stringify(changed);
      Spicetify.LocalStorage ? Spicetify.LocalStorage.set(SETTINGS_KEY, v) : localStorage.setItem(SETTINGS_KEY, v);
    } catch {}
  }

  // ---------- styles ----------
  const style = document.createElement("style");
  style.id = "vinyl-rewind-style";
  style.textContent = `
/* Spotify's own interface is taken out of layout while Vinyl mode covers it, so its hidden panels
   cost nothing to re-measure on every song change */
body.vr-open > *:not(#vr-overlay) { display: none !important; }
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
  /* record size: fits the width, and leaves room below for the title, progress bar and controls */
  --D: min(58vh, 72vw, calc((100vh - 270px) / 1.1));
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
/* ? = a small card listing the keyboard shortcuts (only there when asked for) */
#vr-overlay .vr-help {
  position: absolute; left: 50%; top: 50%; z-index: 5; box-sizing: border-box;
  width: max-content; max-width: min(460px, calc(100vw - 32px)); padding: 22px 26px; border-radius: 14px;
  background: rgba(0,0,0,0.55); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
  box-shadow: 0 20px 60px rgba(0,0,0,0.35); color: #fff; outline: none;
  opacity: 0; visibility: hidden; pointer-events: none; transform: translate(-50%, -50%) scale(0.97);
  transition: opacity 0.18s ease, transform 0.18s ease, visibility 0s linear 0.18s;
}
#vr-overlay .vr-help.show { opacity: 1; visibility: visible; pointer-events: auto; transform: translate(-50%, -50%); transition: opacity 0.18s ease, transform 0.18s ease; }
#vr-overlay .vr-help h3 { margin: 0 0 14px; font-size: 17px; font-weight: 700; }
#vr-overlay .vr-help dl { display: grid; grid-template-columns: auto 1fr; gap: 9px 18px; margin: 0; font-size: 14px; line-height: 1.5; }
#vr-overlay .vr-help dt { text-align: right; white-space: nowrap; }
#vr-overlay .vr-help dd { margin: 0; opacity: 0.85; }
#vr-overlay .vr-help kbd {
  display: inline-block; min-width: 22px; padding: 1px 7px; border-radius: 6px; box-sizing: border-box;
  background: rgba(255,255,255,0.15); font: inherit; font-size: 12.5px; font-weight: 600; text-align: center;
}
/* title -> album, artist -> artist page, like Spotify's own now-playing bar */
#vr-overlay .vr-meta [data-href] { cursor: pointer; }
#vr-overlay .vr-meta [data-href]:hover { text-decoration: underline; }
/* L = like: a heart pops over the middle of the record (filled = saved, outline = removed) */
#vr-overlay .vr-heart {
  position: absolute; left: 50%; top: 50%; z-index: 2; pointer-events: none;
  width: 26%; height: 26%; margin: -13% 0 0 -13%; opacity: 0;
  color: #fff; filter: drop-shadow(0 4px 18px rgba(0,0,0,0.45));
}
#vr-overlay .vr-heart svg { width: 100%; height: 100%; display: block; overflow: visible; }
#vr-overlay .vr-heart path { fill: currentColor; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; }
#vr-overlay .vr-heart.off path { fill: none; }
#vr-overlay .vr-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
#vr-overlay .vr-spin {
  position: absolute; inset: 0; border-radius: 50%;
  will-change: transform; backface-visibility: hidden; transform: translateZ(0);
}
#vr-overlay .vr-spin .vr-old-cover { position: absolute; inset: 0; opacity: 0; }
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
#vr-overlay .vr-time.dur { cursor: pointer; border-radius: 4px; }
#vr-overlay .vr-time.dur:hover { opacity: 1; text-decoration: underline; }
#vr-overlay .vr-time.cur { text-align: right; }
#vr-overlay .vr-bar { position: relative; flex: 1; height: 20px; cursor: pointer; touch-action: none; }
#vr-overlay .vr-track, #vr-overlay .vr-fill {
  position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px;
}
#vr-overlay .vr-track { background: rgba(255,255,255,0.35); }
#vr-overlay .vr-fill { background: #fff; transform-origin: 0 50%; transform: scaleX(0); will-change: transform; }
#vr-overlay .vr-thumb-rail { position: absolute; inset: 0; will-change: transform; pointer-events: none; }
#vr-overlay .vr-bar-tip {
  position: absolute; left: 0; bottom: 22px; pointer-events: none; white-space: nowrap;
  padding: 3px 8px; border-radius: 6px; font-size: 12px; font-variant-numeric: tabular-nums;
  background: rgba(0,0,0,0.55); color: #fff; opacity: 0; transition: opacity 0.12s;
}
#vr-overlay .vr-bar-tip.show { opacity: 1; }
#vr-overlay.idle .vr-bar-tip { opacity: 0; }
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
/* short windows: a little tighter so the record can stay large */
@media (max-height: 680px) {
  #vr-overlay .vr-title { font-size: 26px; }
  #vr-overlay .vr-artist { font-size: 17px; }
  #vr-overlay .vr-progress { margin-top: 14px; }
  #vr-overlay .vr-controls { margin-top: 10px; gap: 30px; }
  #vr-overlay .vr-play { width: 68px; height: 68px; }
}
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
#vr-overlay button:focus-visible, #vr-overlay .vr-meta [data-href]:focus-visible, #vr-overlay .vr-time.dur:focus-visible, #vr-overlay .vr-disc:focus-visible, #vr-overlay .vr-bar:focus-visible, #vr-overlay .vr-vol-bar:focus-visible {
  outline: 2px solid #fff; outline-offset: 4px;
}
#vr-overlay button:focus:not(:focus-visible), #vr-overlay .vr-meta [data-href]:focus:not(:focus-visible), #vr-overlay .vr-time.dur:focus:not(:focus-visible), #vr-overlay .vr-disc:focus:not(:focus-visible), #vr-overlay .vr-bar:focus:not(:focus-visible) { outline: none; }
#vr-overlay .vr-volume:focus-within { width: 184px; background: rgba(255,255,255,0.12); }
#vr-overlay .vr-volume:focus-within .vr-vol-bar { opacity: 1; }
/* settings */
#vr-overlay.reduce-motion, #vr-overlay.reduce-motion * { transition-duration: 0.01s !important; animation-duration: 0.01s !important; }
/* Home: our card sits under Spotify's own Getting started card */
.vr-home-card { margin-top: 12px; }
.vr-home-card .vr-home-art { border-radius: 50%; }
.vr-home-card:hover .vr-home-art { animation: vr-home-spin 4s linear infinite; }
@keyframes vr-home-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .vr-home-card .vr-home-art { animation: none; } }
.vr-home-card.reduce-motion .vr-home-art { animation: none; }
#vr-settings .x-settings-firstColumn { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.vr-quick-settings { display: flex; flex-direction: column; min-width: 360px; }
.vr-quick-settings .x-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 32px; padding: 10px 0; }
.vr-quick-settings label { color: var(--spice-text, #fff); }
`;
  document.head.appendChild(style);

  // Spotify's own icons are used when they exist; these simple stand-ins keep every button visible if a future
  // Spotify renames or drops one
  const FALLBACK_ICONS = {
    x: "M3.3 2.2 8 6.9l4.7-4.7 1.1 1.1L9.1 8l4.7 4.7-1.1 1.1L8 9.1l-4.7 4.7-1.1-1.1L6.9 8 2.2 3.3z",
    play: "M4 2.3v11.4L13.8 8z",
    pause: "M3.5 2h3v12h-3zM9.5 2h3v12h-3z",
    "skip-back": "M2.5 2H4v12H2.5zM13.5 2.5v11L5 8z",
    "skip-forward": "M12 2h1.5v12H12zM2.5 2.5v11L11 8z",
    shuffle: "M11.5 1.5 14.5 4l-3 2.5V4.8h-.6c-.9 0-1.7.4-2.2 1.1L5.4 10.5c-.8 1.1-2 1.7-3.3 1.7H1v-1.5h1.1c.8 0 1.5-.4 2-1l3.3-4.6c.8-1.1 2.1-1.8 3.5-1.8h.6zM1 3.8h1.1c1.3 0 2.5.6 3.3 1.7l.4.6-.9 1.2-.7-.9c-.5-.7-1.3-1.1-2.1-1.1H1zm8.1 6 .9-1.2.7.9c.5.7 1.3 1.1 2.1 1.1h.7V9l3 2.5-3 2.5v-1.7h-.7c-1.4 0-2.6-.7-3.4-1.8z",
    repeat: "M1 8V7a4 4 0 0 1 4-4h6.5V1.5l3 2.5-3 2.5V4.5H5A2.5 2.5 0 0 0 2.5 7v1zM15 8v1a4 4 0 0 1-4 4H4.5v1.5l-3-2.5 3-2.5v1.5H11A2.5 2.5 0 0 0 13.5 9V8z",
    "repeat-once": "M1 8V7a4 4 0 0 1 4-4h6.5V1.5l3 2.5-3 2.5V4.5H5A2.5 2.5 0 0 0 2.5 7v1zM15 8v1a4 4 0 0 1-4 4H4.5v1.5l-3-2.5 3-2.5v1.5H11A2.5 2.5 0 0 0 13.5 9V8zM7.3 5.8h1.4v4.4H7.3z",
    volume: "M1 5.5h3L8 2v12l-4-3.5H1zM10.2 5.2a4 4 0 0 1 0 5.6l-1-1a2.6 2.6 0 0 0 0-3.6zM12.3 3.1a7 7 0 0 1 0 9.8l-1-1a5.6 5.6 0 0 0 0-7.8z",
    "volume-two-wave": "M1 5.5h3L8 2v12l-4-3.5H1zM10.2 5.2a4 4 0 0 1 0 5.6l-1-1a2.6 2.6 0 0 0 0-3.6zM12.3 3.1a7 7 0 0 1 0 9.8l-1-1a5.6 5.6 0 0 0 0-7.8z",
    "volume-one-wave": "M1 5.5h3L8 2v12l-4-3.5H1zM10.2 5.2a4 4 0 0 1 0 5.6l-1-1a2.6 2.6 0 0 0 0-3.6z",
    "volume-off": "M1 5.5h3L8 2v12l-4-3.5H1zM10 5.9l1-1 1.6 1.6 1.6-1.6 1 1-1.6 1.6 1.6 1.6-1 1-1.6-1.6-1.6 1.6-1-1 1.6-1.6z",
  };
  // the player controls use Spotify's own words, so they appear in the language Spotify is set to (English otherwise)
  const t = (key, fallback) => {
    try {
      const v = Spicetify.Locale && Spicetify.Locale.get(key);
      return typeof v === "string" && v && v !== key ? v : fallback;
    } catch {
      return fallback;
    }
  };
  const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const LABEL = {
    play: t("playback-control.play", "Play"),
    pause: t("playback-control.pause", "Pause"),
    prev: t("playback-control.skip-back", "Previous"),
    next: t("playback-control.skip-forward", "Next"),
    shuffleOn: t("playback-control.enable-shuffle", "Enable shuffle"),
    shuffleOff: t("playback-control.disable-shuffle", "Disable shuffle"),
    repeatOn: t("playback-control.enable-repeat", "Enable repeat"),
    repeatOne: t("playback-control.enable-repeat-one", "Enable repeat one"),
    repeatOff: t("playback-control.disable-repeat", "Disable repeat"),
    mute: t("playback-control.mute", "Mute"),
    unmute: t("playback-control.unmute", "Unmute"),
    close: t("close", "Close"),
    fullscreen: t("npv.full-screen", "Full screen"),
    exitFullscreen: t("web-player.cinema-mode.fullscreen.exit", "Exit full screen"),
    volume: t("playback-control.a11y.volume-slider-button", "Change volume"),
    progress: t("playback-control.a11y.seek-slider-button", "Change progress"),
  };

  const icon = (name, size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor">${(Spicetify.SVGIcons && Spicetify.SVGIcons[name]) || (FALLBACK_ICONS[name] ? `<path d="${FALLBACK_ICONS[name]}"/>` : "")}</svg>`;
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
    <div class="vr-ghost" hidden><div class="vr-ghost-spin"><img alt="" /></div><div class="vr-hole"></div></div>
    <div class="vr-lyric" dir="auto" aria-hidden="true"></div>
    <div class="vr-live" role="status" aria-live="polite"></div>
    <div class="vr-help" role="dialog" aria-label="Keyboard shortcuts" tabindex="-1">
      <h3>Keyboard shortcuts</h3>
      <dl>
        <dt><kbd>Space</kbd></dt><dd>Play / pause</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Rewind / skip ahead 5 s (hold Shift for 15 s)</dd>
        <dt><kbd>N</kbd> <kbd>P</kbd></dt><dd>Next / previous song</dd>
        <dt><kbd>L</kbd></dt><dd>Like or unlike the song</dd>
        <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Volume</dd>
        <dt><kbd>M</kbd></dt><dd>Mute</dd>
        <dt><kbd>F</kbd></dt><dd>Full screen</dd>
        <dt><kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>V</kbd></dt><dd>Open or close Vinyl mode</dd>
        <dt><kbd>Esc</kbd></dt><dd>Leave full screen, then close</dd>
      </dl>
    </div>
    <button class="vr-next hidden" data-act="next-record" aria-label="Next song"><img alt="" /></button>
    <button class="vr-close vr-full" data-act="fullscreen"></button>
    <button class="vr-close" data-act="close" aria-label="${attr(LABEL.close)}" title="${attr(LABEL.close)}">${icon("x", 22)}</button>
    <div class="vr-disc-slot"><div class="vr-disc" tabindex="0" role="slider" aria-label="Record. Turn to rewind or fast-forward" aria-valuemin="0">
      <div class="vr-spin">
        <img alt="" />
        <img alt="" class="vr-old-cover" aria-hidden="true" />
      </div>
      <div class="vr-hole"></div>
      <div class="vr-heart" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4.1 7.8 4.1c1.5 0 3 .7 4.2 1.9 1.2-1.2 2.7-1.9 4.2-1.9 2.7 0 4.8 2.1 4.8 4.8 0 3.3-3 6-7.7 10.2L12 20.3z"/></svg></div>
    </div></div>
    <div class="vr-meta">
      <div class="vr-title" dir="auto"></div>
      <div class="vr-artist" dir="auto"></div>
    </div>
    <div class="vr-progress">
      <span class="vr-time cur">0:00</span>
      <div class="vr-bar" tabindex="0" role="slider" aria-label="${attr(LABEL.progress)}" aria-valuemin="0">
        <div class="vr-track"></div><div class="vr-fill"></div>
        <div class="vr-thumb-rail"><div class="vr-thumb"></div></div>
        <div class="vr-bar-tip" aria-hidden="true">0:00</div>
      </div>
      <span class="vr-time dur" role="button" tabindex="0">0:00</span>
    </div>
    <div class="vr-controls">
      <button class="vr-ctl" data-act="shuffle" aria-label="${attr(LABEL.shuffleOn)}" title="${attr(LABEL.shuffleOn)}">${icon("shuffle", 26)}</button>
      <button class="vr-ctl" data-act="prev" aria-label="${attr(LABEL.prev)}" title="${attr(LABEL.prev)}">${icon("skip-back", 30)}</button>
      <button class="vr-ctl vr-play" data-act="play" aria-label="Play/Pause"></button>
      <button class="vr-ctl" data-act="next" aria-label="${attr(LABEL.next)}" title="${attr(LABEL.next)}">${icon("skip-forward", 30)}</button>
      <button class="vr-ctl" data-act="repeat" aria-label="${attr(LABEL.repeatOn)}" title="${attr(LABEL.repeatOn)}">${icon("repeat", 26)}</button>
      <div class="vr-volume">
      <button class="vr-vol-btn" data-act="mute" aria-label="${attr(LABEL.mute)}"></button>
      <div class="vr-vol-bar" tabindex="0" role="slider" aria-label="${attr(LABEL.volume)}" aria-valuemin="0" aria-valuemax="100">
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
  crinkleEls.forEach((el) => (el.style.backgroundImage = `url("${PAPER_URL}")`));
  const discEl = $(".vr-disc");
  const slotEl = $(".vr-disc-slot");
  const progressEl = $(".vr-progress");
  const lyricEl = $(".vr-lyric");
  const lyricText = textSlot(lyricEl);
  const liveText = textSlot($(".vr-live")); // read out by screen readers
  const nextEl = $(".vr-next");
  const nextImg = $(".vr-next img");
  const spinEl = $(".vr-spin");
  const coverImg = $(".vr-spin img");
  const oldCoverImg = $(".vr-spin .vr-old-cover");
  const titleEl = $(".vr-title");
  const artistEl = $(".vr-artist");
  const titleText = textSlot(titleEl);
  const ghostEl = $(".vr-ghost");
  const ghostSpin = $(".vr-ghost-spin");
  const ghostImg = $(".vr-ghost-spin img");
  const artistText = textSlot(artistEl);
  const curEl = $(".vr-time.cur");
  const durEl = $(".vr-time.dur");
  const curText = textSlot(curEl);
  const durText = textSlot(durEl);
  const barEl = $(".vr-bar");
  const barTip = $(".vr-bar-tip");
  const barTipText = textSlot(barTip);
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

  // cover of a player item: the metadata fields first, then Spotify's structured images list (future-proofing)
  function imageUrl(meta, item) {
    let raw = meta && (meta.image_xlarge_url || meta.image_large_url || meta.image_url);
    if (!raw && item && Array.isArray(item.images) && item.images.length) {
      const pick = (label) => item.images.find((im) => im && im.label === label);
      raw = (pick("xlarge") || pick("large") || item.images[item.images.length - 1] || {}).url;
    }
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
  // one small CPU-side canvas, reused for every cover
  let colorCtx = null;
  // relative luminance (WCAG) of an HSL color, all values 0..1
  function luminance(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h * 6) % 6];
    const lin = (v) => (v + m <= 0.04045 ? (v + m) / 12.92 : Math.pow((v + m + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function dominantColor(bmp) {
    if (!colorCtx) {
      const c = document.createElement("canvas");
      c.width = c.height = 48;
      colorCtx = c.getContext("2d", { willReadFrequently: true });
    }
    const ctx = colorCtx;
    ctx.clearRect(0, 0, 48, 48);
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
    // bright hues (yellow, green, cyan) look far lighter than their HSL lightness says: darken them just enough
    // that the white title, artist and times stay readable (about 3.5:1 contrast)
    while (l > 0.2 && luminance(h, s, l) > 0.25) l -= 0.01;
    return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  // Cover art + its color are prepared together (and cached), then swapped in on the same frame.
  const coverCache = new Map(); // image url -> Promise<{ src, color }>

  function loadCover(url) {
    let p = coverCache.get(url);
    if (!p) {
      p = (async () => {
        // the picture itself loads straight from Spotify's image server (browser-cached, decoded off the main thread)
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        const decoded = img.decode().catch(() => {});
        // its colour comes from a tiny copy, shrunk off the main thread
        const blob = await (await fetch(url)).blob();
        const bmp = await createImageBitmap(blob, { resizeWidth: 48, resizeHeight: 48, resizeQuality: "low" });
        const color = dominantColor(bmp);
        bmp.close?.();
        await decoded;
        return { src: url, color, img }; // img keeps the decoded picture warm for an instant swap
      })();
      p.catch(() => coverCache.delete(url));
      coverCache.set(url, p);
      if (coverCache.size > 12) coverCache.delete(coverCache.keys().next().value); // current, upcoming and a few recent
    }
    return p;
  }

  // Warm up the next couple of tracks (and the previous one) so skipping swaps instantly.
  function preloadUpcoming() {
    if (!isOpen) return;
    const d = Spicetify.Player.data || {};
    const q = Spicetify.Queue || {};
    const items = [
      ...(d.nextItems || []).slice(0, 2),
      ...(d.previousItems || []).slice(-1),
      ...(q.nextTracks || []).slice(0, 2).map((t) => t && (t.contextTrack || t)),
    ];
    const seen = new Set();
    for (const it of items) {
      const url = imageUrl((it && it.metadata) || null, it);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      loadCover(url).catch(() => {});
    }
    // the next song's lyrics too, so its first line is ready the moment it starts (same request, just earlier)
    if (settings.lyrics) {
      const n = nextItem();
      if (n && n.uri) fetchLyrics(n.uri);
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
  let shownUri = null; // the song Vinyl mode is showing (or loading)
  async function updateTrack() {
    const item = currentItem();
    shownUri = (item && item.uri) || null;
    const meta = (item && item.metadata) || {};
    const title = meta.title || (item && item.name) || "Nothing playing";
    const artists = item && Array.isArray(item.artists) ? item.artists.map((a) => a && a.name).filter(Boolean).join(", ") : "";
    const artist = meta.artist_name || artists || meta.album_title || meta.show_name || "";
    const url = imageUrl(meta, item);
    const token = ++trackToken;

    let cover = null;
    if (url) {
      try {
        // do not hold the title back forever on a slow network
        cover = await Promise.race([loadCover(url), new Promise((r) => setTimeout(() => r(null), 1500))]);
      } catch {}
    }
    if (token !== trackToken) return;

    // a new song while the controls are hidden: name it for a moment in the lyric line
    if (idle && titleText.data && (titleText.data !== title || artistText.data !== artist)) announceSong(artist ? title + " · " + artist : title);
    titleText.data = title;
    setLink(titleEl, (item && item.album && item.album.uri) || meta.album_uri || (item && item.show && item.show.uri) || meta.show_uri);
    setLink(artistEl, (item && Array.isArray(item.artists) && item.artists[0] && item.artists[0].uri) || meta.artist_uri);
    titleEl.title = title; // full text on hover when a long title is cut off
    artistText.data = artist;
    artistEl.title = artist;
    const uri = item && item.uri;
    if (cover) {
      if (coverImg.src !== cover.src) crossfadeCover();
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

  // the title and artist lead to their pages in Spotify (Vinyl mode closes on the way)
  function uriPath(uri) {
    const m = /^spotify:(album|artist|show|episode|playlist):([A-Za-z0-9]+)$/.exec(uri || "");
    return m ? `/${m[1]}/${m[2]}` : null;
  }
  function setLink(el, uri) {
    const path = uriPath(uri);
    if (path === (el.dataset.href || null)) return;
    if (path) {
      el.dataset.href = path;
      el.setAttribute("role", "link");
      el.tabIndex = 0;
    } else {
      delete el.dataset.href;
      el.removeAttribute("role");
      el.removeAttribute("tabindex");
    }
  }
  function followLink(el) {
    const path = el && el.dataset.href;
    if (!path || !Spicetify.Platform || !Spicetify.Platform.History) return;
    close();
    Spicetify.Platform.History.push(path);
  }
  titleEl.addEventListener("click", () => followLink(titleEl));
  artistEl.addEventListener("click", () => followLink(artistEl));
  for (const el of [titleEl, artistEl]) {
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      followLink(el);
    });
  }

  // ---------- synced lyrics (idle mode) ----------
  const lyricsCache = new Map(); // track id -> Promise<[{ t, text }] | null>
  let lyrics = { uri: null, lines: null, failedAt: 0 };
  let lyricIndex = -1;
  let announceUntil = 0; // a new song name is showing in the lyric line until then

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
      if (performance.now() >= announceUntil) showLyric(-1); // (a song name being announced stays)
    }
    if (!settings.lyrics) return;
    lyrics.failedAt = 0;
    fetchLyrics(uri).then((lines) => {
      if (lyrics.uri !== uri) return;
      if (lines === undefined) lyrics.failedAt = performance.now(); // retried shortly, see renderFrame
      else lyrics.lines = lines;
    });
  }

  // briefly show the new song's name in the lyric line (idle mode), then lyrics carry on
  function announceSong(text) {
    announceUntil = performance.now() + 4200;
    lyricIndex = -2; // makes the next lyric update redraw, whatever line it is
    clearTimeout(showLyric.timer);
    if (settings.reduceMotion) {
      lyricText.data = text;
      lyricEl.classList.add("show");
      return;
    }
    lyricEl.classList.remove("show");
    showLyric.timer = setTimeout(() => {
      lyricText.data = text;
      lyricEl.classList.add("show");
    }, 180);
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
    if (performance.now() < announceUntil) return;
    const lines = settings.lyrics && idle ? lyrics.lines : null;
    if (!lines || !lines.length) return showLyric(-1);
    // carry on from the line showing now (runs every frame); start over only after a jump backwards
    const at = pos + 0.15;
    let i = lyricIndex >= 0 && lyricIndex < lines.length && lines[lyricIndex].t <= at ? lyricIndex : -1;
    while (i + 1 < lines.length && lines[i + 1].t <= at) i++;
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
    const url = it && imageUrl(it.metadata, it);
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
      cmd.next();
    } else {
      // Previous may just restart the song, so only roll once Spotify really changes it (see songchange)
      prevPendingUntil = performance.now() + 1500;
      cmd.back();
    }
    setTimeout(updateNextUp, 900);
  }

  function startSwap(dir) {
    if (!isOpen || settings.reduceMotion) return;
    endSwap();
    if (fadeAnim) { fadeAnim.cancel(); fadeAnim = null; }
    const r = discEl.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    ghostEl.style.cssText = `left:${r.left - o.left}px;top:${r.top - o.top}px;width:${r.width}px;height:${r.height}px`;
    ghostSpin.style.transform = `rotate(${getAngle()}deg)`;
    const hasCover = coverImg.style.visibility !== "hidden" && coverImg.src;
    ghostImg.style.visibility = hasCover ? "" : "hidden";
    if (hasCover) ghostImg.src = coverImg.src;
    ghostEl.hidden = false;
    // rolling away: moving left means turning counter-clockwise (and the reverse for Previous)
    const anim = ghostEl.animate(
      [{ transform: "none" }, { transform: `translateX(${dir > 0 ? -110 : 110}vw) rotate(${dir > 0 ? -150 : 150}deg)` }],
      { duration: 460, easing: "cubic-bezier(0.55, 0, 0.8, 0.25)", fill: "forwards" }
    );
    anim.finished.then(() => { ghostEl.hidden = true; anim.cancel(); }, () => {});
    slotEl.style.opacity = "0";
    // normally the new cover arrives well before this; it is only a safety net so the record never stays away
    swap = { dir, anim, timer: setTimeout(arriveSwap, 1800) };
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
    swap.anim.cancel();
    ghostEl.hidden = true;
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
    if (idle || hand.holding || nextEl.classList.contains("hidden") || performance.now() < nextQuietUntil) return setNear(false);
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

  // A song that changes by itself (not a skip): the old cover fades out over the new one. The old cover is
  // a second layer inside the spinning record, so it always matches the record's size, position and turn.
  let fadeAnim = null;
  function crossfadeCover() {
    if (!isOpen || swap || settings.reduceMotion || overlay.classList.contains("vr-instant")) return;
    if (!coverImg.src || coverImg.style.visibility === "hidden") return;
    if (fadeAnim) fadeAnim.cancel();
    oldCoverImg.src = coverImg.src;
    const anim = (fadeAnim = oldCoverImg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 550, easing: "ease-out" }));
    anim.finished.then(() => { if (fadeAnim === anim) fadeAnim = null; }, () => {});
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

  function setIcon(el, name, size) {
    if (el.dataset.icon === name) return;
    el.dataset.icon = name;
    el.innerHTML = icon(name, size);
  }

  // a control's name and state change only with it, so these writes are rare
  function setLabel(el, label) {
    if (el.getAttribute("aria-label") === label && el.title === label) return;
    el.setAttribute("aria-label", label);
    el.title = label;
  }
  function renderPlayButton(playing) {
    setIcon(playBtn, playing ? "pause" : "play", 32);
    setLabel(playBtn, playing ? LABEL.pause : LABEL.play);
  }

  function updateButtons() {
    renderPlayButton(isPlaying());
    updateRestrictions();
    const sh = Spicetify.Player.getShuffle();
    shuffleBtn.classList.toggle("on", !!sh);
    shuffleBtn.classList.toggle("off", !sh);
    shuffleBtn.setAttribute("aria-pressed", String(!!sh)); // screen readers hear "on" / "off"
    setLabel(shuffleBtn, sh ? LABEL.shuffleOff : LABEL.shuffleOn); // what a click will do, like Spotify's own buttons
    const rp = Spicetify.Player.getRepeat();
    setIcon(repeatBtn, rp === 2 ? "repeat-once" : "repeat", 26);
    repeatBtn.classList.toggle("on", rp > 0);
    repeatBtn.classList.toggle("off", rp === 0);
    repeatBtn.setAttribute("aria-pressed", String(rp > 0));
    setLabel(repeatBtn, rp === 0 ? LABEL.repeatOn : rp === 1 ? LABEL.repeatOne : LABEL.repeatOff);
  }

  // ---------- rewind sound: soft, low tape-rewind rumble that follows the hand's speed ----------
  // It runs on the audio thread (AudioWorklet), so busy moments in Spotify can never make it stutter.
  // Older engines without AudioWorklet get the same sound from a ScriptProcessor on the main thread.
  const sfx = { ac: null, port: null, sent: 0, speed: 0, gain: 0, phase: 0, pitch: 1, nextJump: 0, lp: 0, lp2: 0, n1: 0, n2: 0, quietSince: 0 };

  // Pure DSP (also shipped to the audio thread as source text, so it may only use its arguments and Math).
  // st: filter/gain state, speed: multiples of normal playback speed.
  function sfxRender(st, speed, outL, outR, sr) {
    const n = outL.length;
    speed = Math.min(8, Math.abs(speed));
    const target = speed > 0.1 ? Math.min(0.06, 0.018 + speed * 0.008) : 0;
    if (target === 0 && st.gain === 0) {
      outL.fill(0);
      outR.fill(0);
      return;
    }
    const gStep = 1 / (sr * 0.006); // ~6 ms fades: instant but click-free
    const toneCut = Math.min(1, ((260 + speed * 90) / sr) * 6.283);
    const hissCut = Math.min(1, ((500 + speed * 160) / sr) * 6.283);
    for (let i = 0; i < n; i++) {
      // garble: pitch hops like voices on a rewinding tape
      if (--st.nextJump <= 0) {
        st.pitch = 0.75 + Math.random() * 0.5;
        st.nextJump = sr * (0.04 + Math.random() * 0.06);
      }
      st.phase += ((55 + speed * 28) * st.pitch) / sr;
      if (st.phase > 1) st.phase -= 1;
      const saw = st.phase * 2 - 1;
      st.lp += (saw - st.lp) * toneCut;
      st.lp2 += (st.lp - st.lp2) * toneCut;
      // soft low hiss
      const noise = Math.random() * 2 - 1;
      st.n1 += (noise - st.n1) * hissCut;
      st.n2 += (st.n1 - st.n2) * hissCut;
      st.gain += target > st.gain ? Math.min(gStep, target - st.gain) : -Math.min(gStep, st.gain - target);
      const v = (st.lp2 * 0.8 + st.n2 * 0.9) * st.gain;
      outL[i] = v;
      outR[i] = v;
    }
  }

  const SFX_WORKLET = `${sfxRender.toString()}
class VrSfx extends AudioWorkletProcessor {
  constructor() {
    super();
    this.st = { gain: 0, phase: 0, pitch: 1, nextJump: 0, lp: 0, lp2: 0, n1: 0, n2: 0 };
    this.speed = 0;
    this.port.onmessage = (e) => (this.speed = +e.data || 0);
  }
  process(inputs, outputs) {
    const o = outputs[0];
    sfxRender(this.st, this.speed, o[0], o[1] || o[0], sampleRate);
    return true;
  }
}
registerProcessor("vinyl-rewind-sfx", VrSfx);`;

  function setSfxSpeed(v) {
    sfx.speed = v;
    if (sfx.port && v !== sfx.sent) {
      sfx.sent = v;
      sfx.port.postMessage(v);
    }
  }

  function startSfx() {
    if (sfx.ac) {
      if (sfx.ac.state === "suspended") sfx.ac.resume();
      return;
    }
    let ac;
    try {
      ac = new AudioContext({ latencyHint: "interactive" });
    } catch {
      return;
    }
    sfx.ac = ac;
    const mainThread = () => {
      try {
        const node = ac.createScriptProcessor(512, 0, 2);
        node.onaudioprocess = (e) => sfxRender(sfx, sfx.speed, e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1), ac.sampleRate);
        node.connect(ac.destination);
      } catch {}
    };
    if (!ac.audioWorklet || typeof AudioWorkletNode !== "function") return mainThread();
    const url = URL.createObjectURL(new Blob([SFX_WORKLET], { type: "application/javascript" }));
    ac.audioWorklet
      .addModule(url)
      .then(() => {
        const node = new AudioWorkletNode(ac, "vinyl-rewind-sfx", { numberOfInputs: 0, outputChannelCount: [2] });
        node.connect(ac.destination);
        sfx.port = node.port;
        sfx.sent = 0;
        setSfxSpeed(sfx.speed); // catch up with a scratch that started while the module loaded
      })
      .catch(mainThread)
      .finally(() => URL.revokeObjectURL(url));
  }

  // ---------- turntable state ----------
  let isOpen = false;
  let raf = 0;
  // everything about a hand on the record, in one place
  const hand = {
    holding: false,    // a hand is on the record right now
    wasPlaying: false, // playback state before the hand touched it
    pos: 0,            // record position in the song (seconds) while held
    startPos: 0,       // ... when the hand touched it
    uri: null,         // the song under the hand; letting go never seeks inside a different one
    vel: 0,            // deg/s
    angle: 0,          // pointer angle around the centre
    movedAt: 0,        // last time the hand moved
    center: null,      // the record's centre, measured when grabbed (it is held still while grabbed)
  };
  let barDrag = null;      // seconds while dragging the progress bar
  let pendingPos = null;   // position shown right after a seek until Spotify catches up
  const drawn = { sec: -1, dur: -1, p: -1 }; // what the frame loop last put on screen (-1 = redraw)

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
    playing ? cmd.play() : cmd.pause();
  }

  // Spotify's player commands return promises that reject when there is nothing to do (e.g. "play" while a new
  // song has already started playing). The state is what we wanted either way, so the refusal is not an error.
  function settle(result) {
    if (result && typeof result.catch === "function") result.catch(() => {});
    return result;
  }

  // Spicetify's Player.* shortcuts call Spotify's player but drop the promise it returns, so a refusal would
  // surface as an uncaught error. Call Spotify's player directly when it has the method (and keep the promise);
  // otherwise fall back to Spicetify's shortcut, whatever a future version provides.
  function command(method, args, fallback) {
    const player = Spicetify.Player.origin;
    if (player && typeof player[method] === "function") return settle(player[method](...args));
    return settle(fallback());
  }
  const cmd = {
    play: () => command("resume", [], () => Spicetify.Player.play()),
    pause: () => command("pause", [], () => Spicetify.Player.pause()),
    next: () => command("skipToNext", [], () => Spicetify.Player.next()),
    back: () => command("skipToPrevious", [], () => Spicetify.Player.back()),
    seek: (ms) => command("seekTo", [ms], () => Spicetify.Player.seek(ms)),
    shuffle: () => command("setShuffle", [!Spicetify.Player.getShuffle()], () => Spicetify.Player.toggleShuffle()),
    repeat: () => command("setRepeat", [(Spicetify.Player.getRepeat() + 1) % 3], () => Spicetify.Player.toggleRepeat()),
    volume: (v) => {
      const api = Spicetify.Platform && Spicetify.Platform.PlaybackAPI;
      return settle(api && typeof api.setVolume === "function" ? api.setVolume(v) : Spicetify.Player.setVolume(v));
    },
  };

  const durationSec = () => (Spicetify.Player.getDuration() || 0) / 1000;
  const clampPos = (p) => Math.max(0, Math.min(p, Math.max(0, durationSec() - 0.3)));

  // 3:07, or 1:02:07 for an hour or more (podcasts, long mixes), like Spotify
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = String(sec % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }

  function seekTo(sec) {
    const pos = clampPos(sec);
    const now = performance.now();
    pendingPos = { pos, at: now, until: now + 1200 };
    cmd.seek(Math.round(pos * 1000));
  }

  function displayPos() {
    if (barDrag !== null) return barDrag;
    if (hand.holding) return hand.pos;
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
    if (hand.holding) {
      setSfxSpeed(!settings.sound || performance.now() - hand.movedAt > HAND_STILL_MS ? 0 : hand.vel / DEG_PER_SEC);
    } else {
      setSfxSpeed(0);
      setSpinning(isPlaying());
    }

    const dur = durationSec();
    const pos = displayPos();
    const sec = Math.floor(pos);
    if (sec !== drawn.sec || dur !== drawn.dur) {
      curText.data = fmt(pos);
      if (settings.remaining) durText.data = "-" + fmt(Math.max(0, dur - pos));
      const text = `${fmt(pos)} of ${fmt(dur)}`;
      for (const el of [discEl, barEl]) {
        el.setAttribute("aria-valuemax", String(Math.round(dur)));
        el.setAttribute("aria-valuenow", String(sec));
        el.setAttribute("aria-valuetext", text);
      }
      drawn.sec = sec;
    }
    if (dur !== drawn.dur) {
      if (!settings.remaining) durText.data = fmt(dur);
      drawn.dur = dur;
    }
    const p = dur ? Math.min(1, Math.max(0, pos / dur)) : 0;
    if (Math.abs(p - drawn.p) > 0.0002) {
      fillEl.style.transform = `scaleX(${p})`;
      railEl.style.transform = `translateX(${p * 100}%)`;
      drawn.p = p;
    }
    syncVolume();
    if (sfx.ac) {
      // the sound engine sleeps whenever the record is not being held
      if (hand.holding || sfx.speed) {
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
      // missed announcements (a Spicetify hiccup): the song on screen or the buttons catch up on their own
      const cur = currentItem();
      if (!swap && ((cur && cur.uri) || null) !== shownUri) updateTrack();
      updateButtons();
    }
  }


  function angleAt(e) {
    if (!hand.center || !hand.holding) {
      const r = discEl.getBoundingClientRect();
      hand.center = { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width / 2 };
    }
    return (Math.atan2(e.clientY - hand.center.y, e.clientX - hand.center.x) * 180) / Math.PI;
  }

  // right at the spindle a tiny hand movement is a huge angle change: ignore that spot
  const nearSpindle = (e) => Math.hypot(e.clientX - hand.center.x, e.clientY - hand.center.y) < hand.center.radius * 0.07;


  discEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || hand.holding || swap) return;
    e.preventDefault();
    if (!canScratch()) return;
    sendNudge(); // a nudge still on its way lands before the hand takes over
    // hold the record exactly where it is (it may be mid-way through the idle zoom) so it cannot slide out from under the hand
    const here = getComputedStyle(discEl).transform;
    discEl.style.transition = "none";
    discEl.style.transform = here === "none" ? "" : here;
    discEl.setPointerCapture(e.pointerId);
    discEl.classList.add("grabbing");
    setSpinning(false); // hand on the record: it stops right now
    if (settings.sound) startSfx();

    hand.center = null; // re-measure for this grab
    hand.wasPlaying = isPlaying();
    hand.pos = hand.startPos = displayPos();
    hand.uri = (currentItem() || {}).uri || null;
    if (hand.wasPlaying) setPlaying(false);
    hand.holding = true;
    hand.vel = 0;
    hand.angle = angleAt(e);
    hand.movedAt = 0;
  });

  // pointerrawupdate delivers every mouse report as it happens (not batched per frame), so the record
  // always shows the hand's latest position; plain pointermove is the fallback
  const RAW_MOVES = "onpointerrawupdate" in discEl;
  discEl.addEventListener(RAW_MOVES ? "pointerrawupdate" : "pointermove", (e) => {
    if (!hand.holding) return;
    const a = angleAt(e);
    if (nearSpindle(e)) { hand.angle = a; return; }
    let d = a - hand.angle;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    hand.angle = a;
    if (d === 0) return;
    d = Math.max(-90, Math.min(90, d)); // one report can never whip the record round

    const next = clampPos(hand.pos + d / DEG_PER_SEC);
    const applied = (next - hand.pos) * DEG_PER_SEC; // the record "sticks" at the start/end of the song
    hand.pos = next;
    setAngle(getAngle() + applied); // record follows the hand 1:1, immediately

    const now = performance.now();
    const dt = hand.movedAt ? Math.max(4, now - hand.movedAt) / 1000 : 0.016;
    hand.movedAt = now;
    hand.vel = hand.vel * 0.4 + (applied / dt) * 0.6;
  });

  // seek = false when the grab is abandoned (the song changed underneath the hand)
  function release(e, seek = true) {
    if (!hand.holding) return;
    try { if (e && e.pointerId !== undefined) discEl.releasePointerCapture(e.pointerId); } catch {}
    discEl.classList.remove("grabbing");
    hand.holding = false;
    discEl.style.transition = "";
    layoutIdle();
    wake();
    setSfxSpeed(0);
    // a plain tap should not stutter the audio, and a song that changed under the hand (even before Spotify
    // announced it) must not get the old song's position
    const sameSong = ((currentItem() || {}).uri || null) === hand.uri;
    if (seek && sameSong && Math.abs(hand.pos - hand.startPos) > 0.05) seekTo(hand.pos);
    if (hand.wasPlaying) {
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
  // a small time bubble follows the pointer over the bar (and while dragging it)
  function showBarTip(e) {
    const r = barEl.getBoundingClientRect();
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    barTipText.data = fmt((x / r.width) * durationSec());
    barTip.style.transform = `translateX(${x}px) translateX(-50%)`;
    barTip.classList.add("show");
  }
  barEl.addEventListener("pointermove", (e) => {
    if (barDrag !== null) barDrag = barPos(e);
    if (durationSec()) showBarTip(e);
  });
  barEl.addEventListener("pointerleave", () => { if (barDrag === null) barTip.classList.remove("show"); });
  function barUp() {
    if (barDrag === null) return;
    seekTo(barDrag);
    barDrag = null;
    if (!barEl.matches(":hover")) barTip.classList.remove("show");
  }
  barEl.addEventListener("pointerup", barUp);
  barEl.addEventListener("pointercancel", barUp);
  barEl.addEventListener("lostpointercapture", barUp);

  // the song length doubles as a switch to "time left", like in Spotify's own player bar
  function labelDuration() {
    const label = settings.remaining ? "Show song length" : "Show time remaining";
    durEl.title = label;
    durEl.setAttribute("aria-label", label);
  }
  function toggleRemaining() {
    settings.remaining = !settings.remaining;
    saveSettings();
    labelDuration();
    drawn.sec = drawn.dur = -1; // redraw both times on the next frame
  }
  labelDuration();
  durEl.addEventListener("click", toggleRemaining);
  durEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleRemaining();
  });

  // ---------- volume ----------
  // the volume control's state
  const vol = {
    dragging: false,
    shown: -1,          // value the slider shows (-1 = not drawn yet)
    beforeMute: 0.5,    // what unmuting goes back to
    pending: null,      // value waiting to be sent to Spotify
    sentAt: 0,          // Spotify volume calls are slow: at most one every ~40 ms
    timer: 0,
    holdUntil: 0,       // briefly ignore Spotify's (older) value right after a change
  };

  function renderVolume(v) {
    v = Math.min(1, Math.max(0, Number(v) || 0)); // some Spotify builds may not report a volume
    if (v === vol.shown) return;
    vol.shown = v;
    volFillEl.style.transform = `scaleX(${v})`;
    volRailEl.style.transform = `translateX(${v * 100}%)`;
    const name = v === 0 ? "volume-off" : v < 0.34 ? "volume-one-wave" : v < 0.67 ? "volume-two-wave" : "volume";
    setIcon(muteBtn, name, 22);
    muteBtn.title = v === 0 ? LABEL.unmute : LABEL.mute;
    muteBtn.setAttribute("aria-label", muteBtn.title);
    volBarEl.setAttribute("aria-valuenow", String(Math.round(v * 100)));
  }

  function flushVolume() {
    vol.timer = 0;
    if (vol.pending === null) return;
    cmd.volume(vol.pending);
    vol.pending = null;
    vol.sentAt = performance.now();
  }

  function setVolume(v) {
    v = Math.min(1, Math.max(0, Number(v) || 0));
    if (v > 0) vol.beforeMute = v;
    renderVolume(v); // slider moves right away
    vol.holdUntil = performance.now() + 700;
    // Spotify volume calls are slow; send at most one every ~40 ms, always ending on the latest value
    vol.pending = v;
    const wait = 40 - (performance.now() - vol.sentAt);
    if (wait <= 0) flushVolume();
    else if (!vol.timer) vol.timer = setTimeout(flushVolume, wait);
  }

  function syncVolume() {
    if (vol.dragging || vol.pending !== null || performance.now() < vol.holdUntil) return;
    renderVolume(Spicetify.Player.getVolume());
  }

  function volAt(e) {
    const r = volBarEl.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  }
  volBarEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    volBarEl.setPointerCapture(e.pointerId);
    vol.dragging = true;
    volBarEl.parentElement.classList.add("dragging");
    setVolume(volAt(e));
  });
  volBarEl.addEventListener("pointermove", (e) => {
    if (vol.dragging) setVolume(volAt(e));
  });
  function volUp() {
    vol.dragging = false;
    volBarEl.parentElement.classList.remove("dragging");
  }
  volBarEl.addEventListener("pointerup", volUp);
  volBarEl.addEventListener("pointercancel", volUp);
  volBarEl.addEventListener("lostpointercapture", volUp);
  overlay.querySelector(".vr-volume").addEventListener("wheel", (e) => {
    e.preventDefault();
    setVolume((vol.shown < 0 ? Spicetify.Player.getVolume() : vol.shown) + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });

  // ---------- controls ----------
  overlay.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "close") return close();
    if (act === "fullscreen") return toggleFullscreen();
    if (act === "mute") return setVolume(vol.shown > 0 ? 0 : vol.beforeMute || 0.5);
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
    else if (act === "shuffle" || act === "repeat") {
      const done = act === "shuffle" ? cmd.shuffle() : cmd.repeat();
      if (done && typeof done.then === "function") done.then(updateButtons, updateButtons); // as soon as Spotify confirms
    }
    setTimeout(updateButtons, 120);
    setTimeout(updateButtons, 500);
  });

  Spicetify.Player.addEventListener("songchange", () => {
    if (performance.now() < prevPendingUntil) {
      prevPendingUntil = 0;
      startSwap(-1); // runs before updateTrack, so the outgoing record still shows the old cover
    }
    if (hand.holding) release(null, false); // the position being scrubbed belongs to the old song
    dropNudge(); // so does a nudge that hasn't reached Spotify yet
    barDrag = null;
    if (isOpen) updateTrack(); // (covers for upcoming songs are only preloaded while Vinyl mode is open)
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
    if (!hand.holding) setSpinning(isPlaying());
    updateButtons();
  });

  // ---------- fullscreen ----------
  let weWentFullscreen = false;

  function updateFullBtn() {
    const fs = !!document.fullscreenElement;
    fullBtn.innerHTML = fs ? FS_EXIT : FS_ENTER;
    fullBtn.setAttribute("aria-label", fs ? LABEL.exitFullscreen : LABEL.fullscreen);
    fullBtn.title = fs ? LABEL.exitFullscreen : LABEL.fullscreen;
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
    if (!canScratch() || hand.holding) return;
    nudge(delta);
  }

  // Nudging (arrow keys, scrolling over the record): the record and the times move on every step, but
  // Spotify is asked to seek at most about 3 times a second, always ending on the latest spot. A lone
  // nudge goes to Spotify straight away. (Holding an arrow key used to send a seek per key repeat.)
  let nudgeTarget = null; // where the record has been turned to, not yet sent to Spotify
  let nudgeTimer = 0;
  let nudgeSentAt = -1e9;
  function nudge(delta) {
    const from = nudgeTarget !== null ? nudgeTarget : displayPos();
    const to = clampPos(from + delta);
    setAngle(getAngle() + (to - from) * DEG_PER_SEC);
    const now = performance.now();
    pendingPos = { pos: to, at: now, until: now + 1500 }; // show the new time right away
    nudgeTarget = to;
    clearTimeout(nudgeTimer);
    if (now - nudgeSentAt > 300) return sendNudge();
    nudgeTimer = setTimeout(sendNudge, Math.min(140, Math.max(0, nudgeSentAt + 300 - now)));
  }
  function sendNudge() {
    clearTimeout(nudgeTimer);
    nudgeTimer = 0;
    if (nudgeTarget === null) return;
    const to = nudgeTarget;
    nudgeTarget = null;
    nudgeSentAt = performance.now();
    seekTo(to);
  }
  function dropNudge() {
    clearTimeout(nudgeTimer);
    nudgeTimer = 0;
    nudgeTarget = null;
  }

  // Scroll over the record to nudge it: down (clockwise) goes forward, up rewinds; one wheel notch = 2 s.
  discEl.addEventListener("wheel", (e) => {
    if (hand.holding || swap || !canScratch()) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    nudge((px / 100) * 2);
  }, { passive: false });

  // ---------- like / unlike the song (L) ----------
  let heartAnim = null;
  function popHeart(liked) {
    const el = $(".vr-heart");
    el.classList.toggle("off", !liked);
    if (heartAnim) heartAnim.cancel();
    const frames = settings.reduceMotion
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: "scale(0.5)" },
          { opacity: 1, transform: "scale(1.12)", offset: 0.22 },
          { opacity: 1, transform: "scale(1)", offset: 0.45 },
          { opacity: 0, transform: "scale(1.04)" },
        ];
    heartAnim = el.animate(frames, { duration: 950, easing: "ease-out" });
    liveText.data = liked ? "Added to Liked Songs" : "Removed from Liked Songs";
  }

  let liking = false;
  async function toggleLike() {
    const item = currentItem();
    const uri = item && item.uri;
    if (liking || !uri || !/^spotify:(track|episode):/.test(uri) || isAd(item)) return;
    liking = true;
    try {
      const lib = Spicetify.Platform && Spicetify.Platform.LibraryAPI;
      let liked;
      if (lib && lib.contains && lib.add && lib.remove) {
        // ask the library itself: the player's copy of the flag can lag behind a like made elsewhere
        const [saved] = await lib.contains(uri);
        liked = !saved;
        await (liked ? lib.add({ uris: [uri] }) : lib.remove({ uris: [uri] }));
      } else if (Spicetify.Player.setHeart && Spicetify.Player.getHeart) {
        liked = !Spicetify.Player.getHeart();
        settle(Spicetify.Player.setHeart(liked));
      } else return;
      if (isOpen) popHeart(liked);
    } catch {
    } finally {
      liking = false;
    }
  }

  // ---------- ? : keyboard shortcut card ----------
  const helpEl = $(".vr-help");
  let helpOpen = false;
  let helpReturn = null;
  function toggleHelp(on = !helpOpen, restoreFocus = true) {
    if (on === helpOpen) return;
    helpOpen = on;
    helpEl.classList.toggle("show", on);
    if (on) {
      helpReturn = document.activeElement;
      setIdle(false);
      helpEl.focus({ preventScroll: true });
    } else {
      if (restoreFocus && helpReturn && helpReturn.focus && document.contains(helpReturn)) helpReturn.focus({ preventScroll: true });
      helpReturn = null;
    }
  }
  overlay.addEventListener("pointerdown", (e) => { if (helpOpen && !helpEl.contains(e.target)) toggleHelp(false); }, true);

  function isTyping(e) {
    const t = e.target;
    return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    if (helpOpen) {
      // Esc or ? just closes the card; any other shortcut closes it and does its job
      toggleHelp(false);
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopImmediatePropagation();
        return wake();
      }
    }
    // the focused volume slider behaves like a slider: ← → change the volume, Home / End go to 0 / 100 %
    if (e.target === volBarEl && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) {
      const cur = vol.shown < 0 ? Spicetify.Player.getVolume() : vol.shown;
      setVolume(e.key === "Home" ? 0 : e.key === "End" ? 1 : cur + (e.key === "ArrowRight" ? 0.05 : -0.05));
      e.preventDefault();
      e.stopImmediatePropagation();
      return wake();
    }
    const focusedButton = e.target && e.target.closest && e.target.closest("#vr-overlay button, #vr-overlay [role=link], #vr-overlay [role=button]");
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
      case "Home":
        // on the record or the progress bar (both sliders): back to the start of the song
        if (e.target === discEl || e.target === barEl) stepSeek(-displayPos());
        else handled = false;
        break;
      case "ArrowUp":
        setVolume((vol.shown < 0 ? Spicetify.Player.getVolume() : vol.shown) + 0.05);
        break;
      case "ArrowDown":
        setVolume((vol.shown < 0 ? Spicetify.Player.getVolume() : vol.shown) - 0.05);
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
      case "n":
      case "N":
        skip(1);
        break;
      case "p":
      case "P":
        skip(-1);
        break;
      case "l":
      case "L":
        toggleLike();
        break;
      case "?":
        toggleHelp(true);
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
    if (!on) {
      announceUntil = 0;
      showLyric(-1);
    }
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (!settings.idle) return;
    idleTimer = setTimeout(() => {
      if (!isOpen) return;
      if (hand.holding || barDrag !== null || vol.dragging || helpOpen) return armIdle();
      setIdle(true);
    }, IDLE_MS);
  }

  function wake() {
    if (hand.holding) return armIdle(); // the record stays put while held; release() wakes the UI
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

  // ---------- keep Spicetify's page scanner cheap while Vinyl mode is open ----------
  // On some Spotify versions Spicetify re-checks the style of every element that is not marked
  // data-scroll-optimized, on every page change. A song change causes several of those, which made
  // skipping stutter. Plain elements (no scrolling, not a menu or dialog) never need that work, so they are
  // marked in idle moments; scroll areas, menus and dialogs are left to Spicetify exactly as before.
  function scannerStillActive() {
    const v = String((Spicetify.Platform && Spicetify.Platform.version) || "").split(".").map((n) => parseInt(n, 10));
    return !(v[1] >= 2 && v[2] >= 57); // the same check Spicetify uses to switch its scanner off
  }

  let markTimer = 0;
  function markPlainElements() {
    clearTimeout(markTimer);
    if (!isOpen || !scannerStillActive()) return;
    const pending = document.querySelectorAll("*:not([data-scroll-optimized])");
    let i = 0;
    const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 1));
    const step = (deadline) => {
      if (!isOpen) return;
      while (i < pending.length && deadline.timeRemaining() > 1) {
        const el = pending[i++];
        if (!el.isConnected || el.hasAttribute("data-scroll-optimized")) continue;
        if (el.id === "context-menu" || el.getAttribute("role") === "dialog" || el.classList.contains("popup") || el.getAttribute("aria-haspopup") === "true") continue;
        if (el.closest("#context-menu")) continue;
        const cs = getComputedStyle(el);
        if (cs.overflow === "auto" || cs.overflow === "scroll" || cs.overflowY === "auto" || cs.overflowY === "scroll") continue;
        el.setAttribute("data-scroll-optimized", "true");
      }
      if (i < pending.length) idle(step);
      else markTimer = setTimeout(markPlainElements, 4000); // catch up with elements Spotify adds later
    };
    idle(step);
  }

  // ---------- open / close ----------
  let returnFocus = null;

  // follow the system's "reduce motion" switch while it runs, unless you picked something else in Vinyl mode
  try {
    const mq = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", (e) => {
        const followed = settings.reduceMotion === SETTINGS_DEFAULTS.reduceMotion;
        SETTINGS_DEFAULTS.reduceMotion = e.matches;
        if (followed) {
          settings.reduceMotion = e.matches;
          applySettings();
        }
        saveSettings();
      });
    }
  } catch {}

  function applySettings() {
    document.querySelectorAll("input[data-vr-setting]").forEach((i) => (i.checked = !!settings[i.dataset.vrSetting]));
    overlay.classList.toggle("reduce-motion", settings.reduceMotion);
    if (isOpen) {
      setSpinning(!hand.holding && isPlaying());
      if (settings.idle) armIdle();
      else { clearTimeout(idleTimer); setIdle(false); }
    }
    if (!settings.sound) setSfxSpeed(0);
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
    drawn.sec = drawn.dur = drawn.p = -1;
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
    setTimeout(markPlainElements, 600);
    if (button) button.active = true;
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
    toggleHelp(false, false);
    if (returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    clearTimeout(idleTimer);
    setIdle(false);
    if (weWentFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setSfxSpeed(0);
    showLyric(-1);
    clearTimeout(glimpseTimer);
    clearTimeout(markTimer);
    setNear(false);
    endSwap();
    if (sfx.ac) setTimeout(() => !isOpen && sfx.ac.suspend(), 200);
    if (button) button.active = false;
  }

  // ---------- Settings > Vinyl mode ----------
  const SETTING_ROWS = [
    ["autoOpen", "Open Vinyl mode when music starts"],
    ["sound", "Rewind sound while scratching"],
    ["idle", "Hide controls when the mouse is idle"],
    ["lyrics", "Show lyrics when controls are hidden"],
    ["nextUp", "Show the next song at the screen edge"],
    ["reduceMotion", "Reduce motion"],
  ];

  // one toggle row in Spotify's own switch style; every copy of a setting stays in sync (see applySettings)
  function settingRow(key, label, id, labelCls) {
    const row = document.createElement("div");
    row.className = "x-settings-row";
    row.innerHTML = `
      <div class="x-settings-firstColumn">
        <label class="${labelCls}" for="${id}"></label>
      </div>
      <div class="x-settings-secondColumn">
        <label class="x-toggle-wrapper">
          <input id="${id}" class="x-toggle-input" type="checkbox" data-vr-setting="${key}">
          <span class="x-toggle-indicatorWrapper"><span class="x-toggle-indicator"></span></span>
        </label>
      </div>`;
    row.querySelector("label[for]").textContent = label;
    const input = row.querySelector("input");
    input.checked = settings[key];
    input.addEventListener("change", () => {
      settings[key] = input.checked;
      saveSettings();
      applySettings();
    });
    return row;
  }

  // Quick settings: right-click the record button. Uses Spicetify's own popup, so the settings stay
  // reachable even if a Spotify update changes its Settings page.
  function openQuickSettings() {
    if (!Spicetify.PopupModal || !Spicetify.PopupModal.display) return;
    const box = document.createElement("div");
    box.className = "vr-quick-settings";
    for (const [key, label] of SETTING_ROWS) box.appendChild(settingRow(key, label, "vinyl-rewind-quick." + key, ""));
    Spicetify.PopupModal.display({ title: "Vinyl mode", content: box });
  }

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

    for (const [key, label] of SETTING_ROWS) {
      sec.appendChild(settingRow(key, label, "vinyl-rewind." + key, labelCls));
    }

    const keys = document.createElement("div");
    keys.className = "x-settings-row";
    keys.innerHTML = `
      <div class="x-settings-firstColumn">
        <span class="${labelCls}">Keyboard shortcuts</span>
        <span class="${noteCls}">Alt + Shift + V open or close · ← → or scroll on the record to rewind / skip ahead · N P next / previous song · L like · Space play or pause · ? all shortcuts · ↑ ↓ volume · M mute · F full screen · Esc close</span>
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
    const isHome = (pathname === "/" || pathname === "") && settings.homeTip; // nothing to do there once the card is dismissed
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
  // playbar button; if a future Spicetify changes that API, try the top bar, and otherwise Vinyl mode
  // still works from Alt+Shift+V and the Home card
  let button = null;
  for (const Api of [Spicetify.Playbar && Spicetify.Playbar.Button, Spicetify.Topbar && Spicetify.Topbar.Button]) {
    if (typeof Api !== "function") continue;
    try {
      button = new Api("Vinyl mode", ICON, () => (isOpen ? close() : open()), false, false);
      break;
    } catch (err) {
      console.error("[Vinyl Rewind] could not add the button", err);
    }
  }
  const buttonEl = button && (button.button || button.element);
  if (buttonEl) {
    buttonEl.classList.add("vr-playbar-btn");
    buttonEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openQuickSettings();
    });
  }

})();
