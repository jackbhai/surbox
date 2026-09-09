/**
 * Downloads — keep a song on the device, play it with no internet.
 *
 * WHY A SEPARATE STORE
 *   The player's own cache (audio-resolve) is a *link* cache with a 55 min
 *   TTL: the CDN signs its URLs, so what it stores expires almost
 *   immediately. A download means the BYTES, which never expire. Those live
 *   in the Cache Storage under SURBOX_DL, and the human list you see in the
 *   Library tab lives in localStorage next to everything else.
 *
 * OFFLINE PLAYBACK
 *   player.play() asks getDownload(id) BEFORE it asks the network. A hit
 *   returns a blob: URL — same-origin, so the equaliser and visualiser read
 *   real samples and the track starts in ~0 ms even in flight mode.
 *
 * BLOAT CONTROL
 *   One MP3 is 3-10 MB, so the list shows sizes and every row can be
 *   removed. The whole store can be cleared from the Downloads view.
 */

const CACHE = 'surbox-dl-v1';
const KEY = 'omni:downloads';

const subs = new Set();
export const onDownloads = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => { for (const f of subs) { try { f(); } catch {} } };

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} emit(); };

/** In-flight ids, so the UI can show a spinner instead of a second copy. */
const busy = new Set();

export const downloads = () => read();
export const isDownloaded = (id) => !!id && read().some((d) => d.id === id);
export const isDownloading = (id) => busy.has(id);
export const downloadCount = () => read().length;

export const downloadBytes = () => read().reduce((a, d) => a + (+d.size || 0), 0);

/** "4.2 MB" / "1.1 GB" — one decimal below ten, none above. */
export const fmtBytes = (b) => {
  if (!b || b < 1024) return (b || 0) + ' B';
  const u = ['KB', 'MB', 'GB']; let i = -1; let v = b;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
};

const cacheUrl = (id) => `https://surbox.dl/${encodeURIComponent(id)}.mp3`;

/**
 * Download a track: resolve a fresh stream URL (signed links expire, so the
 * 55-minute link cache must NOT be trusted here), pull the bytes, keep them.
 * Resolves to true when the track is on the device afterwards.
 */
export async function downloadTrack(track, { resolveAudio }) {
  if (!track?.id) throw new Error('This track cannot be saved offline');
  if (isDownloaded(track.id)) return true;
  if (busy.has(track.id)) return false;
  busy.add(track.id); emit();
  try {
    const r = await resolveAudio(track.id, { fresh: true });
    const res = await fetch(r.audio, { mode: 'cors' });
    if (!res.ok) throw new Error(`Source answered ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error('Empty file');
    const c = await caches.open(CACHE);
    await c.put(new Request(cacheUrl(track.id)),
      new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
    const list = read().filter((d) => d.id !== track.id);
    list.unshift({
      id: track.id, title: track.title || track.name || '', artist: track.artist || '',
      art: track.art || '', dur: track.dur || 0, size: blob.size, at: Date.now(),
    });
    write(list);
    return true;
  } finally {
    busy.delete(track.id); emit();
  }
}

/** The bytes as a blob: URL the audio element can play offline. */
export async function getDownload(id) {
  if (!id || !isDownloaded(id)) return null;
  try {
    const c = await caches.open(CACHE);
    const res = await c.match(new Request(cacheUrl(id)));
    if (!res) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch { return null; }
}

export async function removeDownload(id) {
  try {
    const c = await caches.open(CACHE);
    await c.delete(new Request(cacheUrl(id)));
  } catch {}
  write(read().filter((d) => d.id !== id));
}

export async function clearDownloads() {
  try { await caches.delete(CACHE); } catch {}
  write([]);
}
