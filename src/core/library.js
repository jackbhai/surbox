/**
 * Your music library — favourites, play history and your own playlists.
 *
 * Everything lives in localStorage. No account, no server, nothing leaves the
 * device. Tracks are stored with the few fields the player actually needs
 * (id, title, artist, art, duration) so a saved song still plays months later:
 * the CDN link is deliberately NOT stored, because those are signed and expire
 * within minutes — the id is re-resolved on play.
 */

const K_FAV  = 'omni:lib:fav';
const K_HIST = 'omni:lib:hist';
const K_PL   = 'omni:lib:playlists';
const K_TIME = 'omni:lib:time';     // seconds actually listened, per track/artist/day
const MAX_HIST = 200;

const subs = new Set();
export function onLibrary(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = () => { for (const f of subs) { try { f(); } catch {} } };

function read(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
  catch { return fallback; }
}
function write(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  emit();
}

/** Keep only what playback needs — never the signed stream URL. */
const slim = (t) => ({
  id: t.id, title: t.title || '', artist: t.artist || '',
  art: t.art || '', dur: t.dur || null, needsResolve: true,
});

/* ------------------------------------------------------------ favourites */
export const favourites = () => read(K_FAV, []);
export const isFav = (id) => !!id && favourites().some((t) => t.id === id);

export function toggleFav(track) {
  if (!track?.id) return false;
  const cur = favourites();
  const hit = cur.findIndex((t) => t.id === track.id);
  if (hit >= 0) { cur.splice(hit, 1); write(K_FAV, cur); return false; }
  cur.unshift(slim(track));
  write(K_FAV, cur);
  return true;
}
export function removeFav(id) {
  write(K_FAV, favourites().filter((t) => t.id !== id));
}

/* --------------------------------------------------------------- history */
export const history = () => read(K_HIST, []);

/** Record a play. Re-playing a track moves it to the top rather than duplicating. */
export function notePlay(track) {
  if (!track?.id) return;
  const cur = history().filter((t) => t.id !== track.id);
  cur.unshift({ ...slim(track), at: Date.now() });
  write(K_HIST, cur.slice(0, MAX_HIST));
}
export const clearHistory = () => write(K_HIST, []);

/** Most-played, derived from history frequency. */
export function topPlayed(n = 20) {
  const count = new Map();
  for (const t of history()) count.set(t.id, (count.get(t.id) || 0) + 1);
  const byId = new Map(history().map((t) => [t.id, t]));
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, c]) => ({ ...byId.get(id), plays: c }))
    .filter((t) => t.id);
}

/* ------------------------------------------------------- listening time */
/* A play is a tap; listening time is what the player measured. The player
   flushes seconds here every few seconds while a track is actually audible,
   so the Stats view can say "3.4 hours this week" instead of "47 plays". */

const readTime = () => read(K_TIME, { total: 0, tracks: {}, artists: {}, days: {} });

/**
 * Add listened seconds. No emit() storm — the player calls this in batches,
 * and the Library view re-reads when it mounts anyway.
 */
export function noteListen(track, secs) {
  if (!track?.id || !secs || secs <= 0) return;
  const d = readTime();
  const day = new Date().toISOString().slice(0, 10);
  d.total = Math.round((d.total || 0) + secs);
  d.tracks[track.id] = Math.round((d.tracks[track.id] || 0) + secs);
  const a = (track.artist || '').trim();
  if (a) d.artists[a] = Math.round((d.artists[a] || 0) + secs);
  d.days[day] = Math.round((d.days[day] || 0) + secs);
  // keep the day log to a year — a stat nobody scrolls is just bytes
  const days = Object.keys(d.days).sort();
  while (days.length > 366) { delete d.days[days.shift()]; }
  try { localStorage.setItem(K_TIME, JSON.stringify(d)); } catch {}
}

/** "1h 24m" / "46m" / "2.4h" — compact, for the stats cards. */
export const fmtMins = (s) => {
  const m = Math.round((s || 0) / 60);
  if (m < 60) return m + 'm';
  const h = m / 60;
  return (h >= 10 ? Math.round(h) : h.toFixed(1)) + 'h';
};

/** Everything the Stats view shows, in one read. */
export function listenStats() {
  const d = readTime();
  const today = new Date().toISOString().slice(0, 10);
  let week = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    week += d.days[day] || 0;
  }
  const topArtists = Object.entries(d.artists || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, s]) => ({ name, s }));
  const topTracks = Object.entries(d.tracks || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, s]) => ({ id, s }));
  const byId = new Map(history().map((t) => [t.id, t]));
  return {
    total: d.total || 0, today: d.days[today] || 0, week,
    topArtists,
    topTracks: topTracks.map((t) => ({ ...t, ...(byId.get(t.id) || { id: t.id, title: 'Unknown track' }) })),
  };
}

/* ------------------------------------------------------------- playlists */
export const playlists = () => read(K_PL, []);

export function createPlaylist(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const all = playlists();
  const pl = { id: `pl_${Date.now().toString(36)}`, name: n, tracks: [], at: Date.now() };
  all.unshift(pl);
  write(K_PL, all);
  return pl;
}

export function deletePlaylist(id) {
  write(K_PL, playlists().filter((p) => p.id !== id));
}

export function renamePlaylist(id, name) {
  const all = playlists();
  const p = all.find((x) => x.id === id);
  if (!p) return;
  p.name = String(name || '').trim() || p.name;
  write(K_PL, all);
}

/** Add a track (or several) to a playlist, skipping duplicates. */
export function addToPlaylist(id, tracks) {
  const all = playlists();
  const p = all.find((x) => x.id === id);
  if (!p) return 0;
  const have = new Set(p.tracks.map((t) => t.id));
  let added = 0;
  for (const t of [].concat(tracks)) {
    if (!t?.id || have.has(t.id)) continue;
    p.tracks.push(slim(t));
    have.add(t.id);
    added++;
  }
  if (added) write(K_PL, all);
  return added;
}

export function removeFromPlaylist(id, trackId) {
  const all = playlists();
  const p = all.find((x) => x.id === id);
  if (!p) return;
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
  write(K_PL, all);
}

/** Everything, as one JSON blob the user can save. */
export function exportLibrary() {
  return JSON.stringify({
    v: 1, at: new Date().toISOString(),
    favourites: favourites(), playlists: playlists(), history: history(),
  }, null, 2);
}

/** Merge a previously exported blob back in. Returns a short summary. */
export function importLibrary(json) {
  const d = JSON.parse(json);
  if (!d || d.v !== 1) throw new Error('Not a SurBox library file');
  const fav = favourites();
  const haveFav = new Set(fav.map((t) => t.id));
  let nf = 0;
  for (const t of d.favourites || []) if (t?.id && !haveFav.has(t.id)) { fav.push(t); nf++; }
  write(K_FAV, fav);

  const pls = playlists();
  const havePl = new Set(pls.map((p) => p.name.toLowerCase()));
  let np = 0;
  for (const p of d.playlists || []) {
    if (!p?.name || havePl.has(p.name.toLowerCase())) continue;
    pls.push({ ...p, id: `pl_${Date.now().toString(36)}_${np}` });
    np++;
  }
  write(K_PL, pls);
  return { favourites: nf, playlists: np };
}

export function libraryStats() {
  return {
    favourites: favourites().length,
    playlists: playlists().length,
    history: history().length,
  };
}
