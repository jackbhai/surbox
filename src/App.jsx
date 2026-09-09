/**
 * SurBox — the OmniTools music player, standing on its own.
 *
 * The whole app is the player: one screen, eight tabs (Home · Search ·
 * Artists · Library · Charts · Genres · Playlists · Radio), the mini player
 * pinned above the content while a track is loaded, and the full-screen
 * player layered on top. Nothing else ships — no tool grid, no routing,
 * no other tools. The player context is the shell.
 */
import React from 'react';
import { Music } from './tools/music2';
import { PlayerProvider, usePlayer } from './core/player';
import { MiniPlayer, FullPlayer } from './ui/PlayerUI';
import { Icon } from './ui/icons';

export default function App() {
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  );
}

function Shell() {
  const p = usePlayer();
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
