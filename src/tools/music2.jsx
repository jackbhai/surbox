/**
 * Music — search, charts, genres, artists, playlists and endless radio.
 *
 * WHY IT LOOKS LIKE THIS
 *   The old screen was a search box and the first 20 hits, full stop. A live
 *   probe of the sources showed how much more was reachable without adding a
 *   single API key:
 *     · search paginates (verified pages 2 and 3, 20 rows each) → infinite scroll
 *     · fanning the same query over three filters takes 20 hits → 54 unique ids
 *     · one playlist call returns 101 tracks
 *     · iTunes (CORS *) gives an artist's 60 songs and 30 albums, plus charts
 *   So the tool now has Search · Charts · Genres · Playlists · Radio, and every
 *   list can be played as a queue.
 *
 *   Playback stays what it was: a direct audio stream, no video, no ads, no
 *   YouTube embed. Tapping a row starts the whole list as a queue, so it keeps
 *   going by itself; with Radio on, the queue refills before it can run out.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as P from '../core/providers';
import { usePlayer } from '../core/player';
import { prefetchAudio, isCached, onWarm, rememberTrack } from '../core/audio-resolve';
import { searchMusic, suggest, findPlaylists, findPlaylistsWithCounts, playlistTracks, artistInfo,
         resolveByName, radioQueue, chart, GENRES } from '../core/music';
import { catalogueReady, searchCatalogue, searchArtists, artistPage, albumTracks,
         chartTracks, chartArtists, chartPlaylists, playlistEntries,
         radioStations, radioTracks, toPlayable, toPlayableList,
         REGIONS, TOP_ARTISTS } from '../core/catalogue';
import { Spin, Err, Empty, Card, fmt } from '../ui/kit';
import { Icon } from '../ui/icons';
import { favourites, isFav, toggleFav, history, topPlayed, playlists,
         createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
         clearHistory, onLibrary, libraryStats } from '../core/library';
import { getSettings, setSetting, testProxy, usingBuiltin, BUILTIN_PROXY } from '../core/settings';
import * as SRC from '../core/sources';
import { HomeTab } from './music-home';

const mmss = (s) => (!s ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

const TABS = [
  ['home',     'cog',     'Home'],
  ['search',   'search',  'Search'],
  ['artists',  'smile',   'Artists'],
  ['library',  'staron',  'Library'],
  ['charts',   'chart',   'Charts'],
  ['genres',   'grid',    'Genres'],
  ['playlist', 'list',    'Playlists'],
  ['radio',    'radio',   'Radio'],
];

/* The mood list and the regional list, merged and de-duplicated. */
const ALL_GENRES = (() => {
  const out = [...GENRES];
  const have = new Set(out.map((g) => g.label.toLowerCase()));
  for (const r of REGIONS) if (!have.has(r.label.toLowerCase())) out.push(r);
  return out;
})();

const QUICK = ['babbu maan', 'sidhu moose wala', 'diljit dosanjh', 'ishq murshid',
  'cheema y', 'atif aslam', 'arijit singh', 'coke studio', 'karan aujla', 'ap dhillon'];

export function Music() {
  const player = usePlayer();
  const [tab, setTab] = useState('home');
  const [, bump] = useState(0);
  useEffect(() => onWarm(() => bump((n) => n + 1)), []);

  return (<>
    <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
      {TABS.map(([id, ic, label]) => (
        <button key={id} role="tab" aria-selected={tab === id}
          className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
          <Icon n={ic} size={16} /><span>{label}</span>
        </button>))}
    </div>

    {tab === 'home'     && <HomeTab player={player} />}
    {tab === 'search'   && <SearchTab player={player} />}
    {tab === 'artists'  && <ArtistsTab player={player} />}
    {tab === 'library'  && <LibraryTab player={player} />}
    {tab === 'charts'   && <ChartsTab player={player} />}
    {tab === 'genres'   && <GenresTab player={player} />}
    {tab === 'playlist' && <PlaylistTab player={player} />}
    {tab === 'radio'    && <RadioTab player={player} />}
  </>);
}

