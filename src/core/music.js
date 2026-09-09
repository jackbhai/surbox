/**
 * Music catalogue engine.
 *
 * WHAT THIS REPLACES
 *   The old music tool ran two hardcoded Piped mirrors and showed the first 20
 *   hits. A live probe of 33 mirrors found exactly ONE that still answers with
 *   a CORS header, /streams is HTTP 500 on every instance (so no
 *   "relatedStreams"), every JioSaavn mirror is dead, and youtubei returns 403
 *   from a browser Origin. That is a single point of failure with no depth.
 *
 * WHAT IT DOES NOW — all verified live from a github.io Origin:
 *   · SEARCH with pagination. The mirror returns a `nextpage` token and
 *     /nextpage/search honours it (page 2 and 3 confirmed, 20 items each), so
 *     the list is effectively endless instead of capped at 20.
 *   · FOUR FILTERS FANNED OUT. music_songs alone gives 20 ids; adding
 *     music_videos and `all` raises it to 54 unique ids for the same query.
 *   · PLAYLISTS. /playlists/<id> returns 101 tracks in one call — the single
 *     richest source of bulk catalogue we have.
 *   · CHARTS + BROWSE from iTunes (CORS *): artist lookup gives 60 songs and
 *     30 albums, and genre searches return 50 rows. iTunes has no playable
 *     audio, so it is used as a METADATA + QUERY generator: its titles become
 *     searches that resolve to real playable ids.
 *   · AUTOPLAY. With /streams dead there is no official "related" list, so the
 *     radio queue is built from the artist's other tracks, the album, and the
 *     genre seed — which is what "related" was giving us anyway.
 *
 * Everything degrades: if the mirror dies, iTunes still renders browsable
 * catalogue, and any track already resolved stays playable from cache.
 */
import { jget } from './engine';
import { proxyBase } from './settings';

/* Ordered by measured health. Only the first currently answers with CORS, but
   mirrors recover and the pool costs nothing when they do not. */
export const MIRRORS = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.drgns.space',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.orangenet.cc',
];

const ITUNES = 'https://itunes.apple.com';
const secs = (t) => (typeof t === 'number' && t > 0 ? t : null);
const vidOf = (u = '') => (u.includes('v=') ? u.split('v=')[1].split('&')[0] : '');

/**
 * Try every mirror in turn; first usable answer wins.
 *
 * A dead mirror does not fail politely: the browser reports "TypeError: Failed
 * to fetch" because the CORS preflight itself never completes. That is thrown
 * from `fetch` rather than returned as a status, so the loop has to catch it
 * and move on — which it now does. Mirrors that fail are also benched briefly
 * so one dead host does not add its timeout to every subsequent call.
 */
const MIRROR_BENCH = new Map();       // base -> retry-after timestamp
const mirrorOk = (b) => (MIRROR_BENCH.get(b) || 0) < Date.now();

async function anyMirror(path, { ms = 14000, pick } = {}) {
  let lastErr;
  const order = [...MIRRORS.filter(mirrorOk), ...MIRRORS.filter((b) => !mirrorOk(b))];

  const attempt = async (url) => {
    const d = await jget(url, { ms });
    const v = pick ? pick(d) : d;
    if (!v || (Array.isArray(v) && !v.length)) throw new Error('empty');
    return { data: v, raw: d };
  };

  for (const base of order) {
    try {
      const r = await attempt(base + path);
      MIRROR_BENCH.delete(base);
      return { ...r, base };
    } catch (e) {
      lastErr = e;
      MIRROR_BENCH.set(base, Date.now() + 90000);
    }
  }

  /* Every mirror refused us directly. Several of them are alive but simply do
     not send a CORS header (kavin.rocks 403s a browser, others answer fine to
     curl) — going through our own relay makes those usable. This only runs
     after the fast path has failed, so it costs nothing in the normal case. */
  const relay = proxyBase();
  if (relay) {
    for (const base of MIRRORS) {
      try {
        const r = await attempt(`${relay}/?url=${encodeURIComponent(base + path)}`);
        MIRROR_BENCH.delete(base);
        return { ...r, base, viaRelay: true };
      } catch (e) { lastErr = e; }
    }
  }
  throw lastErr || new Error('all mirrors failed');
}

