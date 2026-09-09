/**
 * SurBox v2 UI primitives — the small pieces the premium screens are built
 * from. Same theme DNA (neon green/cyan on true black), glass surfaces,
 * editorial section headers in the brand display face.
 */
import React, { useRef, useState } from 'react';
import { Icon } from './icons';

export const mmss = (s) => (!s || !isFinite(s)) ? '0:00'
  : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Play a list at index i, the way the whole app does it. */
export const playList = (player, list, i = 0) => {
  if (!list?.length || !player) return;
  player.play(list[i], list);
};

/* ---------------------------------------------------------- section head */
/** "MADE FOR YOU ————" editorial header, with optional "See all". */
export function SectionHead({ icon, title, onMore }) {
  return (
    <div className="sb-sec">
      {icon && <Icon n={icon} size={15} style={{ color: 'var(--green)' }} />}
      <h2>{title}</h2>
      <span className="ln" />
      {onMore && (
        <button className="more" onClick={onMore}>
          See all <Icon n="chevron" size={12} /></button>)}
    </div>);
}

/* --------------------------------------------------------------- shelves */
/** Horizontal snap-scroller. Children are usually ShelfCards. */
export function Shelf({ children }) {
  const ref = useRef(null);
  return <div className="shelf" ref={ref}>{children}</div>;
}

/**
 * One card in a shelf. `wide` renders a 246×138 landscape cover (mixes),
 * the default is a 138×138 square (songs/albums).
 */
export function ShelfCard({ art, title, sub, wide, onClick, onPlay, delay = 0, children }) {
  return (
    <div className={`shelfcard ${wide ? 'wide' : ''}`} onClick={onClick}
      style={{ animationDelay: `${delay * 45}ms` }}>
      <div className="cv">
        {art
          ? <img src={art} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
          : <div className="ph"><Icon n="music" size={wide ? 34 : 30} /></div>}
        {onPlay && (
          <button className="play" aria-label={`Play ${title || ''}`}
            onClick={(e) => { e.stopPropagation(); onPlay(); }}>
            <Icon n="play" size={15} /></button>)}
        {children}
      </div>
      <b>{title}</b>
      {sub && <small>{sub}</small>}
    </div>);
}

/* --------------------------------------------------------------- skeletons */
export function Skeleton({ kind = 'row', style }) {
  return <div className={`skel ${kind}`} style={style} />;
}

export function ShelfSkeleton({ n = 3, wide }) {
  return (<>
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} className={`shelfcard ${wide ? 'wide' : ''}`}>
        <div className={`skel ${wide ? 'hero' : 'card'}`} style={{ width: wide ? 246 : 138, height: 138, borderRadius: 18, margin: 0 }} />
        <div className="skel" style={{ height: 11, width: '80%', marginTop: 10, borderRadius: 5 }} />
        <div className="skel" style={{ height: 8, width: '50%', marginTop: 6, borderRadius: 4 }} />
      </div>))}
  </>);
}

/* -------------------------------------------------------------- page head */
/** Back-chevron + display title for secondary screens. */
export function PageHead({ icon, title, sub, onBack, right }) {
  return (
    <div className="sb-pagehead">
      <button className="back" onClick={onBack} aria-label="Back">
        <Icon n="back" size={17} /></button>
      {icon && <span style={{ color: 'var(--green)' }}><Icon n={icon} size={22} /></span>}
      <div className="tt" style={{ flex: 1, minWidth: 0 }}>
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
      {right}
    </div>);
}

/* ------------------------------------------------------------------ empty */
export function EmptyState({ icon = 'music', title, sub, action }) {
  return (
    <div className="sb-empty">
      <div className="ic"><Icon n={icon} size={26} /></div>
      <b>{title}</b>
      {sub && <span>{sub}</span>}
      {action}
    </div>);
}

/* ------------------------------------------------------------------- misc */
/** Time-of-day greeting — the home header says hello like a person would. */
export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Late night drop';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Night session';
};

/** Stable hue for a string — playlist covers get a colour that is theirs. */
export const hueOf = (s = '') => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

