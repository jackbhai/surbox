import React, { useEffect, useRef, useState } from 'react';
import { usePlayer, chain, PRESETS } from '../core/player';
import { isFav, toggleFav } from '../core/library';
import { downloadTrack, removeDownload, isDownloaded, isDownloading, onDownloads } from '../core/downloads';
import { resolveAudio } from '../core/audio-resolve';
import { radioQueue } from '../core/music';
import { useArtTheme, artStyle } from '../core/art-theme';
import { Icon } from './icons';

const mmss = (s) => (!s || !isFinite(s)) ? '0:00'
  : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------- mini bar */
export function MiniPlayer() {
  const p = usePlayer();
  if (!p?.track) return null;
  if (p.miniHidden && !p.full) {
    // Hidden but still playing — show tiny restore pill
    return (
      <div className="mini mini-hidden">
        <button className="mini-restore" onClick={() => p.setMiniHidden(false)} title="Show player">
          <Icon n="music" size={14} /> {p.playing ? 'Playing' : 'Paused'} · {p.track.title?.slice(0,20) || 'Music'}
        </button>
        <button className="mini-btn" onClick={() => p.setMiniHidden(false)} aria-label="Expand">
          <Icon n="up" size={14} />
        </button>
        <button className="mini-btn" onClick={(e) => { e.stopPropagation(); p.stop?.(); }} aria-label="Stop">
          <Icon n="x" size={14} />
        </button>
      </div>
    );
  }
  // When collapsed, the IFrame must stay mounted (off-screen) so playback
  // continues while the user browses other tools.
  const hidden = p.yt && !p.full ? (
    <div className="yt-hidden">
      <iframe id="yt-frame" title="player" allow="autoplay; encrypted-media"
        src={`https://www.youtube-nocookie.com/embed/${p.yt}?autoplay=1&enablejsapi=1&playsinline=1&rel=0`} />
    </div>) : null;
  const pct = p.dur ? (p.pos / p.dur) * 100 : 0;
  return (<>
    {hidden}
    <div className="mini" onClick={() => p.setFull(true)}>
      <div className="mini-prog"><i style={{ width: pct + '%' }} /></div>
      <div className="mini-row">
        {p.track.art
          ? <img className={`mini-art ${p.playing ? 'spin' : ''}`} src={p.track.art} alt=""
              onError={(e) => { e.target.style.visibility = 'hidden'; }} />
          : <div className={`mini-ph ${p.playing ? 'spin' : ''}`}><Icon n="music" size={17} /></div>}
        <div className="mini-txt">
          <b className="mini-ttl"><span>{p.track.title || p.track.name}</span></b>
          <span>{p.err ? <em style={{ color: 'var(--bad)' }}>{p.err}</em>
            : p.loading ? (p.stage || 'Loading ad-free audio…')
            : (p.track.artist || p.track.country || '')}</span>
        </div>
        <button className="mini-btn" aria-label="Previous"
          onClick={(e) => { e.stopPropagation(); p.step(-1); }}><Icon n="prev" size={17} /></button>
        <button className="mini-btn play" aria-label={p.playing ? 'Pause' : 'Play'}
          onClick={(e) => { e.stopPropagation(); p.toggle(); }}>
          {p.loading ? <span className="spin-sm" /> : <Icon n={p.playing ? 'pause' : 'play'} size={15} />}</button>
        <button className="mini-btn" aria-label="Next"
          onClick={(e) => { e.stopPropagation(); p.step(1); }}><Icon n="next" size={17} /></button>
        <button className="mini-btn" aria-label="Full screen" title="Full screen"
          onClick={(e) => { e.stopPropagation(); p.setFull(true); }}>
          <Icon n="max" size={15} />
        </button>
        <button className="mini-btn" aria-label="Minimize" title="Minimize player"
          onClick={(e) => { e.stopPropagation(); p.setMiniHidden(true); }}>
          <Icon n="down" size={15} />
        </button>
        <button className="mini-btn" aria-label="Close" title="Stop and close"
          onClick={(e) => { e.stopPropagation(); p.stop?.(); }}>
          <Icon n="x" size={14} />
        </button>
      </div>
    </div>
  </>);
}

