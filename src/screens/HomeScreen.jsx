/**
 * Home — the screen you open the app for.
 *
 * Structure, top to bottom:
 *   greeting → Continue listening → Daily Mix hero → quick vibes →
 *   "Jump back in" shelf → "Made for you" shelf → top artists orbit →
 *   browse tiles (Charts / Genres / Playlists / Radio / Artists)
 *
 * Recommendations load from preferences the same way the old Home tab did,
 * but they land in a shelf instead of a wall — scannable, not overwhelming.
 * Everything shows a shimmer while it loads; nothing ever pops in blank.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { SectionHead, Shelf, ShelfCard, ShelfSkeleton, playList, greeting, CoverGrad } from '../ui/bits';
import { usePlayer, lastSession } from '../core/player';
import { searchMusic } from '../core/music';
import { prefetchAudio, rememberTrack } from '../core/audio-resolve';
import { getPreferences } from '../core/preferences';
import { favourites, history, topPlayed, listenStats, onLibrary } from '../core/library';

export default function HomeScreen({ go }) {
  const player = usePlayer();
  const [prefs] = useState(() => getPreferences());
  const [recs, setRecs] = useState(null);
  const [mixBusy, setMixBusy] = useState(false);
  const [, bump] = useState(0);
  const seq = useRef(0);
  useEffect(() => onLibrary(() => bump((n) => n + 1)), []);

  const [session] = useState(() => lastSession());
  const freshSession = session?.track && (Date.now() - (session.ts || 0) < 7 * 864e5);

  /* Recommendations: three parallel probes seeded by the user's own taste. */
  useEffect(() => {
    const my = ++seq.current;
    (async () => {
      const queries = [];
      if (prefs.languages.length) queries.push(`${prefs.languages[Math.floor(Math.random() * prefs.languages.length)]} hits`);
      if (prefs.genres.length) queries.push(prefs.genres[Math.floor(Math.random() * prefs.genres.length)]);
      if (prefs.moods.length) queries.push(`${prefs.moods[Math.floor(Math.random() * prefs.moods.length)]} songs`);
      if (prefs.artists.length) queries.push(prefs.artists[Math.floor(Math.random() * prefs.artists.length)]);
      if (!queries.length) queries.push('trending', 'top hits');
      try {
        const rs = await Promise.allSettled(queries.slice(0, 3).map((q) => searchMusic(q, { deep: false })));
        if (my !== seq.current) return;
        const seen = new Set();
        const all = [];
        for (const r of rs) if (r.status === 'fulfilled' && r.value.tracks)
          for (const t of r.value.tracks) {
            const k = t.id || `${t.title}-${t.artist}`;
            if (!seen.has(k)) { seen.add(k); all.push(t); }
          }
        setRecs(all.slice(0, 14));
        all.slice(0, 2).forEach((t, i) => { if (t.id) { rememberTrack(t.id, t); prefetchAudio(t.id, i); } });
      } catch { setRecs([]); }
    })();
  }, []);   // eslint-disable-line

  /* Daily Mix: what this device actually plays, shuffled into one queue. */
  const buildMix = async () => {
    if (mixBusy) return;
    setMixBusy(true);
    try {
      const stats = listenStats();
      const favs = favourites();
      const seedPool = [
        ...stats.topArtists.map((a) => a.name),
        ...(prefs.artists || []),
        ...[...new Set(favs.map((t) => t.artist).filter(Boolean))],
      ].filter(Boolean);
      const pick = seedPool.length
        ? seedPool[Math.floor(Math.random() * seedPool.length)]
        : ['trending', 'top hits', 'punjabi hits'][Math.floor(Math.random() * 3)];
      const parts = [];
      try {
        const r = await searchMusic(pick, { deep: false });
        if (r?.tracks?.length) parts.push(...r.tracks.slice(0, 15));
      } catch {}
      const seen = new Set(parts.map((t) => t.id));
      for (const f of favs) if (f.id && !seen.has(f.id)) { parts.push(f); seen.add(f.id); }
      for (const h of history().slice(0, 8)) if (h.id && !seen.has(h.id)) { parts.push(h); seen.add(h.id); }
      const mix = parts.filter(Boolean).sort(() => Math.random() - 0.5);
      if (mix.length) { player.setRadio(true); player.play(mix[0], mix); }
    } finally { setMixBusy(false); }
  };

  const hist = history().slice(0, 10);
  const top = topPlayed(10);
  const stats = listenStats();

  /* The orbit: artists you actually spend time on, plus the ones you picked
     yourself — deduped, ten at most. */
  const artistOrbs = [
    ...stats.topArtists.map((a) => ({ name: a.name, sub: 'most heard' })),
    ...(prefs.artists || []).slice(0, 8).map((a) => ({ name: a, sub: 'your pick' })),
  ].filter((v, i, arr) => arr.findIndex((x) => x.name === v.name) === i).slice(0, 10);

  const playOrb = async (name) => {
    try {
      const r = await searchMusic(name, { deep: false });
      if (r?.tracks?.length) { player.setRadio(true); playList(player, r.tracks, 0); }
    } catch {}
  };
  const night = (() => { const h = new Date().getHours(); return h >= 21 || h < 5; })();
  const featured = recs?.[0];
  const heroTitle = night ? 'GOOD NIGHT' : 'SOUNDS BEYOND LIMITS';
  const heroSub = night
    ? 'Let the music take you somewhere better tonight.'
    : 'Your mix, rebuilt from what you actually play. Ad-free, endless.';
  const heroPlay = () => {
    if (night && freshSession && !player.track) { player.resumeSession(); return; }
    buildMix();
  };

  const MOODS = [
    ['Party', 'bolt'], ['Chill', 'moon'], ['Workout', 'bolt'], ['Romantic', 'heart'],
    ['Focus', 'sparkle'], ['Sleep', 'moon'],
  ];
  const [moodBusy, setMoodBusy] = useState(null);
  const startMood = async (m) => {
    if (moodBusy) return;
    setMoodBusy(m);
    try {
      const r = await searchMusic(`${m} songs`, { deep: false });
      if (r?.tracks?.length) { player.setRadio(true); playList(player, r.tracks, 0); }
    } finally { setMoodBusy(null); }
  };

  return (
    <div className="pageanim">
      {/* greeting + avatar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, margin: '10px 0 2px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="sb-h1" style={{ margin: 0 }}>{greeting()}</h1>
          <p className="sb-sub">Music feels better with you. No ads, no login — just your sound.</p>
        </div>
        <button className="avbtn" aria-label="Edit your taste" title="Edit your taste"
          onClick={() => go('taste')}>
          <Icon n="smile" size={19} /></button>
      </div>

      {/* cinematic hero — night gets its own sky */}
      {night ? (
        <div className="night-hero" onClick={heroPlay}>
          <span className="sky" /><span className="stars" /><span className="ridge" />
          <div className="inner">
            <div className="kick">Sleep mode</div>
            <h3>Good Night</h3>
            <p>{freshSession ? 'Pick up exactly where you left off.' : 'Soft songs for the hours nobody sees.'}</p>
            <button className="cta" onClick={(e) => { e.stopPropagation(); heroPlay(); }}>
              <Icon n="play" size={14} /> {freshSession ? 'Continue Listening' : 'Play Night Mix'}</button>
            <p className="quote">&ldquo;Music gives a soul to the universe, wings to the mind, flight to the imagination.&rdquo;</p>
          </div>
        </div>
      ) : (
        <div className="sb-hero" onClick={heroPlay}>
          {featured?.art
            ? <img className="bgimg" src={featured.art} alt="" loading="lazy" />
            : <div className="bgimg" style={{ background: 'linear-gradient(140deg, var(--s3), var(--s2) 60%, #000)' }} />}
          <span className="shade" />
          <div className="inner">
            <div className="kick">Your Daily Mix</div>
            <h3>{heroTitle}</h3>
            <p>{heroSub}</p>
            <button className="cta" onClick={(e) => { e.stopPropagation(); heroPlay(); }}>
              {mixBusy ? <span className="spin-sm" /> : <Icon n="play" size={14} />} Play Now</button>
          </div>
        </div>)}

      {/* mood starters */}
      <div className="cats" style={{ marginTop: 14 }}>
        <button className="cat on" onClick={() => go('genres')}>All</button>
        {MOODS.map(([m, ic]) => (
          <button key={m} className="cat" disabled={moodBusy === m} onClick={() => startMood(m)}>
            {moodBusy === m ? <span className="spin-sm" /> : <Icon n={ic} size={12} />} {m}
          </button>))}
      </div>

      {/* jump back in */}
      {hist.length > 0 && (<>
        <SectionHead icon="timer" title="Jump back in" />
        <Shelf>
          {hist.map((t, i) => (
            <ShelfCard key={t.id || i} art={t.art} title={t.title} sub={t.artist}
              delay={i} onPlay={() => playList(player, hist, i)} onClick={() => playList(player, hist, i)} />))}
        </Shelf>
      </>)}

      {/* made for you */}
      <SectionHead icon="sparkle" title="Made for you" />
      {recs === null
        ? <Shelf><ShelfSkeleton n={3} /></Shelf>
        : recs.length === 0
          ? <EmptyHint text="Nothing yet — pick a few artists in Search and this fills itself." />
          : <Shelf>
              {recs.map((t, i) => (
                <ShelfCard key={t.id || i} art={t.art} title={t.title}
                  sub={t.artist || '—'} delay={i}
                  onPlay={() => playList(player, recs, i)} onClick={() => playList(player, recs, i)} />))}
            </Shelf>}

      {/* artist orbit */}
      {artistOrbs.length > 0 && (<>
        <SectionHead icon="smile" title="Your orbit" more={null} />
        <Shelf>
          {artistOrbs.map((a, i) => {
            const initials = a.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
            return (
              <button key={a.name} className="orb" style={{ animationDelay: `${i * 40}ms` }} onClick={() => playOrb(a.name)}>
                <span className="ring"><span className="core">{initials}</span></span>
                <b>{a.name}</b>
                <small>{a.sub}</small>
              </button>);
          })}
        </Shelf>
      </>)}

      {/* most played */}
      {top.length > 0 && (<>
        <SectionHead icon="chart" title="On repeat" onMore={() => go('library', 'songs')} />
        <Shelf>
          {top.map((t, i) => (
            <ShelfCard key={t.id || i} art={t.art} title={t.title}
              sub={`${t.plays} plays`} delay={i}
              onPlay={() => playList(player, top, i)} onClick={() => playList(player, top, i)} />))}
        </Shelf>
      </>)}

      {/* browse */}
      <SectionHead icon="grid" title="Browse" />
      <div className="qgrid" style={{ marginBottom: 6 }}>
        {[
          ['charts', 'chart', 'Charts', 'What India is playing'],
          ['genres', 'disc', 'Genres', 'Pick a sound, get a queue'],
          ['playlists', 'list', 'Playlists', 'Ready-made, searchable'],
          ['radio', 'radio', 'Radio', 'Non-stop, never repeats'],
        ].map(([id, ic, t, s]) => (
          <button key={id} className="qtile" onClick={() => go(id)}>
            <span className="ic"><Icon n={ic} size={19} /></span>
            <span style={{ minWidth: 0 }}>
              <b>{t}</b><small>{s}</small>
            </span>
          </button>))}
        <button className="qtile" onClick={() => go('artists')}>
          <span className="ic"><Icon n="smile" size={19} /></span>
          <span style={{ minWidth: 0 }}>
            <b>Artists</b><small>Search the full catalogue</small>
          </span>
        </button>
        <button className="qtile" onClick={() => go('library', 'stats')}>
          <span className="ic"><Icon n="bolt" size={19} /></span>
          <span style={{ minWidth: 0 }}>
            <b>Your Stats</b><small>Minutes, artists, streaks</small>
          </span>
        </button>
      </div>
    </div>);
}

function EmptyHint({ text }) {
  return (
    <div className="sb-empty" style={{ padding: '26px 16px' }}>
      <div className="ic"><Icon n="sparkle" size={22} /></div>
      <span>{text}</span>
    </div>);
}
