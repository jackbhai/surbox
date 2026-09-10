/**
 * Onboarding — the taste selector.
 *
 * Four screens, one promise: tell SurBox what you love once, and Home is
 * yours from the very first visit. Everything saves the moment it is tapped,
 * so closing halfway loses nothing.
 *
 *   · Welcome   — the brand says hello, shows what the next 30 seconds do
 *   · Languages — what you LISTEN in (Punjabi, Hindi, Bhojpuri…)
 *   · Artists   — who you play on loop (grid + search + add your own)
 *   · Vibes     — genres and moods as one big cloud
 *
 * Skippable everywhere; skipping still leaves whatever was already picked.
 */
import React, { useMemo, useState } from 'react';
import { Icon } from '../ui/icons';
import {
  getPreferences, toggleLanguage, toggleGenre, toggleMood, addArtist, removeArtist,
  AVAILABLE_LANGUAGES, AVAILABLE_GENRES, AVAILABLE_MOODS,
} from '../core/preferences';
import { TOP_ARTISTS } from '../core/catalogue';

const LANG_HINTS = {
  Punjabi: 'ਪੰਜਾਬੀ', Hindi: 'हिंदी', English: 'EN', Urdu: 'اردو', Tamil: 'தமிழ்',
  Telugu: 'తెలుగు', Bengali: 'বাংলা', Marathi: 'मराठी', Gujarati: 'ગુજરાતી',
  Bhojpuri: 'भोजपुरी', Kannada: 'ಕನ್ನಡ', Malayalam: 'മലയാളം', Odia: 'ଓଡ଼ିଆ',
  Assamese: 'অসমীয়া', Rajasthani: 'राजस्थानी', Haryanvi: 'हरियाणवी', Pakistani: 'پاکستانی',
};

const STEPS = ['Languages', 'Artists', 'Vibes'];

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(-1);           // -1 = welcome
  const [prefs, setPrefs] = useState(() => getPreferences());
  const refresh = () => setPrefs(getPreferences());
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length));
  const back = () => setStep((s) => Math.max(s - 1, -1));

  const skip = () => { try { localStorage.setItem('omni:onb', '1'); } catch {} onDone(); };
  const finish = () => { try { localStorage.setItem('omni:onb', '1'); } catch {} onDone(); };

  const picks = prefs.languages.length + prefs.artists.length + prefs.genres.length + prefs.moods.length;

  /* ---------------------------------------------------------- welcome */
  if (step === -1) return (
    <div className="onb">
      <div className="onb-top">
        <span className="sb-brand" style={{ fontSize: 22 }}>Sur<b>बॉक्स</b></span>
        <button className="onb-skip" onClick={skip}>Skip for now</button>
      </div>
      <div className="welcome">
        <div className="mark"><Icon n="music" size={46} /></div>
        <h1 className="wm">Sur<br /><b>बॉक्स</b></h1>
        <p className="tag">Ad-free music that knows you. Thirty seconds of picking, a home screen that is yours forever.</p>
        <div className="steps">
          <div><span className="n">ਅ</span> Languages</div>
          <div><span className="n">★</span> Artists</div>
          <div><span className="n">≈</span> Vibes</div>
        </div>
      </div>
      <div className="onb-foot">
        <button className="bigcta" onClick={() => setStep(0)}>
          Pick my taste <Icon n="next" size={16} /></button>
        <button className="ghostcta" onClick={skip}>Surprise me — straight to the music</button>
      </div>
    </div>);

  /* ---------------------------------------------------------- done */
  if (step >= STEPS.length) return (
    <div className="onb">
      <div className="onb-top">
        <span className="sb-brand" style={{ fontSize: 22 }}>Sur<b>बॉक्स</b></span>
      </div>
      <div className="welcome" style={{ animationDelay: '.05s' }}>
        <div className="mark" style={{ width: 88, height: 88 }}>
          <Icon n="check" size={38} /></div>
        <h1 style={{ fontSize: 46 }}>TASTE<br />LOCKED</h1>
        <p className="tag">
          {picks > 0
            ? `${prefs.languages.length} languages · ${prefs.artists.length} artists · ${prefs.genres.length + prefs.moods.length} vibes. Your home is built.`
            : 'No pressure — Home learns from whatever you play.'}
        </p>
      </div>
      <div className="onb-foot">
        <button className="bigcta" onClick={finish}>
          <Icon n="play" size={16} /> Start listening</button>
        <button className="ghostcta" onClick={() => setStep(0)}>
          <Icon n="back" size={14} /> Change my picks</button>
      </div>
    </div>);

  /* ------------------------------------------------------ step chrome */
  return (
    <div className="onb">
      <div className="onb-top">
        <div className="onb-dots">
          {STEPS.map((_, i) => <i key={i} className={i === step ? 'on' : i < step ? 'done' : ''}
            style={i < step ? { background: 'var(--green-dim)' } : {}} />)}
        </div>
        <button className="onb-skip" onClick={skip}>Done for now</button>
      </div>

      <div className="onb-body" key={step}>
        {step === 0 && (<>
          <div className="onb-kicker">Step 1 — Sound of home</div>
          <h2 className="onb-h">What do you<br />listen in?</h2>
          <p className="onb-sub">Pick every language you vibe with — recommendations mix them all.</p>
          <div className="onb-grid">
            {AVAILABLE_LANGUAGES.map((l) => {
              const on = prefs.languages.includes(l);
              return (
                <button key={l} className={`optile ${on ? 'on' : ''}`} onClick={() => { toggleLanguage(l); refresh(); }}>
                  <span style={{ fontSize: 17, color: 'var(--cyan)', width: 26, textAlign: 'center' }}>
                    {LANG_HINTS[l] || '♪'}</span>
                  <span style={{ flex: 1 }}>{l}</span>
                  <span className="tick"><Icon n="check" size={11} /></span>
                </button>);
            })}
          </div>
        </>)}

        {step === 1 && <ArtistStep prefs={prefs} refresh={refresh} />}

        {step === 2 && (<>
          <div className="onb-kicker">Step 3 — The vibe</div>
          <h2 className="onb-h">Genres &amp;<br />moods.</h2>
          <p className="onb-sub">The sound, and the feeling. Both feed your Daily Mix and radio seeds.</p>
          <div className="sb-sec" style={{ margin: '4px 0 12px' }}><h2 style={{ fontSize: 15 }}>Genres</h2><span className="ln" /></div>
          <div className="onb-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(104px,1fr))' }}>
            {AVAILABLE_GENRES.map((g) => {
              const on = prefs.genres.includes(g);
              return (
                <button key={g} className={`optile ${on ? 'on' : ''}`}
                  style={{ justifyContent: 'center', padding: '13px 8px' }}
                  onClick={() => { toggleGenre(g); refresh(); }}>
                  {g}
                  <span className="tick"><Icon n="check" size={11} /></span>
                </button>);
            })}
          </div>
          <div className="sb-sec" style={{ margin: '20px 0 12px' }}><h2 style={{ fontSize: 15 }}>Moods</h2><span className="ln" /></div>
          <div className="onb-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(104px,1fr))' }}>
            {AVAILABLE_MOODS.map((m) => {
              const on = prefs.moods.includes(m);
              return (
                <button key={m} className={`optile ${on ? 'on' : ''}`}
                  style={{ justifyContent: 'center', padding: '13px 8px' }}
                  onClick={() => { toggleMood(m); refresh(); }}>
                  {m}
                  <span className="tick"><Icon n="check" size={11} /></span>
                </button>);
            })}
          </div>
        </>)}
      </div>

      <div className="onb-foot">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="onb-back" onClick={back}>
            <Icon n="back" size={14} /> Back</button>
          <span className="onb-count" style={{ flex: 1, textAlign: 'center' }}>{picks} picks so far</span>
          <button className="bigcta" style={{ width: 'auto', padding: '13px 26px' }}
            onClick={next}>
            {step === STEPS.length - 1 ? 'Done' : 'Next'} <Icon n="next" size={15} /></button>
        </div>
      </div>
    </div>);
}

