# SurBox 🎵

**Ad-free music player. Nothing else.** Music-only spin-off of
[OmniTools](https://github.com/jackbhai/omnitools) — the songs feature,
extracted to stand on its own.

## What's inside

One screen, eight tabs:

| Tab | What it does |
|---|---|
| **Home** | Personalised recommendations from your preferences (languages, genres, moods, artists) |
| **Search** | Search across multiple catalogues, infinite scroll, plays any list as a queue |
| **Artists** | Artist pages, top songs, albums |
| **Library** | Favourites, play counts, history, custom playlists, import/export |
| **Charts** | Top tracks / albums / artists by region |
| **Genres** | Mood & genre radio starters |
| **Playlists** | Searchable playlist catalogue |
| **Radio** | Endless radio — the queue refills before it can run out |

Plus:

- **Ad-free direct audio streaming** — no video, no ads, no YouTube embeds
- **Equaliser with presets**, background playback, sleep timer
- **Multi-source fallback** — if one catalogue fails, another takes over
- **Audio prefetching/warming** so tracks start fast
- **Lyrics pool** (when available)
- **PWA** — install as an app, works offline for the shell (service worker)
- **Proxy settings** — ships with a built-in Cloudflare Worker relay; point it
  at your own if you want (`worker/` folder has all three workers)

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
catalogue, library, audio resolution, preferences) and `src/ui/PlayerUI.jsx`
(mini + full player) are the heart of it.
