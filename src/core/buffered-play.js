/**
 * The local byte store — why it exists and how it is used.
 *
 * MEASURED, NOT ASSUMED (2026-09-10/11, against the live chain)
 *   · The element streaming straight from the CDN is the fastest possible
 *     START — under a second, which is what omnitools always felt like —
 *     but it is also fragile: a phone's radio drops connections far more
 *     often than a datacentre sees, the second catalogue's CDN truncates
 *     at exactly 4 MiB and IGNORES Range resumes (ask for `bytes=100-199`,
 *     receive `206` with `Content-Range: bytes 0-…` and the whole file
 *     from zero), and the Android WebView's own media buffering is the
 *     weakest of any Chromium. A stream that dies mid-song stays dead,
 *     and the demuxer feeding the decoder through the gap is the torn,
 *     crackling audio the user called "fati hui awaz".
 *   · The primary CDN, by contrast, serves parallel connections happily
 *     (three simultaneous range requests: all 206) and honours ranges.
 *
 * SO THE DESIGN IS: start instantly, stream directly — exactly like
 * omnitools — and quietly pull the track's bytes into a local store at
 * the same time. The store then serves three purposes:
 *   1. REPLAY / PREV / a prefetched NEXT start from a local blob in
 *      under half a second, with no network at all.
 *   2. RESCUE: a stream that stalls for real (the failure no CDN lets
 *      the media stack resume) is switched to the local copy at the same
 *      position after a moment — only ever reactively; a healthy stream
 *      is never touched.
 *   3. In the WebView, where the platform's streaming is weakest, the
 *      element is additionally handed the local copy as soon as it lands
 *      (one inaudible position-preserving swap early in the song), so
 *      the rest of the track cannot stall at all.
 *
 * Nothing is ever re-encoded — the store holds the exact bytes the CDN
 * sent, so playback stays source-quality ("lossless" in the only sense
 * that matters here: nothing was added or taken away).
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
 * One byte transfer at a time, so a burst of prefetches can never crowd
 * the track the user is actually waiting for. */
let current = null;
const queued = [];
function acquire() {
  return new Promise((start) => {
    const begin = () => {
      const handle = { abort: null };
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
    queued.push(begin);
  });
}

/** True inside the Capacitor Android/iOS shell — the environment whose
 *  media stack streams weakest (see the file header) and benefits from
 *  being handed local bytes as soon as they exist; a plain browser plays
 *  direct, exactly like omnitools. */
export const isNativeApp = () => {
  try {
    const c = window.Capacitor;
    return !!(c && (c.isNativePlatform?.() || c.Plugins?.App));
  } catch { return false; }
};

/* ------------------------------------------------------------- the fetch
 * Read a URL to a complete Blob and keep it in the store. A transfer
 * that dies part way is retried: first with `Range: bytes=<have>-`, and
 * if the answer proves the server ignored the range (Content-Range
 * starts at zero — measured on the second catalogue's CDN), by reading
 * the whole file again. */
async function fetchToBlob(url, { key, signal } = {}) {
  const res = await fetch(url, { signal, redirect: 'follow' });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('Content-Type') || '').split(';')[0] || 'audio/mp4';

  let chunks = [];
  let have = 0;
  let full = null;
  const readAll = async (stream) => {
    const rd = stream.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      chunks.push(value);
      have += value.byteLength;
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
          chunks = []; have = 0;                        // range refused: start over
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
  return fullUrl;
}

/** The stored object URL for a key, if the bytes are local. */
export const storeUrl = (key) => (key ? STORE.get(key)?.url : null) || null;

/**
 * Prefetch a whole file into the store, behind everything interactive.
 * Used for the track that is playing (so a replay or a dead stream can
 * be served locally) and for the next track (so a skip lands on a blob).
 * Resolves true when the bytes are in the store afterwards.
 */
export async function bufferAhead(url, key) {
  if (!url || !key || STORE.has(key)) return !!STORE.get(key);
  if (/\.m3u8(\?|$)/i.test(String(url)) || /^(blob|data):/i.test(url)) return false;
  const lock = await acquire();
  try {
    if (STORE.has(key)) return true;         // someone got there first
    const ctl = new AbortController();
    lock.setAbort(() => { try { ctl.abort(); } catch {} });
    await fetchToBlob(url, { key, signal: ctl.signal });
    return true;
  } catch { return false; }
  finally { lock.release(); }
}

/**
 * Point the element at the stored copy of `key` at its current position.
 *
 * This is the one deliberate src swap in the app, and it only happens in
 * the two situations where the alternative is worse: the WebView hands
 * the local bytes over as soon as they land (one early, inaudible seam
 * buys a track that cannot stall for the rest of the song), and a dead
 * stream is rescued with them. A healthy direct stream in a browser is
 * never swapped — omnitools parity is the rule there.
 *
 * `resume` honours a user pause: a swap while paused stays paused.
 */
export function swapToStored(el, key, rate = 1, { resume = true } = {}) {
  if (!el || !key) return false;
  const hit = STORE.get(key);
  if (!hit) return false;
  const cur = el.currentSrc || el.src || '';
  if (cur === hit.url) return false;         // already playing the local copy
  if (/\.m3u8(\?|$)/i.test(String(cur))) return false;
  const at = el.currentTime || 0;
  const wasPaused = el.paused;
  try { el.pause(); } catch {}
  try {
    el.removeAttribute('crossorigin');
    el.src = hit.url;
    el.playbackRate = rate; el.preservesPitch = true;
    el.currentTime = at;
    if (resume || !wasPaused) el.play().catch(() => {});
    return true;
  } catch { return false; }
}

/**
 * REACTIVE rescue: the live stream just stalled or died mid-song, and the
 * bytes of THIS track are already local. Same swap as above — the stall
 * already stopped playback, so resuming is always right. Returns false
 * when there is nothing local to rescue with (the caller's ordinary
 * recovery then runs, as it always did).
 */
export const rescueStalled = (el, key, rate = 1) => swapToStored(el, key, rate, { resume: true });
