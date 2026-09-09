/**
 * SurBox — the OmniTools music player, standing on its own.
 *
 * v2 SHELL
 *   Onboarding (taste selector) → main app:
 *   · top bar: brand + status
 *   · one screen at a time: Home · Search · Library · secondary pages
 *   · glass NowBar floating above a glass dock (Home / Search / Library / More)
 *   · the full-screen player stays the crown jewel it already was
 *
 * Nothing else ships — no tool grid, no other tools. The player context is
 * the shell.
 */
import React, { useEffect, useState } from 'react';
import { PlayerProvider, usePlayer } from './core/player';
import { FullPlayer } from './ui/PlayerUI';
import { NowBar } from './ui/NowBar';
import { Icon } from './ui/icons';
import { PageHead } from './ui/bits';
import { hasPreferences } from './core/preferences';
import Onboarding from './screens/Onboarding';
import HomeScreen from './screens/HomeScreen';
import SearchScreen from './screens/SearchScreen';
import LibraryScreen from './screens/LibraryScreen';
import { ChartsTab, GenresTab, PlaylistTab, RadioTab, ArtistsTab } from './tools/music2';
import { PreferencesEditor } from './tools/music-prefs';
import ThemeScreen from './screens/ThemeScreen';

/**
 * Keyboard shortcuts — desktop users get real controls.
 *   Space play/pause · ←/→ seek · N/P track · M mute · F full player ·
 *   S shuffle · R repeat
 */
