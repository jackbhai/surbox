/**
 * Home Tab — Personalized Music Recommendations
 * 
 * Shows a personalized home screen based on user preferences:
 * - Recommended songs based on languages, genres, moods
 * - Favorite artists' latest/top songs
 * - Quick play buttons for mood-based mixes
 * - Genre shortcuts
 * - "Set up preferences" prompt for new users
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '../ui/icons';
import { Card, Spin, Empty, Err } from '../ui/kit';
import { usePlayer } from '../core/player';
import { searchMusic } from '../core/music';
import { catalogueReady, searchCatalogue, toPlayableList, TOP_ARTISTS } from '../core/catalogue';
import { prefetchAudio, rememberTrack } from '../core/audio-resolve';
import {
  getPreferences, hasPreferences, buildPreferenceQuery,
  getSuggestedArtists, AVAILABLE_LANGUAGES, AVAILABLE_MOODS,
} from '../core/preferences';
import { PreferencesEditor } from './music-prefs';
import { favourites, isFav, toggleFav, history, topPlayed } from '../core/library';
import { onLibrary } from '../core/library';

const mmss = (s) => (!s ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

export function HomeTab({ player }) {
  const [prefs, setPrefs] = useState(getPreferences());
  const [showSetup, setShowSetup] = useState(false);
  const [recs, setRecs] = useState(null);
  const [artistSongs, setArtistSongs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mood, setMood] = useState(null);
  const [moodTracks, setMoodTracks] = useState(null);
  const [moodBusy, setMoodBusy] = useState(false);
  const [, bump] = useState(0);
  const seq = useRef(0);

  useEffect(() => onLibrary(() => bump((n) => n + 1)), []);

  const hasPrefs = hasPreferences();

  /* Load personalized recommendations */
  const loadRecs = useCallback(async () => {
    if (!hasPrefs) return;
    const my = ++seq.current;
    setBusy(true); setErr('');
    try {
      const p = getPreferences();
      const queries = [];

      // Build smart queries from preferences
      if (p.languages.length > 0) {
        const lang = p.languages[Math.floor(Math.random() * p.languages.length)];
        queries.push(`${lang} hits`);
      }
      if (p.genres.length > 0) {
        const genre = p.genres[Math.floor(Math.random() * p.genres.length)];
        queries.push(genre);
      }
      if (p.moods.length > 0) {
        const m = p.moods[Math.floor(Math.random() * p.moods.length)];
        queries.push(`${m} songs`);
      }
      if (p.artists.length > 0) {
        const art = p.artists[Math.floor(Math.random() * p.artists.length)];
        queries.push(art);
      }

      if (queries.length === 0) queries.push('trending');

      // Fetch from multiple queries in parallel
      const results = await Promise.allSettled(
        queries.slice(0, 3).map(q => searchMusic(q, { deep: false }))
      );

      if (my !== seq.current) return;

      const allTracks = [];
      const seen = new Set();
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.tracks) {
          for (const t of r.value.tracks) {
            const key = t.id || `${t.title}-${t.artist}`;
            if (!seen.has(key)) {
              seen.add(key);
              allTracks.push(t);
            }
          }
        }
      }

      setRecs(allTracks.slice(0, 20));

      // Warm top 2
      allTracks.slice(0, 2).forEach((t, i) => {
        if (t.id) { rememberTrack(t.id, t); prefetchAudio(t.id, i); }
      });

      // Also load catalogue enrichment if available
      if (catalogueReady() && p.languages.length > 0) {
        const lang = p.languages[0];
        searchCatalogue(`${lang} hits`, { limit: 15 })
          .then(async (entries) => {
            if (my !== seq.current || !entries.length) return;
            const extra = await toPlayableList(entries, { limit: 8 });
            if (my !== seq.current) return;
            setRecs((cur) => {
              if (!cur) return cur;
              const seen2 = new Set(cur.map((t) => t.id));
              const add = extra.filter((t) => t?.id && !seen2.has(t.id));
              return add.length ? [...cur, ...add].slice(0, 25) : cur;
            });
          })
          .catch(() => {});
      }
    } catch (e) {
      if (my === seq.current) setErr(e.message || 'Could not load recommendations');
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [hasPrefs]);

  /* Load songs from favorite artists */
  const loadArtistSongs = useCallback(async () => {
    const p = getPreferences();
    if (p.artists.length === 0) return;
    const my = ++seq.current;
    try {
      const artist = p.artists[Math.floor(Math.random() * p.artists.length)];
      const r = await searchMusic(artist, { deep: false });
      if (my !== seq.current) return;
      if (r.tracks?.length) {
        setArtistSongs({ artist, tracks: r.tracks.slice(0, 8) });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (hasPrefs) {
      loadRecs();
      loadArtistSongs();
    }
  }, [hasPrefs, loadRecs, loadArtistSongs]);

  /* Load mood-based playlist */
  const loadMood = async (m) => {
    setMood(m); setMoodBusy(true); setMoodTracks(null);
    try {
      const p = getPreferences();
      const query = p.languages.length > 0
        ? `${p.languages[0]} ${m} songs`
        : `${m} songs`;
      const r = await searchMusic(query, { deep: false });
      if (r.tracks?.length) {
        setMoodTracks(r.tracks.slice(0, 15));
        r.tracks.slice(0, 2).forEach((t, i) => {
          if (t.id) { rememberTrack(t.id, t); prefetchAudio(t.id, i); }
        });
      }
    } catch { setMoodTracks([]); }
    finally { setMoodBusy(false); }
  };

  const playList = (list, i = 0) => {
    player.setRadio(true);
    player.play(list[i], list);
    const nx = list[i + 1];
    if (nx?.id) { rememberTrack(nx.id, nx); prefetchAudio(nx.id, 0); }
  };

  /* ---- Setup screen ---- */
  if (showSetup) {
    return (
      <PreferencesEditor
        onClose={() => { setShowSetup(false); setPrefs(getPreferences()); }}
        onChange={(p) => setPrefs(p)}
      />
    );
  }

  /* ---- Mood view ---- */
  if (mood) {
    return (<>
      <button className="btn ghost sm" onClick={() => { setMood(null); setMoodTracks(null); }}
        style={{ marginBottom: 10 }}>
        <Icon n="back" size={15} /> Back to Home
      </button>
      <div className="hubhead">
        <div className="hubico"><Icon n="heart" size={24} /></div>
        <div>
          <b>{mood} Mix</b>
          <span className="dim sm">{moodTracks?.length || 0} songs</span>
        </div>
      </div>
      {moodBusy && <Spin t={`Loading ${mood} songs`} />}
      {moodTracks?.length > 0 && (<>
        <button className="btn" style={{ width: '100%', marginBottom: 10 }}
          onClick={() => playList(moodTracks, 0)}>
          <Icon n="play" size={16} /> Play all {moodTracks.length}
        </button>
        <div className="list">
          {moodTracks.map((t, i) => (
            <TrackRow key={t.id || i} track={t} player={player}
              onPlay={() => playList(moodTracks, i)} />
          ))}
        </div>
      </>)}
      {moodTracks?.length === 0 && !moodBusy && <Empty t={`No ${mood} songs found`} />}
    </>);
  }

  /* ---- No preferences set ---- */
  if (!hasPrefs) {
    return (<>
      <Card>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%',
            background: 'var(--s3)', display: 'grid', placeItems: 'center',
            margin: '0 auto 16px', color: 'var(--green)' }}>
            <Icon n="cog" size={28} />
          </div>
          <b style={{ fontSize: 17, display: 'block', marginBottom: 8 }}>
            Set Up Your Music Preferences
          </b>
          <div className="dim sm" style={{ lineHeight: 1.7, maxWidth: 320, margin: '0 auto' }}>
            Tell us what you love — languages, artists, genres, moods — and we will
            show you personalized songs and recommendations right here on your home screen.
          </div>
          <button className="btn" style={{ marginTop: 18, padding: '10px 32px' }}
            onClick={() => setShowSetup(true)}>
            <Icon n="cog" size={16} /> Set Up Preferences
          </button>
        </div>
      </Card>

      {/* Quick start suggestions */}
      <div className="chead" style={{ marginTop: 16 }}>Or try these</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))' }}>
        {['Punjabi Hits', 'Bollywood', 'Lo-Fi', 'Sufi', '90s Hindi', 'Party Mix'].map((label) => (
          <QuickCard key={label} label={label} player={player} />
        ))}
      </div>
    </>);
  }

  /* ---- Personalized home ---- */
  return (<>
    {/* Header with edit button */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <Icon n="cog" size={18} style={{ color: 'var(--green)' }} />
      <b style={{ fontSize: 15, flex: 1 }}>For You</b>
      <button className="btn ghost sm" onClick={() => setShowSetup(true)}
        style={{ fontSize: 11 }}>
        <Icon n="cog" size={13} /> Edit
      </button>
    </div>

    {/* Preference summary */}
    <div className="dim sm" style={{ marginBottom: 14, lineHeight: 1.6 }}>
      {prefs.languages.length > 0 && `Languages: ${prefs.languages.join(', ')} · `}
      {prefs.artists.length > 0 && `${prefs.artists.length} favorite artists · `}
      {prefs.genres.length > 0 && `Genres: ${prefs.genres.slice(0, 3).join(', ')}${prefs.genres.length > 3 ? '…' : ''}`}
    </div>

    {/* Quick mood buttons */}
    {prefs.moods.length > 0 && (<>
      <div className="chead">Quick Mix</div>
      <div className="cats" style={{ marginBottom: 14 }}>
        {prefs.moods.map((m) => (
          <button key={m} className="cat" onClick={() => loadMood(m)}>
            <Icon n="heart" size={13} /> {m}
          </button>
        ))}
        {AVAILABLE_MOODS.filter((m) => !prefs.moods.includes(m)).slice(0, 3).map((m) => (
          <button key={m} className="cat" onClick={() => loadMood(m)}
            style={{ opacity: 0.6 }}>
            {m}
          </button>
        ))}
      </div>
    </>)}

    {/* Recommended songs */}
    <div className="chead">Recommended For You</div>
    {busy && <Spin t="Finding songs for you" />}
    {err && <Err error={err} retry={loadRecs} />}
    {recs?.length > 0 && (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 8px' }}>
        <span className="dim sm" style={{ flex: 1 }}>{recs.length} songs</span>
        <button className="btn ghost sm" onClick={() => playList(recs, 0)}>
          <Icon n="play" size={14} /> Play all</button>
        <button className="btn ghost sm" onClick={() => {
          const sh = [...recs].sort(() => Math.random() - 0.5);
          player.setShuffle(true); playList(sh, 0);
        }}><Icon n="swap" size={14} /> Shuffle</button>
        <button className="btn ghost sm" onClick={loadRecs}
          style={{ fontSize: 11 }}>
          <Icon n="refresh" size={13} /> Refresh
        </button>
      </div>
      <div className="list">
        {recs.map((t, i) => (
          <TrackRow key={t.id || i} track={t} player={player}
            onPlay={() => playList(recs, i)} />
        ))}
      </div>
    </>)}
    {recs?.length === 0 && !busy && !err && (
      <Empty t="No recommendations yet — try adding more preferences" />
    )}

    {/* Favorite artist songs */}
    {artistSongs?.tracks?.length > 0 && (<>
      <div className="chead" style={{ marginTop: 18 }}>
        <Icon n="smile" size={14} /> {artistSongs.artist}
      </div>
      <div className="list">
        {artistSongs.tracks.map((t, i) => (
          <TrackRow key={t.id || i} track={t} player={player}
            onPlay={() => playList(artistSongs.tracks, i)} />
        ))}
      </div>
    </>)}

    {/* Recently played */}
    {history().length > 0 && (<>
      <div className="chead" style={{ marginTop: 18 }}>Recently Played</div>
      <div className="list">
        {history().slice(0, 5).map((t, i) => (
          <TrackRow key={t.id || i} track={t} player={player}
            onPlay={() => playList(history().slice(0, 10), i)} />
        ))}
      </div>
    </>)}

    {/* Top played */}
    {topPlayed(5).length > 0 && (<>
      <div className="chead" style={{ marginTop: 18 }}>Your Most Played</div>
      <div className="list">
        {topPlayed(5).map((t, i) => (
          <TrackRow key={t.id || i} track={t} player={player}
            onPlay={() => playList(topPlayed(10), i)} />
        ))}
      </div>
    </>)}
  </>);
}

