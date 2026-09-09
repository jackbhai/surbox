/**
 * Library — everything that is yours, one screen.
 *
 * Songs (favourites / recent / most played) · Playlists (premium grid with
 * generated covers) · Downloads (offline) · Stats (listening time) ·
 * App (proxy speed, backup, install).
 *
 * The heavy views (Downloads, Stats, App) are the same battle-tested
 * components the old Library used — they ride on the shared classes, so the
 * v2 chrome around them is all that changed.
 */
import React, { useEffect, useState } from 'react';
import { Icon } from '../ui/icons';
import { SectionHead, playList, CoverGrad, hueOf, ViewToggle, TrackGrid, readListView } from '../ui/bits';
import { usePlayer } from '../core/player';
import {
  favourites, history, topPlayed, playlists, createPlaylist, deletePlaylist, removeFromPlaylist,
  clearHistory, onLibrary, libraryStats,
} from '../core/library';
import { TrackList, DownloadsView, StatsView, SpeedSetup, AppBits } from '../tools/music2';
import { downloadCount } from '../core/downloads';

const SEGS = [
  ['songs', 'Songs'], ['lists', 'Playlists'], ['down', 'Downloads'],
  ['stats', 'Stats'], ['app', 'App'],
];

export default function LibraryScreen({ initial = 'songs' }) {
  const player = usePlayer();
  const [seg, setSeg] = useState(SEGS.some(([id]) => id === initial) ? initial : 'songs');
  const [songView, setSongView] = useState('fav');
  const [view, setView] = useState(readListView);
  const [, bump] = useState(0);
  useEffect(() => onLibrary(() => bump((n) => n + 1)), []);

  const favs = favourites();
  const hist = history();
  const top = topPlayed(50);
  const pls = playlists();
  const stats = libraryStats();
  const rows = songView === 'fav' ? favs : songView === 'recent' ? hist : top;

  return (
    <div className="pageanim">
      <h1 className="sb-h1" style={{ margin: '10px 0 4px' }}>Your Library</h1>
      <p className="sb-sub">{stats.favourites} favourites · {stats.playlists} playlists · {stats.history} played</p>

      <div className="seg" style={{ margin: '16px 0 18px' }}>
        {SEGS.map(([id, l]) => (
          <button key={id} className={seg === id ? 'on' : ''} onClick={() => setSeg(id)}>{l}</button>))}
      </div>

      {/* ------------------------------------------------------- songs */}
      {seg === 'songs' && (<>
        {/* shortcuts — the three places people open the library FOR */}
        <div className="libcards">
          <button className="libcard" style={{ animationDelay: '0ms' }} onClick={() => setSongView('fav')}>
            <span className="cv c1"><Icon n="staron" size={26} /><b>{favs.length}</b></span>
            <span className="tx"><b>Liked Songs</b><small>The ones you never lose</small></span>
          </button>
          <button className="libcard" style={{ animationDelay: '60ms' }} onClick={() => setSeg('down')}>
            <span className="cv c2"><Icon n="download" size={26} /><b>{downloadCount()}</b></span>
            <span className="tx"><b>Downloads</b><small>Plays offline</small></span>
          </button>
          <button className="libcard" style={{ animationDelay: '120ms' }} onClick={() => setSongView('top')}>
            <span className="cv c3"><Icon n="chart" size={26} /><b>{top.length}</b></span>
            <span className="tx"><b>On Repeat</b><small>Your most played</small></span>
          </button>
        </div>
        <div className="cats" style={{ marginBottom: 12 }}>
          {[['fav', 'Favourites'], ['recent', 'Recent'], ['top', 'Most played']].map(([v, l]) => (
            <button key={v} className={`cat ${songView === v ? 'on' : ''}`} onClick={() => setSongView(v)}>{l}</button>))}
        </div>
        {rows.length === 0
          ? <div className="sb-empty">
              <div className="ic"><Icon n="star" size={24} /></div>
              <b>{songView === 'fav' ? 'No favourites yet' : 'Nothing played yet'}</b>
              <span>{songView === 'fav'
                ? 'Tap the star on any song — it lands here, forever.'
                : 'Play something and your history builds itself.'}</span>
            </div>
          : (<>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className="btn sm" style={{ flex: 1 }}
                onClick={() => playList(player, rows, 0)}>
                <Icon n="play" size={14} /> Play all</button>
              <button className="btn ghost sm" style={{ flex: 1 }} onClick={() => {
                const sh = [...rows].sort(() => Math.random() - 0.5);
                player.setShuffle(true); player.play(sh[0], sh);
              }}><Icon n="shuffle" size={14} /> Shuffle</button>
              {songView === 'recent' && rows.length > 0 && (
                <button className="btn ghost sm" aria-label="Clear history"
                  onClick={() => { if (confirm('Clear play history?')) clearHistory(); }}>
                  <Icon n="x" size={14} /></button>)}
              <ViewToggle view={view} onChange={setView} />
            </div>
            {view === 'grid'
              ? <TrackGrid tracks={rows} player={player} onPlay={(t, i) => playList(player, rows, i)} />
              : <TrackList tracks={rows} player={player}
                  onPlay={(t, i) => playList(player, rows, i)} />}
          </>)}
      </>)}

      {/* --------------------------------------------------- playlists */}
      {seg === 'lists' && <Playlists player={player} />}

      {/* --------------------------------------------------- downloads */}
      {seg === 'down' && <DownloadsView player={player} />}

      {/* ------------------------------------------------------- stats */}
      {seg === 'stats' && <StatsView player={player} />}

      {/* -------------------------------------------------------- app */}
      {seg === 'app' && (<><SpeedSetup /><AppBits /></>)}
    </div>);
}

