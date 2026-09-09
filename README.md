# SurBox 🎵

**Ad-free music player. Nothing else.** Music-only spin-off of
[OmniTools](https://github.com/jackbhai/omnitools) — the songs feature,
extracted to stand on its own, then pushed further.

## What's inside

One screen, eight tabs:

| Tab | What it does |
|---|---|
| **Home** | Continue listening, **Your Daily Mix**, personalised recommendations, quick mood mixes, recently played |
| **Search** | Multi-catalogue search, infinite scroll, **search history**, **voice search** 🎤 |
| **Artists** | Artist pages, top songs, albums |
| **Library** | Favourites, history, most played, **offline Downloads**, **listening Stats**, playlists, app settings |
| **Charts** | Top tracks / albums / artists by region |
| **Genres** | Mood & genre radio starters |
| **Playlists** | Searchable playlist catalogue |
| **Radio** | Endless radio — the queue refills before it can run out |

## Player features

- **Ad-free direct streaming** — no video, no ads, no YouTube embeds
- **Offline downloads** — save a song's bytes to the device (Cache API);
  it then plays in flight mode and starts in ~0 ms
- **Full queue control** — play next, add to queue, reorder, remove,
  jump to any row (Queue tab in the player)
- **Song radio** — one tap builds an endless queue around the current track
- **Continue listening** — the last queue, song and second are remembered;
  resume after a reload or app restart
- **Equaliser** — 10 bands, presets, bass/treble, loudness compressor
- **Visualiser** — bars, waveform and ring modes, driven by a real analyser
- **Lyrics** — synced where available, tap a line to jump
- **Sleep timer**, playback speed (0.5–2×), shuffle, repeat one/all
- **Listening stats** — minutes listened (all time / week / today),
  top artists with bars, most-listened tracks
- **Keyboard shortcuts** — Space play/pause, ←/→ seek, N/P track,
  M mute, F full player, S shuffle, R repeat
- **Lock-screen / notification controls** via Media Session API
- **One-file backup & restore** — library, playlists, preferences, history,
  search history and listening time in a single JSON
- **PWA** — install as an app; network-first shell works offline
- **Multi-source fallback** — if one catalogue fails, another takes over
- **Proxy settings** — built-in Cloudflare Worker relay; bring your own if
  you want (`worker/` has all three workers)

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

## Build

```bash
npm run build      # -> dist/
```

Deploy anywhere static (Vercel config included). For GitHub Pages, enable
Pages → Source: **GitHub Actions**; the workflow in `.github/workflows/deploy.yml`
builds with `BASE_PATH=/surbox/` on every push to `main`.

## Android APK

```bash
./build-apk.sh     # needs JDK 17+ and Android SDK; creates android/ if missing
```

See [APK-BUILD-GUIDE.md](APK-BUILD-GUIDE.md).

## Workers (optional, music backends)

The app already works out of the box via its built-in relay. To deploy your
own copy of the three Cloudflare Workers (free tier, 100k req/day each):

```bash
cd worker && ./deploy.sh
```

## Origin

Extracted from [OmniTools](https://github.com/jackbhai/omnitools) — same
player, same sources, same engine; the tool grid, routing and every other
tool removed. `src/tools/music2.jsx` (player UI), `src/core/*` (music engine,
catalogue, library, audio resolution, downloads, preferences) and
`src/ui/PlayerUI.jsx` (mini + full player) are the heart of it.
