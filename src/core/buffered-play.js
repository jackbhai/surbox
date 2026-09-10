/**
 * Buffered playback — fetch the bytes once, play them locally.
 *
 * WHY THIS EXISTS (measured, 2026-09-10, against the live chain)
 * The old path pointed the <audio> element straight at the CDN and let the
 * platform stream it. That is fine in a desktop browser and fragile
 * everywhere a phone actually plays music:
 *
 *   · The primary CDN truncates a transfer at exactly 4 MiB every so often
 *     (measured repeatedly: the connection closes after 4 194 304 bytes)
 *     and IGNORES Range requests — ask for `bytes=100-199` and it answers
 *     `206` with `Content-Range: bytes 0-4557664/4557665`, the whole file
 *     from zero. A stream that dies mid-song therefore cannot be resumed
 *     by the media stack: it stalls, and the demuxer feeding the decoder
 *     through the gap is exactly the torn, crackling audio ("fati hui
 *     awaz") the user heard.
 *   · A phone's radio drops and re-NATs connections far more often than a
 *     datacentre ever sees. Every drop is an unrecoverable stall for the
 *     same reason — there is no resume.
 *   · The Android WebView's media stack is not Chrome's: its buffer is
 *     smaller, its bandwidth estimation weaker, and it carries stutter
 *     bugs of its own. Handing it a LOCAL blob removes the whole class of
 *     network failure — a blob cannot stall, cannot truncate, cannot be
 *     rate-limited, and seeks are instant.
 *
 * HOW IT PLAYS A TRACK
 * fetch() the audio with a streaming reader, then one of two openings:
 *
 *   FAST PIPE  — when the transfer's measured pace says the whole file is
 *               ~10 s away, playback simply waits for it. No seam, no
 *               second source, the element plays one complete local file.
 *
 *   SLOW PIPE  — the moment ~45 s of music has arrived, the element is
 *               handed a blob cut from those bytes and starts playing
 *               while the rest downloads. The moment the file completes,
 *               the element is switched to it at the same position (a
 *               sub-second seam, always far better than the crackle it
 *               replaces). If playback were ever about to outrun the
 *               download, it pauses a few seconds short — an honest
 *               buffering pause, like any streaming player — until the
 *               bytes land. A pipe so slow that even that cannot win
 *               (the rest is >45 s away) declines the buffered path
 *               entirely and the player streams directly, as it always
 *               did.
 *
 * THE ONE-CONNECTION RULE
 * The primary CDN 403s clients that hold two connections at once
 * (measured — see player.jsx). So exactly ONE byte transfer runs at any
 * moment, enforced by the lock below. The track the user is waiting for
 * pre-empts any background prefetch, never the other way round.
 *
 * WHEN THIS STANDS ASIDE
 * Live stations (an endless stream can never complete), HLS playlists,
 * and already-local blob:/data: URLs keep the old direct path.
 */

/* ------------------------------------------------------------ blob store
 * Completed tracks, kept in RAM so replays and skips back are instant.
 * A 320 kbps song is 8-12 MB; eight of them is the budget. LRU, and the
 * object URLs are revoked on eviction so the memory really leaves. */
const MAX_BYTES = 72 * 1024 * 1024;
const MAX_ITEMS = 8;
const STORE = new Map();            // key -> { url, size, at }
let storeBytes = 0;

/** Object URL for a finished blob. Stored under the key when there is one;
 *  untracked (session-owned) when there is not. */
function keepBlob(key, blob) {
  const url = URL.createObjectURL(blob);
  if (!key || !blob?.size) return { url, stored: false };
  const old = STORE.get(key);
  if (old) { STORE.delete(key); storeBytes -= old.size; try { URL.revokeObjectURL(old.url); } catch {} }
  STORE.set(key, { url, size: blob.size, at: Date.now() });
  storeBytes += blob.size;
  while ((storeBytes > MAX_BYTES || STORE.size > MAX_ITEMS) && STORE.size > 1) {
    let oldest = null;
    for (const [k, v] of STORE.entries()) if (k !== key && (!oldest || v.at < STORE.get(oldest).at)) oldest = k;
    if (!oldest) break;
    const v = STORE.get(oldest);
    STORE.delete(oldest); storeBytes -= v.size;
    try { URL.revokeObjectURL(v.url); } catch {}
  }
  return { url, stored: true };
}

export const hasBuffered = (key) => !!key && STORE.has(key);
export const bufferedBytes = () => storeBytes;