/** Normalise a Piped search/stream row into our track shape. */
function toTrack(v) {
  const id = vidOf(v.url || '');
  if (!id) return null;
  return {
    id,
    title: (v.title || '').trim(),
    artist: (v.uploaderName || v.uploader || '').replace(/ - Topic$/, '').trim(),
    dur: secs(v.duration),
    art: (v.thumbnail || '').replace(/^\/\//, 'https://'),
    // The mirror sends -1 when it does not know the play count; treating
    // that as a number rendered "-1 plays" under every track.
    views: typeof v.views === 'number' && v.views > 0 ? v.views : null,
    needsResolve: true,
  };
}

const dedupe = (list) => {
  const seen = new Set(), out = [];
  for (const t of list) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
};

/* Music results should not be hour-long uploads, interviews or full albums. */
const isSong = (t) => !t.dur || (t.dur >= 45 && t.dur <= 1500);
const JUNK = /\b(full album|jukebox|all songs|non ?stop|mashup \d+ ?min|live show|interview|podcast|episode)\b/i;

/* ---- FAST SEARCH CACHE ---- */
const FAST_CACHE = new Map();
const FAST_TTL = 5 * 60 * 1000;
function cacheGet(q) {
  const k = q.toLowerCase().trim();
  const v = FAST_CACHE.get(k);
  if (v && Date.now() - v.at < FAST_TTL) return v.data;
  if (v) FAST_CACHE.delete(k);
  return null;
}
function cacheSet(q, data) {
  const k = q.toLowerCase().trim();
  FAST_CACHE.set(k, { data, at: Date.now() });
  if (FAST_CACHE.size > 120) {
    const first = FAST_CACHE.keys().next().value;
    FAST_CACHE.delete(first);
  }
}

/* ---- FAST PATH: omni-proxy 34 sources race = 0.5-1s vs piped 14s ---- */
async function omniProxySearch(q, { limit = 20 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  const cached = cacheGet('proxy:' + query + ':' + limit);
  if (cached) return cached;
  try {
    const { search } = await import('./saavn');
    const rows = await search(query, { limit });
    if (rows?.length) {
      // Convert to music2 shape: needsResolve false, already has stream
      const shaped = rows.map(r => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album || '',
        art: r.art || '',
        dur: r.dur || 0,
        year: r.year || '',
        lang: r.lang || '',
        stream: r.stream,
        streams: r.streams || [],
        src: r.src || 'catalogue-2',
        exact: true,
        needsResolve: false,
      })).filter(t => t.stream && t.title);
      if (shaped.length) {
        cacheSet('proxy:' + query + ':' + limit, shaped);
        return shaped;
      }
    }
  } catch {}
  return [];
}

/**
 * Search, fanned out across filters, with pagination.
 * NOW: fast path first (omni-proxy 34 sources 0.5s), then piped as fallback.
 * @returns {Promise<{tracks:Array, next:Function|null}>}
 */