/* ------------------------------------------------------------- track list */
function TrackList({ tracks, player, onPlay, loading, more, onMore, onRemove }) {
  const sentinel = useRef(null);
  const [addFor, setAddFor] = useState(null);   // track awaiting a playlist pick
  const [, bump] = useState(0);
  useEffect(() => onLibrary(() => bump((n) => n + 1)), []);

  /* Infinite scroll: load the next page when the end of the list appears.
     FIX: guard rapid triggers, use smaller rootMargin, disconnect properly */
  useEffect(() => {
    if (!onMore || !sentinel.current || loading) return;
    let triggered = false;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !triggered && !loading) {
        triggered = true;
        onMore();
        // debounce next trigger by 800ms
        setTimeout(() => { triggered = false; }, 800);
      }
    }, { rootMargin: '200px', threshold: 0.1 });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [onMore, tracks.length, loading]);

  if (!tracks?.length) return null;
  return (<>
    <div className="list">
      {tracks.map((t, i) => {
        const active = player.track && (player.track.id ?? player.track.url) === (t.id ?? t.url);
        const key = `${t.id || t.url || t.title}-${i}-${(t.title||'').slice(0,8)}`;
        return (
          <div className="row" key={key} onClick={() => onPlay(t, i)}
            style={{ cursor: 'pointer', background: active ? 'rgba(0,255,156,.07)' : '' }}>
            {t.art
              ? <img src={t.art} alt="" loading="lazy"
                  style={{ width: 46, height: 46, borderRadius: 9, objectFit: 'cover',
                           flex: '0 0 auto', background: 'var(--s3)' }}
                  onError={(e) => { e.target.style.visibility = 'hidden'; }} />
              : <div style={{ width: 46, height: 46, borderRadius: 9, background: 'var(--s3)',
                  display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <Icon n="music" size={20} style={{ opacity: .55 }} /></div>}
            <div className="main">
              <b style={{ fontSize: 13.5, color: active ? 'var(--green)' : '' }}>
                {(t.title || '').slice(0, 54)}</b>
              <span className="dim sm">
                {t.artist || ''}
                {t.dur ? ` · ${mmss(t.dur)}` : ''}
                {t.views > 0 ? ` · ${fmt(t.views)} plays` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center', flex: '0 0 auto' }}>
              {t.id && isCached(t.id) && !active &&
                <span className="tag g" title="Already loaded — plays instantly">ready</span>}
              {t.id && (
                <button className="rowbtn" aria-label={isFav(t.id) ? 'Remove favourite' : 'Add favourite'}
                  onClick={(e) => { e.stopPropagation(); toggleFav(t); }}>
                  <Icon n={isFav(t.id) ? 'staron' : 'star'} size={16}
                    style={{ color: isFav(t.id) ? 'var(--green)' : 'var(--fg3)' }} /></button>)}
              {t.id && !onRemove && (
                <button className="rowbtn" aria-label="Add to playlist"
                  onClick={(e) => { e.stopPropagation(); setAddFor(t); }}>
                  <Icon n="list" size={16} style={{ color: 'var(--fg3)' }} /></button>)}
              {onRemove && (
                <button className="rowbtn" aria-label="Remove from playlist"
                  onClick={(e) => { e.stopPropagation(); onRemove(t); }}>
                  <Icon n="x" size={15} style={{ color: 'var(--fg3)' }} /></button>)}
              <span style={{ color: active && player.playing ? 'var(--green)' : 'var(--fg2)',
                             display: 'grid', placeItems: 'center', paddingLeft: 3 }}>
                <Icon n={active && player.playing ? 'pause' : 'play'} size={18} /></span>
            </div>
          </div>);
      })}
    </div>
    {addFor && <AddToPlaylist track={addFor} onClose={() => setAddFor(null)} />}
    {onMore && <div ref={sentinel} style={{ height: 1 }} />}
    {loading && <Spin t="Loading more" />}
    {!loading && more === false && tracks.length > 20 &&
      <div className="dim sm" style={{ textAlign: 'center', padding: '12px 0' }}>
        That is everything for this one.</div>}
  </>);
}

/** Small sheet: pick a playlist to add a track to, or make a new one. */
function AddToPlaylist({ track, onClose }) {
  const [name, setName] = useState('');
  const pls = playlists();
  const add = (id) => { addToPlaylist(id, track); onClose(); };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="chead">Add &ldquo;{(track.title || '').slice(0, 30)}&rdquo; to…</div>
        {pls.length > 0 && (
          <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {pls.map((p) => (
              <button className="row" key={p.id} onClick={() => add(p.id)}
                style={{ background: 'none', border: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                <Icon n="list" size={17} style={{ color: 'var(--green)' }} />
                <div className="main"><b style={{ fontSize: 13 }}>{p.name}</b>
                  <span className="dim sm">{p.tracks.length} songs</span></div>
              </button>))}
          </div>)}
        <div className="fld" style={{ marginTop: 10, marginBottom: 0 }}>
          <div className="ip-wrap">
            <Icon n="list" size={16} />
            <input value={name} autoFocus placeholder="…or a new playlist"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  const p = createPlaylist(name); if (p) add(p.id);
                }
              }} />
          </div>
        </div>
        <button className="btn ghost sm" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>
          Cancel</button>
      </div>
    </div>);
}

/** Start a list as a queue and warm the first few so the next tap is instant. */
function playList(player, list, i) {
  player.setRadio(true);
  player.play(list[i], list);
  const nx = list[i + 1];
  if (nx?.id) { rememberTrack(nx.id, nx); prefetchAudio(nx.id, 0); }
}