/* ------------------------------------------------------------- playlists */
/**
 * Your playlists as a cover grid. A playlist has no artwork of its own, so
 * each one gets a cover generated from its name — a stable hue, so the
 * cover is recognisably THE same one every visit. Tapping opens the track
 * list; the play badge starts it.
 */
function Playlists({ player }) {
  const [, bump] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [newName, setNewName] = useState('');
  const [view, setView] = useState(readListView);
  useEffect(() => onLibrary(() => bump((n) => n + 1)), []);
  const pls = playlists();

  if (openId) {
    const pl = pls.find((p) => p.id === openId);
    if (!pl) { setOpenId(null); return null; }
    return (<>
      <button className="btn ghost sm" onClick={() => setOpenId(null)} style={{ marginBottom: 12 }}>
        <Icon n="back" size={14} /> All playlists</button>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ width: 92, height: 92, borderRadius: 20, overflow: 'hidden', flex: '0 0 auto', boxShadow: '0 10px 30px rgba(0,0,0,.5)' }}>
          <CoverGrad seed={pl.name} icon="list" size={34} /></div>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 17, display: 'block' }}>{pl.name}</b>
          <span className="dim sm">{pl.tracks.length} songs</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn sm" onClick={() => playList(player, pl.tracks, 0)}>
              <Icon n="play" size={14} /> Play</button>
            <button className="btn ghost sm" onClick={() => {
              const sh = [...pl.tracks].sort(() => Math.random() - 0.5);
              player.setShuffle(true); player.play(sh[0], sh);
            }}><Icon n="shuffle" size={14} /></button>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ViewToggle view={view} onChange={setView} /></div>
      {view === 'grid'
        ? <TrackGrid tracks={pl.tracks} player={player} onPlay={(t, i) => playList(player, pl.tracks, i)} />
        : <TrackList tracks={pl.tracks} player={player}
            onPlay={(t, i) => playList(player, pl.tracks, i)}
            onRemove={(t) => removeFromPlaylist(pl.id, t.id)} />}
      <button className="ghostcta" style={{ marginTop: 16 }}
        onClick={() => { if (confirm(`Delete "${pl.name}"?`)) { deletePlaylist(pl.id); setOpenId(null); } }}>
        <Icon n="trash" size={14} /> Delete this playlist</button>
    </>);
  }

  return (<>
    <div className="fld" style={{ margin: '2px 0 16px' }}>
      <div className="ip-wrap">
        <Icon n="plus" size={15} />
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { createPlaylist(newName); setNewName(''); } }}
          placeholder="New playlist name…" />
        <button className="ip-x" disabled={!newName.trim()} aria-label="Create"
          onClick={() => { if (newName.trim()) { createPlaylist(newName); setNewName(''); } }}>
          <Icon n="check" size={15} /></button>
      </div>
    </div>

    {pls.length === 0
      ? <div className="sb-empty">
          <div className="ic"><Icon n="list" size={24} /></div>
          <b>No playlists yet</b>
          <span>Name one above, then use the ＋ on any song to file it here.</span>
        </div>
      : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
          {pls.map((p) => (
            <div key={p.id} className="shelfcard" style={{ width: 'auto' }} onClick={() => setOpenId(p.id)}>
              <div className="cv" style={{ width: '100%', aspectRatio: '1' }}>
                <CoverGrad seed={p.name} icon="list" size={30} />
                {p.tracks.length > 0 && (
                  <button className="play" aria-label="Play" onClick={(e) => { e.stopPropagation(); playList(player, p.tracks, 0); }}>
                    <Icon n="play" size={14} /></button>)}
              </div>
              <b>{p.name}</b>
              <small>{p.tracks.length} songs</small>
            </div>))}
        </div>}
  </>);
}
