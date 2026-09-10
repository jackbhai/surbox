# SurBox — Master Plan

**Single source of truth for everything shipped and everything next.**
UI first (v2 shell ✅), then features in phases. Status legend:
✅ shipped · 🔨 next · 💤 planned · ⛔ blocked (with reason)

---

## 0. Reference-spec alignment — ✅ v2.1 SHIPPED

The reference master prompt ("Ultra-Premium AMOLED Music App") was audited
against SurBox v2. Adopted, adapted to SurBox's own identity:

| From the spec | SurBox version | Status |
|---|---|---|
| Cinematic hero (artwork edge-to-edge + CTA) | Home hero merges Daily Mix + featured art, "SOUNDS BEYOND LIMITS" | ✅ |
| Good Night / sleep mode | 21:00–05:00 the hero becomes a night sky (stars, aurora, ridge) with Continue Listening + quote | ✅ |
| "PLAYING FROM" header | Player header shows source (queue / station / catalogue) | ✅ |
| Labeled secondary actions (Lyrics/Download/Audio/More) | LYRICS · DOWNLOAD · AUDIO · QUEUE labeled row with active states | ✅ |
| UP NEXT card | Compact up-next preview above the controls, tap → queue tab | ✅ |
| Glowing progress thumb + premium play ring | 66px gradient play button with double ring; white glowing seek thumb | ✅ |
| Ambient artwork glow | Radial green/cyan (violet in theme) bloom behind the vinyl | ✅ |
| Lyrics over blurred artwork | Lyrics tab renders a 46px-blur artwork layer behind the words | ✅ |
| Library shortcuts (Liked/Downloads cards) | Three gradient shortcut cards with live counts | ✅ |
| Browse All visual grid | 12 hue-shifted cinematic tiles, one-tap queues | ✅ |
| Mood chips on Home | Functional mood starters (Party/Chill/Workout/Romantic/Focus/Sleep) | ✅ |
| Electric violet accent | Full "Electric Violet" theme in Settings (green/cyan stays default) | ✅ |
| Fake lossless/Hi-Res quality picker | **Intentionally not built** — the app only ever offers what the stream really is | ⛔ honesty |
| Premium subscription tab | **Intentionally not built** — every feature is free; the spec's "Premium" is SurBox's default state | ⛔ honesty |

## 1. UI System (v2) — ✅ SHIPPED

Same DNA (true black AMOLED, neon `#00FF9C` / `#00E5FF`, DM Sans + Bangers,
DM Mono), completely rebuilt surface:

| Piece | Status |
|---|---|
| Onboarding: 4-step taste selector (Languages → Artists → Vibes → Locked), instant-save, skippable | ✅ |
| Floating glass dock (Home / Search / Library / More) + glass NowBar with live EQ bars + hairline progress | ✅ |
| Home: greeting, Continue listening, Daily Mix hero, quick vibes, Jump-back-in shelf, Made-for-you shelf, artist orbit, On-repeat shelf, browse tiles | ✅ |
| Search: glass field, live suggestions, voice (en-IN), recents chips, shimmer skeletons, shuffle-all | ✅ |
| Library: segmented (Songs / Playlists / Downloads / Stats / App), playlist cover grid with generated gradient covers | ✅ |
| Full player (vinyl disc, 3 viz modes, synced lyrics, 10-band EQ, editable queue) — carried forward, styled by shared classes | ✅ |
| Micro-interactions: press-scale, hover-lift, staggered rise-in, glow states | ✅ |

**Design rules (keep these forever):**
- True black only; surfaces are transparent tints + `backdrop-filter`, never flat grey fills.
- Bangers = section headers + brand moments ONLY (letterspaced, uppercase). DM Sans everywhere else.
- Green→cyan gradient reserved for: primary CTA, play badges, active states. Never body text.
- Every loading state is a shimmer, never a spinner on a blank page.
- Every empty state teaches the user what fills it.

---

## 2. Player Engine — v1.1 ✅ (foundation)

| Feature | Status |
|---|---|
| Multi-tier ad-free stream resolution, signed-link auto-refresh (2 tries), approximate-match honesty | ✅ |
| Offline downloads (Cache API store `surbox-dl-v1`), offline-first play path via `getDownload(id)` | ✅ |
| Queue editing: playNext / addToQueue / removeAt / moveInQueue | ✅ |
| Song radio (radioQueue seeds endless queue) from track sheet + player | ✅ |
| Session persistence (`omni:session`, 5 s cadence) + resumeSession | ✅ |
| Listening time tracking (wall-clock batches → `omni:lib:time`) | ✅ |
| Voice search (Web Speech, en-IN), search history (10) | ✅ |
| Keyboard shortcuts (Space / ←→ / N P / M / F / S / R) | ✅ |
| Media Session (lock screen / notification controls) | ✅ |
| One-file backup & restore (merge semantics) | ✅ |
| Prefetch/warming pipeline (URL-level only — CDN allows 1 connection, see ⛔ crossfade) | ✅ |