/** Drop every buffered track (settings reset / storage clear). */
export function dropBuffered() {
  for (const v of STORE.values()) { try { URL.revokeObjectURL(v.url); } catch {} }
  STORE.clear(); storeBytes = 0;
}

/* --------------------------------------------------------- network lock
 * One byte transfer at a time. Handles are identity-checked so a pre-empted
 * background fetch releasing the lock cannot steal it from the interactive
 * transfer that took over. */
let current = null;
const queued = [];
function acquire(kind) {
  return new Promise((start) => {
    const begin = () => {
      const handle = { kind, abort: null };
      current = handle;
      start({
        handle,
        setAbort: (fn) => { handle.abort = fn; },
        release: () => {
          if (current !== handle) return;      // stale — someone else owns it
          current = null;
          const next = queued.shift();
          if (next) next();
        },
      });
    };
    if (!current) return begin();
    if (kind === 'play' && current.kind === 'bg') {
      try { current.abort?.(); } catch {}      // a background prefetch loses its place
      return begin();
    }
    queued.push(begin);
  });
}

/* ------------------------------------------------------------ heuristics
 * How many bytes make a safe opening chunk: about 45 seconds of the
 * track's own bitrate, clamped so a small file simply completes (no seam
 * at all) and a huge one does not wait forever. Without a known duration,
 * 320 kbps is assumed — the catalogue's default quality. */
const OPEN_SECONDS = 10;
function openThreshold(total, durSec) {
  const bps = total && durSec ? total / durSec : 40 * 1024;
  let t = Math.round(OPEN_SECONDS * bps);
  if (t < 500 * 1024) t = 500 * 1024;
  if (t > 2200 * 1024) t = 2200 * 1024;
  if (total && total <= t) t = total;          // small file: wait for it all
  return t;
}

/* If the rest of the file is this close, waiting for the whole thing beats
 * playing a partial and swapping (no seam at all). */
const HOLD_FULL_MS = 2500;
/* If the rest is this far away, the buffered path cannot keep ahead of
 * playback and direct streaming will do a better job. */
const GIVE_UP_MS = 180000;
/* Beyond this many seconds of audio, sizing the opening so playback can
   never outrun the download would mean an unreasonable start wait — open
   small instead and let the re-cut below extend the runway in flight. */
const EXTEND_OPEN_MAX = 30;
/* How far before the end of the local copy the seam machinery acts. */
const SEAM_MARGIN = 8;

/* ------------------------------------------------------------- the fetch
 * Read a URL to a complete Blob. `onOpen(blob, have, total, etaMs)` fires
 * once, the moment the opening threshold is reached (unless noOpen); the
 * ETA of the remaining bytes at that moment is passed along so the caller
 * can decide between waiting for the file and starting from the chunk.
 * A transfer that dies part way is retried: first with
 * `Range: bytes=<have>-`, and if the answer proves the server ignored the
 * range (Content-Range starts at zero), by reading the whole file again —
 * whatever is already playing from the earlier partial is an independent
 * Blob and is not disturbed. */