export async function searchMusic(q, { deep = false } = {}) {
  const query = String(q || '').trim();
  if (!query) return { tracks: [], next: null };

  // 1. Try fast cache
  const cached = cacheGet('music:' + query + ':' + (deep ? 'deep' : 'fast'));
  if (cached) return cached;

  // 2. Fast path: omni-proxy 34 mirrors (0.5-1s) - primary for Indian music
  try {
    const fast = await omniProxySearch(query, { limit: 20 });
    if (fast.length >= 3) {
      const result = { tracks: fast, next: null, base: 'omni-proxy' };
      cacheSet('music:' + query + ':' + (deep ? 'deep' : 'fast'), result);
      return result;
    }
  } catch {}

  // 3. Super search (multi-engine + discovery) in parallel - 1-2s
  try {
    const { superSearch } = await import('./music-super');
    const superRows = await Promise.race([
      superSearch(query, { limit: 15 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
    ]).catch(() => []);
    if (superRows?.length) {
      const shaped = superRows.map(r => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album || '',
        art: r.art || '',
        dur: r.dur || 0,
        stream: r.stream || r.preview || '',
        streams: r.streams || [],
        src: r.src || 'super',
        exact: r.exact ?? true,
        needsResolve: !r.stream || !!r.needsFetch,
      })).filter(t => (t.stream || t.needsResolve) && t.title);
      if (shaped.length >= 2) {
        const result = { tracks: shaped, next: null, base: 'super' };
        cacheSet('music:' + query + ':' + (deep ? 'deep' : 'fast'), result);
        return result;
      }
    }
  } catch {}

  // 4. Fallback: piped mirrors - reduced timeout 6s not 14s
  const enc = encodeURIComponent(query);
  try {
    const primary = await anyMirror(`/search?q=${enc}&filter=music_songs`, {
      ms: 6000,
      pick: (d) => d.items,
    });
    let tracks = (primary.data || []).map(toTrack).filter(Boolean);
    const base = primary.base;
    let token = primary.raw?.nextpage || null;

    if (deep) {
      const extra = await Promise.allSettled([
        jget(`${base}/search?q=${enc}&filter=music_videos`, { ms: 6000 }),
        jget(`${base}/search?q=${enc}&filter=all`, { ms: 6000 }),
      ]);
      for (const r of extra) {
        if (r.status !== 'fulfilled') continue;
        tracks = tracks.concat((r.value.items || []).map(toTrack).filter(Boolean));
      }
    }

    tracks = dedupe(tracks).filter((t) => isSong(t) && !JUNK.test(t.title));

    const next = async () => {
      if (!token) return [];
      const u = `${base}/nextpage/search?nextpage=${encodeURIComponent(token)}` +
                `&q=${enc}&filter=music_songs`;
      try {
        const d = await jget(u, { ms: 8000 });
        token = d.nextpage || null;
        return dedupe((d.items || []).map(toTrack).filter(Boolean))
          .filter((t) => isSong(t) && !JUNK.test(t.title));
      } catch { token = null; return []; }
    };

    const result = { tracks, next: token ? next : null, base };
    cacheSet('music:' + query + ':' + (deep ? 'deep' : 'fast'), result);
    return result;
  } catch {
    return { tracks: [], next: null, base: null };
  }
}

/**
 * A single-shot search against the ONE mirror known to be healthy.
 *
 * `searchMusic` walks the whole pool, which is right for a user-initiated
 * search but wrong when eighteen catalogue titles are being matched at once —
 * that turned into hundreds of requests to dead or CORS-blocked hosts. This
 * tries only the first healthy mirror and fails fast.
 */
export async function quickSearch(q, { ms = 9000 } = {}) {
  const base = MIRRORS.find(mirrorOk) || MIRRORS[0];
  try {
    const d = await jget(`${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`, { ms });
    return (d.items || []).map(toTrack).filter(Boolean).filter(isSong);
  } catch (e) {
    MIRROR_BENCH.set(base, Date.now() + 90000);
    return [];
  }
}

/** Search suggestions for the box. */
export async function suggest(q) {
  if (!q?.trim()) return [];
  try {
    const r = await anyMirror(`/suggestions?query=${encodeURIComponent(q.trim())}`, { ms: 7000 });
    return (r.data || []).slice(0, 8);
  } catch { return []; }
}

