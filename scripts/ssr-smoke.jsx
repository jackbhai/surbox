/**
 * SSR smoke render — catches runtime reference errors (the class of bug a
 * syntax-passing build cannot see) on every screen, before deploy.
 *
 * Renders, with mocked browser globals:
 *   1. Onboarding (fresh user)
 *   2. The shell + Home (onboarded user)
 *   3. SearchScreen, LibraryScreen (every segment)
 *
 * Run: vite build --ssr scripts/ssr-smoke.jsx --outDir .ssr-smoke --emptyOutDir
 *      node .ssr-smoke/ssr-smoke.js
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import App from '../src/App';
import SearchScreen from '../src/screens/SearchScreen';
import LibraryScreen from '../src/screens/LibraryScreen';
import { PlayerProvider } from '../src/core/player';

/* ---- minimal browser mocks ---- */
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.navigator = { userAgent: 'node', mediaSession: undefined, standalone: false };
global.document = {
  referrer: '',
  createElement: () => ({ style: {}, setAttribute: () => {}, append: () => {}, click: () => {}, href: '' }),
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  body: { appendChild: () => {} },
};
global.window = global;
global.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.location = { origin: 'https://surbox.test', pathname: '/', hash: '' };
global.requestAnimationFrame = () => 0;
global.confirm = () => true;

const check = (name, el) => {
  const html = renderToString(el);
  if (!html || html.length < 40) throw new Error(`${name}: rendered empty output`);
  console.log(`  ✓ ${name} — ${html.length} chars`);
};

let failures = 0;
const run = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { failures++; console.error(`✗ ${name}: ${e.message}`); }
};

console.log('SSR smoke — SurBox');

run('Onboarding (fresh user)', () => {
  store.clear();
  check('welcome', React.createElement(App));
});

run('Shell + Home (onboarded)', () => {
  store.clear();
  store.set('omni:onb', '1');
  store.set('omni:music-prefs', JSON.stringify({
    languages: ['Punjabi'], artists: ['Babbu Maan'], genres: ['Pop'], moods: ['Happy'],
  }));
  store.set('omni:lib:time', JSON.stringify({
    total: 600, tracks: { a: 300 }, artists: { 'Babbu Maan': 300 },
    days: { [new Date().toISOString().slice(0, 10)]: 600 },
  }));
  store.set('omni:lib:hist', JSON.stringify([
    { id: 'x1', title: 'Test', artist: 'A', art: '', dur: 200 },
  ]));
  check('home', React.createElement(App));
});

run('Search + Library screens', () => {
  for (const seg of ['songs', 'lists', 'down', 'stats', 'app']) {
    check(`library/${seg}`, React.createElement(
      PlayerProvider, null, React.createElement(LibraryScreen, { initial: seg })));
  }
  check('search', React.createElement(
    PlayerProvider, null, React.createElement(SearchScreen)));
});

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL RENDERS CLEAN');