/* ------------------------------------------------------------ search tab */
function SearchTab({ player }) {
  const [q, setQ] = useState('babbu maan');
  const [tracks, setTracks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tips, setTips] = useState([]);
  const [focused, setFocused] = useState(false);
  const [more, setMore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextRef = useRef(null);
  const seq = useRef(0);
  const abortRef = useRef(null);

  const run = useCallback(async (term) => {
    const s = String(term || '').trim();
    if (!s) return;
    // Abort previous
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const my = ++seq.current;
    setBusy(true); setErr(''); setTips([]); setFocused(false);
    // Show immediate feedback: clear old list fast so user knows new search started
    setTracks(null);
    try {
      // FAST PATH: omni-proxy 34 sources race (0.5-1s) via searchMusic which now uses it
      const r = await searchMusic(s, { deep: false });
      if (ctrl.signal.aborted || my !== seq.current) return;
      if (r.tracks?.length) {
        setTracks(r.tracks);
        nextRef.current = r.next;
        setMore(r.next ? true : false);
        // Warm top 2 only
        r.tracks.slice(0, 2).forEach((t, i) => { if (t.id) { rememberTrack(t.id, t); prefetchAudio(t.id, i); } });
        setBusy(false);
        // Background enrichment: catalogue + second pass without blocking UI
        if (catalogueReady()) {
          searchCatalogue(s, { limit: 30 })
            .then(async (entries) => {
              if (ctrl.signal.aborted || my !== seq.current || !entries.length) return;
              const extra = await toPlayableList(entries, { limit: 12 });
              if (ctrl.signal.aborted || my !== seq.current) return;
              setTracks((cur) => {
                if (!cur) return cur;
                const seen = new Set(cur.map((t) => t.id));
                const add = extra.filter((t) => t?.id && !seen.has(t.id));
                return add.length ? [...cur, ...add] : cur;
              });
            })
            .catch(() => {});
        }
        return;
      }
      // If fast path empty, try deeper
      const r2 = await searchMusic(s, { deep: true });
      if (ctrl.signal.aborted || my !== seq.current) return;
      setTracks(r2.tracks);
      nextRef.current = r2.next;
      setMore(r2.next ? true : false);
      r2.tracks.slice(0, 2).forEach((t, i) => { if (t.id) { rememberTrack(t.id, t); prefetchAudio(t.id, i); } });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (my === seq.current) { setErr(e.message || 'Search failed'); setTracks([]); }
    } finally {
      if (!ctrl.signal.aborted && my === seq.current) setBusy(false);
    }
  }, []);

  useEffect(() => { run('babbu maan'); return () => abortRef.current?.abort(); }, [run]);

  useEffect(() => {
    if (!focused || q.trim().length < 2) { setTips([]); return; }
    const t = setTimeout(async () => {
      try { setTips(await suggest(q)); } catch { setTips([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, focused]);

  const loadMore = useCallback(async () => {
    if (!nextRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const add = await nextRef.current();
      if (add.length) setTracks((cur) => [...(cur || []), ...add]);
      else { setMore(false); nextRef.current = null; }
    } catch { setMore(false); }
    finally { setLoadingMore(false); }
  }, [loadingMore]);

  return (<>
    <div className="fld" style={{ position: 'relative' }}>
      <div className="ip-wrap">
        <Icon n="search" size={17} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { setTips([]); setFocused(false); run(q); e.target.blur(); }
            if (e.key === 'Escape') { setTips([]); setFocused(false); e.target.blur(); }
          }}
          placeholder="Any song, artist or album…" enterKeyHint="search" autoComplete="off" />
        {q && <button className="ip-x" onClick={() => { setQ(''); setTips([]); setTracks(null); }} aria-label="Clear">
          <Icon n="x" size={16} /></button>}
      </div>
      {focused && tips.length > 0 && (
        <div className="list" style={{ position: 'absolute', top: '100%', left: 0, right: 0,
          zIndex: 40, marginTop: 4, maxHeight: 240, overflowY: 'auto', boxShadow: '0 12px 24px rgba(0,0,0,.18)' }}>
          {tips.map((s) => (
            <button key={s} className="row" style={{ background: 'none', border: 0,
              textAlign: 'left', width: '100%', cursor: 'pointer', padding: '10px 12px' }}
              onMouseDown={(e) => { e.preventDefault(); setQ(s); setTips([]); setFocused(false); run(s); }}>
              <Icon n="search" size={14} style={{ opacity: .5 }} />
              <b style={{ fontSize: 13 }}>{s}</b>
            </button>))}
        </div>)}
    </div>

    <div className="cats" style={{ gap: 6 }}>
      {QUICK.map((x) => (
        <button key={x} className="cat" style={{ textTransform: 'capitalize' }}
          onClick={() => { setQ(x); setTips([]); setFocused(false); run(x); }}>{x}</button>))}
    </div>

    {busy && !tracks && <Spin t="Searching" />}
    {err && <Err error={err} retry={() => run(q)} />}
    {tracks?.length === 0 && !busy && <Empty t={`Nothing found for "${q}"`} />}

    {tracks?.length > 0 && (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 8px' }}>
        <span className="dim sm" style={{ flex: 1 }}>{tracks.length} songs</span>
        <button className="btn ghost sm" onClick={() => playList(player, tracks, 0)}>
          <Icon n="play" size={14} /> Play all</button>
        <button className="btn ghost sm" onClick={() => {
          const sh = [...tracks].sort(() => Math.random() - 0.5);
          player.setShuffle(true); playList(player, sh, 0);
        }}><Icon n="swap" size={14} /> Shuffle</button>
      </div>
      <TrackList tracks={tracks} player={player} loading={loadingMore}
        more={more} onMore={more ? loadMore : null}
        onPlay={(t, i) => playList(player, tracks, i)} />
    </>)}
  </>);
}

/* ------------------------------------------------------------ charts tab */
function ChartsTab({ player }) {
  const [country, setCountry] = useState('in');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [opening, setOpening] = useState(null);

  const load = useCallback(async (c) => {
    setBusy(true); setErr(''); setRows(null);
    try { setRows(await chart(c, 50)); }
    catch (e) { setErr(e.message || 'Could not load the chart'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(country); }, [country, load]);

  /* Chart rows are metadata only, so the title is resolved to a playable
     track on tap, then the rest of the chart is queued behind it. */
  const openRow = async (r, i) => {
    setOpening(i);
    try {
      const t = await resolveByName(r.title, r.artist);
      if (!t) throw new Error('not found');
      const rest = await Promise.all(rows.slice(i + 1, i + 6)
        .map((x) => resolveByName(x.title, x.artist).catch(() => null)));
      const queue = [t, ...rest.filter(Boolean)];
      player.setRadio(true);
      player.play(t, queue);
      if (queue[1]?.id) { rememberTrack(queue[1].id, queue[1]); prefetchAudio(queue[1].id, 0); }
    } catch { setErr('Could not find a stream for that track.'); }
    finally { setOpening(null); }
  };

  return (<>
    <div className="cats">
      {[['in', 'India'], ['us', 'Global'], ['gb', 'UK'], ['ca', 'Canada'], ['ae', 'UAE']]
        .map(([c, l]) => (
        <button key={c} className={`cat ${country === c ? 'on' : ''}`}
          onClick={() => setCountry(c)}>{l}</button>))}
    </div>
    {busy && <Spin t="Loading the chart" />}
    {err && <Err error={err} retry={() => load(country)} />}
    {rows?.length > 0 && (<>
      <div className="dim sm" style={{ margin: '10px 0 8px' }}>
        Top {rows.length} most played right now
      </div>
      <div className="list">
        {rows.map((r, i) => (
          <div className="row" key={i} onClick={() => openRow(r, i)} style={{ cursor: 'pointer' }}>
            <span className="chartno">{i + 1}</span>
            {r.art
              ? <img src={r.art} alt="" loading="lazy"
                  style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
              : <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--s3)' }} />}
            <div className="main">
              <b style={{ fontSize: 13 }}>{r.title}</b>
              <span className="dim sm">{r.artist}</span>
            </div>
            <span style={{ color: 'var(--fg2)', display: 'grid', placeItems: 'center' }}>
              {opening === i ? <span className="spin-sm" /> : <Icon n="play" size={17} />}
            </span>
          </div>))}
      </div>
      <div className="src"><span className="dot" />
        <span>Chart positions from Apple's most-played feed; audio is matched and streamed ad-free.</span></div>
    </>)}
  </>);
}

/* ------------------------------------------------------------ genres tab */
function GenresTab({ player }) {
  const [open, setOpen] = useState(null);
  const [tracks, setTracks] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async (g) => {
    setOpen(g); setBusy(true); setTracks(null);
    try {
      const r = await searchMusic(g.q);
      setTracks(r.tracks);
      r.tracks.slice(0, 2).forEach((t, i) => { if (t.id) { rememberTrack(t.id, t); prefetchAudio(t.id, i); } });
      // widen with catalogue material — this is where the regional depth is
      if (catalogueReady()) {
        const entries = await searchCatalogue(g.q, { limit: 40 }).catch(() => []);
        if (entries.length) {
          const extra = await toPlayableList(entries, { limit: 16 });
          setTracks((cur) => {
            const seen = new Set((cur || []).map((t) => t.id));
            const add = extra.filter((t) => t?.id && !seen.has(t.id));
            return add.length ? [...(cur || []), ...add] : cur;
          });
        }
      }
    } catch { setTracks([]); }
    finally { setBusy(false); }
  };

  if (open) return (<>
    <button className="btn ghost sm" onClick={() => { setOpen(null); setTracks(null); }}
      style={{ marginBottom: 10 }}><Icon n="back" size={15} /> All genres</button>
    <div className="hubhead">
      <div className="hubico"><Icon n="music" size={24} /></div>
      <div><b>{open.label}</b><span className="dim sm">{tracks?.length || 0} songs</span></div>
    </div>
    {busy && <Spin t={`Loading ${open.label}`} />}
    {tracks?.length > 0 && (<>
      <button className="btn" style={{ width: '100%', marginBottom: 10 }}
        onClick={() => playList(player, tracks, 0)}>
        <Icon n="play" size={16} /> Play all {tracks.length}</button>
      <TrackList tracks={tracks} player={player}
        onPlay={(t, i) => playList(player, tracks, i)} />
    </>)}
    {tracks?.length === 0 && !busy && <Empty />}
  </>);

  return (<>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))' }}>
      {ALL_GENRES.map((g) => (
        <button className="tile" key={g.id} onClick={() => load(g)}>
          <span className="ic"><Icon n="music" size={22} /></span>
          <b>{g.label}</b>
        </button>))}
    </div>
    <div className="src" style={{ marginTop: 14 }}><span className="dot" />
      <span>{ALL_GENRES.length} moods and languages — Punjabi, Haryanvi, Bhojpuri,
        Bollywood, Pakistani, Tamil, Telugu, Marathi, Gujarati, Bengali, Rajasthani
        and more. Every list plays as a queue and keeps going.</span></div>
  </>);
}

/* ---------------------------------------------------------- playlist tab */
function PlaylistTab({ player }) {
  const [q, setQ] = useState('punjabi hits');
  const [lists, setLists] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [tracks, setTracks] = useState(null);
  const [loadingTracks, setLoadingTracks] = useState(false);

  /* Only show playlists that actually expand: the mirror advertises many it
     cannot open (four of five came back empty in testing), and tapping one of
     those looked like a bug on our side. */
  const find = useCallback(async (term) => {
    setBusy(true); setLists(null);
    try { setLists(await findPlaylistsWithCounts(term)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { find('punjabi hits'); }, [find]);

  const openList = async (p) => {
    setOpen(p); setLoadingTracks(true); setTracks(null);
    try {
      const t = await playlistTracks(p.id);
      setTracks(t);
      t.slice(0, 2).forEach((x, i) => x.id && prefetchAudio(x.id, i));
    } catch { setTracks([]); }
    finally { setLoadingTracks(false); }
  };

  if (open) return (<>
    <button className="btn ghost sm" onClick={() => { setOpen(null); setTracks(null); }}
      style={{ marginBottom: 10 }}><Icon n="back" size={15} /> Playlists</button>
    <div className="hubhead">
      {open.art
        ? <img src={open.art} alt="" style={{ width: 62, height: 62, borderRadius: 14, objectFit: 'cover' }} />
        : <div className="hubico"><Icon n="list" size={24} /></div>}
      <div style={{ minWidth: 0 }}>
        <b style={{ fontSize: 15 }}>{open.name.slice(0, 46)}</b>
        <span className="dim sm">{tracks ? `${tracks.length} songs` : 'loading…'}{open.by ? ` · ${open.by}` : ''}</span>
      </div>
    </div>
    {loadingTracks && <Spin t="Loading the playlist" />}
    {tracks?.length > 0 && (<>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className="btn sm" style={{ flex: 1 }} onClick={() => playList(player, tracks, 0)}>
          <Icon n="play" size={15} /> Play all</button>
        <button className="btn ghost sm" onClick={() => {
          const sh = [...tracks].sort(() => Math.random() - 0.5);
          player.setShuffle(true); playList(player, sh, 0);
        }}><Icon n="swap" size={15} /> Shuffle</button>
      </div>
      <TrackList tracks={tracks} player={player}
        onPlay={(t, i) => playList(player, tracks, i)} />
    </>)}
    {tracks?.length === 0 && !loadingTracks && <Empty t="This playlist came back empty" />}
  </>);

  return (<>
    <div className="fld">
      <div className="ip-wrap">
        <Icon n="search" size={17} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { find(q); e.target.blur(); } }}
          placeholder="Find a playlist…" enterKeyHint="search" />
      </div>
    </div>
    <div className="cats">
      {['punjabi hits', 'bollywood 2026', 'old is gold', 'coke studio',
        'sad songs', 'party mix', 'sufi', 'lofi'].map((x) => (
        <button key={x} className="cat" onClick={() => { setQ(x); find(x); }}>{x}</button>))}
    </div>
    {busy && <Spin t="Finding playlists" />}
    {lists?.length === 0 && !busy &&
      <Empty t="No playlists here that can be opened — try another search" />}
    {lists?.length > 0 && (
      <div className="list">
        {lists.map((p) => (
          <div className="row" key={p.id} onClick={() => openList(p)} style={{ cursor: 'pointer' }}>
            {p.art
              ? <img src={p.art} alt="" loading="lazy"
                  style={{ width: 48, height: 48, borderRadius: 9, objectFit: 'cover', flex: '0 0 auto' }} />
              : <div style={{ width: 48, height: 48, borderRadius: 9, background: 'var(--s3)',
                  display: 'grid', placeItems: 'center' }}><Icon n="list" size={20} /></div>}
            <div className="main">
              <b style={{ fontSize: 13 }}>{p.name.slice(0, 48)}</b>
              <span className="dim sm">{p.count ? `${p.count} songs` : 'playlist'}{p.by ? ` · ${p.by}` : ''}</span>
            </div>
            <Icon n="chevron" size={15} style={{ opacity: .5 }} />
          </div>))}
      </div>)}
    <div className="src" style={{ marginTop: 14 }}><span className="dot" />
      <span>A playlist can hold a hundred songs — the whole thing queues up and plays without stopping.</span></div>
  </>);
}

/* -------------------------------------------------------------- radio tab */
function RadioTab({ player }) {
  const [mode, setMode] = useState('desi');       // desi = endless mix · live = stations
  const [busy, setBusy] = useState(false);
  const [stations, setStations] = useState(null);
  const [err, setErr] = useState('');
  const [lang, setLang] = useState('punjabi');

  const startMix = async (seedQuery, label) => {
    setBusy(true); setErr('');
    try {
      const r = await searchMusic(seedQuery);
      if (!r.tracks.length) throw new Error('nothing found');
      const shuffled = [...r.tracks].sort(() => Math.random() - 0.5);
      player.setRadio(true);
      player.setShuffle(false);
      player.play(shuffled[0], shuffled);
      if (shuffled[1]?.id) prefetchAudio(shuffled[1].id, 0);
    } catch (e) { setErr(`Could not start ${label}: ${e.message}`); }
    finally { setBusy(false); }
  };

  const [probing, setProbing] = useState(false);
  const [, bumpLive] = useState(0);
  const probeToken = useRef(0);

  const loadStations = useCallback(async (l) => {
    setBusy(true); setErr(''); setStations(null);
    /* One directory mirror was dead in DNS, so a failure here used to be
       final. Walk the pool instead of trusting the first entry. */
    let last = null;
    for (const provider of P.radio) {
      try {
        const r = await provider.run({ q: l, mode: 'lang' });
        if (r.length) {
          setStations(SRC.sortStations(r.map((s) => ({ ...s, stream: s.url }))));
          setBusy(false);
          return;
        }
      } catch (e) { last = e; }
    }
    setErr(last?.message || 'Could not load stations');
    setBusy(false);
  }, []);

  useEffect(() => { if (mode === 'live') loadStations(lang); }, [mode, lang, loadStations]);

  /* Probe the visible stations quietly, remember what answered, and re-sort.
     Same approach live TV uses, and for the same reason: a directory listing
     is not proof a stream is up, and finding out one tap at a time is a poor
     way to learn it. Only the slice on screen is probed — there is no reason
     to hammer sixty hosts the user may never scroll to. */
  useEffect(() => {
    if (mode !== 'live' || !stations?.length) return;
    const my = ++probeToken.current;
    let alive = true;
    setProbing(true);
    SRC.probeStations(stations.slice(0, 24))
      .then((learned) => {
        if (!alive || my !== probeToken.current) return;
        if (learned) {
          setStations((cur) => (cur ? SRC.sortStations(cur) : cur));
          bumpLive((n) => n + 1);
        }
      })
      .finally(() => { if (alive && my === probeToken.current) setProbing(false); });
    return () => { alive = false; };
  }, [mode, stations?.length, lang]);   // eslint-disable-line

  return (<>
    <div className="cats">
      <button className={`cat ${mode === 'desi' ? 'on' : ''}`} onClick={() => setMode('desi')}>
        Endless mix</button>
      <button className={`cat ${mode === 'live' ? 'on' : ''}`} onClick={() => setMode('live')}>
        Live stations</button>
    </div>

    {mode === 'desi' && (<>
      <Card>
        <div className="chead"><Icon n="radio" size={16} /> Non-stop radio</div>
        <div className="dim sm">
          Pick a station and it plays for as long as you like. When the list gets
          low it refills itself with more of the same, so the music never stops.
        </div>
      </Card>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))' }}>
        {GENRES.map((g) => (
          <button className="tile" key={g.id} disabled={busy}
            onClick={() => startMix(g.q, g.label)}>
            <span className="ic"><Icon n="radio" size={22} /></span>
            <b>{g.label}</b>
            <small>non-stop</small>
          </button>))}
      </div>
      {busy && <Spin t="Starting the station" />}
      {err && <div className="note bad" style={{ marginTop: 10 }}>{err}</div>}
    </>)}

    {mode === 'live' && (<>
      <div className="cats">
        {['punjabi', 'hindi', 'urdu', 'bhojpuri', 'tamil', 'bengali'].map((l) => (
          <button key={l} className={`cat ${lang === l ? 'on' : ''}`}
            onClick={() => setLang(l)}>{l}</button>))}
      </div>
      {busy && <Spin t="Loading stations" />}
      {err && <Err error={err} retry={() => loadStations(lang)} />}
      {stations?.length > 0 && (() => {
        const st8 = SRC.stationStats(stations);
        return (
        <div className="list">
          {/* Say what is actually known, rather than tagging every row "live"
              on the directory's word. The old list marked all sixty live
              including the ones that answer nothing. */}
          <div className="qhead">
            <span>{stations.length} stations{st8.up ? ` · ${st8.up} confirmed live` : ''}</span>
            <span>{probing ? 'checking…' : ''}</span>
          </div>
          {stations.map((st, i) => {
            const active = player.track && player.track.url === st.url;
            const score = SRC.stationScore(st.url);
            return (
              <div className="row" key={st.id || i} style={{ cursor: 'pointer' }}
                onClick={() => player.play({ ...st, title: st.name, stream: st.url,
                  altStream: st.altUrl || '', kind: 'station', needsResolve: false }, stations)}>
                {st.fav
                  ? <img src={st.fav} alt="" loading="lazy"
                      style={{ width: 44, height: 44, borderRadius: 9, objectFit: 'cover', flex: '0 0 auto' }}
                      onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--s3)',
                      display: 'grid', placeItems: 'center' }}><Icon n="radio" size={19} /></div>}
                <div className="main">
                  <b style={{ fontSize: 13, color: active ? 'var(--green)' : '' }}>{st.name}</b>
                  <span className="dim sm">
                    {[st.country, st.bitrate ? `${st.bitrate}kbps` : '', st.codec]
                      .filter(Boolean).join(' · ')}
                  </span>
                </div>
                {/* A confirmed station gets a lit dot; one that failed a probe
                    is dimmed but NOT removed — plenty of hosts refuse a
                    cross-origin read and still play perfectly. */}
                {score > 0
                  ? <span className="tag c"><span className="dot live" /> live</span>
                  : score < 0
                    ? <span className="tag" style={{ opacity: .5 }}>no answer</span>
                    : <span className="tag" style={{ opacity: .6 }}>untested</span>}
              </div>);
          })}
        </div>);
      })()}
    </>)}
  </>);
}

