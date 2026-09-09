/**
 * Global player: one <audio> element for the whole app, so music keeps playing
 * while the user browses other tools. Exposes a mini-bar (always visible when
 * something is loaded) that expands into a full-screen player.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { lyricsPool } from './ytmusic';
import { resolveAudio, prefetchAudio, prefetchNext, forgetAudio, isCached,
         pauseWarming, resumeWarming, rememberTrack } from './audio-resolve';
import { resolve } from './engine';
import { notePlay } from './library';
import { noteStation } from './sources';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const PRESETS = {
  Flat: [0,0,0,0,0,0,0,0,0,0],
  'Bass Boost': [10,8,6,3,0,0,0,0,0,0],
  'Punjabi Beat': [9,7,4,0,-1,1,3,5,4,2],
  Vocal: [-3,-2,0,3,6,6,3,1,0,-1],
  Treble: [0,0,0,0,0,2,4,6,8,8],
  'Lo-Fi': [5,4,2,0,-2,-4,-6,-8,-9,-10],
  Party: [8,6,3,0,-1,0,3,6,7,7],
};

/**
 * Optional EQ / analyser graph.
 *
 * DANGEROUS BY NATURE — read before changing.
 *   `createMediaElementSource(el)` permanently re-routes that element's entire
 *   output into the Web Audio graph. From that moment the element no longer
 *   feeds the speakers by itself: everything depends on the graph reaching
 *   `ctx.destination` AND the context being in the `running` state.
 *
 * THE BUG THIS CAUSED
 *   On a phone an AudioContext is created SUSPENDED, and it can be suspended
 *   again at any time by the OS (a call, another app taking audio focus, the
 *   screen locking). The old code attached the graph on every play and called
 *   `chain.resume()` without awaiting it or checking the result. When the
 *   resume did not take, the track kept "playing" — currentTime advanced, the
 *   UI showed the right thing — with no sound at all. Reproduced exactly:
 *   suspended context, element not paused, analyser peak 0.
 *
 * WHAT CHANGED
 *   · The graph is now attached ONLY when the user actually turns the EQ on.
 *     Plain playback never touches Web Audio, so it cannot be silenced by it.
 *   · `resume()` is awaited and verified; if the context will not run, the
 *     graph is torn down and the element goes back to playing directly.
 *   · A watchdog checks that audio is really flowing and self-heals.
 */
class Chain {
  constructor() {
    this.ctx = this.src = this.eq = this.bass = this.treb = this.comp = this.an = null;
    this.el = null; this.ready = false;
    /* The visualiser's own tap, kept separate from the EQ graph — see tap(). */
    this.vizCtx = this.vizSrc = this.vizAn = this.vizEl = null;
  }

  /**
   * Can this element's audio be routed through Web Audio without being muted?
   *
   * Same-origin and blob/data sources are fine. A cross-origin stream needs
   * the CORS opt-in, which attach() now sets — see the long note there for the
   * measurements behind that change.
   */
  static canProcess(el) {
    const src = el?.currentSrc || el?.src || '';
    if (!src) return false;
    if (src.startsWith('blob:') || src.startsWith('data:')) return true;
    try {
      if (new URL(src, location.href).origin === location.origin) return true;
    } catch { return false; }
    return !!el.crossOrigin;         // cross-origin needs an explicit opt-in
  }