/** Super search across ALL 22 tiers — Cloudflare worker + multi-engine + previews + discovery */
export async function superSearchAll(q, { limit = 20 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  try {
    const { superSearch } = await import('./music-super');
    const r = await superSearch(query, { limit });
    if (r?.length) return r;
    if (r?.results?.length) return r.results;
  } catch {}
  try {
    const { discoverySearch } = await import('./music-discovery');
    const r = await discoverySearch(query, { limit });
    return r || [];
  } catch { return []; }
}

/** Discovery metadata - Last.fm + Discogs + Genrenator for enrichment */
export async function discoveryMeta(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (!query) return { lastfm: [], discogs: [], genres: [] };
  try {
    const { discoveryMetadata } = await import('./music-discovery');
    return await discoveryMetadata(query, { limit });
  } catch { return { lastfm: [], discogs: [], genres: [] }; }
}

/** Genrenator random genres for fun discovery + radio hints */
export async function randomGenres({ count = 5 } = {}) {
  try {
    const { genrenatorGenres } = await import('./music-discovery');
    return await genrenatorGenres({ count });
  } catch { return []; }
}

/* ------------------------------------------------------------- playlists */
/** Playlists matching a query — the richest bulk source (101 tracks/call). */
export async function findPlaylists(q) {
  try {
    const r = await anyMirror(`/search?q=${encodeURIComponent(q)}&filter=playlists`, {
      pick: (d) => d.items,
    });
    return (r.data || [])
      .filter((x) => (x.url || '').includes('list='))
      .map((x) => ({
        id: (x.url.split('list=')[1] || '').split('&')[0],
        name: x.name || x.title || 'Playlist',
        art: (x.thumbnail || '').replace(/^\/\//, 'https://'),
        count: x.videos > 0 ? x.videos : null,
        by: x.uploaderName || '',
      }))
      .filter((p) => p.id);
  } catch { return []; }
}

/**
 * Playlists that actually open.
 *
 * The mirror advertises playlists it cannot expand: searching "punjabi hits"
 * returned five, of which four came back with `relatedStreams: []` and only
 * one had real tracks. Tapping a dead one looked like our bug. This probes the
 * candidates in parallel and reports how many tracks each really has, so the
 * UI can hide the empty ones instead of letting the user find them.
 */
export async function findPlaylistsWithCounts(q, { probe = 8 } = {}) {
  const found = await findPlaylists(q);
  if (!found.length) return [];
  const head = found.slice(0, probe);
  const checked = await Promise.all(head.map(async (p) => {
    try {
      const d = await jget(`${MIRRORS[0]}/playlists/${encodeURIComponent(p.id)}`, { ms: 12000 });
      const n = (d.relatedStreams || []).length;
      return n > 0 ? { ...p, count: n } : null;
    } catch { return null; }
  }));
  return checked.filter(Boolean);
}

/**
 * Every track of a playlist — one call returns up to ~100.
 *
 * Some playlist ids genuinely 500 upstream (measured: one id returned 101
 * tracks in 1.5 s, another 500'd on every mirror), so a failure here is not
 * necessarily a bug on our side. The caller gets an empty array and the UI
 * says so rather than spinning forever.
 */
export async function playlistTracks(id) {
  try {
    const r = await anyMirror(`/playlists/${encodeURIComponent(id)}`, {
      ms: 20000, pick: (d) => d.relatedStreams,
    });
    const first = dedupe((r.data || []).map(toTrack).filter(Boolean)).filter(isSong);

    /* Long playlists paginate. One more page is usually enough to cover a
       "top 100" list without making the user wait for four round trips. */
    const token = r.raw?.nextpage;
    if (token && first.length >= 90) {
      try {
        const d = await jget(
          `${r.base}/nextpage/playlists/${encodeURIComponent(id)}?nextpage=${encodeURIComponent(token)}`,
          { ms: 16000 });
        const more = dedupe((d.relatedStreams || []).map(toTrack).filter(Boolean)).filter(isSong);
        return dedupe([...first, ...more]);
      } catch { /* the first page is plenty */ }
    }
    return first;
  } catch {
    return [];
  }
}

/* --------------------------------------------------------------- artists */
/** Artist metadata from iTunes: 60 songs + 30 albums, CORS enabled. */
export async function artistInfo(name) {
  const enc = encodeURIComponent(name);
  const a = await jget(`${ITUNES}/search?term=${enc}&entity=musicArtist&country=IN&limit=1`, { ms: 10000 });
  const artist = (a.results || [])[0];
  if (!artist?.artistId) return null;
  const [songs, albums] = await Promise.all([
    jget(`${ITUNES}/lookup?id=${artist.artistId}&entity=song&limit=60&country=IN`, { ms: 12000 })
      .catch(() => ({ results: [] })),
    jget(`${ITUNES}/lookup?id=${artist.artistId}&entity=album&limit=30&country=IN`, { ms: 12000 })
      .catch(() => ({ results: [] })),
  ]);
  return {
    name: artist.artistName,
    genre: artist.primaryGenreName || '',
    id: artist.artistId,
    songs: (songs.results || [])
      .filter((r) => r.wrapperType === 'track')
      .map((r) => ({
        title: r.trackName, album: r.collectionName,
        art: (r.artworkUrl100 || '').replace('100x100', '300x300'),
        year: (r.releaseDate || '').slice(0, 4), dur: Math.round((r.trackTimeMillis || 0) / 1000),
      })),
    albums: (albums.results || [])
      .filter((r) => r.wrapperType === 'collection')
      .map((r) => ({
        name: r.collectionName,
        art: (r.artworkUrl100 || '').replace('100x100', '300x300'),
        year: (r.releaseDate || '').slice(0, 4), tracks: r.trackCount,
      })),
  };
}

/** Turn an iTunes title into a real playable track by searching for it. */
export async function resolveByName(title, artist) {
  const q = `${artist || ''} ${title}`.trim();
  const { tracks } = await searchMusic(q, { deep: false });
  return tracks[0] || null;
}

/* ---------------------------------------------------------------- charts */
export const GENRES = [
  { id: 'punjabi',   label: 'Punjabi',      q: 'punjabi songs 2026' },
  { id: 'bollywood', label: 'Bollywood',    q: 'bollywood hits 2026' },
  { id: 'pakistani', label: 'Pakistani',    q: 'coke studio pakistan' },
  { id: 'sufi',      label: 'Sufi',         q: 'sufi qawwali' },
  { id: 'sad',       label: 'Sad',          q: 'punjabi sad songs' },
  { id: 'romantic',  label: 'Romantic',     q: 'romantic hindi songs' },
  { id: 'haryanvi',  label: 'Haryanvi',     q: 'haryanvi songs' },
  { id: 'bhojpuri',  label: 'Bhojpuri',     q: 'bhojpuri hits' },
  { id: 'old',       label: 'Old classics', q: 'old hindi classics' },
  { id: 'lofi',      label: 'Lo-Fi',        q: 'lofi hindi' },
  { id: 'gym',       label: 'Workout',      q: 'gym punjabi songs' },
  { id: 'ghazal',    label: 'Ghazal',       q: 'ghazal jagjit singh' },
  { id: 'rap',       label: 'Desi hip-hop', q: 'desi hip hop 2026' },
  { id: 'devotional',label: 'Devotional',   q: 'bhajan aarti' },
  { id: 'tamil',     label: 'Tamil',        q: 'tamil hit songs' },
  { id: 'telugu',    label: 'Telugu',       q: 'telugu hit songs' },
];

/**
 * Apple's top-songs chart for a country. Metadata only — used as seeds.
 *
 * NOTE the host: rss.applemarketingtools.com 301-redirects to
 * rss.marketingtools.apple.com and NEITHER sends a CORS header, so the browser
 * blocks it and the chart came back empty. The older itunes.apple.com/rss feed
 * does send `Access-Control-Allow-Origin: *` and returns the same 50 entries,
 * so that is what we use.
 */
export async function chart(country = 'in', n = 50) {
  const d = await jget(
    `${ITUNES}/${country}/rss/topsongs/limit=${n}/json`, { ms: 12000 });
  const entries = d.feed?.entry || [];
  return entries.map((e) => {
    const imgs = e['im:image'] || [];
    const big = imgs[imgs.length - 1]?.label || '';
    return {
      title: e['im:name']?.label || '',
      artist: e['im:artist']?.label || '',
      album: e['im:collection']?.['im:name']?.label || '',
      art: big.replace(/\/\d+x\d+bb/, '/300x300bb'),
    };
  }).filter((r) => r.title);
}

/* -------------------------------------------------------------- autoplay */
/**
 * Build a "radio" queue around a track.
 *
 * /streams (which used to supply relatedStreams) is HTTP 500 on every mirror,
 * so the related list is reconstructed from what still works: more by the same
 * artist, then the artist's name as a query, then the genre seed. In practice
 * that is the same material the official related list was returning.
 */
export async function radioQueue(track, { limit = 40 } = {}) {
  const out = [];
  const push = (arr) => { for (const t of arr || []) if (t?.id !== track?.id) out.push(t); };

  const artist = (track?.artist || '').replace(/\s*-\s*Topic$/i, '').trim();
  const jobs = [];
  if (artist) jobs.push(searchMusic(artist, { deep: true }).then((r) => r.tracks).catch(() => []));
  const words = (track?.title || '').replace(/\(.*?\)|\[.*?\]/g, '').trim().split(/\s+/).slice(0, 3).join(' ');
  if (words) jobs.push(searchMusic(words, { deep: false }).then((r) => r.tracks).catch(() => []));
  jobs.push(searchMusic(GENRES[0].q, { deep: false }).then((r) => r.tracks).catch(() => []));

  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'fulfilled') push(r.value);
  }
  return dedupe(out).slice(0, limit);
}