/* -------------------------------------------------------------- library tab */
/**
 * Favourites, recently played, most played, your own playlists — and the
 * proxy setting, which is here because it is the one thing that decides
 * whether music starts in half a second or ten.
 */
function LibraryTab({ player }) {
  const [, bump] = useState(0);
  useEffect(() => onLibrary(() => bump((n) => n + 1)), []);
  const [view, setView] = useState('fav');
  const [openPl, setOpenPl] = useState(null);
  const [newName, setNewName] = useState('');

  const stats = libraryStats();
  const favs = favourites();
  const hist = history();
  const top = topPlayed(25);
  const pls = playlists();

  /* --- one playlist, opened --- */
  if (openPl) {
    const pl = pls.find((p) => p.id === openPl);
    if (!pl) { setOpenPl(null); return null; }
    return (<>
      <button className="btn ghost sm" onClick={() => setOpenPl(null)} style={{ marginBottom: 10 }}>
        <Icon n="back" size={15} /> Library</button>
      <div className="hubhead">
        <div className="hubico"><Icon n="list" size={24} /></div>
        <div style={{ minWidth: 0 }}>
          <b>{pl.name}</b><span className="dim sm">{pl.tracks.length} songs</span>
        </div>
      </div>
      {pl.tracks.length === 0
        ? <Empty t="Empty — add songs with the + button on any track" />
        : (<>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button className="btn sm" style={{ flex: 1 }}
              onClick={() => playList(player, pl.tracks, 0)}>
              <Icon n="play" size={15} /> Play all</button>
            <button className="btn ghost sm" onClick={() => {
              const sh = [...pl.tracks].sort(() => Math.random() - 0.5);
              player.setShuffle(true); playList(player, sh, 0);
            }}><Icon n="swap" size={15} /> Shuffle</button>
          </div>
          <TrackList tracks={pl.tracks} player={player}
            onPlay={(t, i) => playList(player, pl.tracks, i)}
            onRemove={(t) => removeFromPlaylist(pl.id, t.id)} />
        </>)}
      <button className="btn ghost sm" style={{ width: '100%', marginTop: 14 }}
        onClick={() => { if (confirm(`Delete "${pl.name}"?`)) { deletePlaylist(pl.id); setOpenPl(null); } }}>
        <Icon n="x" size={14} /> Delete this playlist</button>
    </>);
  }

  const rows = view === 'fav' ? favs : view === 'recent' ? hist : top;

  return (<>
    <div className="g3" style={{ marginBottom: 12 }}>
      <div className="stat"><div className="v">{stats.favourites}</div><div className="l">Favourites</div></div>
      <div className="stat"><div className="v">{stats.playlists}</div><div className="l">Playlists</div></div>
      <div className="stat"><div className="v">{stats.history}</div><div className="l">Played</div></div>
    </div>

    <div className="cats">
      {[['fav', 'Favourites'], ['recent', 'Recent'], ['top', 'Most played'],
        ['lists', 'My playlists'], ['setup', 'Speed']].map(([v, l]) => (
        <button key={v} className={`cat ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>{l}</button>))}
    </div>

    {view === 'lists' && (<>
      <div className="fld" style={{ marginTop: 10 }}>
        <div className="ip-wrap">
          <Icon n="list" size={16} />
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { createPlaylist(newName); setNewName(''); } }}
            placeholder="New playlist name…" />
          <button className="ip-x" disabled={!newName.trim()} aria-label="Create"
            onClick={() => { if (newName.trim()) { createPlaylist(newName); setNewName(''); } }}>
            <Icon n="check" size={16} /></button>
        </div>
      </div>
      {pls.length === 0
        ? <Empty t="No playlists yet — name one above and press enter" />
        : <div className="list">
            {pls.map((p) => (
              <div className="row" key={p.id} onClick={() => setOpenPl(p.id)} style={{ cursor: 'pointer' }}>
                <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--s3)',
                  display: 'grid', placeItems: 'center', flex: '0 0 auto', color: 'var(--green)' }}>
                  <Icon n="list" size={19} /></div>
                <div className="main">
                  <b style={{ fontSize: 13 }}>{p.name}</b>
                  <span className="dim sm">{p.tracks.length} songs</span>
                </div>
                <Icon n="chevron" size={15} style={{ opacity: .5 }} />
              </div>))}
          </div>}
    </>)}

    {view === 'setup' && <SpeedSetup />}

    {['fav', 'recent', 'top'].includes(view) && (<>
      {rows.length === 0
        ? <Empty t={view === 'fav'
            ? 'No favourites yet — tap the star on any song'
            : 'Nothing played yet'} />
        : (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 8px' }}>
            <span className="dim sm" style={{ flex: 1 }}>{rows.length} songs</span>
            <button className="btn ghost sm" onClick={() => playList(player, rows, 0)}>
              <Icon n="play" size={14} /> Play all</button>
            {view === 'recent' && rows.length > 0 &&
              <button className="btn ghost sm" onClick={() => { if (confirm('Clear history?')) clearHistory(); }}>
                <Icon n="x" size={14} /></button>}
          </div>
          <TrackList tracks={rows} player={player}
            onPlay={(t, i) => playList(player, rows, i)} />
        </>)}
    </>)}
  </>);
}

/* --------------------------------------------------------- speed / proxy */
/**
 * The relay decides two things: how fast a song starts, and whether the full
 * catalogue (artists, albums, regional search) is available at all. One ships
 * with the app, so this screen is mostly reassurance plus an escape hatch.
 */
function SpeedSetup() {
  const [url, setUrl] = useState(getSettings().proxyUrl || '');
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const builtin = usingBuiltin();

  const check = async () => {
    setBusy(true); setState(null);
    const r = await testProxy(url);
    setState(r);
    if (r.ok) { setSetting('proxyUrl', url.trim().replace(/\/+$/, '')); bump((n) => n + 1); }
    setBusy(false);
  };

  return (<>
    <Card>
      <div className="chead"><Icon n="signal" size={16} /> Playback relay</div>
      {builtin
        ? <div className="note" style={{ marginTop: 0 }}>
            Using the relay that ships with the app — nothing to set up.
            Songs resolve in well under a second and the full catalogue is on.
          </div>
        : <div className="dim sm" style={{ lineHeight: 1.65 }}>
            Using your own relay. Clear the box below to go back to the built-in one.
          </div>}

      <div className="fld" style={{ marginTop: 12 }}>
        <label>Your own relay (optional)</label>
        <div className="ip-wrap">
          <Icon n="link" size={16} />
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder={BUILTIN_PROXY} spellCheck="false" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn sm" style={{ flex: 1 }} disabled={busy || !url.trim()} onClick={check}>
          {busy ? 'Checking…' : 'Test & use mine'}</button>
        {!builtin &&
          <button className="btn ghost sm"
            onClick={() => { setSetting('proxyUrl', ''); setUrl(''); setState(null); bump((n) => n + 1); }}>
            Use built-in</button>}
      </div>
      {state?.ok && <div className="note" style={{ marginTop: 10 }}>
        Working — answered in {state.ms} ms. Saved and in use.</div>}
      {state && !state.ok && <div className="note bad" style={{ marginTop: 10 }}>{state.error}</div>}
    </Card>

    <Card>
      <div className="chead"><Icon n="info" size={16} /> Why a relay at all</div>
      <div className="dim sm" style={{ lineHeight: 1.7 }}>
        Browsers refuse to read from a server that does not opt in, and the
        music sources do not. A relay sits in between and adds that permission.
        The public ones are heavily rate-limited — of twenty-five tested, one
        was permanently blocked, several were throttled, and the single
        survivor took seven to nineteen seconds. The bundled relay answers in
        a fraction of that and unlocks the artist and album catalogue too.
      </div>
      <div className="src"><span className="dot" />
        <span>Want your own? Deploy <b>worker/omni-proxy.js</b> to a free
          Cloudflare Worker and paste the address above. It only forwards
          requests — nothing is stored.</span></div>
    </Card>
  </>);
}

/* -------------------------------------------------------------- artists tab */
/**
 * A real artist browser, which the YouTube mirror alone could never provide.
 *
 * Deezer supplies the catalogue (verified: Atif Aslam 50 top tracks + 50
 * albums, Arijit Singh 50+50, Nusrat Fateh Ali Khan 50+50, AP Dhillon 49+48)
 * and each title is matched to a full-length stream on play — 6 of 6 real
 * Punjabi titles matched in testing. Deezer's own 30-second preview is only
 * used if nothing full-length can be found, and is labelled when it happens.
 */
function ArtistsTab({ player }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);      // artist id
  const [page, setPage] = useState(null);
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const find = useCallback(async (term) => {
    setBusy(true); setErr(''); setList(null);
    try { setList(await searchArtists(term, { limit: 16 })); }
    catch (e) { setErr(e.message === 'no-proxy' ? 'no-proxy' : 'Could not search artists'); }
    finally { setBusy(false); }
  }, []);

  const openArtist = useCallback(async (id) => {
    setOpen(id); setLoading(true); setPage(null); setAlbum(null); setErr('');
    try { setPage(await artistPage(id)); }
    catch (e) { setErr('Could not load this artist'); }
    finally { setLoading(false); }
  }, []);

  const openAlbum = async (id) => {
    setLoading(true);
    try { setAlbum(await albumTracks(id)); }
    catch { setErr('Could not open this album'); }
    finally { setLoading(false); }
  };

  /* Catalogue entries are metadata; resolve to real streams before playing. */
  const playEntries = async (entries, i) => {
    setLoading(true);
    try {
      const from = entries.slice(i);
      const playable = await toPlayableList(from, { limit: 15 });
      if (!playable.length) { setErr('Could not find a stream for that'); return; }
      player.setRadio(true);
      player.play(playable[0], playable);
      if (playable[1]?.id) prefetchAudio(playable[1].id, 0);
    } finally { setLoading(false); }
  };

  if (!catalogueReady()) return <NeedsRelay what="Artist pages" />;

  /* ---- one album ---- */
  if (album) return (<>
    <button className="btn ghost sm" onClick={() => setAlbum(null)} style={{ marginBottom: 10 }}>
      <Icon n="back" size={15} /> {page?.name || 'Back'}</button>
    <div className="hubhead">
      {album.art
        ? <img src={album.art} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover' }} />
        : <div className="hubico"><Icon n="disc" size={24} /></div>}
      <div style={{ minWidth: 0 }}>
        <b>{album.name}</b>
        <span className="dim sm">{album.artist}{album.year ? ` · ${album.year}` : ''} · {album.tracks.length} songs</span>
      </div>
    </div>
    {loading && <Spin t="Finding streams" />}
    <button className="btn" style={{ width: '100%', marginBottom: 10 }}
      onClick={() => playEntries(album.tracks, 0)}>
      <Icon n="play" size={16} /> Play album</button>
    <EntryList entries={album.tracks} onPlay={(e, i) => playEntries(album.tracks, i)} />
  </>);

  /* ---- one artist ---- */
  if (open) return (<>
    <button className="btn ghost sm" onClick={() => { setOpen(null); setPage(null); }}
      style={{ marginBottom: 10 }}><Icon n="back" size={15} /> Artists</button>
    {loading && !page && <Spin t="Loading artist" />}
    {err && <div className="note bad">{err}</div>}
    {page && (<>
      <div className="hubhead">
        {page.art
          ? <img src={page.art} alt="" style={{ width: 68, height: 68, borderRadius: '50%', objectFit: 'cover' }} />
          : <div className="hubico"><Icon n="smile" size={26} /></div>}
        <div style={{ minWidth: 0 }}>
          <b>{page.name}</b>
          <span className="dim sm">
            {page.fans ? `${fmt(page.fans)} fans · ` : ''}{page.tracks.length} songs · {page.albums.length} albums
          </span>
        </div>
      </div>

      {page.tracks.length > 0 && (<>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button className="btn sm" style={{ flex: 1 }} onClick={() => playEntries(page.tracks, 0)}>
            <Icon n="play" size={15} /> Play top songs</button>
          <button className="btn ghost sm" onClick={() => {
            const sh = [...page.tracks].sort(() => Math.random() - 0.5);
            player.setShuffle(true); playEntries(sh, 0);
          }}><Icon n="swap" size={15} /> Shuffle</button>
        </div>
        {loading && <Spin t="Finding streams" />}
        <div className="chead">Top songs</div>
        <EntryList entries={page.tracks} onPlay={(e, i) => playEntries(page.tracks, i)} />
      </>)}

      {page.albums.length > 0 && (<>
        <div className="chead" style={{ marginTop: 16 }}>Albums · {page.albums.length}</div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(116px,1fr))' }}>
          {page.albums.map((a) => (
            <button className="tile" key={a.id} onClick={() => openAlbum(a.id)}
              style={{ padding: 0, minHeight: 0, display: 'block', overflow: 'hidden' }}>
              {a.art
                ? <img src={a.art} alt="" loading="lazy"
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                : <div style={{ aspectRatio: '1', background: 'var(--s2)', display: 'grid', placeItems: 'center' }}>
                    <Icon n="disc" size={22} /></div>}
              <div style={{ padding: 7, textAlign: 'left' }}>
                <b style={{ fontSize: 11, display: 'block', lineHeight: 1.25 }}>{a.name.slice(0, 36)}</b>
                <span className="dim" style={{ fontSize: 9.5 }}>{a.year}{a.tracks ? ` · ${a.tracks}` : ''}</span>
              </div>
            </button>))}
        </div>
      </>)}

      {page.related.length > 0 && (<>
        <div className="chead" style={{ marginTop: 16 }}>Similar artists</div>
        <div className="cats">
          {page.related.map((a) => (
            <button key={a.id} className="cat" onClick={() => openArtist(a.id)}>{a.name}</button>))}
        </div>
      </>)}
    </>)}
  </>);

  /* ---- artist search / shortcuts ---- */
  return (<>
    <div className="fld">
      <div className="ip-wrap">
        <Icon n="search" size={17} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { find(q); e.target.blur(); } }}
          placeholder="Search any artist…" enterKeyHint="search" />
      </div>
    </div>

    {busy && <Spin t="Searching artists" />}
    {err === 'no-proxy' && <NeedsRelay what="Artist search" />}
    {err && err !== 'no-proxy' && <div className="note bad">{err}</div>}

    {list?.length > 0 && (
      <div className="list">
        {list.map((a) => (
          <div className="row" key={a.id} onClick={() => openArtist(a.id)} style={{ cursor: 'pointer' }}>
            {a.art
              ? <img src={a.art} alt="" loading="lazy"
                  style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
              : <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--s3)',
                  display: 'grid', placeItems: 'center' }}><Icon n="smile" size={20} /></div>}
            <div className="main">
              <b style={{ fontSize: 13.5 }}>{a.name}</b>
              <span className="dim sm">{a.fans ? `${fmt(a.fans)} fans` : ''}{a.albums ? ` · ${a.albums} albums` : ''}</span>
            </div>
            <Icon n="chevron" size={15} style={{ opacity: .5 }} />
          </div>))}
      </div>)}

    {!list && !busy && (<>
      <div className="chead" style={{ marginTop: 4 }}>Popular artists</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(112px,1fr))' }}>
        {TOP_ARTISTS.map((n) => (
          <button className="tile" key={n} onClick={() => { setQ(n); find(n); }}>
            <span className="ic"><Icon n="smile" size={20} /></span>
            <b style={{ fontSize: 11.5 }}>{n}</b>
          </button>))}
      </div>
    </>)}
  </>);
}

/** Catalogue rows (metadata, matched to a stream on tap). */
function EntryList({ entries, onPlay }) {
  if (!entries?.length) return null;
  return (
    <div className="list">
      {entries.map((e, i) => (
        <div className="row" key={(e.dzid || i) + ''} onClick={() => onPlay(e, i)}
          style={{ cursor: 'pointer' }}>
          <span className="chartno">{i + 1}</span>
          {e.art
            ? <img src={e.art} alt="" loading="lazy"
                style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
            : <div style={{ width: 42, height: 42, borderRadius: 8, background: 'var(--s3)' }} />}
          <div className="main">
            <b style={{ fontSize: 13 }}>{(e.title || '').slice(0, 46)}</b>
            <span className="dim sm">
              {e.artist}{e.album ? ` · ${e.album.slice(0, 22)}` : ''}
              {e.dur ? ` · ${mmss(e.dur)}` : ''}
            </span>
          </div>
          <Icon n="play" size={17} style={{ color: 'var(--fg2)' }} />
        </div>))}
    </div>);
}

/** Shown when a catalogue feature needs the relay and none is configured. */
function NeedsRelay({ what }) {
  return (
    <Card>
      <div className="chead"><Icon n="info" size={16} /> {what} needs a relay</div>
      <div className="dim sm" style={{ lineHeight: 1.6 }}>
        The music catalogue is fetched through a relay. One ships with the app,
        so this normally just works — if you see this, the relay has been turned
        off in <b>Library → Speed</b>. Turn it back on or point it at your own.
      </div>
    </Card>);
}
