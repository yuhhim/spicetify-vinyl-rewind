// Start-up test for rewind.js: runs it in a simulated Spotify page (jsdom + a fake Spicetify player), opens Vinyl
// mode, changes songs, uses the keyboard and settings, and fails on any error. Real-Spotify tests live elsewhere;
// this catches mistakes that would stop the extension from starting or working at all.
import { readFileSync } from "fs";
import { JSDOM, VirtualConsole } from "jsdom";

const code = readFileSync(new URL("../../rewind.js", import.meta.url), "utf8");
const problems = [];
// errors thrown inside the page can surface in Node itself: report them instead of crashing
process.on("unhandledRejection", (e) => problems.push("unhandled rejection: " + ((e && e.message) || e)));
process.on("uncaughtException", (e) => problems.push("uncaught: " + ((e && e.message) || e)));
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => problems.push("page error: " + (e.message || e)));
virtualConsole.on("error", (...a) => problems.push("console.error: " + a.map(String).join(" ")));

const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="main"></div></body></html>`, {
  url: "https://xpui.app.spotify.com/index.html",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const { document } = window;
window.addEventListener("error", (e) => problems.push("uncaught: " + e.message));
window.addEventListener("unhandledrejection", (e) => problems.push("unhandled rejection: " + e.reason));

// ---- what jsdom lacks ----
const fakeAnimation = () => ({
  playState: "idle", currentTime: 0, playbackRate: 1, effect: { getKeyframes: () => [] },
  finished: Promise.resolve(), onfinish: null,
  play() { this.playState = "running"; }, pause() { this.playState = "paused"; }, cancel() { this.playState = "idle"; }, finish() {},
});
window.Element.prototype.animate = function () { const a = fakeAnimation(); a.play(); return a; };
window.Element.prototype.getAnimations = () => [];
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
window.HTMLCanvasElement.prototype.getContext = () => null;

// ---- a fake Spicetify / Spotify ----
const listeners = {};
const song = (n) => ({
  uri: `spotify:track:song${n}`,
  metadata: { title: `Test Song ${n}`, artist_name: "Test Artist", album_title: "Test Album", image_xlarge_url: `https://i.scdn.co/image/${n}` },
  artists: [{ name: "Test Artist", uri: "spotify:artist:a1" }],
  album: { uri: "spotify:album:b1" },
});
let playing = false, position = 30000, shuffle = false, repeat = 0, volume = 0.5;
const store = {};
const origin = {
  resume: async () => { playing = true; fire("onplaypause"); },
  pause: async () => { playing = false; fire("onplaypause"); },
  skipToNext: async () => { Player.data.item = song(++songNo); position = 0; fire("songchange"); },
  skipToPrevious: async () => { Player.data.item = song(Math.max(1, --songNo)); position = 0; fire("songchange"); },
  seekTo: async (ms) => { position = ms; },
  setShuffle: async (v) => { shuffle = v; },
  setRepeat: async (v) => { repeat = v; },
};
let songNo = 1;
function fire(type) { for (const cb of listeners[type] || []) cb({ type }); }
const Player = {
  origin,
  data: { item: song(1), context: { uri: "spotify:album:b1" }, restrictions: {}, nextItems: [song(2)] },
  addEventListener: (t, cb) => (listeners[t] = listeners[t] || []).push(cb),
  getProgress: () => position, getDuration: () => 200000, isPlaying: () => playing,
  getShuffle: () => shuffle, getRepeat: () => repeat, getVolume: () => volume,
  setVolume: (v) => { volume = v; }, play: () => origin.resume(), pause: () => origin.pause(),
  next: () => origin.skipToNext(), back: () => origin.skipToPrevious(), seek: (ms) => origin.seekTo(ms),
  toggleShuffle: () => origin.setShuffle(!shuffle), toggleRepeat: () => origin.setRepeat((repeat + 1) % 3),
  getHeart: () => false, setHeart: () => {},
};
const historyListeners = [];
window.Spicetify = {
  Player,
  Platform: {
    version: "1.2.60.564",
    History: {
      location: { pathname: "/" },
      listen: (cb) => historyListeners.push(cb),
      push(p) { this.location = { pathname: p }; historyListeners.forEach((cb) => cb(this.location)); },
    },
    LibraryAPI: { contains: async () => [false], add: async () => {}, remove: async () => {} },
    AuthorizationAPI: { getState: async () => ({ token: { accessToken: "x" } }) },
    PlaybackAPI: { setVolume: async (v) => { volume = v; } },
  },
  Playbar: {
    Button: class {
      constructor(label, icon, onClick) {
        this.element = document.createElement("button");
        this.element.setAttribute("aria-label", label);
        this.element.addEventListener("click", onClick);
        document.body.appendChild(this.element);
        this.active = false;
      }
    },
  },
  LocalStorage: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = String(v); } },
  SVGIcons: {},
  Locale: { get: (k) => k },
  PopupModal: { display() {}, hide() {} },
  colorExtractor: async () => ({ DARK_VIBRANT: "#223344" }),
  Queue: { nextTracks: [] },
};

// ---- run it ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail = "") => checks.push([ok, name, detail]);
const key = (k, opts = {}) => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, code: opts.code || "", bubbles: true, cancelable: true, ...opts }));

try { window.eval(code); } catch (e) { problems.push("failed to start: " + e.message); }
await sleep(700);
const overlay = document.getElementById("vr-overlay");
const button = document.querySelector(".vr-playbar-btn");
check("starts and builds Vinyl mode", !!overlay && !!button);
if (overlay && button) {
  button.click();
  await sleep(1800);
  check("the button opens Vinyl mode", overlay.classList.contains("open") && document.body.classList.contains("vr-open"));
  check("shows the playing song", overlay.querySelector(".vr-title").textContent === "Test Song 1", overlay.querySelector(".vr-title").textContent);
  overlay.querySelector('[data-act="play"]').click();
  await sleep(300);
  check("play button plays", playing === true);
  overlay.querySelector('[data-act="next"]').click();
  await sleep(2200);
  check("next song shows up", overlay.querySelector(".vr-title").textContent === "Test Song 2", overlay.querySelector(".vr-title").textContent);
  // a song change Spicetify never announced is caught up by the once-a-second check
  Player.data.item = song(7);
  await sleep(2500);
  check("catches up on an unannounced song change", overlay.querySelector(".vr-title").textContent === "Test Song 7", overlay.querySelector(".vr-title").textContent);
  const before = position;
  key("ArrowRight", { code: "ArrowRight" });
  await sleep(200);
  check("arrow key seeks", position > before, `${before} -> ${position}`);
  key("?");
  await sleep(100);
  check("? opens the shortcut card", overlay.querySelector(".vr-help").classList.contains("show"));
  key("Escape", { code: "Escape" });
  key("Escape", { code: "Escape" });
  await sleep(300);
  check("Esc closes the card, then Vinyl mode", !overlay.classList.contains("open") && !document.body.classList.contains("vr-open"));
  key("V", { code: "KeyV", altKey: true, shiftKey: true });
  await sleep(1200);
  check("Alt+Shift+V opens it again", overlay.classList.contains("open"));
  key("V", { code: "KeyV", altKey: true, shiftKey: true });
  await sleep(300);
}
window.close();

let failed = problems.length > 0;
for (const [ok, name, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  (" + detail + ")" : ""}`);
  if (!ok) failed = true;
}
for (const p of problems) console.log("FAIL  " + p);
console.log(failed ? "start-up test FAILED" : "start-up test passed");
process.exit(failed ? 1 : 0);