---

## 3. Phase P1 — AUDIO LAB 🎛️ 🔨 (next up, after UI approval)

The flagship. All real-time, all Web Audio, all local. Extends the existing
`Chain` graph (player.jsx) which already owns the element source.

### 3.1 Karaoke / Vocal isolation (analog, instant)
- **Music-only (karaoke):** split L/R → mid/side. Side = instruments. Keep
  center **below ~250 Hz** (bass/kick live there) → phase-cancel the rest of
  the center (vocals) → sing over it.
- **Vocals-only (acapella-ish):** mid channel, high-passed above ~250 Hz.
- UI: player tab "LAB" → three-way toggle: Normal / Karaoke / Vocals-only.
- Implementation: `ChannelSplitter` → per-channel `BiquadFilter` banks →
  `ChannelMerger`; gain staging to avoid clipping.
- **Honesty note in UI:** works on properly-mixed stereo (most modern
  Bollywood/Punjabi); nothing on mono tracks. Label it "best on stereo".

### 3.2 Pitch shift (key change) ±6 semitones
- For karaoke: sing in YOUR key. Speed must stay 1×.
- Custom implementation (no npm): delay-line granular resampling in an
  `AudioWorklet` (~150 lines), or `playbackRate + preservesPitch=false` quick
  mode first (ships in a day, quality "chipmunk above ±3").
- Ship quick mode first, worklet version as the upgrade.

### 3.3 8D / Spatial rotation
- `PannerNode` HRTF, LFO-driven `positionX/Z` orbit. Toggle + speed slider.
- Trivial, huge wow. 30 min of work.

### 3.4 Reverb / Ambience
- Procedural impulse responses (exponentially-decaying noise, generated in
  code — zero asset downloads): Room / Club / Hall / Stadium presets.
- `ConvolverNode` wet/dry mix slider.

### 3.5 Pro EQ upgrades
- Parametric mode: pick band → set freq / gain / Q / type
  (peak, lowshelf, highshelf, notch) via the existing BiquadFilter plumbing.
- Live frequency-response curve drawn on canvas (getFrequencyResponse).
- 31-band mode as a preset grid.
- Save custom presets to localStorage (`omni:eq-presets`).

### 3.6 Utility switches
- **Night mode:** heavy compression + gain (existing compressor, preset).
- **Mono / L-R balance / channel swap** (splitter/merger reroutes).
- **Bass synth:** `OscillatorNode` sub octave (40–60 Hz) envelope-following
  the kick — fiddly, do last.
- **Vocal boost:** speech band (1–4 kHz) shelf + mild side duck.

### 3.7 ⛔ Crossfade — BLOCKED
Upstream CDN allows **one active connection per client** (measured: second
connection 403s the first). True crossfade needs two streams. Not possible
client-side. Alternative when wanted: **gapless hand-off** (pre-resolve next
URL — already done — and swap at `ended` with zero pause).

---

## 4. Phase P2 — AI STEMS 🤖 💤

Real vocal/instrumental separation, in-browser:
- **Spleeter 2-stems via TensorFlow.js** (or ONNX runtime web) — model
  ~30–60 MB, cached by service worker after first load.
- Flow: track → decode to PCM (OfflineAudioContext) → windowed inference →
  `vocals.webm` + `instrumental.webm` blobs → cached in `surbox-dl-v1`
  cache store keyed `<id>:stem:vocals` → player gains a "Stems: AI" toggle
  that swaps sources seamlessly (keep position).
- Processing time phone: 15–60 s/song, one-time per song.
- UI: in LAB tab, "Separate with AI" button + progress; karaoke then uses
  real stems instead of analog cancel.
- Risk: TFJS bundle size (~1 MB) — lazy-load the whole stems module only on
  first use.

---

## 5. Phase P3 — LIBRARY 2.0 📚 💤

- **Smart playlists** (rules, auto-refreshed): "Top Punjabi", "Downloaded
  only", "This week's 50", "Unheard favourites". Rules engine in
  library.js: `{source, filter, sort, limit}` — evaluated on open.
- **Auto-download favourites:** new favourite → queue background download
  (respect a storage budget setting: "up to 2 GB, evict oldest").
