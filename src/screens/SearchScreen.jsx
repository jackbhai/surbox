/**
 * Search — the front door to 30+ catalogues.
 *
 * A big glass field with the mic beside it (voice search, Indian English),
 * live suggestions from the mirrors while you type, recent searches as
 * chips below, and results in the shared premium TrackList with infinite
 * scroll. The first two results are warmed before you tap them.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import { SectionHead } from '../ui/bits';
import { usePlayer } from '../core/player';
import { searchMusic, suggest } from '../core/music';
import { catalogueReady, searchCatalogue, toPlayableList } from '../core/catalogue';
import { prefetchAudio, rememberTrack } from '../core/audio-resolve';
import { TrackList } from '../tools/music2';
import { Spin, Err } from '../ui/kit';

const K_SEARCHES = 'omni:searches';
const readSearches = () => { try { return JSON.parse(localStorage.getItem(K_SEARCHES) || '[]'); } catch { return []; } };
const writeSearches = (v) => { try { localStorage.setItem(K_SEARCHES, JSON.stringify(v)); } catch {} };

const QUICK = ['babbu maan', 'sidhu moose wala', 'diljit dosanjh', 'arijit singh',
  'karan aujla', 'ap dhillon', 'coke studio', 'shubh', 'nusrat', 'lofi punjabi'];

export default function SearchScreen() {
  const player = usePlayer();
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tips, setTips] = useState([]);
  const [focused, setFocused] = useState(false);
  const [more, setMore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [recent, setRecent] = useState(readSearches);
  const [listening, setListening] = useState(false);
  const nextRef = useRef(null);
  const seq = useRef(0);
  const abortRef = useRef(null);
  const heardRef = useRef('');
  const recogRef = useRef(null);

  const run = useCallback(async (term) => {
    const s = String(term || '').trim();
    if (!s) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const my = ++seq.current;
    setBusy(true); setErr(''); setTips([]); setFocused(false);
    setTracks(null);
    try {
      const r = await searchMusic(s, { deep: false });
      if (ctrl.signal.aborted || my !== seq.current) return;
      if (r.tracks?.length) {
        setTracks(r.tracks);
        nextRef.current = r.next;
        setMore(r.next ? true : false);
        setRecent([s, ...readSearches().filter((x) => x !== s)].slice(0, 10));
        writeSearches([s, ...readSearches().filter((x) => x !== s)].slice(0, 10));
        r.tracks.slice(0, 2).forEach((t, i) => { if (t.id) { rememberTrack(t.id, t); prefetchAudio(t.id, i); } });
        setBusy(false);
        // background enrichment — catalogue hits join the list without a wait
        if (catalogueReady()) {
          searchCatalogue(s, { limit: 30 })
            .then(async (entries) => {
              if (ctrl.signal.aborted || my !== seq.current || !entries.length) return;
              const extra = await toPlayableList(entries, { limit: 12 });
              if (ctrl.signal.aborted || my !== seq.current) return;
              setTracks((cur) => {
                if (!cur) return cur;
                const seen = new Set(cur.map((t) => t.id || t.url));
                const add = extra.filter((t) => !seen.has(t.id || t.url));
                return add.length ? [...cur, ...add] : cur;
              });
            })
            .catch(() => {});
        }
      } else {
        setTracks([]); setBusy(false); setMore(false);
      }
    } catch (e) {
      if (my === seq.current) { setErr(e.message || 'Search failed'); setTracks([]); setBusy(false); }
    }
  }, []);

  /* live suggestions while typing */
  useEffect(() => {
    if (!focused || q.trim().length < 2) { setTips([]); return; }
    const t = setTimeout(() => {
      suggest(q).then((s) => setTips(Array.isArray(s) ? s : []));
    }, 240);
    return () => clearTimeout(t);
  }, [q, focused]);

  /* voice search — platform recogniser, Indian English, interim in the box */
  const micSearch = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('Voice search needs Chrome or Edge — type instead'); return; }
    if (listening) { try { recogRef.current?.stop(); } catch {} return; }
    const r = new SR();
    recogRef.current = r;
    r.lang = 'en-IN';
    r.interimResults = true;
    r.maxAlternatives = 1;
    heardRef.current = '';
    r.onresult = (e) => {
      let txt = '';
      for (const res of e.results) txt += res[0].transcript;
      heardRef.current = txt;
      setQ(txt);
    };
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      const s = heardRef.current.trim();
      if (s) run(s);
    };
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };

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

  return (
    <div className="pageanim">
      <h1 className="sb-h1" style={{ margin: '10px 0 14px' }}>Search</h1>

      <div className="sb-search">
        <div className="box">
          <Icon n="search" size={17} style={{ color: 'var(--fg3)' }} />
          <input value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 140)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setTips([]); setFocused(false); run(q); e.target.blur(); }
              if (e.key === 'Escape') { setTips([]); setFocused(false); e.target.blur(); }
            }}
            placeholder="Any song, artist or album…" enterKeyHint="search" autoComplete="off" />
          {q && (
            <button className="mic" style={{ background: 'transparent', color: 'var(--fg3)' }}
              onClick={() => { setQ(''); setTips([]); setTracks(null); }} aria-label="Clear">
              <Icon n="x" size={14} /></button>)}
          <button className={`mic ${listening ? 'rec' : ''}`} onClick={micSearch}
            aria-label="Voice search" title={listening ? 'Listening — tap to stop' : 'Search by voice'}>
            <Icon n="mic" size={15} /></button>
        </div>
        {focused && tips.length > 0 && (
          <div className="tips">
            {tips.map((s) => (
              <button key={s} onMouseDown={(e) => { e.preventDefault(); setQ(s); setTips([]); setFocused(false); run(s); }}>
                <Icon n="search" size={13} style={{ opacity: .5 }} /> {s}
              </button>))}
          </div>)}
      </div>

      {tracks === null && (<>
        {recent.length > 0 && (<>
          <SectionHead icon="timer" title="Recent" />
          <div className="cats">
            {recent.map((x) => (
              <button key={x} className="cat" style={{ textTransform: 'none' }}
                onClick={() => { setQ(x); run(x); }}>{x}</button>))}
            <button className="cat" aria-label="Clear history" title="Clear search history"
              onClick={() => { writeSearches([]); setRecent([]); }}>
              <Icon n="trash" size={12} /></button>
          </div>
        </>)}
        <SectionHead icon="bolt" title="Try" />
        <div className="cats">
          {QUICK.map((x) => (
            <button key={x} className="cat" style={{ textTransform: 'none' }}
              onClick={() => { setQ(x); run(x); }}>{x}</button>))}
        </div>
      </>)}

      {busy && !tracks && (
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel row" style={{ animationDelay: `${i * 90}ms` }} />)}
        </div>)}
      {err && tracks?.length !== 0 && <div style={{ marginTop: 12 }}><Err error={err} retry={() => run(q)} /></div>}
      {tracks?.length === 0 && !busy && (
        <div className="sb-empty" style={{ marginTop: 30 }}>
          <div className="ic"><Icon n="search" size={24} /></div>
          <b>Nothing found for &ldquo;{q}&rdquo;</b>
          <span>Try the artist name, or a few words of the song. Voice search helps with spellings.</span>
        </div>)}

      {tracks?.length > 0 && (<>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 10px' }}>
          <span className="dim sm" style={{ flex: 1 }}>{tracks.length} songs for &ldquo;{q}&rdquo;</span>
          <button className="btn ghost sm" onClick={() => {
            const sh = [...tracks].sort(() => Math.random() - 0.5);
            player.setShuffle(true); player.play(sh[0], sh);
          }}><Icon n="shuffle" size={14} /> Shuffle all</button>
        </div>
        <TrackList tracks={tracks} player={player} loading={loadingMore} more={more}
          onMore={loadMore}
          onPlay={(t, i) => player.play(t, tracks)} />
      </>)}
    </div>);
}