/* ------------------------------------------------------------ artist step */
/**
 * The heart of onboarding. A searchable, tappable grid of the artists India
 * actually plays (Top 100 catalogue seed), plus a free-text add for anyone
 * we did not list. Selecting is instant and persisted.
 */
function ArtistStep({ prefs, refresh }) {
  const [filter, setFilter] = useState('');
  const chosen = new Set(prefs.artists);

  const pool = useMemo(() => {
    const base = [...new Set([...TOP_ARTISTS, ...prefs.artists])];
    const f = filter.trim().toLowerCase();
    return f ? base.filter((a) => a.toLowerCase().includes(f)) : base;
  }, [filter, prefs.artists]);

  const toggle = (name) => {
    if (chosen.has(name)) removeArtist(name); else addArtist(name);
    refresh();
  };

  const addCustom = () => {
    const v = filter.trim();
    if (!v) return;
    addArtist(v); setFilter(''); refresh();
  };

  const exact = pool.some((a) => a.toLowerCase() === filter.trim().toLowerCase());

  return (<>
    <div className="onb-kicker">Step 2 — On repeat</div>
    <h2 className="onb-h">Who do you<br />play on loop?</h2>
    <p className="onb-sub">Pick three or more — the more you pick, the better day-one Home gets.</p>

    <div className="sb-search" style={{ margin: '0 0 16px' }}>
      <div className="box" style={{ padding: '11px 14px' }}>
        <Icon n="search" size={16} style={{ color: 'var(--fg3)' }} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter artists…" autoComplete="off" />
        {filter.trim() && !exact && (
          <button className="mic" style={{ background: 'rgba(0,255,156,.12)', color: 'var(--green)' }}
            onClick={addCustom} title={`Add "${filter.trim()}"`} aria-label="Add custom artist">
            <Icon n="plus" size={15} /></button>)}
        {filter && (
          <button className="mic" style={{ background: 'transparent', color: 'var(--fg3)' }}
            onClick={() => setFilter('')} aria-label="Clear filter">
            <Icon n="x" size={14} /></button>)}
      </div>
      {filter.trim() && !exact && pool.length > 0 && (
        <div className="tips" style={{ position: 'static', marginTop: 8 }}>
          <button onClick={addCustom}>
            <Icon n="plus" size={14} style={{ color: 'var(--green)' }} />
            Add &ldquo;{filter.trim()}&rdquo; as a favourite artist</button>
        </div>)}
    </div>

    <div className="onb-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))' }}>
      {pool.map((a) => {
        const on = chosen.has(a);
        const initials = a.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
        return (
          <button key={a} className={`artpick ${on ? 'on' : ''}`} onClick={() => toggle(a)}>
            <span className="tick"><Icon n="check" size={10} /></span>
            <span className="av">{initials}</span>
            <b>{a}</b>
          </button>);
      })}
      {pool.length === 0 && (
        <div className="sb-empty" style={{ gridColumn: '1/-1', padding: '30px 10px' }}>
          <b>No match</b>
          <span>Type the name above and tap ＋ to add &ldquo;{filter.trim()}&rdquo; as your artist.</span>
        </div>)}
    </div>
  </>);
}
