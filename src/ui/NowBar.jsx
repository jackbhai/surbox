/**
 * NowBar — the glass mini player that floats above the dock.
 *
 * One tap anywhere opens the full player. Art on the left, what is playing
 * in the middle (title over artist), live EQ bars that freeze when paused,
 * play/pause and next on the right, and a hairline progress track along the
 * bottom edge so you always know where in the song you are.
 */
import React from 'react';
import { usePlayer } from '../core/player';
import { Icon } from './icons';

export function NowBar() {
  const p = usePlayer();
  if (!p?.track) return null;
  const dur = (isFinite(p.dur) && p.dur > 0) ? p.dur : (p.track?.dur || 0);
  const pct = dur ? Math.min(100, (p.pos / dur) * 100) : 0;

  return (
    <div className="sb-nowwrap">
      <div className="sb-now" onClick={() => p.setFull(true)} role="button" aria-label="Open player">
        {p.track.art
          ? <img className="art" src={p.track.art} alt="" />
          : <span className="artph"><Icon n="music" size={18} /></span>}
        <div className="meta">
          <b>{p.track.title || 'Untitled'}</b>
          <span>
            {p.track.artist || ''}
            {p.via ? ` · via ${p.via}` : ''}
          </span>
        </div>
        <span className={`sb-eqs ${p.playing ? '' : 'pause'}`} aria-hidden="true">
          <i style={{ height: 14 }} /><i style={{ height: 10 }} /><i style={{ height: 16 }} /><i style={{ height: 9 }} />
        </span>
        <div className="ctl">
          <button className="pp" aria-label={p.playing ? 'Pause' : 'Play'}
            onClick={(e) => { e.stopPropagation(); p.toggle(); }}>
            {p.loading ? <span className="spin-sm" /> : <Icon n={p.playing ? 'pause' : 'play'} size={16} />}</button>
          <button aria-label="Next" onClick={(e) => { e.stopPropagation(); p.step(1); }}>
            <Icon n="next" size={15} /></button>
        </div>
        <span className="prog" style={{ width: pct + '%' }} />
      </div>
    </div>);
}
