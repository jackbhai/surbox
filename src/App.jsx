/**
 * SurBox — the OmniTools music player, standing on its own.
 *
 * The whole app is the player: one screen, eight tabs (Home · Search ·
 * Artists · Library · Charts · Genres · Playlists · Radio), the mini player
 * pinned above the content while a track is loaded, and the full-screen
 * player layered on top. Nothing else ships — no tool grid, no routing,
 * no other tools. The player context is the shell.
 */
import React, { useEffect } from 'react';
import { Music } from './tools/music2';
import { PlayerProvider, usePlayer } from './core/player';
import { MiniPlayer, FullPlayer } from './ui/PlayerUI';
import { Icon } from './ui/icons';

/**
 * Keyboard shortcuts — desktop users get real controls, not just a phone UI
 * with a mouse. Every key is ignored while typing in an input.
 *
 *   Space        play / pause
 *   ← / →        seek 10 s back / forward
 *   N / P        next / previous track
 *   M            mute
 *   F            open / close the full player
 *   S            shuffle
 *   R            repeat off → all → one
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
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  );
}

function Shell() {
  const p = usePlayer();
  useKeys(p);
  return (
    <div className={`app ${p?.track ? 'has-mini' : ''}`}>
      <header className="topbar">
        <span className="brand gradtext">SUR</span>
        <div className="tb-t">
          <b>SurBox</b>
          <span>Ad-free music · EQ · background play</span>
        </div>
        <span className="iconbtn" title="Music, nothing else" aria-hidden="true"
          style={{ display: 'grid', placeItems: 'center', color: 'var(--green)' }}>
          <Icon n="music" size={18} />
        </span>
      </header>

      <div className="main-area">
        <div style={{ paddingTop: 14 }}>
          <Music />
        </div>
      </div>

      <MiniPlayer />
      <FullPlayer />
    </div>
  );
}
