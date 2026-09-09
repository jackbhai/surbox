/**
 * Art-theme — the app dresses in the colours of whatever is playing.
 *
 * A 24×24 downscale of the artwork is read back from a canvas and its pixels
 * bucketed by hue (dark and grey pixels are skipped — they carry no accent).
 * The two richest buckets become the accents: a1 (primary) drives what the
 * theme calls --green, a2 drives --cyan. Setting those two variables on any
 * container re-skins everything inside it — play buttons, progress, chips,
 * EQ bars — with zero per-component work.
 *
 * Tainted-canvas honesty: if the CDN does not send CORS headers, reading the
 * pixels throws and we resolve null — the UI then keeps the default accent
 * rather than guessing. Every URL's palette is cached forever (a song's
 * colours do not change), so repeat plays re-theme instantly.
 */
import { useEffect, useState } from 'react';

const cache = new Map();

const rgbToHue = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};

/** Dominant-accent pair for an image URL: { a1, a2 } as hsl() strings. */
export function extractPalette(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const s = 24;
        const c = document.createElement('canvas');
        c.width = s; c.height = s;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, s, s);
        const d = ctx.getImageData(0, 0, s, s).data;
        const buckets = new Map();          // hue-bucket -> {r,g,b,w}
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx < 42 || mx - mn < 26) continue;   // too dark / too grey
          const key = Math.floor(rgbToHue(r, g, b) / 30);
          const cur = buckets.get(key) || { r: 0, g: 0, b: 0, w: 0 };
          cur.r += r; cur.g += g; cur.b += b;
          cur.w += (mx - mn) / mn * 4 + 1;          // vivid pixels weigh more
          buckets.set(key, cur);
        }
        if (!buckets.size) { resolve(null); return; }
        const sorted = [...buckets.entries()].sort((a, b) => b[1].w - a[1].w);
        const mk = (e, l, s) => {
          const v = e[1];
          const h = Math.round(rgbToHue(v.r / v.w * 4, v.g / v.w * 4, v.b / v.w * 4) + 360) % 360;
          return `hsl(${h}, ${s}%, ${l}%)`;
        };
        const a1 = mk(sorted[0], 60, 78);
        const a2 = sorted[1] && sorted[1][1].w > sorted[0][1].w * 0.28
          ? mk(sorted[1], 55, 84)
          : mk(sorted[0], 66, 90);        // same hue, lighter — still a pair
        resolve({ a1, a2 });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cache.set(url, p);
  return p;
}

/** React hook: the accent pair for the current artwork, or null. */
export function useArtTheme(art) {
  const [pal, setPal] = useState(null);
  useEffect(() => {
    let live = true;
    setPal(null);
    if (!art) return undefined;
    extractPalette(art).then((v) => { if (live) setPal(v); });
    return () => { live = false; };
  }, [art]);
  return pal;
}

/** Inline style that re-skins a subtree to the artwork's colours. */
export const artStyle = (pal) => (pal ? { '--green': pal.a1, '--cyan': pal.a2 } : undefined);