/** A gradient cover for things that have no artwork (playlists, genres). */
export const CoverGrad = ({ seed = '', icon = 'music', size = 26 }) => {
  const h = hueOf(seed);
  return (
    <div style={{
      width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#fff',
      background: `linear-gradient(135deg, hsl(${h},70%,32%), hsl(${(h + 70) % 360},80%,18%))`,
    }}>
      <Icon n={icon} size={size} />
    </div>);
};

/* ---------------------------------------------------------- collapsible */
/**
 * A section that folds away. The header stays; the body collapses with a
 * soft height+fade so a busy home can be emptied in two taps. Open/closed
 * is remembered per section, per device.
 */
export function Collapse({ icon, title, onMore, k, children }) {
  const [open, setOpen] = useState(() => {
    if (!k) return true;
    try { return localStorage.getItem('omni:col:' + k) !== '0'; } catch { return true; }
  });
  const toggle = () => setOpen((o) => {
    const n = !o;
    if (k) { try { localStorage.setItem('omni:col:' + k, n ? '1' : '0'); } catch {} }
    return n;
  });
  return (
    <div style={{ margin: '26px 0 0' }}>
      <div className="sb-sec" style={{ margin: 0 }}>
        {icon && <Icon n={icon} size={15} style={{ color: 'var(--green)' }} />}
        <h2 onClick={toggle} style={{ cursor: 'pointer' }}>{title}</h2>
        <span className="ln" />
        {onMore && <button className="more" onClick={onMore}>See all <Icon n="chevron" size={12} /></button>}
        <button className="colbtn" onClick={toggle} aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={open}>
          <Icon n="chevron" size={14} style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .28s cubic-bezier(.2,.9,.3,1.2)',
          }} />
        </button>
      </div>
      <div className={`coll ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="coll-in" style={{ paddingTop: 13 }}>{children}</div>
      </div>
    </div>);
}

/* --------------------------------------------------------- view toggle */
/** Row ⇄ Grid switch for any song list. Preference is remembered globally. */
export function ViewToggle({ view, onChange }) {
  const set = (v) => { try { localStorage.setItem('omni:listview', v); } catch {} onChange(v); };
  return (
    <div className="vtoggle" role="group" aria-label="View">
      <button className={view === 'row' ? 'on' : ''} onClick={() => set('row')}
        aria-label="List view" title="List view"><Icon n="list" size={15} /></button>
      <button className={view === 'grid' ? 'on' : ''} onClick={() => set('grid')}
        aria-label="Grid view" title="Grid view"><Icon n="grid" size={15} /></button>
    </div>);
}

/** Default list view from storage ('row' unless the user chose grid). */
export const readListView = () => {
  try { return localStorage.getItem('omni:listview') === 'grid' ? 'grid' : 'row'; } catch { return 'row'; }
};

/* ------------------------------------------------------------ grid list */
/**
 * Songs as a card grid — the alternate view for search results and library
 * lists. Big art, title, artist, a play badge that appears on hover/press,
 * and a subtle accent ring on the card that is actually playing.
 */
export function TrackGrid({ tracks, player, onPlay }) {
  return (
    <div className="tgrid">
      {tracks.map((t, i) => {
        const active = player?.track && (player.track.id ?? player.track.url) === (t.id ?? t.url);
        return (
          <div key={(t.id || t.url || t.title) + i} className={`tcard ${active ? 'act' : ''}`}
            onClick={() => onPlay(t, i)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onPlay(t, i); }}
            style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
            <div className="cv">
              {t.art
                ? <img src={t.art} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                : <div className="ph"><Icon n="music" size={26} /></div>}
              {active && player.playing && <span className="eqs"><i /><i /><i /></span>}
              <span className="badge" aria-hidden="true"><Icon n="play" size={13} /></span>
            </div>
            <b>{(t.title || 'Untitled').slice(0, 60)}</b>
            <small>{t.artist || '—'}</small>
          </div>);
      })}
    </div>);
}
