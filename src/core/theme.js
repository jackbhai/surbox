/**
 * Theme Manager - Settings Page Feature
 * Supports multiple themes + Make Your Own Theme
 * Stores in localStorage, applies via CSS variables
 */

const THEME_KEY = 'omni:theme';
const CUSTOM_THEME_KEY = 'omni:custom-theme';

export const THEMES = {
  dark: {
    id: 'dark',
    name: 'Dark (Default)',
    nameHi: 'डार्क (डिफॉल्ट)',
    description: 'AMOLED black + green + cyan - Battery saving',
    colors: {
      '--bg': '#000000',
      '--s1': '#080B0A',
      '--s2': '#0E1412',
      '--s3': '#141C19',
      '--line': '#1C2724',
      '--line2': '#26332F',
      '--green': '#00FF9C',
      '--green-dim': '#00C77A',
      '--cyan': '#00E5FF',
      '--cyan-dim': '#00B4CC',
      '--fg': '#E8FFF4',
      '--fg2': '#9DB5AC',
      '--fg3': '#5E736C',
      '--warn': '#FFD166',
      '--bad': '#FF5C7A',
    },
    isDark: true,
  },
  violet: {
    id: 'violet',
    name: 'Electric Violet',
    nameHi: 'इलेक्ट्रिक वायलेट',
    description: 'True black + electric violet accent - Cinematic premium',
    colors: {
      '--bg': '#000000',
      '--s1': '#070508',
      '--s2': '#0D0A10',
      '--s3': '#141018',
      '--line': '#1D1622',
      '--line2': '#2A2033',
      '--green': '#B18CFF',
      '--green-dim': '#8F6BE8',
      '--cyan': '#7B5CFF',
      '--cyan-dim': '#5F44D8',
      '--fg': '#F2EDFF',
      '--fg2': '#A99CC4',
      '--fg3': '#635876',
      '--warn': '#FFD166',
      '--bad': '#FF5C7A',
    },
    isDark: true,
  },
  light: {
    id: 'light',
    name: 'Light',
    nameHi: 'लाइट',
    description: 'Clean white + green - Day mode',
    colors: {
      '--bg': '#FFFFFF',
      '--s1': '#F5F7F6',
      '--s2': '#E8EFEC',
      '--s3': '#DDE8E3',
      '--line': '#C5D6CF',
      '--line2': '#A8C0B5',
      '--green': '#00A86B',
      '--green-dim': '#008F5B',
      '--cyan': '#0096C7',
      '--cyan-dim': '#0077B6',
      '--fg': '#0A1F18',
      '--fg2': '#4A6B5E',
      '--fg3': '#7A9B8E',
      '--warn': '#B8860B',
      '--bad': '#D32F2F',
    },
    isDark: false,
  },
  amoled: {
    id: 'amoled',
    name: 'AMOLED Pure Black',
    nameHi: 'एमोलेड प्योर ब्लैक',
    description: 'Pure black #000000 - Maximum battery saving',
    colors: {
      '--bg': '#000000',
      '--s1': '#000000',
      '--s2': '#0A0A0A',
      '--s3': '#141414',
      '--line': '#1A1A1A',
      '--line2': '#2A2A2A',
      '--green': '#00FF88',
      '--green-dim': '#00CC6A',
      '--cyan': '#00D4FF',
      '--cyan-dim': '#00A8CC',
      '--fg': '#FFFFFF',
      '--fg2': '#A0A0A0',
      '--fg3': '#606060',
      '--warn': '#FFCC00',
      '--bad': '#FF3366',
    },
    isDark: true,
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean Blue',
    nameHi: 'ओशन ब्लू',
    description: 'Deep blue + cyan - Calm and cool',
    colors: {
      '--bg': '#001122',
      '--s1': '#001A33',
      '--s2': '#002244',
      '--s3': '#002A55',
      '--line': '#003366',
      '--line2': '#004477',
      '--green': '#00FFCC',
      '--green-dim': '#00CCAA',
      '--cyan': '#00CCFF',
      '--cyan-dim': '#0099CC',
      '--fg': '#CCEEFF',
      '--fg2': '#88BBDD',
      '--fg3': '#557799',
      '--warn': '#FFAA00',
      '--bad': '#FF5566',
    },
    isDark: true,
  },
  forest: {
    id: 'forest',
    name: 'Forest Green',
    nameHi: 'फॉरेस्ट ग्रीन',
    description: 'Deep green + earth - Natural',
    colors: {
      '--bg': '#0A1A0A',
      '--s1': '#102010',
      '--s2': '#152A15',
      '--s3': '#1A331A',
      '--line': '#204020',
      '--line2': '#2A552A',
      '--green': '#66FF66',
      '--green-dim': '#44CC44',
      '--cyan': '#88FF88',
      '--cyan-dim': '#66CC66',
      '--fg': '#CCFFCC',
      '--fg2': '#88AA88',
      '--fg3': '#557755',
      '--warn': '#FFCC66',
      '--bad': '#FF7777',
    },
    isDark: true,
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset Orange',
    nameHi: 'सनसेट ऑरेंज',
    description: 'Warm orange + purple - Energetic',
    colors: {
      '--bg': '#1A0A00',
      '--s1': '#261500',
      '--s2': '#331E00',
      '--s3': '#402600',
      '--line': '#553300',
      '--line2': '#774400',
      '--green': '#FFAA00',
      '--green-dim': '#CC8800',
      '--cyan': '#FF6600',
      '--cyan-dim': '#CC5200',
      '--fg': '#FFEECC',
      '--fg2': '#CCAA88',
      '--fg3': '#997755',
      '--warn': '#FFCC00',
      '--bad': '#FF4444',
    },
    isDark: true,
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Purple',
    nameHi: 'मिडनाइट पर्पल',
    description: 'Deep purple + pink - Mysterious',
    colors: {
      '--bg': '#0F0A1A',
      '--s1': '#1A1030',
      '--s2': '#251540',
      '--s3': '#301A50',
      '--line': '#402060',
      '--line2': '#552A80',
      '--green': '#AA66FF',
      '--green-dim': '#8844CC',
      '--cyan': '#FF66CC',
      '--cyan-dim': '#CC44AA',
      '--fg': '#EEDDFF',
      '--fg2': '#AA88CC',
      '--fg3': '#775599',
      '--warn': '#FFCC66',
      '--bad': '#FF6666',
    },
    isDark: true,
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   THEME FAMILIES — one hue, its whole wardrobe.

   A "family" theme is generated from a single base hue: every surface, line
   and text colour carries a whisper of it, and both accents are drawn from
   neighbouring shades — a Blood Red theme is REDS (surface tint, rose
   highlights, ember secondary), never one flat red dropped on grey.

   Hand-tuned entries above stay; these are derived. True black background
   on every dark family — the AMOLED promise is not negotiable.
   ═══════════════════════════════════════════════════════════════════════════ */
const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360}, ${s}%, ${l}%)`;

function family(id, name, description, h, o = {}) {
  const SS = o.ss ?? 24;                       // how strongly surfaces carry the hue
  const AS = o.as ?? 86;                       // accent saturation
  const AL = o.al ?? 62;                       // accent lightness
  const H2 = h + (o.shift ?? 42);              // secondary accent hue
  const AS2 = o.as2 ?? 90;
  return {
    id, name, description,
    colors: {
      '--bg': '#000000',
      '--s1': hsl(h, SS, 3.5),
      '--s2': hsl(h, SS, 6),
      '--s3': hsl(h, SS + 3, 9),
      '--line': hsl(h, SS, 10.5),
      '--line2': hsl(h, SS, 15.5),
      '--green': hsl(h, AS, AL),
      '--green-dim': hsl(h, AS, Math.max(28, AL - 17)),
      '--cyan': hsl(H2, AS2, Math.min(80, AL + 3)),
      '--cyan-dim': hsl(H2, AS2, Math.max(30, AL - 13)),
      '--fg': hsl(h, 26, 93),
      '--fg2': hsl(h, 16, 70),
      '--fg3': hsl(h, 12, 50),
      '--warn': '#FFD166',
      '--bad': '#FF5C7A',
    },
    isDark: true,
  };
}

const FAMILIES = [
  // greens / cyans
  ['mint',      'Neon Mint',        'Mint green family, crisp and cool', 158],
  ['cyancyber', 'Cyber Cyan',       'Electric cyan family, techy and bright', 188],
  ['teal',      'Deep Teal',        'Teal family, calm water deep', 172, { al: 58 }],
  ['arctic',    'Arctic Mint',      'Pale ice mint, soft on the eyes', 166, { ss: 12, al: 70 }],
  ['emerald',   'Emerald',          'Gemstone greens with gold edge', 152, { shift: 34, al: 58 }],
  // greens — wild side
  ['lime',      'Acid Lime',        'Sour lime family, loud and fast', 88],
  ['toxic',     'Toxic Waste',      'Radioactive green with hazard glow', 96, { shift: -60 }],
  // violets
  ['venom',     'Venom Violet',     'Toxic violet with acid-green bite', 283, { shift: -150 }],
  ['uv',        'Ultraviolet',      'Deep UV violet family', 258, { shift: 36 }],
  ['indigo',    'Indigo Night',     'Indigo family, midnight denim', 245, { al: 66 }],
  // blues
  ['navy',      'Midnight Navy',    'Navy family, deep sea at night', 224, { as: 82, al: 60 }],
  ['sky',       'Sky Blue',         'Open-sky blues, light and airy', 198, { al: 66 }],
  ['ice',       'Ice Blue',         'Glacier blues, quiet and pale', 192, { ss: 10, al: 70 }],
  ['steel',     'Steel Blue',       'Muted steel, professional calm', 215, { ss: 8, as: 45, al: 72 }],
  ['neonblue',  'Neon Blue',        'Saturated electric blue', 222],
  // magentas / pinks
  ['magenta',   'Cyberpunk',        'Magenta family, neon city night', 300, { shift: 50 }],
  ['vapor',     'Vaporwave',        'Pink and cyan, retro-future', 310, { shift: 130 }],
  ['pink',      'Hot Pink',         'Vivid pink family', 330, { al: 66 }],
  ['rose',      'Rose Gold',        'Soft rose family, warm and gentle', 338, { ss: 18, al: 68 }],
  ['sakura',    'Sakura',           'Cherry blossom pinks, spring dark', 325, { ss: 16, al: 74 }],
  // reds — the requested family
  ['blood',     'Blood Red',        'Deep blood reds with ember glow', 354, { shift: -16, as: 84, al: 60 }],
  ['crimson',   'Crimson',          'Rich crimson family, dark and royal', 350, { ss: 30, al: 56 }],
  ['wine',      'Burgundy Wine',    'Wine-dark family, aged and deep', 345, { ss: 26, al: 54, shift: -20 }],
  // warm
  ['lava',      'Molten Lava',      'Lava oranges with red core', 14, { shift: -18 }],
  ['coral',     'Coral',            'Warm coral family, beach at dusk', 6, { al: 68 }],
  ['amber',     'Amber Gold',       'Golden amber family, honey light', 40, { shift: 15, al: 60 }],
  ['peach',     'Peach',            'Soft peach family, warm pastel', 22, { ss: 16, al: 70 }],
  ['mocha',     'Coffee Mocha',     'Coffee-brown family, cafe hours', 27, { ss: 14, as: 50, al: 64 }],
  ['copper',    'Copper',           'Metallic copper with warm edge', 30, { as: 72, al: 60 }],
  ['gold',      'Royal Gold',       'Regal golds, throne room warm', 46, { al: 58 }],
  // mono
  ['graphite',  'Graphite',         'Near-mono greys, white accent', 220, { ss: 5, as: 8, al: 86 }],
];

for (const [id, name, description, h, o] of FAMILIES) {
  THEMES[id] = family(id, name, description, h, o || {});
}

/** Build a custom theme from raw maker settings (used by the theme screen). */
export function makeCustom({ h = 158, h2 = 200, ss = 24, as = 86, al = 62 } = {}) {
  return {
    id: 'custom',
    name: 'My Theme',
    description: `Custom family — hue ${Math.round(h)}°, accent pair ${Math.round(h)}°/${Math.round(((h2 % 360) + 360) % 360)}°`,
    colors: {
      '--bg': '#000000',
      '--s1': hsl(h, ss, 3.5),
      '--s2': hsl(h, ss, 6),
      '--s3': hsl(h, ss + 3, 9),
      '--line': hsl(h, ss, 10.5),
      '--line2': hsl(h, ss, 15.5),
      '--green': hsl(h, as, al),
      '--green-dim': hsl(h, as, Math.max(28, al - 17)),
      '--cyan': hsl(h2, 90, Math.min(80, al + 3)),
      '--cyan-dim': hsl(h2, 90, Math.max(30, al - 13)),
      '--fg': hsl(h, 26, 93),
      '--fg2': hsl(h, 16, 70),
      '--fg3': hsl(h, 12, 50),
      '--warn': '#FFD166',
      '--bad': '#FF5C7A',
    },
    isDark: true,
  };
}

export function getCurrentThemeId() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

export function getCustomTheme() {
  try {
    const custom = localStorage.getItem(CUSTOM_THEME_KEY);
    return custom ? JSON.parse(custom) : null;
  } catch {
    return null;
  }
}

export function saveCustomTheme(theme) {
  try {
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(theme));
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(themeId) {
  const custom = getCustomTheme();
  
  let theme;
  if (themeId === 'custom' && custom) {
    theme = custom;
  } else {
    theme = THEMES[themeId] || THEMES.dark;
  }

  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }

  // Set color-scheme for browser widgets
  root.style.setProperty('color-scheme', theme.isDark ? 'dark' : 'light');

  // Update theme-color meta
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.content = theme.colors['--bg'] || '#000000';
  }

  // Save
  try {
    localStorage.setItem(THEME_KEY, themeId);
  } catch {}

  return theme;
}

export function initTheme() {
  const themeId = getCurrentThemeId();
  return applyTheme(themeId);
}

// For settings page - list all themes including custom if exists
export function getAllThemes() {
  const custom = getCustomTheme();
  const all = { ...THEMES };
  if (custom) {
    all.custom = custom;
  }
  return all;
}