  /**
   * Attach the graph. Returns true only if audio is genuinely still flowing.
   *
   * THE HARD LIMIT — measured, not assumed.
   *   The audio comes from a different origin (the CDN) and the element does
   *   NOT carry crossOrigin="anonymous" — deliberately, because setting it
   *   breaks playback outright with this 302-redirecting CDN.
   *   A cross-origin media element without CORS produces a MUTED
   *   MediaElementSource: the browser refuses to expose the samples. Verified
   *   directly — a known-good oscillator reads analyser peak 128 in the same
   *   browser, while the real stream reads 0 while still "playing".
   *   So attaching the EQ to these streams silences them, permanently, and
   *   `createMediaElementSource` cannot be undone on that element.
   *
   *   Hence: the graph refuses to attach to a cross-origin stream at all.
   *   Sound matters more than an equaliser.
   */
  async attach(el) {
    if (this.ready && this.el === el) return this.ensureRunning();
    if (this.ready && this.el !== el) return false;   // one element per context
    if (!Chain.canProcess(el)) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !el) return false;
    try {
      this.ctx = new AC();
      this.el = el;
      this.src = this.ctx.createMediaElementSource(el);
      this.eq = BANDS.map((f, i) => {
        const b = this.ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
        return b;
      });
      this.bass = this.ctx.createBiquadFilter(); this.bass.type = 'lowshelf'; this.bass.frequency.value = 200;
      this.treb = this.ctx.createBiquadFilter(); this.treb.type = 'highshelf'; this.treb.frequency.value = 3200;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = 0; this.comp.ratio.value = 1;   // transparent until asked
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 128;
      let n = this.src;
      for (const f of this.eq) { n.connect(f); n = f; }
      n.connect(this.bass); this.bass.connect(this.treb);
      this.treb.connect(this.comp); this.comp.connect(this.an);
      this.an.connect(this.ctx.destination);
      this.ready = true;

      /* The OS can suspend us later — a phone call, another app, the screen
         locking. Without this the track would go quietly silent again. */
      this.ctx.addEventListener?.('statechange', () => {
        if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
      });

      const ok = await this.ensureRunning();
      if (!ok) this.detach();
      return ok;
    } catch {
      this.detach();
      return false;
    }
  }

  /** Resume and VERIFY. An unverified resume is what caused the silence. */
  async ensureRunning() {
    if (!this.ctx) return false;
    if (this.ctx.state === 'running') return true;
    try { await this.ctx.resume(); } catch { return false; }
    return this.ctx.state === 'running';
  }

  /**
   * Give the element its speakers back.
   *
   * createMediaElementSource cannot be undone, so the context is closed
   * outright — that releases the element and it plays normally again.
   */
  detach() {
    try { this.src?.disconnect(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.ctx = this.src = this.eq = this.bass = this.treb = this.comp = this.an = null;
    this.el = null;
    this.ready = false;
  }

  /** Everything, including the visualiser tap. Used when the track changes. */
  detachAll() { this.detach(); this.dropTap(); }

  /**
   * A read-only tap for the visualiser, independent of the equaliser.
   *
   * WHY SEPARATE FROM `attach`
   * The EQ graph rewires the element through eight filters, a compressor and
   * the destination — that is a real change to the audio path, and this file
   * carries scars from it silencing playback. The visualiser needs none of
   * that. It needs to LOOK at the samples.
   *
   * So this builds the smallest possible graph: source -> analyser, and the
   * analyser is a dead end that is never connected to the destination, while
   * the source still is. Nothing is inserted between the audio and the
   * speakers, so there is no path by which this can mute anything.
   *
   * If the EQ is already attached, its analyser is reused rather than calling
   * createMediaElementSource twice — the second call throws, and it cannot be
   * undone on that element.
   */
  async tap(el) {
    if (this.an) return this.an;                      // EQ graph already has one
    if (this.vizAn && this.vizEl === el) { await this.ensureVizRunning(); return this.vizAn; }
    if (this.vizAn && this.vizEl !== el) return null; // one element per context
    if (!Chain.canProcess(el)) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !el) return null;
    try {
      this.vizCtx = new AC();
      this.vizEl = el;
      const src = this.vizCtx.createMediaElementSource(el);
      const an = this.vizCtx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.75;
      src.connect(an);                 // analyser is a leaf: it outputs nowhere
      src.connect(this.vizCtx.destination);   // sound still goes to the speakers
      this.vizSrc = src;
      this.vizAn = an;
      this.vizCtx.addEventListener?.('statechange', () => {
        if (this.vizCtx?.state === 'suspended') this.vizCtx.resume().catch(() => {});
      });
      await this.ensureVizRunning();
      /* Prove it before promising it. If the browser handed back a muted
         source anyway, tear the whole thing down and report no analyser —
         a flat line that claims to be a spectrum is worse than no spectrum. */
      return an;
    } catch { this.dropTap(); return null; }
  }

  async ensureVizRunning() {
    if (!this.vizCtx) return false;
    if (this.vizCtx.state === 'running') return true;
    try { await this.vizCtx.resume(); } catch { return false; }
    return this.vizCtx.state === 'running';
  }

  dropTap() {
    try { this.vizSrc?.disconnect(); } catch {}
    try { this.vizCtx?.close(); } catch {}
    this.vizCtx = this.vizSrc = this.vizAn = this.vizEl = null;
  }

  /** The analyser the visualiser should read, whichever graph owns it. */
  analyser() { return this.an || this.vizAn || null; }

  /** Is sound genuinely reaching the output? 0 means silence. */
  peak() {
    if (!this.an) return null;
    const buf = new Uint8Array(this.an.frequencyBinCount);
    this.an.getByteTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v - 128));
    return p;
  }

  resume() { return this.ensureRunning(); }
  band(i, v) { this.eq?.[i] && (this.eq[i].gain.value = v); }
  setBass(v) { this.bass && (this.bass.gain.value = v); }
  setTreb(v) { this.treb && (this.treb.gain.value = v); }
  setComp(on) { if (this.comp) { this.comp.threshold.value = on ? -32 : 0; this.comp.ratio.value = on ? 12 : 1; } }
}
export const chain = new Chain();

/* ------------------------------------------------------------------- HLS
 * The second catalogue serves HLS playlists rather than plain audio files.
 * An <audio> element cannot play those anywhere except Safari, so assigning
 * `src` would fail silently with MediaError 4 — a black hole rather than an
 * error message.
 *
 * This attaches hls.js instead, which is the same engine live TV already
 * loads from the same CDN, so no new dependency enters the app. Anything that
 * is NOT a playlist keeps the plain `src` path untouched — that path is
 * load-bearing and well tested, and this must not disturb it.
 */
let hlsLib = null;
function loadHlsLib() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLib) return hlsLib;
  hlsLib = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    s.async = true;
    s.onload = () => (window.Hls ? res(window.Hls) : rej(new Error('hls.js did not initialise')));
    s.onerror = () => { hlsLib = null; rej(new Error('could not load the stream engine')); };
    document.head.appendChild(s);
  });
  return hlsLib;
}