- **Playlist share without a server:** export as compressed JSON → **QR
  code** on screen; other phone scans → imports. (qrcode via canvas, no dep.)
- **Drag-reorder** in playlist (pointer events + FLIP animation).
- **Listening heatmap:** GitHub-style contribution calendar (last 12 months,
  from `omni:lib:time.days`), tap a day → what was played.
- **Streaks + Artist of the Month** cards in Stats.
- **SurBox Wrapped:** shareable year/month card rendered on canvas
  (top artists, minutes, top genre, streak) → PNG download / Web Share.

---

## 6. Phase P4 — DISCOVERY 2.0 🔍 💤

- **Smart recs v2:** co-play signal — mine local history for "people who
  played X also played Y" patterns (pure client-side, no account).
- **Time-of-day auto-mix:** morning energy / night chill — one tap "For this
  hour" shelf on Home.
- **Time Machine:** "On this day" — what you played exactly N months ago.
- **Deep filters** in search results: language, year, duration, bitrate.
- **Search inside results.**
- **Fuzzy matching** for misspellings (levenshtein on titles from catalogue).

---

## 7. Phase P5 — PLATFORM & POLISH 📱 💤

- **Gesture layer:** swipe ←/→ on player = track change, swipe up = open
  full player, swipe down = close. (pointer events, velocity threshold)
- **Haptics:** `navigator.vibrate` on play/pause/like (Android PWA).
- **Dynamic theme:** extract dominant colors from artwork (canvas, 16-bit
  histogram) → offer "Match artwork" accent mode (keeps true black).
- **Chromecast:** Cast icon exists; implement Cast Framework lazy-loaded.
  (Audio is direct-stream URLs — castable; resolve-then-cast flow.)
- **Virtualized lists** (windowing) for 500+ row queues.
- **Widgets/shortcuts:** PWA shortcuts already in manifest; add "Play Daily
  Mix" as shortcut_url.
- **APK:** capacitor config + build-apk.sh ready; needs a build machine
  session (JDK + SDK) — script auto-creates android/ on first run.

---

## 8. Infrastructure notes (permanent)

- **Workers** (Cloudflare, free 100k/day each): `omni-proxy` (31-source race
  + CORS relay), `omni-music-super` (16 Saavn mirrors + multi-engine),
  `omni-discovery` (9 APIs). App ships with BUILTIN_PROXY; user can point at
  their own (Library → App → Speed).
- **Deploy:** GitHub Actions → Pages (`BASE_PATH=/surbox/`), Vercel config
  also present. SW = `surbox-v1`, network-first shell, hashed assets cached.
- **localStorage keys** (all `omni:` prefixed, shared with OmniTools origin
  if ever run on same origin): `lib:fav|hist|playlists|time`, `settings`,
  `music-prefs`, `searches`, `session`, `onb`, `vol`, `viz`, `theme`,
  `custom-theme`, `pwa`.
- **Cache stores:** `surbox-dl-v1` (downloads), `surbox-stems` (future).

---

## 9. Order of attack (when user says "go")

1. **P1 Audio Lab** — karaoke + vocals-only + 8D + reverb + parametric EQ +
   night mode (one session, big visible win)
2. **P1b** pitch shift quick mode → worklet version
3. **P2 AI stems** (own session, heavy)
4. **P3 Library 2.0** → **P4 Discovery** → **P5 Polish** (any order)

*Last updated: v2 UI build — onboarding, dock shell, glass NowBar, premium
Home/Search/Library shipped.*

## P1 — Audio Lab / EQ — ROLLED BACK (v2.4.3, user decision)
Removed from the product. The CDNs behind the catalogue stopped sending
`Access-Control-Allow-Origin` on audio, so a genuine Web-Audio equaliser
cannot run on streamed tracks; the relay workaround (piping audio through
omni-proxy) worked but made playback heavier — buffering and stutter.
Smooth playback wins over any effect. The Audio tab now offers Speed only.
The dormant DSP code stays in player.jsx but nothing reaches it.

## P6 — Android APK wrapper (v2.4.1) — DONE
Capacitor 7 shell around the same web bundle: `android/` project in-repo,
release-signed APK (see `BUILD-ANDROID.md`), adaptive icon + splash from the
theme DNA (neon green/cyan waveform on true black), black status bar via the
native status-bar plugin, VIBRATE permission for the lab's haptic ticks.
Background playback continues (keepRunning); lock-screen controls need a
future native MediaSession service — tracked as a P7 candidate, not claimed
anywhere in the UI.
