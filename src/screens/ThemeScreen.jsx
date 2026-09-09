/**
 * Appearance — 35+ theme families and a custom maker.
 *
 * Every tap applies instantly (the whole app re-skins live, because themes
 * are just CSS variables). The custom maker slides four values — hue, second
 * hue, surface tint, accent lightness — and re-skins the app WHILE you drag,
 * so you taste the theme before committing it.
 */
import React, { useState } from 'react';
import { Icon } from '../ui/icons';
import { PageHead, SectionHead } from '../ui/bits';
import {
  THEMES, applyTheme, getCurrentThemeId, getCustomTheme, saveCustomTheme, makeCustom,
} from '../core/theme';

const readMaker = () => {
  const c = getCustomTheme();
  if (c?.maker) return c.maker;
  return { h: 158, h2: 200, ss: 24, as: 86, al: 62 };
};

export default function ThemeScreen({ onBack }) {
  const [active, setActive] = useState(() => getCurrentThemeId());
  const [mk, setMk] = useState(readMaker);
  const [makerOpen, setMakerOpen] = useState(() => getCurrentThemeId() === 'custom');

  const pick = (id) => { applyTheme(id); setActive(id); };

  /* Live preview: every slider move re-skins the app immediately. Commit
     happens on release (pointer up) — so a visitor who just peeks can slide
     back, and one who leaves keeps what they see. */
  const setVal = (k, v) => {
    const next = { ...mk, [k]: v };
    setMk(next);
    const theme = { ...makeCustom(next), maker: next };
    saveCustomTheme(theme);
    applyTheme('custom');
    setActive('custom');
  };

  const swatch = (t) => {
    const c = t.colors;
    const on = active === t.id;
    return (
      <button key={t.id} className={`swatch ${on ? 'on' : ''}`} onClick={() => pick(t.id)}
        aria-pressed={on}>
        <span className="sw">
          <span className="sw-bg" style={{ background: c['--s2'] }}>
            <i style={{ background: c['--green'] }} />
            <i style={{ background: c['--cyan'] }} />
            <i style={{ background: c['--fg2'] }} />
          </span>
          {on && <span className="sw-tick"><Icon n="check" size={11} /></span>}
        </span>
        <b>{t.name}</b>
      </button>);
  };

  const handTuned = ['dark', 'amoled', 'light', 'violet', 'ocean', 'forest', 'sunset', 'midnight'];
  const families = Object.values(THEMES).filter((t) => !handTuned.includes(t.id));
  const hand = handTuned.map((id) => THEMES[id]).filter(Boolean);

  return (
    <div className="pageanim">
      <PageHead icon="palette" title="APPEARANCE" sub="35+ families · every tap applies live" onBack={onBack} />

      <SectionHead icon="sparkle" title="Hand-tuned" />
      <div className="swatches">{hand.map(swatch)}</div>

      <SectionHead icon="disc" title="Families" />
      <p className="dim sm" style={{ margin: '0 0 12px' }}>
        Each family carries its hue through every surface, line and letter — one colour's whole wardrobe, not one flat colour.</p>
      <div className="swatches">{families.map(swatch)}</div>

      <SectionHead icon="pen" title="Your own" />
      <div className="glass" style={{ padding: 16 }}>
        <button className="btn ghost sm" style={{ width: '100%' }} onClick={() => setMakerOpen((v) => !v)}>
          <Icon n={makerOpen ? 'chevron' : 'pen'} size={14} style={{ transform: makerOpen ? 'rotate(180deg)' : 'none', transition: 'transform .25s' }} />
          {active === 'custom' ? 'Editing your theme' : 'Make a theme'}</button>

        {makerOpen && (<>
          <div className="mkrow">
            <label>Base hue<span className="mkdot" style={{ background: `hsl(${mk.h}, 86%, 62%)` }} /></label>
            <input type="range" min="0" max="359" value={mk.h}
              onChange={(e) => setVal('h', +e.target.value)} aria-label="Base hue" />
            <span className="mono mkv">{mk.h}°</span>
          </div>
          <div className="mkrow">
            <label>Second hue<span className="mkdot" style={{ background: `hsl(${mk.h2}, 90%, 65%)` }} /></label>
            <input type="range" min="0" max="359" value={mk.h2}
              onChange={(e) => setVal('h2', +e.target.value)} aria-label="Second hue" />
            <span className="mono mkv">{mk.h2}°</span>
          </div>
          <div className="mkrow">
            <label>Surface tint</label>
            <input type="range" min="0" max="45" value={mk.ss}
              onChange={(e) => setVal('ss', +e.target.value)} aria-label="Surface tint" />
            <span className="mono mkv">{mk.ss}</span>
          </div>
          <div className="mkrow">
            <label>Accent glow</label>
            <input type="range" min="45" max="80" value={mk.al}
              onChange={(e) => setVal('al', +e.target.value)} aria-label="Accent lightness" />
            <span className="mono mkv">{mk.al}</span>
          </div>
          <p className="dim sm" style={{ margin: '10px 0 0' }}>
            Drag — the whole app previews live. It saves itself; come back anytime and it is exactly where you left it.</p>
        </>)}
      </div>
    </div>);
}