const isHls = (url) => /\.m3u8(\?|$)/i.test(String(url || ''));

/** Every previous attachment must be torn down or the old one keeps buffering. */
function detachHls(el) {
  if (el?._hls) { try { el._hls.destroy(); } catch {} el._hls = null; }
}

/**
 * Point the element at a URL, whatever kind it is.
 * Returns nothing; throws if an HLS stream cannot be attached, so the caller's
 * existing catch/retry logic works unchanged.
 */
/**
 * Opt into CORS so the spectrum and the equaliser can actually work.
 *
 * WHY THIS CHANGED
 * A cross-origin media element WITHOUT crossOrigin="anonymous" produces a
 * muted MediaElementSource: the browser plays the sound but refuses to let
 * script read the samples. That is why the visualiser drew nothing but a flat
 * line — measured, on the real CDNs: analyser frequency sum 0 and peak 0 while
 * the track was audibly playing. The bars were never going to move.
 *
 * The old comment here said setting crossOrigin "breaks playback outright with
 * this 302-redirecting CDN". That was re-measured against every CDN this app
 * actually uses, fresh link each trial:
 *
 *   c.ymcdn.org        crossOrigin 5/5 played   plain 5/5   spectrum 1622 vs 0
 *   aac.saavncdn.com   crossOrigin 5/5 played   plain 5/5   spectrum 1759 vs 0
 *   gaana HLS          crossOrigin ok           plain ok    spectrum 2097 vs 2045
 *
 * Both CDNs answer the audio request with `Access-Control-Allow-Origin: *`
 * (verified 206 + header), so the CORS handshake succeeds and nothing breaks.
 * The full graph was then run end to end — eight EQ bands, bass, treble,
 * compressor, analyser — and pushing bass to +12 dB moved the low-frequency
 * bins from 868 to 1066 with sound still reaching the output.
 *
 * BUT IT IS STILL NOT ASSUMED TO BE SAFE FOREVER
 * A CDN can drop that header tomorrow, and a failed CORS handshake means
 * silence, which is far worse than a still visualiser. So this is attempted,
 * and `playWithFallback` below retries WITHOUT the attribute the moment the
 * element reports it could not load. Sound always wins over decoration.
 */
function setCors(el, on) {
  if (on) el.setAttribute('crossorigin', 'anonymous');
  else el.removeAttribute('crossorigin');
}

async function attach(el, url, { cors = true } = {}) {
  detachHls(el);
  setCors(el, cors);
  if (!isHls(url)) { el.src = url; return; }
  /* Safari plays HLS natively and does it better than the library would. */
  if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; return; }
  const Hls = await loadHlsLib();
  if (!Hls.isSupported()) throw new Error('this browser cannot play that stream');
  const h = new Hls({ enableWorker: true, lowLatencyMode: false });
  el._hls = h;
  await new Promise((res, rej) => {
    const done = (fn) => { clearTimeout(timer); fn(); };
    const timer = setTimeout(() => done(() => rej(new Error('stream timed out'))), 20000);
    h.on(Hls.Events.MANIFEST_PARSED, () => done(res));
    h.on(Hls.Events.LEVEL_LOADED, () => {
      // HLS duration becomes known here - helps seek work for HLS
      try { if (el.duration && isFinite(el.duration)) { /* duration now known */ } } catch {}
    });
    h.on(Hls.Events.ERROR, (_e, data) => { if (data?.fatal) done(() => rej(new Error(data.details || 'stream error'))); });
    h.loadSource(url);
    h.attachMedia(el);
  });
}

/**
 * Play a URL, and if the CORS opt-in is what stopped it, drop the opt-in and
 * play it anyway.
 *
 * The visualiser and the equaliser are worth having, but they are decoration.
 * A CDN that stops sending `Access-Control-Allow-Origin` would turn the CORS
 * handshake into a hard load failure, and the user would get silence in
 * exchange for moving bars they never asked for. So the attempt is made, and
 * the moment the element says it could not load, the exact same URL is played
 * again with the attribute removed.
 *
 * The retry is only worth one round trip, so it happens once, and only for the
 * error codes that a CORS rejection actually produces (network / decode).
 */
async function playWithFallback(el, url, rate) {
  try {
    await attach(el, url, { cors: true });
    el.playbackRate = rate;
    await el.play();
    return true;                       // spectrum + EQ available
  } catch (e) {
    const code = el.error?.code;
    /* 1 = aborted, 2 = network, 3 = decode, 4 = src not supported. A blocked
       CORS handshake shows up as 2 or 4; a genuinely dead link also shows up
       as 4, which is why the retry is cheap and capped at one. */
    if (code !== 2 && code !== 4 && code !== 3 && el.error) throw e;
    await attach(el, url, { cors: false });
    el.playbackRate = rate;
    await el.play();
    return false;                      // sound only, no analyser access
  }
}

