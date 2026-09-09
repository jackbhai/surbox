/**
 * Music Preferences Editor
 * 
 * A complete preference setting UI where users can:
 * - Select languages
 * - Add favorite artists
 * - Pick genres
 * - Choose moods
 * - Select eras
 */
import React, { useState, useEffect } from 'react';
import { Icon } from '../ui/icons';
import { Card } from '../ui/kit';
import {
  getPreferences, savePreferences, hasPreferences, clearPreferences,
  addArtist, removeArtist, toggleLanguage, toggleGenre, toggleMood, toggleEra,
  AVAILABLE_LANGUAGES, AVAILABLE_GENRES, AVAILABLE_MOODS, AVAILABLE_ERAS,
} from '../core/preferences';

export function PreferencesEditor({ onClose, onChange }) {
  const [prefs, setPrefs] = useState(getPreferences());
  const [newArtist, setNewArtist] = useState('');
  const [section, setSection] = useState('lang');

  const refresh = () => {
    const p = getPreferences();
    setPrefs(p);
    onChange?.(p);
  };

  const handleToggleLang = (lang) => {
    toggleLanguage(lang);
    refresh();
  };

  const handleToggleGenre = (genre) => {
    toggleGenre(genre);
    refresh();
  };

  const handleToggleMood = (mood) => {
    toggleMood(mood);
    refresh();
  };

  const handleToggleEra = (era) => {
    toggleEra(era);
    refresh();
  };

  const handleAddArtist = () => {
    if (newArtist.trim()) {
      addArtist(newArtist.trim());
      setNewArtist('');
      refresh();
    }
  };

  const handleRemoveArtist = (name) => {
    removeArtist(name);
    refresh();
  };

  const handleClear = () => {
    if (confirm('Clear all preferences? Your personalized recommendations will reset.')) {
      clearPreferences();
      refresh();
    }
  };

  const sections = [
    ['lang', 'Languages', 'globe'],
    ['artists', 'Artists', 'smile'],
    ['genres', 'Genres', 'music'],
    ['moods', 'Moods', 'heart'],
    ['eras', 'Eras', 'clock'],
  ];

  return (
    <div style={{ padding: '0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Icon n="cog" size={20} style={{ color: 'var(--green)' }} />
        <b style={{ fontSize: 16, flex: 1 }}>Music Preferences</b>
        <button className="btn ghost sm" onClick={handleClear}
          style={{ fontSize: 11, padding: '4px 8px' }}>
          <Icon n="x" size={12} /> Reset
        </button>
      </div>

      <div className="dim sm" style={{ marginBottom: 12, lineHeight: 1.6 }}>
        Set your preferences and the home screen will show personalized songs,
        artists and recommendations just for you.
      </div>

      {/* Section tabs */}
      <div className="cats" style={{ marginBottom: 12 }}>
        {sections.map(([id, label, ic]) => (
          <button key={id} className={`cat ${section === id ? 'on' : ''}`}
            onClick={() => setSection(id)}>
            <Icon n={ic} size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Languages */}
      {section === 'lang' && (
        <Card>
          <div className="chead">
            <Icon n="globe" size={15} /> Select your languages
          </div>
          <div className="dim sm" style={{ marginBottom: 10 }}>
            Pick the languages you love — songs in these languages will appear first.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVAILABLE_LANGUAGES.map((lang) => {
              const on = prefs.languages.includes(lang);
              return (
                <button key={lang} className={`cat ${on ? 'on' : ''}`}
                  onClick={() => handleToggleLang(lang)}
                  style={{ fontSize: 12, padding: '6px 12px' }}>
                  {lang}
                </button>
              );
            })}
          </div>
          {prefs.languages.length > 0 && (
            <div className="dim sm" style={{ marginTop: 10, fontSize: 11 }}>
              Selected: {prefs.languages.join(', ')}
            </div>
          )}
        </Card>
      )}

      {/* Artists */}
      {section === 'artists' && (
        <Card>
          <div className="chead">
            <Icon n="smile" size={15} /> Favorite Artists
          </div>
          <div className="dim sm" style={{ marginBottom: 10 }}>
            Add up to 20 artists you love. Their songs and similar artists will be recommended.
          </div>
          <div className="fld" style={{ marginBottom: 10 }}>
            <div className="ip-wrap">
              <Icon n="plus" size={15} />
              <input value={newArtist}
                onChange={(e) => setNewArtist(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddArtist(); }}
                placeholder="Type artist name and press Enter…"
                maxLength={50} />
              <button className="ip-x" disabled={!newArtist.trim()}
                onClick={handleAddArtist} aria-label="Add">
                <Icon n="check" size={15} />
              </button>
            </div>
          </div>
          {prefs.artists.length === 0 ? (
            <div className="dim sm" style={{ textAlign: 'center', padding: '16px 0' }}>
              No artists added yet. Type a name above!
            </div>
          ) : (
            <div className="list" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {prefs.artists.map((name) => (
                <div className="row" key={name}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%',
                    background: 'var(--s3)', display: 'grid', placeItems: 'center',
                    flex: '0 0 auto', color: 'var(--green)' }}>
                    <Icon n="smile" size={16} />
                  </div>
                  <div className="main">
                    <b style={{ fontSize: 13 }}>{name}</b>
                  </div>
                  <button className="rowbtn" onClick={() => handleRemoveArtist(name)}
                    aria-label="Remove">
                    <Icon n="x" size={14} style={{ color: 'var(--fg3)' }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="dim sm" style={{ marginTop: 8, fontSize: 11 }}>
            {prefs.artists.length}/20 artists
          </div>
        </Card>
      )}

      {/* Genres */}
      {section === 'genres' && (
        <Card>
          <div className="chead">
            <Icon n="music" size={15} /> Favorite Genres
          </div>
          <div className="dim sm" style={{ marginBottom: 10 }}>
            Pick genres you enjoy — we will prioritize songs in these styles.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVAILABLE_GENRES.map((genre) => {
              const on = prefs.genres.includes(genre);
              return (
                <button key={genre} className={`cat ${on ? 'on' : ''}`}
                  onClick={() => handleToggleGenre(genre)}
                  style={{ fontSize: 12, padding: '6px 12px' }}>
                  {genre}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Moods */}
      {section === 'moods' && (
        <Card>
          <div className="chead">
            <Icon n="heart" size={15} /> Mood Preferences
          </div>
          <div className="dim sm" style={{ marginBottom: 10 }}>
            What moods do you listen in? This helps us recommend the right vibe.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVAILABLE_MOODS.map((mood) => {
              const on = prefs.moods.includes(mood);
              return (
                <button key={mood} className={`cat ${on ? 'on' : ''}`}
                  onClick={() => handleToggleMood(mood)}
                  style={{ fontSize: 12, padding: '6px 12px' }}>
                  {mood}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Eras */}
      {section === 'eras' && (
        <Card>
          <div className="chead">
            <Icon n="clock" size={15} /> Era Preferences
          </div>
          <div className="dim sm" style={{ marginBottom: 10 }}>
            Prefer a certain era of music? Select your favorites.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AVAILABLE_ERAS.map((era) => {
              const on = prefs.eras.includes(era);
              return (
                <button key={era} className={`cat ${on ? 'on' : ''}`}
                  onClick={() => handleToggleEra(era)}
                  style={{ fontSize: 12, padding: '6px 12px' }}>
                  {era}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Save / Close */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn" style={{ flex: 1 }} onClick={onClose}>
          <Icon n="check" size={15} /> Done
        </button>
      </div>

      {/* Summary */}
      {hasPreferences() && (
        <div className="src" style={{ marginTop: 12 }}>
          <span className="dot" />
          <span>
            Your preferences: {prefs.languages.length} languages, {prefs.artists.length} artists,
            {prefs.genres.length} genres, {prefs.moods.length} moods, {prefs.eras.length} eras.
            Home screen will show personalized recommendations.
          </span>
        </div>
      )}
    </div>
  );
}
