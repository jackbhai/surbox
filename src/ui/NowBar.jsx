/**
 * NowBar — the glass mini player.
 *
 * Three superpowers:
 *   · DRAG IT ANYWHERE — grab the bar (not its buttons) and it lifts out of
 *     the dock and follows the finger; drop it anywhere on screen and it
 *     stays there (remembered per device). Drop it back near the bottom and
 *     it snaps into the dock again.
 *   · DISMISS IT — the ✕ slides the bar away with an exit animation and
 *     stops playback.
 *   · IT DRESSES LIKE THE SONG — the play button, progress line and EQ bars
 *     take their colours from the current artwork's palette.
 *
 * A tap that never moved more than a few pixels counts as a tap, not a
 * drag — it opens the full player, exactly as before.
 */
import React, { useEffect, useRef, useState } from 'react';
import { usePlayer } from '../core/player';
import { useArtTheme, artStyle } from '../core/art-theme';
import { Icon } from './icons';

const POS_KEY = 'omni:nowpos';
const readPos = () => {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    return p && isFinite(p.x) && isFinite(p.y) ? p : null;
  } catch { return null; }
};

export function NowBar() {
  const p = usePlayer();
  const pal = useArtTheme(p?.track?.art);
  const barRef = useRef(null);
  const [free, setFree] = useState(null);          // {x,y} once dragged free
  const [pos, setPos] = useState(null);            // live position while dragging
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const drag = useRef(null);                       // {sx,sy,ox,oy,w,h,moved}

  /* a remembered free position re-applies on mount */
  useEffect(() => { setFree(readPos()); }, []);

  if (!p?.track) return null;

  const acc = artStyle(pal);

  const close = (e) => {
    e.stopPropagation();
    if (closing) return;
    setClosing(true);
    setTimeout(() => { p.stop(); setClosing(false); }, 300);
  };

  /* ---------------------------------------------------------- dragging */
  const onPointerDown = (e) => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    const bar = barRef.current;
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const base = free || { x: r.left, y: r.top };
    drag.current = { sx: e.clientX, sy: e.clientY, ox: base.x, oy: base.y, w: r.width, h: r.height, moved: false };
    setFree(base);
    setDragging(true);
    try { bar.setPointerCapture(e.pointerId); } catch {}
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    setPos({
      x: Math.max(8, Math.min(window.innerWidth - d.w - 8, d.ox + dx)),
      y: Math.max(8, Math.min(window.innerHeight - d.h - 8, d.oy + dy)),
    });
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (!d.moved) {                       // it was a tap all along
      setPos(null);
      p.setFull(true);
      return;
    }
    const at = pos || { x: d.ox, y: d.oy };
    /* dropped near the bottom-centre: snap back into the dock */
    const nearDock = at.y > window.innerHeight - 160 &&
      Math.abs(at.x + d.w / 2 - window.innerWidth / 2) < window.innerWidth * 0.32;
    if (nearDock) {
      setFree(null); setPos(null);
      try { localStorage.removeItem(POS_KEY); } catch {}
    } else {
      setFree(at); setPos(null);
      try { localStorage.setItem(POS_KEY, JSON.stringify(at)); } catch {}
    }
  };

  /* ------------------------------------------------------------ render */
  const content = (
    <>
      {p.track.art
        ? <img className="art" src={p.track.art} alt="" draggable={false} />
        : <span className="artph"><Icon n="music" size={18} /></span>}
      <div className="meta">
        <b>{p.track.title || 'Untitled'}</b>
        <span>{p.track.artist || ''}</span>
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
        <button className="cls" aria-label="Stop and close player" title="Stop music"
          onClick={close}><Icon n="x" size={13} /></button>
      </div>
      <span className="prog" style={{ width: progPct(p) + '%' }} />
    </>
  );

  const handlers = {
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
    onContextMenu: (e) => e.preventDefault(),
  };

  if (free) {
    const at = pos || free;
    return (
      <div ref={barRef} className={`sb-now free ${dragging ? 'dragging' : ''} ${closing ? 'out' : ''}`}
        style={{ left: at.x, top: at.y, width: Math.min(440, window.innerWidth - 20), ...acc }}
        role="button" aria-label="Mini player — drag to move" {...handlers}>
        {content}
      </div>);
  }
  return (
    <div className="sb-nowwrap">
      <div ref={barRef} className={`sb-now ${dragging ? 'dragging' : ''} ${closing ? 'out' : ''}`}
        style={acc} role="button" aria-label="Open player" {...handlers}>
        {content}
      </div>
    </div>);
}

const progPct = (p) => {
  const dur = (isFinite(p.dur) && p.dur > 0) ? p.dur : (p.track?.dur || 0);
  return dur ? Math.min(100, (p.pos / dur) * 100) : 0;
};