/* ---- Track row component ---- */
function TrackRow({ track, player, onPlay }) {
  const active = player.track && (player.track.id ?? player.track.url) === (track.id ?? track.url);
  return (
    <div className="row" onClick={onPlay}
      style={{ cursor: 'pointer', background: active ? 'rgba(0,255,156,.07)' : '' }}>
      {track.art
        ? <img src={track.art} alt="" loading="lazy"
            style={{ width: 44, height: 44, borderRadius: 9, objectFit: 'cover',
                     flex: '0 0 auto', background: 'var(--s3)' }}
            onError={(e) => { e.target.style.visibility = 'hidden'; }} />
        : <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--s3)',
            display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
            <Icon n="music" size={18} style={{ opacity: .55 }} /></div>}
      <div className="main">
        <b style={{ fontSize: 13, color: active ? 'var(--green)' : '' }}>
          {(track.title || '').slice(0, 50)}</b>
        <span className="dim sm">
          {track.artist || ''}
          {track.dur ? ` · ${mmss(track.dur)}` : ''}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {track.id && (
          <button className="rowbtn"
            onClick={(e) => { e.stopPropagation(); toggleFav(track); }}
            aria-label={isFav(track.id) ? 'Remove favourite' : 'Add favourite'}>
            <Icon n={isFav(track.id) ? 'staron' : 'star'} size={15}
              style={{ color: isFav(track.id) ? 'var(--green)' : 'var(--fg3)' }} />
          </button>)}
        <span style={{ color: active && player.playing ? 'var(--green)' : 'var(--fg2)',
                       display: 'grid', placeItems: 'center', paddingLeft: 3 }}>
          <Icon n={active && player.playing ? 'pause' : 'play'} size={17} /></span>
      </div>
    </div>
  );
}

/* ---- Quick card for suggestions ---- */
function QuickCard({ label, player }) {
  const [busy, setBusy] = useState(false);

  const play = async () => {
    setBusy(true);
    try {
      const r = await searchMusic(label, { deep: false });
      if (r.tracks?.length) {
        const shuffled = [...r.tracks].sort(() => Math.random() - 0.5);
        player.setRadio(true);
        player.play(shuffled[0], shuffled);
        if (shuffled[1]?.id) prefetchAudio(shuffled[1].id, 0);
      }
    } catch {}
    finally { setBusy(false); }
  };

  return (
    <button className="tile" onClick={play} disabled={busy}>
      <span className="ic">
        {busy ? <span className="spin-sm" /> : <Icon n="play" size={20} />}
      </span>
      <b style={{ fontSize: 11 }}>{label}</b>
    </button>
  );
}