/* ------------------------------------------------------------- full screen */
export function FullPlayer() {
  const p = usePlayer();
  /* The palette hook must live ABOVE the early return below — a hook after
     a conditional return changes the hook count between renders and React
     dies with #310 the moment the player closes. */
  const pal = useArtTheme(p?.track?.art);
  const [tab, setTab] = useState('art');       // art | lyrics | eq | queue
  const [sleepOpen, setSleepOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [fav, setFav] = useState(false);
  const cv = useRef(null);
  const lyrRef = useRef(null);

  /* Volume is remembered across sessions, and mute remembers the level it
     came from so unmuting does not jump to full blast. */
  const [vol, setVol] = useState(() => {
    const v = parseFloat(localStorage.getItem('omni:vol'));
    return isFinite(v) && v >= 0 && v <= 1 ? v : 1;
  });
  const lastVol = useRef(vol || 0.8);
  useEffect(() => {
    localStorage.setItem('omni:vol', String(vol));
    if (p?.audio?.current) p.audio.current.volume = vol;
  }, [vol, p?.audio, p?.track?.id]);

  /* The bitrate, read off the stream address the element is really using.
     The catalogue encodes it in the filename (`..._320.mp4`), and an HLS
     playlist names its rung in the path. Anything else stays blank — a
     guessed number on a chip would be a lie dressed as a fact. */
  const [quality, setQuality] = useState('');
  useEffect(() => {
    const el = p?.audio?.current;
    if (!el) { setQuality(''); return; }
    const read = () => {
      const u = el.currentSrc || el.src || '';
      let q = '';
      const m = u.match(/_(\d{2,3})\.mp[34](?:\?|$)/);
      if (m) q = m[1] + ' kbps';
      else if (/\/320[./]/.test(u)) q = '320 kbps';
      else if (/\/(\d{2,3})\.mp4\.master\.m3u8/.test(u)) q = u.match(/\/(\d{2,3})\.mp4\.master/)[1] + ' kbps';
      else if (/\.m3u8(\?|$)/.test(u)) q = 'adaptive';
      setQuality(q);
    };
    read();
    el.addEventListener('loadedmetadata', read);
    return () => el.removeEventListener('loadedmetadata', read);
  }, [p?.audio, p?.track?.id, p?.playing]);

  /* How much is actually buffered ahead. Without this a stalled track and a
     merely slow one look exactly the same on the seek bar. */
  const [buffered, setBuffered] = useState(0);
  useEffect(() => {
    const el = p?.audio?.current;
    if (!el || !p?.full) return;
    const read = () => {
      try {
        const b = el.buffered;
        setBuffered(b && b.length ? b.end(b.length - 1) : 0);
      } catch { setBuffered(0); }
    };
    read();
    const id = setInterval(read, 900);
    el.addEventListener('progress', read);
    return () => { clearInterval(id); el.removeEventListener('progress', read); };
  }, [p?.audio, p?.full, p?.track?.id]);

  const t0 = p?.track;
  useEffect(() => { setFav(isFav(t0?.id)); }, [t0?.id]);   // eslint-disable-line

  /* Offline download: the button reflects the three states — save, saving,
     saved — and a saved track is one tap from being removed again. */
  const [, dlBump] = useState(0);
  useEffect(() => onDownloads(() => dlBump((n) => n + 1)), []);
  const [dlErr, setDlErr] = useState('');
  const dl = async (t) => {
    if (!t?.id) return;
    setDlErr('');
    if (isDownloaded(t.id)) {
      if (confirm(`Remove "${t.title || 'this track'}" from downloads?`)) await removeDownload(t.id);
      return;
    }
    try { await downloadTrack(t, { resolveAudio }); }
    catch (e) { setDlErr(e?.message || 'Download failed — try again'); }
  };

  /* Song radio: build a queue of similar material around what is playing and
     hand it to the player with endless radio on. */
  const [radioBusy, setRadioBusy] = useState(false);
  const songRadio = async (t) => {
    if (!t || radioBusy) return;
    setRadioBusy(true);
    try {
      const list = await radioQueue(t, { limit: 30 });
      if (list?.length) { p.setRadio(true); p.play(list[0], list); p.setFull(true); }
    } finally { setRadioBusy(false); }
  };

  /* Share uses the OS sheet where there is one and falls back to the
     clipboard, so it works on a phone and on a desktop without branching in
     the markup. */
  const share = async () => {
    const q = `${t0?.title || ''} ${t0?.artist || ''}`.trim();
    const url = `${location.origin}${location.pathname}#music`;
    try {
      if (navigator.share) { await navigator.share({ title: q, text: q, url }); return; }
      await navigator.clipboard.writeText(`${q} — ${url}`);
      setShared(true); setTimeout(() => setShared(false), 1500);
    } catch { /* the user dismissed the sheet */ }
  };

  /* ------------------------------------------------------------ visualiser
   *
   * Three styles, because one shape does not suit every track: bars for
   * rhythm, a waveform for vocals, and a ring that wraps the sleeve.
   *
   * It reads a REAL analyser. Until now this drew nothing at all: a
   * cross-origin element without the CORS opt-in gives a muted
   * MediaElementSource, so every sample read back as zero and the canvas
   * painted a flat line. The player now sets crossOrigin (measured safe on
   * every CDN in use) and exposes `canViz` when that succeeded — when it did
   * not, this draws nothing and the UI says why instead of faking motion.
   */
  const [vizMode, setVizMode] = useState(() => localStorage.getItem('omni:viz') || 'bars');
  /* Bottom deck: clean by default. The essentials — timeline, transport —
     stay; everything else folds into one toggle, remembered per device. */
  const [ctlOpen, setCtlOpen] = useState(() => localStorage.getItem('omni:ctl') === '1');
  const toggleCtl = () => setCtlOpen((v) => {
    const n = !v;
    try { localStorage.setItem('omni:ctl', n ? '1' : '0'); } catch {}
    return n;
  });
  const [vizOn, setVizOn] = useState(false);
  useEffect(() => { localStorage.setItem('omni:viz', vizMode); }, [vizMode]);

  useEffect(() => {
    if (!p?.full || tab !== 'art' || !p.playing || !p.canViz) { setVizOn(false); return; }
    const el = p.audio?.current;
    if (!el || !cv.current) return;
    let raf = 0, dead = false, an = null;
    const peaks = [];

    (async () => {
      an = await chain.tap(el);
      if (!an || dead) return;
      setVizOn(true);
      const c = cv.current;
      if (!c) return;
      const cx = c.getContext('2d');
      const freq = new Uint8Array(an.frequencyBinCount);
      const time = new Uint8Array(an.frequencyBinCount);

      const draw = () => {
        raf = requestAnimationFrame(draw);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = c.width = c.offsetWidth * dpr;
        const h = c.height = 74 * dpr;
        cx.clearRect(0, 0, w, h);

        if (vizMode === 'wave') {
          an.getByteTimeDomainData(time);
          cx.lineWidth = 2 * dpr;
          const g = cx.createLinearGradient(0, 0, w, 0);
          g.addColorStop(0, '#00FF9C'); g.addColorStop(1, '#00E5FF');
          cx.strokeStyle = g;
          cx.beginPath();
          for (let i = 0; i < time.length; i++) {
            const x = (i / (time.length - 1)) * w;
            const y = (time[i] / 255) * h;
            i ? cx.lineTo(x, y) : cx.moveTo(x, y);
          }
          cx.stroke();
          return;
        }

        an.getByteFrequencyData(freq);
        /* The top bins of an FFT are mostly empty air on music, so drawing all
           of them wastes half the width on nothing. Only the useful range is
           shown, spread across the full canvas. */
        const used = Math.floor(freq.length * 0.72);
        const bars = 40;
        const bw = w / bars;
        for (let i = 0; i < bars; i++) {
          /* Average a slice per bar rather than sampling one bin, so a bar
             represents its band instead of flickering on a single frequency. */
          const from = Math.floor((i / bars) * used);
          const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * used));
          let sum = 0;
          for (let k = from; k < to; k++) sum += freq[k];
          const v = (sum / (to - from)) / 255;
          const bh = Math.max(2 * dpr, v * h);
          const x = i * bw;
          /* A peak marker that falls slowly — it makes short transients
             visible, which a bare bar height does not. */
          peaks[i] = Math.max((peaks[i] || 0) - 1.1 * dpr, bh);
          const g = cx.createLinearGradient(0, h, 0, h - bh);
          g.addColorStop(0, '#00FF9C'); g.addColorStop(1, '#00E5FF');
          cx.fillStyle = g;
          /* Guard the width before deriving a radius from it. On a narrow
             canvas bw can be under 2*dpr, which made bwd negative and
             roundRect throws on a negative radius — caught in testing as a
             console error every frame. */
          const bwd = Math.max(1, bw - 2 * dpr);
          const r = Math.max(0, Math.min(bwd / 2, 3 * dpr));
          cx.beginPath();
          cx.roundRect ? cx.roundRect(x, h - bh, bwd, bh, [r, r, 0, 0])
                       : cx.rect(x, h - bh, bwd, bh);
          cx.fill();
          cx.fillStyle = 'rgba(0,229,255,.55)';
          cx.fillRect(x, h - peaks[i] - 2 * dpr, bwd, 1.5 * dpr);
        }
      };
      draw();
    })();

    return () => { dead = true; cancelAnimationFrame(raf); setVizOn(false); };
  }, [p?.full, p?.playing, p?.canViz, tab, vizMode]);   // eslint-disable-line

  /* The ring around the sleeve is driven by the same analyser, but it is a
     separate loop so it keeps running while the user is on the Lyrics tab. */
  const ringRef = useRef(null);
  useEffect(() => {
    if (!p?.full || !p.playing || !p.canViz || vizMode !== 'ring') return;
    const el = p.audio?.current;
    if (!el) return;
    let raf = 0, dead = false;
    (async () => {
      const an = await chain.tap(el);
      if (!an || dead) return;
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        raf = requestAnimationFrame(tick);
        an.getByteFrequencyData(buf);
        let s = 0;
        for (let i = 0; i < 24; i++) s += buf[i];
        const v = s / 24 / 255;
        ringRef.current?.style.setProperty('--pulse', (1 + v * 0.09).toFixed(3));
        ringRef.current?.style.setProperty('--glow', (v * 46).toFixed(1) + 'px');
      };
      tick();
    })();
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, [p?.full, p?.playing, p?.canViz, vizMode]);        // eslint-disable-line

  /* auto-scroll synced lyrics */
  const activeLine = (() => {
    const L = p?.lyrics?.synced;
    if (!L) return -1;
    let i = 0;
    while (i < L.length && L[i].t <= p.pos) i++;
    return i - 1;
  })();
  useEffect(() => {
    if (tab === 'lyrics' && activeLine >= 0 && lyrRef.current) {
      const el = lyrRef.current.querySelector(`[data-i="${activeLine}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeLine, tab]);

  if (!p?.full || !p.track) return null;
  const t = p.track;
  /* The player dresses in the artwork: palette accents re-skin every child
     through the two theme variables, and the art itself becomes a static,
     heavily blurred, low-opacity wash behind the whole screen. (The palette
     itself was computed in the hook at the top of the component.) */

  return (
    <div className="full" style={artStyle(pal)}>
      <div className="full-bg" aria-hidden="true">
        {t?.art
          ? <img key={t.art} src={t.art} alt="" draggable={false} />
          : <div className="nul" />}
      </div>
      <div className="full-top">
        <button className="iconbtn" onClick={() => p.setFull(false)} title="Minimize to bar">⌄</button>
        <div className="full-ttl"><b>Playing from</b><span>{t.src || (p.queue.length > 1 ? 'Your queue' : 'SurBox')}</span></div>
        <button className="iconbtn" aria-label="Minimize to hidden" title="Hide player (keep playing)"
          onClick={() => { p.setFull(false); p.setMiniHidden(true); }}>
          <Icon n="down" size={16} /></button>
        <button className="iconbtn" aria-label="Close player" title="Stop and close"
          onClick={() => { p.setFull(false); p.stop?.(); }}>
          <Icon n="x" size={16} /></button>
        <button className="iconbtn" aria-label="Sleep timer"
          onClick={() => setSleepOpen((v) => !v)}
          style={{ color: p.sleep ? 'var(--green)' : '' }}>
          <Icon n={p.sleep ? 'timer' : 'clock'} size={17} /></button>
      </div>

      <div className="full-tabs">
        {[['art','Player'],['lyrics','Lyrics'],['eq','Equalizer'],['queue','Queue']].map(([v, l]) => (
          <button key={v} className={`cat ${tab === v ? 'on' : ''}`} onClick={() => setTab(v)}>{l}</button>))}
      </div>

      <div className="full-body">
        {tab === 'art' && (<>
          {p.yt ? (
            <div className="ytbox">
              <iframe id="yt-frame" title="player" allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                src={`https://www.youtube-nocookie.com/embed/${p.yt}?autoplay=1&enablejsapi=1&playsinline=1&rel=0&modestbranding=1`} />
            </div>
          ) : (
            <div className="art-wrap">
              {/* A record, not a rounded square.
                  The disc keeps turning while the track plays and COASTS to a
                  stop when paused rather than freezing mid-rotation — the old
                  version toggled the animation off, which snapped the artwork
                  back to zero degrees and looked like a glitch. The angle is
                  now carried in a custom property that survives the pause. */}
              <div className={`disc-stage ${vizMode === 'ring' ? 'ring' : ''}`} ref={ringRef}>
                {vizMode === 'ring' && vizOn && <span className="disc-ring" />}
                <div className={`art-disc ${p.playing ? 'spin' : 'coast'}`}>
                  <span className="groove g1" /><span className="groove g2" />
                  <span className="groove g3" /><span className="groove g4" />
                  {t.art
                    ? <img src={t.art} alt="" className="art" onError={(e) => { e.target.style.display = 'none'; }} />
                    : <div className="art ph"><Icon n="music" size={40} /></div>}
                  <span className="art-sheen" />
                  <span className="art-hole" />
                </div>
              </div>
            </div>)}

          {/* The visualiser, and an honest line when it cannot run. */}
          <div className="vizbox">
            <canvas ref={cv} className="viz"
              style={{ display: vizOn && vizMode !== 'ring' ? 'block' : 'none' }} />
            {p.playing && !p.canViz && (
              <p className="viz-note">
                This stream will not allow the visualiser — the server did not
                permit reading its audio. Playback is unaffected.
              </p>)}
            <div className="vizpick">
              {[['bars', 'wave', 'Bars'], ['wave', 'signal', 'Wave'], ['ring', 'disc', 'Ring']].map(([m, ic, lbl]) => (
                <button key={m} className={`vizb ${vizMode === m ? 'on' : ''}`}
                  onClick={() => setVizMode(m)} aria-label={lbl} title={lbl}>
                  <Icon n={ic} size={13} />
                </button>))}
            </div>
          </div>

          <h2 className="full-name">{t.title || t.name}</h2>
          <p className="dim" style={{ textAlign: 'center' }}>{t.artist || t.country || ''}</p>
          {/* Chips carrying what is actually known about this track. Each one
              is omitted when the value is missing rather than rendering an
              empty box or the word "unknown". */}
          <div className="chips">
            {t.album && <span className="chip"><Icon n="disc" size={11} /> {t.album}</span>}
            {t.year && <span className="chip"><Icon n="calendar" size={11} /> {t.year}</span>}
            {t.lang && <span className="chip"><Icon n="globe" size={11} /> {t.lang}</span>}
            {!!t.dur && <span className="chip"><Icon n="clock" size={11} /> {mmss(t.dur)}</span>}
            {/* Read off the actual stream address rather than assumed. Not every
                source encodes a bitrate, so this is absent rather than guessed
                when the URL does not say. */}
            {quality && <span className="chip"><Icon n="wave" size={11} /> {quality}</span>}
            {p.rate !== 1 && <span className="chip on"><Icon n="bolt" size={11} /> {p.rate}&times;</span>}
            {p.sleep > 0 && <span className="chip on"><Icon n="moon" size={11} /> {p.sleep}m</span>}
          </div>
          {/* Which tier answered. A close match from a fallback network must
              never be presented as the original recording. */}
          {(p.via || t.approximate) && (
            <div className="srcline">
              <span className={`dot ${t.approximate ? 'warn' : ''}`} />
              <span>{t.approximate
                ? 'Close match — the original was unavailable'
                : `via ${p.via}`}</span>
            </div>)}
          {p.err && <div className="err" style={{ marginTop: 12 }}><p>{p.err}</p></div>}
        </>)}

        {tab === 'lyrics' && (
          <div style={{ position: 'relative' }}>
            {/* the artwork, melted into the background — the words float over
                the mood of the record instead of a flat panel */}
            <div className="lyrics-blur" aria-hidden="true">
              {t.art ? <img src={t.art} alt="" /> : <div className="ph" />}
            </div>
          <div className="lyrics" ref={lyrRef}>
            {!p.lyrics && <div className="state"><span>No lyrics found for this track</span></div>}
            {p.lyrics && (
              <div className="lyr-src dim sm">
                {p.lyrics.via ? `via ${p.lyrics.via} · ` : ''}
                {p.lyrics.exact ? 'matched to this exact recording' : 'closest match by name'}
                {p.lyrics.synced ? ' · tap a line to jump' : ''}
              </div>)}
            {p.lyrics?.synced && p.lyrics.synced.map((l, i) => (
              <p key={i} data-i={i} className={i === activeLine ? 'lyr on' : 'lyr'}
                onClick={() => p.seek(l.t)}>{l.line}</p>))}
            {p.lyrics && !p.lyrics.synced && (
              <pre className="lyr-plain">{p.lyrics.plain}</pre>)}
          </div>
          </div>)}

        {tab === 'eq' && <EqPanel p={p} />}

        {tab === 'queue' && (
          <div className="list">
            {p.queue.length === 0 && <div className="state"><span>Queue is empty</span></div>}
            {p.queue.length > 0 && (
              <div className="qhead">
                <span>{p.queue.length} tracks
                  {p.shuffle ? ' · shuffled' : ''}
                  {p.repeat !== 'off' ? ` · repeat ${p.repeat}` : ''}</span>
                <span className="mono">{mmss(p.queue.reduce((a, q) => a + (+q.dur || 0), 0))}</span>
              </div>)}
            {p.queue.map((q, i) => (
              <div className={`row ${i === p.idx ? 'qnow' : ''}`} key={i} onClick={() => p.play(q, p.queue)}>
                {/* The playing row shows animated bars where its number was,
                    so the current track is obvious while scrolling a long
                    queue rather than relying on one tinted background. */}
                {i === p.idx
                  ? <span className="qbars" aria-label="Now playing"><i /><i /><i /></span>
                  : <span className="dim mono qnum">{i + 1}</span>}
                <div className="main">
                  <b style={{ fontSize: 13 }}>{q.title || q.name}</b>
                  <span className="dim sm">{q.artist || ''}</span>
                </div>
                {!!q.dur && <span className="dim mono sm">{mmss(q.dur)}</span>}
                {/* Reorder and remove — the queue is a list you own, not a
                    readout. The playing row refuses both so `idx` never has
                    to chase a track that moved under it. */}
                <span style={{ display: 'flex', gap: 2, flex: '0 0 auto' }} onClick={(e) => e.stopPropagation()}>
                  <button className="rowbtn" aria-label="Move up" disabled={i === p.idx}
                    onClick={() => p.moveInQueue(i, -1)} style={{ opacity: i === p.idx ? .25 : 1 }}>
                    <Icon n="up" size={14} /></button>
                  <button className="rowbtn" aria-label="Move down" disabled={i === p.idx}
                    onClick={() => p.moveInQueue(i, 1)} style={{ opacity: i === p.idx ? .25 : 1 }}>
                    <Icon n="down" size={14} /></button>
                  <button className="rowbtn" aria-label="Remove from queue" disabled={i === p.idx}
                    onClick={() => p.removeAt(i)} style={{ opacity: i === p.idx ? .25 : 1 }}>
                    <Icon n="x" size={14} /></button>
                </span>
              </div>))}
          </div>)}
      </div>

        {/* Labeled secondary actions — the four things people actually reach
            for, named instead of guessed from icons. */}
        <div className="lacts">
          <button className={tab === 'lyrics' ? 'on' : ''} onClick={() => setTab('lyrics')}>
            <span className="wic"><Icon n="type" size={17} /></span>Lyrics</button>
          {t.id && (
            <button className={isDownloaded(t.id) ? 'on' : ''} disabled={isDownloading(t.id)}
              onClick={() => dl(t)}>
              <span className="wic">{isDownloading(t.id) ? <span className="spin-sm" /> : <Icon n="download" size={17} />}</span>
              {isDownloaded(t.id) ? 'Saved' : 'Download'}</button>)}
          <button className={tab === 'eq' ? 'on' : ''} onClick={() => setTab('eq')}>
            <span className="wic"><Icon n="wave" size={17} /></span>Audio</button>
          <button className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>
            <span className="wic"><Icon n="queue" size={17} /></span>Queue</button>
        </div>

        {/* UP NEXT — one look ahead, without opening the queue. */}
        {p.queue.length > 1 && p.queue[p.idx + 1] && (() => {
          const n = p.queue[p.idx + 1];
          return (
            <div className="upnext" onClick={() => setTab('queue')}>
              {n.art ? <img src={n.art} alt="" /> : <span className="ph"><Icon n="music" size={15} /></span>}
              <div className="lbl">Up next<b>{n.title || n.name || 'Untitled'}</b><span>{n.artist || ''}</span></div>
              <Icon n="chevron" size={15} style={{ opacity: .5 }} />
            </div>);
        })()}

      <div className="full-ctl">
        {/* The seek bar shows how much is buffered as well as how far in you
            are — a stalled track and a slow track look identical without it. */}
        {(() => {
          // Effective duration: p.dur may be Infinity/0 for HLS until manifest parsed
          // Fall back to seekable, buffered, or track.dur so seek bar works
          let effDur = p.dur;
          if (!isFinite(effDur) || effDur <= 0) {
            try {
              const el = p.audio?.current;
              if (el?.seekable?.length) effDur = el.seekable.end(el.seekable.length - 1);
              else if (el?.buffered?.length) effDur = el.buffered.end(el.buffered.length - 1);
              else if (p.track?.dur && isFinite(p.track.dur)) effDur = p.track.dur;
            } catch {}
          }
          if (!isFinite(effDur) || effDur <= 0) effDur = 0;
          const canSeek = effDur > 0 || buffered > 0;
          const pctBuf = effDur ? Math.min(100, (buffered / effDur) * 100) : 0;
          const pctPlayed = effDur ? Math.min(100, (p.pos / effDur) * 100) : 0;
          return (<>
            <div className="seekwrap">
              <div className="seektrack">
                <i className="buf" style={{ width: pctBuf + '%' }} />
                <i className="played" style={{ width: pctPlayed + '%' }} />
              </div>
              <input type="range" className="seek" min="0" max={effDur || 100} step="0.1"
                value={Math.min(p.pos, effDur || p.pos)}
                onInput={(e) => p.seek(+e.target.value)}
                onChange={(e) => p.seek(+e.target.value)}
                disabled={!canSeek}
                aria-label="Seek"
                style={{ touchAction: 'none' }} />
            </div>
            <div className="times">
              <span>{mmss(p.pos)}</span>
              <span className="rem">{effDur ? '-' + mmss(Math.max(0, effDur - p.pos)) : ''}</span>
              <span>{mmss(effDur || p.dur)}</span>
            </div>
          </>);
        })()}
        <div className="btns">
          <button className="cbtn" aria-label="Previous" onClick={() => p.step(-1)}>
            <Icon n="prev" size={22} /></button>
          <button className="cbtn big" aria-label={p.playing ? 'Pause' : 'Play'} onClick={p.toggle}>
            {p.loading ? <span className="spin-sm" /> : <Icon n={p.playing ? 'pause' : 'play'} size={22} />}</button>
          <button className="cbtn" aria-label="Next" onClick={() => p.step(1)}>
            <Icon n="next" size={22} /></button>
        </div>

        {/* ONE button between a clean deck and everything else. The deck
            keeps only what a thumb needs mid-song: timeline, transport. The
            rest — modes, volume, extras, sleep — folds into this glass drawer,
            and the choice is remembered. */}
        <button className={`ctltoggle ${ctlOpen ? 'on' : ''}`} onClick={toggleCtl}
          aria-expanded={ctlOpen} aria-label={ctlOpen ? 'Hide extra controls' : 'Show extra controls'}>
          <Icon n="chevron" size={15} style={{
            transform: ctlOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform .28s cubic-bezier(.2,.9,.3,1.2)' }} />
          <span>{ctlOpen ? 'Less' : 'More'}</span>
        </button>

        <div className={`ctl-more ${ctlOpen ? 'open' : ''}`}>
          <div className="ctl-in">
            <div className="btns" style={{ marginTop: 2 }}>
              <button className={`cbtn sm ${p.shuffle ? 'act' : ''}`} aria-label="Shuffle"
                onClick={() => p.setShuffle(!p.shuffle)}><Icon n="shuffle" size={17} /></button>
              {/* Repeat-all and repeat-one used to share the refresh arrow, so
                  the two states were indistinguishable. Separate glyphs now. */}
              <button className={`cbtn sm ${p.repeat !== 'off' ? 'act' : ''}`}
                aria-label={p.repeat === 'one' ? 'Repeat one' : p.repeat === 'all' ? 'Repeat all' : 'Repeat off'}
                title={p.repeat === 'one' ? 'Repeat one' : p.repeat === 'all' ? 'Repeat all' : 'Repeat off'}
                onClick={() => p.setRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off')}>
                <Icon n={p.repeat === 'one' ? 'repeatone' : 'repeat'} size={17} /></button>
              <button className={`cbtn sm ${p.sleep ? 'act' : ''}`} aria-label="Sleep timer"
                title={p.sleep ? `Sleep in ${p.sleep} min` : 'Sleep timer'}
                onClick={() => setSleepOpen((v) => !v)}>
                <Icon n={p.sleep ? 'timer' : 'moon'} size={17} /></button>
              <button className={`cbtn sm ${fav ? 'act' : ''}`} aria-label="Favourite"
                onClick={() => { toggleFav(t); setFav((v) => !v); }}>
                <Icon n={fav ? 'staron' : 'star'} size={17} /></button>
            </div>

            {/* Volume, with a mute toggle that remembers where the slider was. */}
            <div className="volrow">
              <button className="volbtn" aria-label={vol === 0 ? 'Unmute' : 'Mute'}
                onClick={() => {
                  const el = p.audio?.current; if (!el) return;
                  if (vol > 0) { lastVol.current = vol; setVol(0); el.volume = 0; }
                  else { const v = lastVol.current || 0.8; setVol(v); el.volume = v; }
                }}>
                <Icon n={vol === 0 ? 'volumeoff' : 'volume'} size={16} /></button>
              <input type="range" className="vol" min="0" max="1" step="0.01" value={vol}
                aria-label="Volume"
                onChange={(e) => {
                  const v = +e.target.value; setVol(v);
                  if (p.audio?.current) p.audio.current.volume = v;
                }} />
              <span className="volpct mono">{Math.round(vol * 100)}</span>
            </div>

            {sleepOpen && (
              <div className="btnrow" style={{ justifyContent: 'center', marginTop: 8 }}>
                {[0, 15, 30, 45, 60].map((m) => (
                  <button key={m} className={`cat ${p.sleep === m ? 'on' : ''}`}
                    onClick={() => { p.setSleep(m); setSleepOpen(false); }}>
                    {m === 0 ? 'Off' : `${m}m`}</button>))}
              </div>)}

            <div className="btnrow" style={{ justifyContent: 'center', marginTop: 8 }}>
              <button className="btn ghost sm" onClick={() => p.seek(Math.max(0, p.pos - 10))}>&minus;10s</button>
              <button className="btn ghost sm" onClick={() => p.seek(p.pos + 10)}>+10s</button>
              <button className="btn ghost sm" aria-label="Share" onClick={share}>
                <Icon n={shared ? 'check' : 'link'} size={15} /></button>
              <button className="btn ghost sm" aria-label="Song radio" title="Play similar songs"
                disabled={radioBusy} onClick={() => songRadio(t)}
                style={{ opacity: radioBusy ? .5 : 1 }}>
                {radioBusy ? <span className="spin-sm" /> : <Icon n="radio" size={15} />}</button>
            </div>
          </div>
        </div>
        {dlErr && <div className="err" style={{ marginTop: 8 }}><p>{dlErr}</p></div>}
      </div>
    </div>);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EQUALISER + AUDIO LAB
   The graph this panel drives lives in player.jsx (the Chain class): ten
   biquad bands, bass/treble shelves, a compressor, a zero-dependency pitch
   shifter and the voice stage. It attaches only when the user switches it
   on here — never by itself — and it is verified to keep audio flowing
   before it promises anything.

   WHY IT WORKS IN THE APP (and frustrated everyone on the website)
   An equaliser needs to READ the samples, and a cross-origin stream that
   does not grant CORS access produces a MUTED MediaElementSource: bars
   move, sound dies. In the app every track plays from a LOCAL blob —
   same-origin by definition — so the samples are always readable and the
   graph always has something real to work on. Website visitors get it on
   buffered tracks and CORS-friendly streams; `eqCapable` says which.

   THE VOICE STAGE (sound alag, vocals alag)
   'Karaoke' cancels the centred channel — vocals sit in the middle of
   nearly every stereo mix, so L−R removes them and leaves the music.
   'Vocals' does the opposite and keeps only the centre. It is the honest
   real-time trick, not AI stem separation: expect a great karaoke track
   on standard mixes, with some bleed on songs hard-panned either side.
   ═══════════════════════════════════════════════════════════════════════════ */
function EqPanel({ p }) {
  if (!p) return null;
  const lab = p.lab || {};
  const capable = p.eqCapable || p.eqOn;   // once attached, keep the controls live
  const disabled = !capable;

  const Row = ({ label, value, min, max, step, onChange, fmt }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '7px 0' }}>
      <span className="dim sm" style={{ flex: '0 0 58px', fontVariantNumeric: 'tabular-nums' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(+e.target.value)}
        style={{ flex: 1, opacity: disabled ? 0.35 : 1 }} />
      <span className="mono sm" style={{ flex: '0 0 40px', textAlign: 'right' }}>
        {fmt ? fmt(value) : value}</span>
    </div>
  );

  const Chips = ({ options, value, onPick, disabled: dis }) => (
    <div className="btnrow" style={{ flexWrap: 'wrap', gap: 6 }}>
      {options.map(([v, l]) => (
        <button key={v} className={`cat ${value === v ? 'on' : ''}`} disabled={dis}
          style={{ opacity: dis ? 0.35 : 1 }} onClick={() => onPick(v)}>{l}</button>))}
    </div>
  );

  return (
    <div>
      {/* ---- master switch ---- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <b style={{ fontSize: 14 }}>Equaliser &amp; Audio Lab</b>
          <div className="dim sm">{p.eqOn ? 'On — processing this track' : 'Off — tap to enable'}</div>
        </div>
        <button className={`cat ${p.eqOn ? 'on' : ''}`} onClick={() => (p.eqOn ? p.offEq() : p.enableEq())}>
          <Icon n="sliders" size={13} /> {p.eqOn ? 'ON' : 'OFF'}
        </button>
      </div>

      {!capable && (
        <div className="note" style={{ marginBottom: 10 }}>
          This track does not grant audio access (a server that refuses to
          share its samples). It will work on buffered and downloaded tracks —
          and on every track in the app, which plays from a local copy.
        </div>
      )}

      {/* ---- presets ---- */}
      <label className="dim sm">Preset</label>
      <Chips options={Object.keys(PRESETS).map((k) => [k, k])} value={p.preset}
        onPick={(k) => p.applyPreset(k)} disabled={disabled} />

      {/* ---- the ten bands ---- */}
      <div style={{ marginTop: 12 }}>
        <label className="dim sm">Bands (dB)</label>
        {p.BANDS.map((f, i) => (
          <Row key={f} label={f >= 1000 ? `${f / 1000}k` : `${f}`}
            value={p.eq[i] ?? 0} min={-12} max={12} step={1}
            onChange={(v) => p.setEqBand(i, v)}
            fmt={(v) => (v > 0 ? `+${v}` : `${v}`)} />
        ))}
      </div>

      {/* ---- tone ---- */}
      <div style={{ marginTop: 10 }}>
        <label className="dim sm">Tone</label>
        <Row label="Bass" value={p.bass} min={-12} max={12} step={1}
          onChange={p.setBassV} fmt={(v) => (v > 0 ? `+${v}` : `${v}`)} />
        <Row label="Treble" value={p.treb} min={-12} max={12} step={1}
          onChange={p.setTrebV} fmt={(v) => (v > 0 ? `+${v}` : `${v}`)} />
      </div>

      {/* ---- voice stage: the sound-alag / vocals-alag switch ---- */}
      <div style={{ marginTop: 14 }}>
        <label className="dim sm">Voice — karaoke &amp; vocal isolation</label>
        <Chips options={[['normal', 'Normal'], ['karaoke', 'Karaoke (music only)'], ['vocals', 'Vocals only']]}
          value={lab.mode || 'normal'} onPick={(m) => p.setLab({ mode: m })} disabled={disabled} />
        <div className="dim sm" style={{ marginTop: 4 }}>
          Karaoke removes centred vocals from the mix; Vocals keeps only the
          centre. Works best on standard stereo mixes.
        </div>
      </div>

      {/* ---- pitch ---- */}
      <div style={{ marginTop: 12 }}>
        <label className="dim sm">Pitch (semitones)</label>
        <Row label="Key" value={lab.pitch || 0} min={-6} max={6} step={1}
          onChange={(v) => p.setLab({ pitch: v })}
          fmt={(v) => (v > 0 ? `+${v}` : `${v}`)} />
      </div>

      {/* ---- space ---- */}
      <div style={{ marginTop: 12 }}>
        <label className="dim sm">Space</label>
        <Chips options={[['off', 'Dry'], ['room', 'Room'], ['club', 'Club'], ['hall', 'Hall'], ['stadium', 'Stadium']]}
          value={lab.reverb || 'off'} onPick={(r) => p.setLab({ reverb: r })} disabled={disabled} />
        {(lab.reverb && lab.reverb !== 'off') && (
          <Row label="Wet" value={Math.round((lab.wet ?? 0.3) * 100)} min={0} max={100} step={5}
            onChange={(v) => p.setLab({ wet: v / 100 })} fmt={(v) => `${v}%`} />
        )}
        <div className="btnrow" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <button className={`cat ${lab.dim ? 'on' : ''}`} disabled={disabled}
            style={{ opacity: disabled ? 0.35 : 1 }}
            onClick={() => p.setLab({ dim: !lab.dim })}>8D orbit</button>
          <button className={`cat ${lab.mono ? 'on' : ''}`} disabled={disabled}
            style={{ opacity: disabled ? 0.35 : 1 }}
            onClick={() => p.setLab({ mono: !lab.mono })}>Mono</button>
          <button className={`cat ${lab.night ? 'on' : ''}`} disabled={disabled}
            style={{ opacity: disabled ? 0.35 : 1 }}
            onClick={() => p.setLab({ night: !lab.night })}>Night mode</button>
        </div>
      </div>

      {/* ---- speed ---- */}
      <div style={{ marginTop: 14 }}>
        <label className="dim sm">Speed</label>
        <Row label="Rate" value={p.rate} min={0.5} max={2} step={0.05}
          onChange={p.setRateV} fmt={(v) => `${v}×`} />
        <div className="btnrow">
          <button className="cat" onClick={() => p.setRateV(1)}>
            <Icon n="refresh" size={13} /> Normal speed</button>
        </div>
      </div>

      <div className="note" style={{ marginTop: 14 }}>
        The equaliser runs on this device, in real time, and never changes the
        stored file — original quality is one tap away (OFF). On very old
        phones heavy settings can cost some battery; playback smoothness
        always comes first, so the graph attaches only when you ask for it.
      </div>
    </div>
  );
}