async function fetchToBlob(url, { key, durSec, noOpen = false, signal, onOpen, onFull, onProgress, sink } = {}) {
  const res = await fetch(url, { signal, redirect: 'follow' });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('Content-Type') || '').split(';')[0] || 'audio/mp4';
  const total = +(res.headers.get('Content-Length') || 0) || null;
  const threshold = noOpen ? 0 : openThreshold(total, durSec);

  let chunks = [];
  let have = 0;
  let opened = false;
  let full = null;
  const t0 = performance.now();
  const sync = () => { if (sink) { sink.chunks = chunks; sink.have = have; sink.type = type; } };
  sync();

  const openIfDue = () => {
    if (opened || !threshold || have < threshold) return;
    opened = true;
    /* average pace so far — plenty for an ETA at this granularity */
    const rate = have / Math.max(1, performance.now() - t0);   // bytes per ms
    const etaMs = total ? (total - have) / Math.max(rate, 1) : null;
    onOpen?.(new Blob(chunks, { type }), have, total, etaMs);
  };
  const readAll = async (stream) => {
    const rd = stream.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      chunks.push(value);
      have += value.byteLength;
      sync();
      openIfDue();
      onProgress?.(have, total);
    }
  };

  try {
    await readAll(res.body);
    full = new Blob(chunks, { type });
  } catch (err) {
    if (signal?.aborted) throw err;
    for (let attempt = 0; attempt < 3 && !full; attempt++) {
      if (signal?.aborted) throw err;
      try {
        const have0 = have;
        const r2 = await fetch(url, { signal, headers: { Range: `bytes=${have0}-` } });
        if (!r2.ok && r2.status !== 206) throw new Error(`HTTP ${r2.status}`);
        const cr = r2.headers.get('Content-Range') || '';
        if (r2.status === 206 && new RegExp(`^bytes\\s+${have0}-`, 'i').test(cr)) {
          await readAll(r2.body);                       // server resumed properly
        } else {
          chunks = []; have = 0; sync();               // range refused: start over
          await readAll(r2.body);
        }
        full = new Blob(chunks, { type });
      } catch (err2) {
        if (signal?.aborted) throw err2;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    if (!full) throw err;
  }

  if (!full?.size) throw new Error('empty download');
  const { url: fullUrl } = keepBlob(key, full);
  onFull?.(fullUrl, full.size, total);
  return full;
}

/** The stored object URL for a key, if the bytes are local. */
export const storeUrl = (key) => (key ? STORE.get(key)?.url : null) || null;

/** True inside the Capacitor Android/iOS shell — the environment whose
 *  media stack streams worst (see the file header) and needs the buffered
 *  path; a plain browser plays direct, exactly like omnitools. */
export const isNativeApp = () => {
  try {
    const c = window.Capacitor;
    return !!(c && (c.isNativePlatform?.() || c.Plugins?.App));
  } catch { return false; }
};

/**
 * REACTIVE rescue: the live stream just stalled or died mid-song, and the
 * bytes of THIS track are already local (prefetched for the next skip, or
 * buffered earlier). Point the element at the local copy at the same
 * position and keep going — instant, offline, no resolver round-trip.
 *
 * This is the only time a healthy stream is ever swapped away: never
 * proactively, never mid-play for tidiness — only when the alternative is
 * a dead player. Returns false when there is nothing local to rescue with
 * (the caller's ordinary recovery then runs, as it always did).
 */
export function rescueStalled(el, key, rate = 1) {
  if (!el || !key) return false;
  const hit = STORE.get(key);
  if (!hit) return false;
  const cur = el.currentSrc || el.src || '';
  if (!cur || cur === hit.url) return false;     // nothing to rescue from
  if (/\.m3u8(\?|$)/i.test(String(cur))) return false;
  const at = el.currentTime || 0;
  try { el.pause(); } catch {}
  try {
    el.removeAttribute('crossorigin');
    el.src = hit.url;
    el.playbackRate = rate; el.preservesPitch = true;
    el.currentTime = at;
    el.play().catch(() => {});
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------- sessions */
let liveSession = null;

/**
 * True while the live session is holding playback at the seam of a partial
 * — the player's own error handler checks this so a truncated-blob decode
 * error during the hold is not mistaken for a dead stream.
 */
export const seamHold = () => !!liveSession?.holding;

/**
 * Play a URL through the buffered path.
 *
 * Resolves as soon as playback has STARTED — from the opening partial or
 * from the whole file — with { mode: 'partial' | 'full' }, or with null
 * when the buffered path is not viable, which tells the caller to use its
 * direct-streaming path exactly as before. The download keeps running
 * after the promise resolves; the switch to the completed file is made
 * immediately on arrival (the element resumes at the same position), or
 * after a short hold if playback reached the opening chunk's end first.
 */
export async function playBuffered(el, url, { rate = 1, key, dur, onStage, onFull } = {}) {
  if (!el) return null;
  if (url && /^(blob|data):/i.test(url)) return null;          // already local
  if (url && /\.m3u8(\?|$)/i.test(String(url))) return null;   // HLS: not a file

  /* close whatever was running — a new track makes the old session's
     fetch, listeners and partial URL dead weight */
  try { liveSession?.close(); } catch {}
  const ses = { closed: false, holding: false, close: () => {} };
  liveSession = ses;

  /* an already-buffered track starts in ~0 ms — and with no url at all
     (the resolver was skipped because the bytes are local) it is the
     only thing that could play */
  const hit = key ? STORE.get(key) : null;
  if (hit) {
    hit.at = Date.now();
    try {
      el.removeAttribute('crossorigin');
      el.src = hit.url;
      el.playbackRate = rate; el.preservesPitch = true;
      await el.play();
      onFull?.(hit.url, hit.size, hit.size);
      return { mode: 'full' };
    } catch { /* fall through to a fresh fetch */ }
  }
  if (!url) return null;                       // nothing else to try here

  const ctl = new AbortController();
  const sink = {};              // live view of the fetch's chunks, for re-cuts
  let pendingOpenBytes = 0;     // >0: opening deferred until this many bytes
  let lock = null;              // network lock; released when the session closes
  let partialUrl = null;        // the opening chunk the element is playing
  let openedHave = 0;           // how many bytes that chunk held
  let totalBytes = null;
  let fullUrl = null;           // the completed file, when it exists
  let fetchDead = false;        // every retry failed
  let swapASAP = false;         // a swap is wanted at the first safe moment
  let swapBusy = false;         // a re-cut/swap is in flight — its own transient
                                // 'waiting'/'timeupdate' must not arm a hold
  let started = false;          // the promise has settled
  let playStarted = false;      // the element's own play() has taken hold
  let swapped = false;          // the seam to the complete file has been made
  let holdTimer = null;         // seam-hold give-up timer
  let listeners = [];

  const on = (ev, fn) => { el.addEventListener(ev, fn); listeners.push([ev, fn]); };
  const off = () => { for (const [ev, fn] of listeners) el.removeEventListener(ev, fn); listeners = []; };

  const doSwap = () => {
    if (ses.closed || swapped || !fullUrl || !partialUrl || fullUrl === partialUrl) return;
    /* Pausing the element while its very first play() promise is still
       pending makes that promise reject with AbortError — measured live —
       which the opening code would read as "the blob failed" and fall
       back to direct streaming for no reason. A swap requested before
       playback has taken hold is deferred, not refused: it happens the
       moment play() resolves, still inaudibly early in the track. */
    if (!playStarted) { swapASAP = true; return; }
    const at = el.currentTime || 0;
    /* If the LISTENER paused (not our seam hold), the swap must respect
       it — switch the source silently and stay paused. */
    const resume = !el.paused || ses.holding;
    swapBusy = true;
    const unbusy = () => { swapBusy = false; };
    el.addEventListener('playing', unbusy, { once: true });
    setTimeout(unbusy, 1200);
    try { el.pause(); } catch {}
    el.src = fullUrl;
    try {
      el.playbackRate = rate; el.preservesPitch = true;
      el.currentTime = at;
      if (resume) el.play().catch(() => {});
    } catch {}
    try { URL.revokeObjectURL(partialUrl); } catch {}
    partialUrl = null;
    swapped = true;
    ses.holding = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    onStage?.('');
  };

  /** Last resort: the download could not be saved — stream the rest
   *  directly and let the element's own buffering carry the song home. */
  const goDirect = () => {
    if (ses.closed || !partialUrl) return;
    const at = el.currentTime || 0;
    try { el.pause(); } catch {}
    el.removeAttribute('crossorigin');
    el.src = url;
    try {
      el.playbackRate = rate; el.preservesPitch = true;
      el.currentTime = at;
      el.play().catch(() => {});
    } catch {}
    try { URL.revokeObjectURL(partialUrl); } catch {}
    partialUrl = null;
    swapped = true;               // no further swaps; the element is on its own
    ses.holding = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    onStage?.('');
  };

  /** How many seconds of music the opening chunk actually holds. */
  const partialSec = () => {
    if (!totalBytes || !isFinite(el.duration) || el.duration <= 0) return null;
    return (openedHave / totalBytes) * el.duration;
  };

  /** THE RE-CUT — the seam is approaching but the file is not complete:
   *  rebuild the local copy from everything fetched so far and hand the
   *  element the bigger chunk at the same position. A sub-fifties-of-
   *  milliseconds src swap (measured), far past noticing, and playback
   *  keeps moving while the rest downloads. Only when there is nothing
   *  new to cut (a stalled fetch mid-retry) does the honest hold below
   *  take over. */
  const recutAtSeam = () => {
    if (ses.closed || swapped || fullUrl || !partialUrl) return false;
    const have = sink.have || 0;
    if (!sink.chunks?.length || have <= openedHave + 65536) return false;
    const blob = new Blob(sink.chunks, { type: sink.type });
    const newUrl = URL.createObjectURL(blob);
    const at = el.currentTime || 0;
    const resume = !el.paused || ses.holding;
    swapBusy = true;
    const unbusy = () => { swapBusy = false; };
    el.addEventListener('playing', unbusy, { once: true });
    setTimeout(unbusy, 1200);
    try { el.pause(); } catch {}
    el.removeAttribute('crossorigin');
    el.src = newUrl;
    try {
      el.playbackRate = rate; el.preservesPitch = true;
      el.currentTime = at;
      if (resume) el.play().catch(() => {});
    } catch {}
    try { URL.revokeObjectURL(partialUrl); } catch {}
    partialUrl = newUrl;
    openedHave = have;
    return true;
  };

  /** Playback has outrun the download and there is nothing new to cut:
   *  hold at the seam, like any streaming player buffers, and give up on
   *  the pipe entirely if the rest does not arrive within half a minute. */
  const holdAtSeam = () => {
    if (ses.closed || fullUrl || swapped || !partialUrl) return;
    ses.holding = true;
    try { el.pause(); } catch {}
    onStage?.('Finishing download…');
    if (!holdTimer) {
      holdTimer = setTimeout(() => { holdTimer = null; if (!ses.closed) goDirect(); }, 30000);
    }
  };

  const onWaiting = () => {
    if (ses.closed || !partialUrl || swapBusy) return;
    /* A stall while the partial is still OPENING is not the seam — the
       blob is local, its metadata arrives in milliseconds — it is just
       the element warming up, and it must not arm any swap. */
    if (!playStarted) return;
    if (fullUrl) { doSwap(); return; }
    if (!recutAtSeam()) holdAtSeam();
  };

  /* A truncated local blob does not stall at its end — the demuxer runs
     out of mdat and the element raises a DECODE error. That is the seam
     arriving as an error instead of a pause; hold here exactly as above
     (the belt to the timeupdate guard, which should always fire first). */
  const onError = () => {
    if (ses.closed || !partialUrl || swapBusy || el.error?.code !== 3) return;
    if (fullUrl) { doSwap(); return; }
    if (fetchDead) { goDirect(); return; }
    if (!recutAtSeam()) holdAtSeam();
  };

  /* The guard itself: a few seconds before playback would reach the end
     of the bytes it actually has, hold until the rest lands. */
  const onTimeUpdate = () => {
    if (ses.closed || swapped || fullUrl || !partialUrl || !playStarted || swapBusy) return;
    const ps = partialSec();
    if (ps != null && el.currentTime > ps - SEAM_MARGIN) {
      if (!recutAtSeam()) holdAtSeam();
    }
  };

  on('waiting', onWaiting);
  on('error', onError);
  on('timeupdate', onTimeUpdate);

  ses.close = () => {
    if (ses.closed) return;
    ses.closed = true;
    ses.holding = false;
    try { ctl.abort(); } catch {}
    off();
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (partialUrl) { try { URL.revokeObjectURL(partialUrl); } catch {} partialUrl = null; }
    if (lock) { lock.release(); lock = null; }
  };

  lock = await acquire('play');
  if (ses.closed) { lock.release(); lock = null; return null; }
  lock.setAbort(() => { try { ctl.abort(); } catch {} });

  const stage = (s) => { if (!started) onStage?.(s); };

  const settle = (v) => { started = true; return v; };

  return new Promise((resolve) => {
    let done = false;
    let idleTimer = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      resolve(settle(v));
    };
    /* An INACTIVITY clock, not an absolute one: a slow-but-flowing pipe
       may legitimately take a while to open a big file, so only silence —
       no bytes for 20 s — gives up and hands the caller the direct path.
       Reset on every progress tick while playback has not begun. */
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!done) { finish(null); ses.close(); }
      }, 20000);
    };
    armIdle();

    fetchToBlob(url, {
      key,
      durSec: dur || null,
      signal: ctl.signal,
      sink,
      onOpen: (blob, have, total, etaMs) => {
        if (ses.closed || done) return;
        totalBytes = total;
        openedHave = have;
        /* A pipe this slow cannot keep ahead of playback — streaming
           directly will do better than we can. */
        if (etaMs != null && etaMs > GIVE_UP_MS) { finish(null); ses.close(); return; }
        /* A pipe this fast will have the whole file before a listener
           could get through the opening chunk — wait for it; one local
           file, no seam, nothing to swap. */
        if (etaMs != null && etaMs <= HOLD_FULL_MS) {
          stage('Buffering…');
          return;                       // no partial; onFull plays the file
        }
        /* Size the opening so playback can never outrun the download on
           a decent pipe: a few extra tenths of a second of wait buys a
           song with no seam work at all. On a slow pipe the wait would
           be unreasonable — open small instead and extend in flight. */
        if (etaMs != null && total && dur) {
          const B = total / dur;                        // bytes per second of audio
          const R = (total - have) / etaMs;             // bytes per ms
          const Tneed = (total + SEAM_MARGIN * R * 1000) / (B + R * 1000);
          if (Tneed > OPEN_SECONDS && Tneed <= EXTEND_OPEN_MAX) {
            pendingOpenBytes = Math.min(total, Math.ceil(Tneed * B));
            stage('Buffering…');
            return;                     // onProgress opens when reached
          }
        }
        partialUrl = URL.createObjectURL(blob);
        el.removeAttribute('crossorigin');
        el.src = partialUrl;
        try { el.playbackRate = rate; el.preservesPitch = true; } catch {}
        el.play().then(() => {
          playStarted = true;
          finish(have >= total ? { mode: 'full' } : { mode: 'partial' });
          /* the opening chunk already was the whole file: nothing further
             to do; the completion below lands in the store silently */
          if (have >= total) fullUrl = partialUrl;
          /* a swap deferred while play() was pending can happen now */
          if (swapASAP && fullUrl && partialUrl) doSwap();
        }).catch(() => {
          if (swapped || fullUrl) {
            /* the pending play() was interrupted by the seam swap itself;
               the swap's own play() owns the element now — this is not a
               failure */
            playStarted = true;
            finish({ mode: 'partial' });
            return;
          }
          /* autoplay refused, or the element refused the blob: give the
             caller the direct path */
          finish(null);
          ses.close();
        });
      },
      onProgress: (have, total) => {
        if (done) return;
        armIdle();
        /* the deferred, download-sized opening has arrived */
        if (pendingOpenBytes && have >= pendingOpenBytes && sink.chunks?.length) {
          pendingOpenBytes = 0;
          const blob2 = new Blob(sink.chunks, { type: sink.type });
          try {
            partialUrl = URL.createObjectURL(blob2);
            openedHave = have;
            el.removeAttribute('crossorigin');
            el.src = partialUrl;
            try { el.playbackRate = rate; el.preservesPitch = true; } catch {}
            el.play().then(() => {
              playStarted = true;
              finish(have >= total ? { mode: 'full' } : { mode: 'partial' });
              if (have >= total) fullUrl = partialUrl;
              if (swapASAP && fullUrl && partialUrl) doSwap();
            }).catch(() => {
              if (swapped || fullUrl) { playStarted = true; finish({ mode: 'partial' }); return; }
              finish(null); ses.close();
            });
          } catch { finish(null); ses.close(); }
        }
      },
      onFull: (u, size, total) => {
        if (ses.closed) return;
        fullUrl = u;
        onFull?.(u, size, total);
        /* held for the whole file: play it complete, no seam at all */
        if (!partialUrl) {
          if (done) {
            /* playback already started somewhere else — should not happen
               when the opening was skipped, but never disturb the element
               if it did */
          } else {
            el.removeAttribute('crossorigin');
            el.src = u;
            try { el.playbackRate = rate; el.preservesPitch = true; } catch {}
            el.play().then(() => finish({ mode: 'full' }))
              .catch(() => { finish(null); ses.close(); });
          }
          return;
        }
        /* playing from the opening chunk: switch to the complete file at
           the same position, now — whether running or held at the seam */
        doSwap();
      },
    }).catch(() => {
      fetchDead = true;
      if (!done) {
        /* nothing ever opened — the buffered path is not working here */
        finish(null);
        ses.close();
      } else if (ses.holding) {
        /* playback is held at the seam and the download is beyond saving:
           stream the rest directly from the current position */
        goDirect();
      }
      /* else: playback runs on the partial; the timeupdate guard holds at
         the seam, and goDirect there carries the song home */
    });
  });
}

/**
 * Prefetch a whole file into the store, behind everything interactive.
 * Used for the track after the one playing, so a skip lands on a local
 * blob. Resolves true when the bytes are in the store afterwards.
 */
export async function bufferAhead(url, key) {
  if (!url || !key || STORE.has(key)) return !!STORE.get(key);
  if (/\.m3u8(\?|$)/i.test(String(url)) || /^(blob|data):/i.test(url)) return false;
  const lock = await acquire('bg');
  try {
    if (STORE.has(key)) return true;         // someone got there first
    const ctl = new AbortController();
    lock.setAbort(() => { try { ctl.abort(); } catch {} });
    await fetchToBlob(url, { key, noOpen: true, signal: ctl.signal });
    return true;
  } catch { return false; }
  finally { lock.release(); }
}

/** Close the live playback session (fetch + listeners), if any. */
export function closeBuffered() {
  try { liveSession?.close(); } catch {}
  liveSession = null;
}