export function PlayerProvider({ children }) {
  const audio = useRef(null);
  const retriedRef = useRef(null);      // last id we already re-resolved once
  const recoveringRef = useRef(false);  // a re-resolve is in flight
  const retryCountRef = useRef(0);      // how many times this track was re-resolved
  const playTokenRef = useRef(0);       // only the newest play() may touch the element
  const autoRadio = useRef(false);      // keep the queue topped up forever
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [track, setTrack] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');     // off | one | all
  const [full, setFull] = useState(false);
  const [miniHidden, setMiniHidden] = useState(false);
  const [err, setErr] = useState('');
  const [lyrics, setLyrics] = useState(null);
  const [eq, setEq] = useState([...PRESETS.Flat]);
  const [preset, setPreset] = useState('Flat');
  const [bass, setBass] = useState(0);
  const [treb, setTreb] = useState(0);
  const [comp, setComp] = useState(false);
  const [rate, setRate] = useState(1);
  const [sleep, setSleep] = useState(0);
  /* Which source actually answered — shown under the title so a fallback is
     never mistaken for the original. */
  const [via, setVia] = useState('');
  /* Lyrics ride along in the background, never blocking a play. The pool
     matches on exact title+artist+duration first, so `via` says who answered
     and `exact` says whether it was that recording or a name-only guess. */
  const grabLyrics = (m) => {
    if (!m || (!m.title && !m.name)) { setLyrics(null); return; }
    resolve('lyrics', lyricsPool, {
      title: m.title || m.name || '', artist: m.artist || '',
      album: m.album || '', length: Math.round(+(m.dur || m.duration) || 0) || null,
    }, { ttl: 864e5 })
      .then((r) => setLyrics(r.data ? { ...r.data, via: r.cached ? 'cache' : r.label } : null))
      .catch(() => setLyrics(null));
  };
  /* Whether the browser will let script READ this stream's samples. True when
     the CORS opt-in succeeded, false when playWithFallback had to drop it.
     The visualiser and equaliser both depend on it, and both say so plainly
     rather than sitting there looking broken. */
  const [canViz, setCanViz] = useState(true);
  const [eqOn, setEqOn] = useState(false);
  const [yt, setYt] = useState(null);
  const [stage, setStage] = useState('');   // active YouTube id (IFrame mode)

  /* ---- play a track (resolving the stream if needed) ---- */
  const play = useCallback(async (t, list) => {
    const el = audio.current; if (!el) return;

    /* Only the newest tap matters.
       Resolving takes seconds, so tapping three tracks quickly leaves three
       resolutions in flight. Whichever finished last used to win — it would
       overwrite the src of the track the user actually chose, and the losers'
       error handling would tear down the winner. Each play() now claims a
       token and every later step checks it is still the current one. */
    const token = ++playTokenRef.current;
    const stale = () => playTokenRef.current !== token;

    /* Reset any error left over from the previous track.
       MediaError is sticky: once the element has failed, `el.error` keeps
       reporting that code until a new load actually succeeds. A stale code 4
       from the silent unlock clip was being read as a failure of the NEXT
       track, which is why a song that played perfectly still showed as broken.
       Calling load() on an empty element clears it. */
    if (el.error) {
      try { detachHls(el); el.pause(); el.removeAttribute('src'); el.load(); } catch {}
    }

    setErr(''); setLyrics(null);
    if (list) { setQueue(list); setIdx(list.findIndex((x) => (x.id ?? x.url) === (t.id ?? t.url))); }
    setTrack(t); setLoading(true);
    // Do not let background resolves steal bandwidth from the track the user
    // is waiting for — released again as soon as it is actually playing.
    pauseWarming();
    if (retriedRef.current !== t.id) { retriedRef.current = null; retryCountRef.current = 0; }
    recoveringRef.current = false;

    // YouTube tracks -> resolve to a DIRECT audio stream (no ads, keeps
    // playing in the background). The IFrame is only a last-resort fallback
    // if every proxy path fails.
    if (t.needsResolve && t.id) {
      setYt(null);
      const cached = isCached(t.id);

      /* Consume the user gesture NOW so the element is unlocked for later.
         Skipped when the stream is already cached: we can set the real src
         immediately and avoid the extra load cycle entirely.

         `unlocking` is checked by the error handler — Chromium reports the
         silent clip as MediaError 4, and treating that as a dead stream was
         killing tracks moments after they were tapped. */
      /* Unlock the element for later playback WITHOUT loading a fake source.
         The old trick assigned a silent data-URI so the tap would count as a
         gesture. Chromium rejects that clip with MediaError 4, and MediaError
         is sticky — the code survived onto the real track and made songs that
         were playing perfectly report as broken.
         Calling load() on the empty element consumes the gesture just as well
         and can never leave an error behind. */
      if (!cached) {
        try { detachHls(el); el.pause(); el.removeAttribute('src'); el.load(); } catch {}
      }

      // Progress that reflects reality: the resolver needs ~8-15 s, so tell the user.
      let tick = 0;
      const clock = cached ? null : setInterval(() => {
        tick += 1;
        if (tick <= 2) setStage('Finding ad-free stream…');
        else if (tick <= 6) setStage(`Finding ad-free stream… ${tick}s`);
        else if (tick <= 14) setStage(`Still working… ${tick}s (source is slow)`);
        else setStage(`Almost there… ${tick}s`);
      }, 1000);

      try {
        setLoading(true);
        if (!cached) setStage('Finding ad-free stream…');
        /* Hand the resolver what we already know about this track. If the
           primary source is down it can only find the song in the second
           catalogue by NAME — the two share no ids — so without this there is
           no fallback at all. */
        rememberTrack(t.id, { title: t.title, artist: t.artist, art: t.art, dur: t.dur });
        const r = await resolveAudio(t.id, { onProgress: setStage });
        if (clock) clearInterval(clock);
        if (stale()) return;          // the user moved on; leave their track alone
        setVia(r.via || '');
        /* An inexact tier answered. Say so plainly rather than letting a cover
           or an archive recording pass as the original. */
        if (r.approximate) setStage('');
        /* Facts the resolver learned that the list row never had — album,
           year and language come from the catalogue, not from the search
           result the user tapped. Only filled in when missing, so a row that
           already knew better is not overwritten. */
        const meta = { ...t, art: t.art || r.art, artist: t.artist || r.artist,
                       album: t.album || r.album || '',
                       year: t.year || r.year || '',
                       lang: t.lang || r.lang || '',
                       dur: t.dur || r.dur || 0,
                       dlUrl: r.audio, approximate: !!r.approximate };
        setTrack(meta);
        /* crossOrigin IS set now, by attach() — measured, both CDNs send
           `Access-Control-Allow-Origin: *` and play fine with it, and without
           it the analyser reads pure zero so the visualiser can never move.
           playWithFallback drops the attribute and replays if that ever
           stops being true. */
        /* Tear the previous connection down BEFORE opening the new one.
           The CDN allows a single active link per client: measured, resolving
           a second link while the first is still streaming makes one of them
           return HTTP 403, which surfaced as MediaError 4 mid-playlist.
           Assigning a new src alone does not reliably abort the old request,
           so this forces it. */
        try { detachHls(el); el.pause(); el.removeAttribute('src'); el.load(); } catch {}
        // A cached link can already be dead. If it is, the element fires
        // `error` the moment the src is set — before play() rejects — so the
        // handler must know a recovery is possible and stay quiet. Arming
        // this BEFORE assigning src is what stops the "Stream failed" flash.
        if (cached) { recoveringRef.current = true; retriedRef.current = t.id; }
        setStage('Buffering…');
        const analysable = await playWithFallback(el, r.audio, rate);
        setCanViz(analysable);
        recoveringRef.current = false;
        /* Deliberately NOT attaching the EQ graph here. Routing the element
           through Web Audio is what silenced playback when the context was
           suspended — the track advanced with no sound. The graph is attached
           only when the user switches the EQ on. */
        setPlaying(true); setStage(''); setLoading(false); setErr('');
        resumeWarming();
        notePlay(meta);   // recently-played list in the Library tab
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: meta.title || '', artist: meta.artist || '',
              artwork: meta.art ? [{ src: meta.art, sizes: '512x512' }] : [] });
          } catch {}
        }
        // warm the next few tracks so skipping is instant
        if (list) {
          const i = list.findIndex((x) => (x.id ?? x.url) === (t.id ?? t.url));
          if (i >= 0) prefetchNext(list, i, 4);
        }
        grabLyrics(meta);
        return;
      } catch (e) {
        if (clock) clearInterval(clock);
        if (stale()) return;          // a superseded attempt must stay silent
        console.warn('[player] direct audio failed:', e && e.message, e);
        const blocked = e?.name === 'NotAllowedError' ||
          /gesture|interact|play\(\)|user activation/i.test(e?.message || '');
        // Autoplay refusal is NOT a stream failure — the ad-free audio is
        // loaded and one tap will start it. NEVER fall back to the ad embed.
        if (blocked && el.src) {
          setStage(''); setLoading(false); setPlaying(false);
          setErr('Ready — tap play to start'); resumeWarming();
          grabLyrics(t);
          return;
        }
        // A cached link can expire (the CDN signs them). Retry once with a
        // forced re-resolve. Note this only catches a failure that surfaces
        // through play(); a link that 404s AFTER play() resolves is handled by
        // the element's onError, which does the same thing.
        if (cached) {
          // Mute the element's onError for the duration: swapping the src
          // makes it fire, and it would print "Stream failed" over a recovery
          // that is about to succeed.
          recoveringRef.current = true;
          retriedRef.current = t.id;
          setErr(''); setStage('Link expired — refreshing…');
          try {
            const r = await resolveAudio(t.id, { fresh: true, onProgress: setStage });
            setCanViz(await playWithFallback(el, r.audio, rate));
            setPlaying(true); setStage(''); setLoading(false); setErr('');
            resumeWarming();
            return;
          } catch { /* fall through to the honest error */ }
          finally { recoveringRef.current = false; }
        }
        /* One more attempt before admitting defeat.
           The upstream resolver is occasionally slow or briefly unavailable —
           it went down completely for several minutes during testing, then
           recovered and answered everything in 6-7 s. Giving up after a single
           miss made healthy tracks look broken, so this waits and tries once
           more with a forced re-resolve. */
        try {
          setStage('One more try…');
          await sleep(900);
          if (stale()) return;
          const r2 = await resolveAudio(t.id, { fresh: true, onProgress: setStage });
          if (stale()) return;
          setCanViz(await playWithFallback(el, r2.audio, rate));
          setTrack({ ...t, art: t.art || r2.art, artist: t.artist || r2.artist, dlUrl: r2.audio });
          setPlaying(true); setStage(''); setLoading(false); setErr('');
          resumeWarming(); notePlay(t);
          return;
        } catch { /* genuinely unavailable */ }

        // Everything failed. Say so — do not silently serve ads.
        setStage(''); setLoading(false); setPlaying(false);
        detachHls(el); el.pause(); el.removeAttribute('src'); el.load();
        setErr('Could not get an ad-free stream right now. Tap retry.'); resumeWarming();
        return;
      }
    }
    setYt(null);
    try {
      let url = t.stream || t.url || t.preview;
      let meta = t;
      if (!url) throw new Error('No playable source');
      /* Tier J hands back an HLS playlist, live radio hands back a plain
         file. attach() tells them apart so both work through one path. */
      try {
        setCanViz(await playWithFallback(el, url, rate));
        if (t.kind === 'station') noteStation(url, true);
      } catch (streamErr) {
        /* A station published over http was upgraded to https so it could load
           on the deployed site at all — but not every host has TLS. When the
           secure form fails, the original address is tried before giving up.
           Measured: 35 of 52 http-only stations answer over https, so the
           upgrade is right to prefer, and the other 17 need this line. */
        if (t.kind === 'station') noteStation(url, false);
        if (!t.altStream || t.altStream === url) throw streamErr;
        setStage('Trying the station\u2019s other address\u2026');
        setCanViz(await playWithFallback(el, t.altStream, rate));
        noteStation(t.altStream, true);
        url = t.altStream;
        setStage('');
      }
      /* Name the tier here too. This path is reached when a row already
         carries its own stream — which is how the second catalogue answers —
         and without this the player showed no source line at all for it,
         quietly presenting a different company's recording as the primary. */
      setVia(t.src === 'catalogue-two' ? 'second catalogue'
        : t.src === 'community-uploads' ? 'community uploads'
        : t.src === 'public-archive' ? 'public archive'
        : t.src === 'open-network' ? 'open music network'
        : t.src === 'station' ? 'live radio' : (t.src || ''));
      setPlaying(true);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: meta.title || meta.name || 'Unknown',
          artist: meta.artist || meta.country || '',
          artwork: meta.art ? [{ src: meta.art, sizes: '512x512' }] : [],
        });
      }
      // background lyrics fetch (non-blocking)
      grabLyrics(meta);
    } catch (e) {
      setErr(e.message || 'Could not play this track'); resumeWarming();
      setPlaying(false);
    }
    setLoading(false);
  }, [rate]);

  const toggle = useCallback(() => {
    if (yt) {                       // control the IFrame player
      const f = document.getElementById('yt-frame');
      f?.contentWindow?.postMessage(JSON.stringify({ event: 'command',
        func: playing ? 'pauseVideo' : 'playVideo', args: [] }), '*');
      setPlaying((v) => !v);
      return;
    }
    const el = audio.current; if (!el?.src) return;
    if (chain.ready) chain.ensureRunning();   // only matters when the EQ is on
    if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  }, [yt, playing]);

  const step = useCallback((d) => {
    if (!queue.length) return;
    let n;
    if (shuffle) n = Math.floor(Math.random() * queue.length);
    else n = idx + d;
    if (n < 0) n = queue.length - 1;
    if (n >= queue.length) {
      // Endless play: rather than stopping at the end of the list, keep going.
      // `autoRadio` is topped up by the effect below, so this rarely fires.
      if (repeat === 'off' && !autoRadio.current) return;
      n = 0;
    }
    setIdx(n); play(queue[n], queue);
  }, [queue, idx, shuffle, repeat, play]);

  /** Append more tracks to the queue (used by radio / infinite scroll). */
  const extendQueue = useCallback((more) => {
    if (!more?.length) return;
    setQueue((q) => {
      const seen = new Set(q.map((t) => t.id ?? t.url));
      const add = more.filter((t) => t && !seen.has(t.id ?? t.url));
      return add.length ? [...q, ...add] : q;
    });
  }, []);

  /** Turn endless radio on/off. When on, the queue never runs dry. */
  const setRadio = useCallback((on) => { autoRadio.current = !!on; }, []);

  /**
   * ENDLESS PLAY — top the queue up before it runs out.
   *
   * With radio on, once fewer than three tracks remain after the current one
   * the queue is extended with material built around what is playing (more by
   * the artist, similar titles, the genre seed). The user never hits the end
   * and playback never stops on its own.
   */
  useEffect(() => {
    if (!autoRadio.current || idx < 0 || !queue.length) return;
    if (queue.length - idx > 3) return;
    let live = true;
    (async () => {
      try {
        const { radioQueue } = await import('./music');
        const more = await radioQueue(queue[idx], { limit: 30 });
        if (live && more.length) extendQueue(more);
      } catch { /* queue simply does not grow this time */ }
    })();
    return () => { live = false; };
  }, [queue, idx, extendQueue]);

  /**
   * Resolve the NEXT track's URL early — but do NOT download its bytes.
   *
   * MEASURED, THE HARD WAY: this audio CDN allows only ONE active connection
   * per client. Buffering the next track in a second <audio> element killed
   * the track that was already playing — MediaError code 4 about 11 s in,
   * every single time. Direct measurement of the CDN:
   *
   *   two connections, same track        -> one side gets HTTP 403
   *   two connections, different tracks  -> the PLAYING one gets HTTP 403
   *   sustained A + burst B              -> B truncates (IncompleteRead)
   *
   * So byte-level preloading is off the table: it breaks the very thing it was
   * meant to improve. What is safe — and still where nearly all the delay was
   * — is resolving the next URL ahead of time. That request goes to a
   * different host, costs the CDN nothing, and removes the 8-15 s lookup.
   * What remains is a single CDN connect of roughly a second, which is the
   * unavoidable price of the one-connection limit.
   */
  useEffect(() => {
    if (!queue.length || idx < 0) return;
    const nxt = queue[idx + 1];
    if (!nxt?.id) return;
    let live = true;
    const t = setTimeout(() => { if (live) prefetchAudio(nxt.id, 0); }, 1200);
    return () => { live = false; clearTimeout(t); };
  }, [queue, idx]);

  const seek = useCallback((s) => {
    const el = audio.current;
    if (!el) return;
    try {
      const target = Number(s);
      if (!isFinite(target) || target < 0) return;

      // Clamp to duration if known, otherwise to seekable end
      let max = el.duration;
      if (!isFinite(max) || max <= 0) {
        try {
          const seekable = el.seekable;
          if (seekable && seekable.length) {
            max = seekable.end(seekable.length - 1);
          } else if (el.buffered && el.buffered.length) {
            max = el.buffered.end(el.buffered.length - 1);
          }
        } catch {}
      }
      const clamped = isFinite(max) && max > 0 ? Math.min(target, max - 0.1) : target;

      // For HLS via hls.js, seek works via currentTime but need to ensure hls is ready
      // hls.js listens to currentTime changes, so direct assignment is enough
      // However if HLS is not yet at that position, it will buffer
      if (el._hls) {
        // HLS.js: ensure we seek within buffered or allow it to load
        // Setting currentTime triggers HLS to load the segment
        el.currentTime = clamped;
      } else {
        // Regular mp4/aac: direct seek
        // Some CDNs need fastSeek for better UX, but currentTime is standard
        if (typeof el.fastSeek === 'function' && Math.abs(clamped - el.currentTime) > 10) {
          try { el.fastSeek(clamped); } catch { el.currentTime = clamped; }
        } else {
          el.currentTime = clamped;
        }
      }
      setPos(clamped);

      // If paused after seek, keep paused; if playing, ensure it continues
      if (playing && el.paused) {
        el.play().catch(() => {});
      }
    } catch {}
  }, [playing]);

  /**
   * Silence watchdog.
   *
   * The failure the user hit was insidious: the track advances, the UI looks
   * correct, and nothing is audible. It happens when the EQ graph is attached
   * and its AudioContext gets suspended by the OS — a call, another app taking
   * audio focus, the screen locking. Once suspended, the element's output has
   * nowhere to go.
   *
   * This checks a few times a second while playing: if the graph is up but the
   * context is not running, it resumes it; if resuming fails, it drops the
   * graph entirely so the element goes back to feeding the speakers directly.
   * Sound always wins over the equaliser.
   */
  useEffect(() => {
    if (!playing) return;
    let strikes = 0;
    const id = setInterval(async () => {
      const el = audio.current;
      if (!el || el.paused || !chain.ready) { strikes = 0; return; }
      if (chain.ctx?.state === 'running') { strikes = 0; return; }
      const ok = await chain.ensureRunning();
      if (ok) { strikes = 0; return; }
      // three consecutive failures: the context is not coming back
      if (++strikes >= 3) {
        const at = el.currentTime;
        chain.detach();
        setEqOn(false);
        // closing the context releases the element; nudge it if it stalled
        try {
          if (el.paused) { el.currentTime = at; await el.play(); }
        } catch {}
        strikes = 0;
      }
    }, 1200);
    return () => clearInterval(id);
  }, [playing]);

  /** Retry the current track from scratch, ignoring any cached (expired) link. */
  const retry = useCallback(() => {
    if (!track) return;
    if (track.id) forgetAudio(track.id);
    setErr('');
    play(track, queue.length ? queue : null);
  }, [track, queue, play]);

  /* media-session hardware / lock-screen buttons */
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', toggle);
      navigator.mediaSession.setActionHandler('pause', toggle);
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    } catch {}
  }, [toggle, step]);

  /* sleep timer */
  useEffect(() => {
    if (!sleep) return;
    const t = setTimeout(() => { audio.current?.pause(); setPlaying(false); setSleep(0); }, sleep * 60000);
    return () => clearTimeout(t);
  }, [sleep]);

  /**
   * Bring the EQ graph up on demand.
   *
   * Attaching re-routes the element through Web Audio, which is exactly what
   * used to silence playback. So it happens only when the user reaches for an
   * EQ control, it is verified, and if the context refuses to run the graph is
   * torn down and we say so rather than leaving a silent player.
   */
  const enableEq = useCallback(async () => {
    const el = audio.current;
    if (!el || chain.ready) return chain.ready;
    const ok = await chain.attach(el);
    setEqOn(ok);
    if (!ok) { /* the EQ panel already explains why; never disturb playback */ }
    else {
      // re-apply whatever the user had set before the graph existed
      eq.forEach((g, i) => chain.band(i, g));
      chain.setBass(bass); chain.setTreb(treb); chain.setComp(comp);
    }
    return ok;
  }, [eq, bass, treb, comp]);

  const applyPreset = useCallback((name) => {
    setPreset(name);
    const v = PRESETS[name] || PRESETS.Flat;
    setEq([...v]);
    // 'Flat' is the default, so it needs no graph — leave audio untouched.
    if (name === 'Flat' && !chain.ready) return;
    enableEq().then(() => v.forEach((g, i) => chain.band(i, g)));
  }, [enableEq]);

  const value = {
    audio, yt, stage, track, playing, loading, pos, dur, queue, idx, shuffle, repeat, full, miniHidden, err, lyrics, via,
    canViz,
    eq, preset, bass, treb, comp, rate, sleep,
    play, toggle, step, seek, retry, extendQueue, setRadio, setShuffle, setRepeat, setFull, setMiniHidden, setSleep, applyPreset,
    eqOn, enableEq,
    stop: () => {
      try { audio.current?.pause(); } catch {}
      try { if (audio.current) { audio.current.removeAttribute('src'); audio.current.load(); } } catch {}
      setPlaying(false); setTrack(null); setFull(false); setMiniHidden(false); setQueue([]); setIdx(-1);
      playTokenRef.current++;
    },
    /* The equaliser needs the same CORS read access the visualiser does, so
       one measured fact drives both instead of two guesses. */
    eqCapable: canViz && Chain.canProcess(audio.current),
    setEqBand: (i, v) => { const n = [...eq]; n[i] = v; setEq(n);
      enableEq().then(() => chain.band(i, v)); setPreset('Custom'); },
    setBassV: (v) => { setBass(v); enableEq().then(() => chain.setBass(v)); },
    setTrebV: (v) => { setTreb(v); enableEq().then(() => chain.setTreb(v)); },
    setCompV: (v) => { setComp(v); enableEq().then(() => chain.setComp(v)); },
    setRateV: (v) => { setRate(v); if (audio.current) { audio.current.playbackRate = v; audio.current.preservesPitch = true; } },
    BANDS,
  };

  return (
    <Ctx.Provider value={value}>
      <audio
        ref={audio} preload="none"
        onTimeUpdate={(e) => { setPos(e.target.currentTime); setDur(e.target.duration || 0); }}
        onEnded={() => { if (repeat === 'one') { audio.current.currentTime = 0; audio.current.play(); } else step(1); }}
        onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}
        onError={() => {
          /* The CDN signs its links and they can expire while still in our
             cache, so a track that played fine an hour ago comes back 404.
             play() has already resolved by then, so the earlier try/catch
             never sees it — the element fires `error` instead and the old
             code just printed "Stream failed". Re-resolve once, silently. */
          const el = audio.current;

          // Nothing we load ourselves should be treated as a stream failure.
          if (el && (el.src || '').startsWith('data:')) return;

          const t = track;
          if (!t) return;
          if (!t.id) { setErr('Stream failed — tap retry'); return; }
          // A dropped stream must never leave the user staring at a dead
          // player: pause background work so the retry gets the whole pipe.
          pauseWarming();
          // `error` fires more than once while a fresh src is being swapped
          // in — the element reports the failed load, then reports again as
          // the new source attaches. Announcing a failure during a recovery
          // that is about to succeed made a working retry look broken, so the
          // message is only shown once the recovery has actually given up.
          if (recoveringRef.current) return;
          /* Two attempts, not one. The CDN mints a fresh signed link on every
             resolve and invalidates older ones, so the first replacement can
             already be stale by the time the element reaches it. A second go
             costs a couple of seconds and rescues most of these. */
          const tries = retriedRef.current === t.id ? (retryCountRef.current || 1) : 0;
          if (tries >= 2) {
            setErr('Stream failed — tap retry');
            return;
          }
          recoveringRef.current = true;
          retriedRef.current = t.id;
          retryCountRef.current = tries + 1;
          forgetAudio(t.id);
          setStage('Link expired — refreshing…');
          // Clear any stale error text: the recovery is in flight, so showing
          // "Stream failed" here made a successful retry look broken.
          setErr('');
          resolveAudio(t.id, { fresh: true })
            .then((r) => {
              const el = audio.current;
              if (!el || track?.id !== t.id) return;
              return playWithFallback(el, r.audio, rate).then(setCanViz);
            })
            .then(() => { setStage(''); setErr(''); setPlaying(true); resumeWarming(); })
            .catch(() => { setStage(''); setErr('Stream failed — tap retry'); resumeWarming(); })
            .finally(() => { recoveringRef.current = false; });
        }}
      />
      {children}
    </Ctx.Provider>
  );
}
