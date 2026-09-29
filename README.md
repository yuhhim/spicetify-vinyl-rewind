# Vinyl Rewind

A fullscreen spinning record for Spotify. Grab the record and turn it to rewind or fast-forward the song, like a real turntable.

![Vinyl Rewind](preview.webp)

## Features

- **Scratch to scrub**: grab the record and it stops instantly. Turn it backwards to rewind, forwards to fast-forward, and let go to carry on playing. One full turn is 24 seconds of the song.
- **Rewind sound**: a soft tape-rewind rumble that follows how fast you turn.
- **Next record**: the next song waits just off the right edge. Move the mouse near it to bring it in, then click or drag it in to skip. Skipping rolls the current record out and the new one in.
- **Synced lyrics**: when the controls are hidden, the current lyric line shows under the record.
- **Vinyl crackle**: optional soft record crackle while music plays.
- **Album colors**: the background takes its color from the cover art, with a faint paper texture that changes with every song. Both fade smoothly when the track changes.
- **Idle mode**: leave the mouse alone for 3 seconds and the record takes center stage; everything except the progress bar fades away.
- **Full controls**: progress bar, shuffle, previous, play/pause, next, repeat, and a volume control that expands on hover.
- **Built in**: a Vinyl mode section in Spotify's Settings, a card in Home > Getting started, and full keyboard control.

## Install

### Spicetify Marketplace

Search for **Vinyl Rewind** in the Marketplace and install it.

### Manually

1. Download `rewind.js` and put it in your Spicetify `Extensions` folder:
   - Windows: `%appdata%\spicetify\Extensions`
   - macOS / Linux: `~/.config/spicetify/Extensions`
2. Run:

   ```bash
   spicetify config extensions rewind.js
   spicetify apply
   ```

## Usage

Click the record icon in the playbar, press `Alt + Shift + V`, or use **Try it** on the Vinyl mode card in Home > Getting started.

| Action | Result |
| --- | --- |
| Grab the record | Stops it (and the music) |
| Turn it backwards / forwards | Rewind / fast-forward |
| Let go | Music continues from the new spot |

### Keyboard

| Key | Action |
| --- | --- |
| `Alt + Shift + V` | Open or close Vinyl mode |
| `←` / `→` | Rewind / fast-forward 5 seconds (hold `Shift` for 15) |
| `Space` | Play / pause |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `F` | Full screen |
| `Esc` | Leave full screen, then close |
| `Tab` | Reach the next-song record, then `Enter` to skip |

## Settings

Open Spotify **Settings** and scroll to **Vinyl mode**.

| Setting | Default | What it does |
| --- | --- | --- |
| Reduce motion | Follows your system | Keeps the record still and turns off zoom and fade animations |
| Rewind sound | On | Soft rewind sound while you turn the record |
| Hide controls when idle | On | Shows only the record and progress bar when the mouse is still |
| Background texture | On | Faint paper texture behind the record |
| Show tip on Home | On | The Vinyl mode card in Getting started |
| Vinyl crackle | Off | Soft record crackle while music plays |
| Lyrics when idle | On | The current line of synced lyrics under the record when the controls are hidden |
| Show next song | On | The next song as a record at the right edge |

Scratching is turned off automatically when Spotify doesn't allow seeking (ads, some radio and DJ sessions), and controls that aren't available in the current context are dimmed.

## Uninstall

```bash
spicetify config extensions rewind.js-
spicetify apply
```

## License

[MIT](LICENSE)