function useKeys(p) {
  useEffect(() => {
    if (!p) return;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = p.audio?.current;
      switch (e.key) {
        case ' ': e.preventDefault(); p.toggle(); break;
        case 'ArrowRight': if (el) p.seek(Math.min((el.duration || 1e9), el.currentTime + 10)); e.preventDefault(); break;
        case 'ArrowLeft': if (el) p.seek(Math.max(0, el.currentTime - 10)); e.preventDefault(); break;
        case 'n': case 'N': p.step(1); break;
        case 'p': case 'P': p.step(-1); break;
        case 'm': case 'M': if (el) el.muted = !el.muted; break;
        case 'f': case 'F': p.setFull(!p.full); break;
        case 's': case 'S': p.setShuffle(!p.shuffle); break;
        case 'r': case 'R': p.setRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off'); break;
        default: return;
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [p]);
}

export default function App() {
  const [onboarded, setOnboarded] = useState(() => {
    try { return !!JSON.parse(localStorage.getItem('omni:onb') || 'null') || hasPreferences(); }
    catch { return hasPreferences(); }
  });

  return (
    <PlayerProvider>
      {!onboarded
        ? <Onboarding onDone={() => setOnboarded(true)} />
        : <Shell />}
    </PlayerProvider>
  );
}

/* ------------------------------------------------------------------ shell */
function Shell() {
  const p = usePlayer();
  useKeys(p);
  const [page, setPage] = useState('home');
  const [libSeg, setLibSeg] = useState('songs');
  const [moreOpen, setMoreOpen] = useState(false);

  const go = (target, arg) => {
    if (target === 'library' && arg) setLibSeg(arg);
    setPage(target);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  };

  const DOCK = [
    ['home', 'home', 'Home'],
    ['search', 'search', 'Search'],
    ['library', 'list', 'Library'],
    ['more', 'grid', 'More'],
  ];

  return (
    <div className={`app sb-shell ${p?.track ? 'has-now' : ''}`}>
      <header className="sb-top">
        <span className="sb-brand">SUR</span>
        <span className="sp" />
        <button className="iconbtn" aria-label="Keyboard shortcuts"
          title="Space play/pause · ←/→ seek · N/P track · M mute · F player · S shuffle · R repeat"
          onClick={() => alert('Keyboard shortcuts\n\nSpace  play / pause\n← →   seek ±10s\nN / P  next / previous\nM      mute\nF      full player\nS      shuffle\nR      repeat mode')}>
          <Icon n="info" size={16} /></button>
        <button className="iconbtn" aria-label="Library settings" title="App settings"
          onClick={() => go('library', 'app')}>
          <Icon n="cog" size={16} /></button>
      </header>

      <main className="sb-main">
        {page === 'home' && <HomeScreen go={go} />}
        {page === 'search' && <SearchScreen />}
        {page === 'library' && <LibraryScreen initial={libSeg} />}

        {page === 'charts' && (
          <div className="pageanim">
            <PageHead icon="chart" title="CHARTS" sub="What India is playing right now" onBack={() => go('home')} />
            <ChartsTab player={p} />
          </div>)}
        {page === 'genres' && (
          <div className="pageanim">
            <PageHead icon="disc" title="GENRES" sub="Pick a sound, get a queue" onBack={() => go('home')} />
            <GenresTab player={p} />
          </div>)}
        {page === 'playlists' && (
          <div className="pageanim">
            <PageHead icon="list" title="PLAYLISTS" sub="Ready-made, searchable" onBack={() => go('home')} />
            <PlaylistTab player={p} />
          </div>)}
        {page === 'radio' && (
          <div className="pageanim">
            <PageHead icon="radio" title="RADIO" sub="Non-stop, never repeats" onBack={() => go('home')} />
            <RadioTab player={p} />
          </div>)}
        {page === 'artists' && (
          <div className="pageanim">
            <PageHead icon="smile" title="ARTISTS" sub="Search the full catalogue" onBack={() => go('home')} />
            <ArtistsTab player={p} />
          </div>)}
        {page === 'taste' && (
          <div className="pageanim">
            <PageHead icon="cog" title="YOUR TASTE" sub="Languages, artists, vibes — Home rebuilds instantly" onBack={() => go('home')} />
            <PreferencesEditor onClose={() => go('home')} />
          </div>)}
        {page === 'theme' && <ThemeScreen onBack={() => go('home')} />}
      </main>

      <NowBar />

      <div className="sb-dockwrap">
        <nav className="sb-dock" role="navigation">
          {DOCK.map(([id, ic, label]) => (
            <button key={id} className={page === id ? 'on' : ''}
              onClick={() => (id === 'more' ? setMoreOpen((v) => !v) : go(id))}
              aria-label={label}>
              <Icon n={ic} size={20} />
              <small>{label}</small>
            </button>))}
        </nav>
      </div>

      {moreOpen && <MoreSheet go={go} close={() => setMoreOpen(false)} />}

      <FullPlayer />
    </div>);
}

/* -------------------------------------------------------------- more sheet */
/**
 * The fourth dock slot: a glass sheet rising over everything, with the
 * destinations that do not deserve a permanent dock slot but deserve better
 * than being buried.
 */
function MoreSheet({ go, close }) {
  const items = [
    ['charts', 'chart', 'Charts', 'Trending across India'],
    ['genres', 'disc', 'Genres', 'Pick a sound, get a queue'],
    ['playlists', 'list', 'Playlists', 'Ready-made collections'],
    ['radio', 'radio', 'Radio', 'Non-stop music'],
    ['artists', 'smile', 'Artists', 'The full catalogue'],
    ['taste', 'cog', 'Edit taste', 'Languages, artists, vibes'],
    ['theme', 'palette', 'Appearance', '35+ themes + your own'],
    ['library', 'bolt', 'Your stats', 'Minutes, artists, trends'],
  ];
  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}
        style={{ borderTop: '1px solid rgba(0,255,156,.2)' }}>
        <div className="chead" style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}>
          <span>More</span>
          <button className="iconbtn" style={{ width: 28, height: 28 }} onClick={close} aria-label="Close">
            <Icon n="x" size={15} /></button>
        </div>
        <div className="qgrid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {items.map(([id, ic, t, s]) => (
            <button key={id} className="qtile" onClick={() => (id === 'library' ? go('library', 'stats') : go(id))}>
              <span className="ic"><Icon n={ic} size={19} /></span>
              <span style={{ minWidth: 0 }}>
                <b>{t}</b><small>{s}</small>
              </span>
            </button>))}
        </div>
      </div>
    </div>);
}
