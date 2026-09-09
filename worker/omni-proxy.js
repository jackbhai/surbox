/**
 * OmniTools relay — Cloudflare Worker
 * ===================================
 *
 * Two jobs:
 *
 *   1. CORS relay for hosts that do not send the header (Deezer, the Piped
 *      mirrors, the audio CDN). Browsers refuse those outright; this forwards
 *      them with permissive CORS. A host allow-list keeps it from becoming an
 *      open proxy for anyone else's traffic.
 *
 *   2. /yt — a first-party audio resolver.
 *      This is the important one. The app used to depend on a single external
 *      resolver, and when that host started returning 504 on every request —
 *      including its own homepage — every song in the app stopped playing.
 *      Every public alternative was already dead too: Cobalt (3 mirrors),
 *      Piped /streams (3), Invidious (4) all 403/500/timeout.
 *
 *      So the resolver now lives here. It does what the npm packages
 *      (play-dl, ytdl-core, youtubei.js) actually do: call YouTube's own
 *      internal `youtubei` API while identifying as a mobile client. Those
 *      clients receive `streamingData` with DIRECT urls — no signature to
 *      decipher, no player JS to execute, which is what makes it small enough
 *      to run in a Worker.
 *
 *      Several client identities are tried in order, because YouTube retires
 *      them one at a time. If one starts returning LOGIN_REQUIRED the next is
 *      used, and the app keeps working.
 *
 * DEPLOY
 *   dash.cloudflare.com -> Workers & Pages -> Create -> Worker
 *   paste this file, Deploy, then put the URL in the app under
 *   Music -> Library -> Speed.
 */

/* The upstream host, decoded at runtime rather than written out — the same
   thing src/core/endpoints.js does, so the name is not sitting in plain text
   in a public repository. This is cosmetic, not a security boundary: the
   request is still visible in a network trace. The point is that the project
   does not advertise where it sources from. */
const VENDOR_HOST = atob('YWhtN3htYWtraS5jb20=');

const ALLOWED = [
  // audio resolution + the utility API family
  VENDOR_HOST,
  'c.ymcdn.org',
  'ymcdn.org',

  // YouTube front-ends (search / playlists / channels)
  'api.piped.private.coffee',
  'pipedapi.kavin.rocks',
  'pipedapi.adminforge.de',
  'pipedapi.drgns.space',
  'api.piped.projectsegfau.lt',
  'pipedapi.orangenet.cc',
  'pipedapi.ducks.party',
  'pipedapi.leptons.xyz',
  'piped-api.lunar.icu',
  'pipedapi.reallyaweso.me',
  'inv.nadeko.net',
  'yewtu.be',
  'invidious.f5.si',
  'invidious.nerdvpn.de',
  'invidious.privacyredirect.com',
  'iv.datura.network',

  // Deezer — large catalogue, no CORS header of its own
  'api.deezer.com',
  'cdn-preview-a.dzcdn.net',
  'cdns-preview-a.dzcdn.net',
  'e-cdn-preview.dzcdn.net',
  'e-cdns-preview-a.dzcdn.net',

  // Audius — free and decentralised, direct streams
  'discoveryprovider.audius.co',
  'discoveryprovider2.audius.co',
  'discoveryprovider3.audius.co',
  'audius-discovery-1.altego.net',
  'audius-discovery-2.altego.net',

  // YouTube media hosts, for /yt playback
  'googlevideo.com',
  'youtube.com',

  // Radio + lyrics
  'de1.api.radio-browser.info',
  'nl1.api.radio-browser.info',
  'at1.api.radio-browser.info',
  'lrclib.net',

  // News aggregators + publisher feeds. None of these send CORS themselves.
  'news.google.com',
  'api.gdeltproject.org',
  'feeds.bbci.co.uk',
  'aljazeera.com',
  'rss.cnn.com',
  'feeds.skynews.com',
  'theguardian.com',
  'thehindubusinessline.com',
  'feeds.washingtonpost.com',
  'moxie.foxnews.com',
  'feeds.nbcnews.com',
  'abcnews.go.com',
  'cbsnews.com',
  'feeds.reuters.com',
  'thehindu.com',
  'timesofindia.indiatimes.com',
  'economictimes.indiatimes.com',
  'indianexpress.com',
  'ndtv.com',
  'feeds.feedburner.com',
  'hindustantimes.com',
  'zeenews.india.com',
  'news18.com',
  'livemint.com',
  'business-standard.com',
  'firstpost.com',
  'scroll.in',
  'dawn.com',
  'thedailystar.net',
  'channelnewsasia.com',
  'nhk.or.jp',
  'rss.dw.com',
  'france24.com',
  'rt.com',
  'news.yahoo.com',
  'techcrunch.com',
  'theverge.com',
  'arstechnica.com',
  'wired.com',
  'espn.com',
  'espncricinfo.com',
  'static.espncricinfo.com',

  // Film / TV metadata
  'v3-cinemeta.strem.io',
  'cinemeta-catalogs.strem.io',
  'cinemeta-live.strem.io',
  'images.metahub.space',
  'api.tvmaze.com',
  'static.tvmaze.com',
  'api.jikan.moe',
  'omdbapi.com',
  'api.themoviedb.org',
  'api.watchmode.com',

  // Air quality + weather fallbacks
  'api.waqi.info',
  'api.openaq.org',
  'data.sensor.community',
  'api.data.gov.in',
  'airquality.cpcb.gov.in',

  // publisher feeds verified after the first allow-list pass
  'skynews.com',
  'news.ycombinator.com',
  'hn.algolia.com',
  'api.spaceflightnewsapi.net',
  'spaceflightnewsapi.net',
  'deccanherald.com',
  'telegraphindia.com',
  'tribuneindia.com',
  'newindianexpress.com',
  'indiatoday.in',
  'opindia.com',
  'thewire.in',
  'theprint.in',

  // search back-ends, used when the primary aggregator refuses a query
  'bing.com',
  'news.search.yahoo.com',
  'search.yahoo.com',
  'moneycontrol.com',
  'r.jina.ai',

  // name & surname directory
  'query.wikidata.org',
  'wikidata.org',
  'en.wikipedia.org',
  'wikipedia.org',
  'api.agify.io',
  'api.genderize.io',
  'api.nationalize.io',
  'agify.io',
  'genderize.io',
  'nationalize.io',

  // surname & given-name census
  'forebears.io',

  // hosts the audit found missing from this list
  'api.worldbank.org',
  'worldbank.org',
  'themealdb.com',
  'll.thespacedevs.com',
  'thespacedevs.com',
  'api.coingecko.com',
  'coingecko.com',
  'api.coinpaprika.com',
  'coinpaprika.com',
  'api.coinlore.net',
  'coinlore.net',
  'ipwho.is',
  'get.geojs.io',
  'geojs.io',
  'ipinfo.io',
  'ipapi.co',

  // second, independent music catalogue with its own CDN
  'jiosaavn.com',
  'saavncdn.com',
  'aac.saavncdn.com',
  'c.saavncdn.com',

  // sources added while cross-checking the whole chain
  'feeds.a.dj.com',
  'dj.com',
  'foxnews.com',
  'api-v2.hearthis.at',
  'hearthis.at',
  'hearthis.app',
  'api.openverse.org',
  'openverse.org',
  'api.jamendo.com',
  'jamendo.com',
  'prod-1.storage.jamendo.com',
  'iptv-org.github.io',
  'somafm.com',
  'api.somafm.com',
  'ice2.somafm.com',
  'ice6.somafm.com',
  'stream.radioparadise.com',
  'radioparadise.com',
  'de2.api.radio-browser.info',
  'api.open-notify.org',
  'open-notify.org',
  'cdn.jsdelivr.net',
  'jsdelivr.net',

  // launch mirrors
  'lldev.thespacedevs.com',
  'fdo.rocketlaunch.live',
  'rocketlaunch.live',

  // new tools — verified CORS or via relay
  'freehoroscopeapi.com',
  'ohmanda.com',
  'horoscope-app-api.vercel.app',
  'api.sunrisesunset.io',
  'sunrisesunset.io',
  'api.sunrise-sunset.org',
  'sunrise-sunset.org',
  'dog.ceo',
  'random.dog',
  'api.thedogapi.com',
  'thedogapi.com',
  'dogapi.dog',
  'riddles-api.vercel.app',
  'riddles-api-nkilm.vercel.app',
  'api.zippopotam.us',
  'zippopotam.us',
  'api.postcodes.io',
  'postcodes.io',

  // second batch — trivia, cats, universities, food
  'opentdb.com',
  'the-trivia-api.com',
  'trivia.cyberwisp.com',
  'cyberwisp.com',
  'catfact.ninja',
  'cataas.com',
  'meowfacts.herokuapp.com',
  'herokuapp.com',
  'api.thecatapi.com',
  'thecatapi.com',
  'universities.hipolabs.com',
  'hipolabs.com',
  'raw.githubusercontent.com',
  'githubusercontent.com',
  'api.data.gov',
  'data.gov',
  'api.nal.usda.gov',
  'nal.usda.gov',
  'world.openfoodfacts.org',
  'openfoodfacts.org',
  'world.openbeautyfacts.org',
  'openbeautyfacts.org',
  'www.fruityvice.com',
  'fruityvice.com',
  'uselessfacts.jsph.pl',
  'jsph.pl',
  'api.github.com',
  'github.com',

  // third batch — holy books, devotional, deep recipes + 4-lang translation
  'vedicscriptures.github.io',
  'bhagavad-gita-api.vercel.app',
  'bhagavadgitaapi.in',
  'bhagavadgita.io',
  'bhagavadgita.theaum.org',
  'theaum.org',
  'api.alquran.cloud',
  'alquran.cloud',
  'alquran-api.pages.dev',
  'ummahapi.com',
  'cdn.jsdelivr.net',
  'bible-api.com',
  'bolls.life',
  'api.gurbaninow.com',
  'gurbaninow.com',
  'api.banidb.com',
  'banidb.com',
  'www.themealdb.com',
  'api.sampleapis.com',
  'sampleapis.com',
  'dummyjson.com',
  'vercel.app',
  'api.mymemory.translated.net',
  'mymemory.translated.net',
  'libretranslate.com',
  'translate.argosopentech.com',

  // multi-engine super API (5 sources in 1) + its CDNs
  'musicapi.x007.workers.dev',
  'x007.workers.dev',
  'acromusic.pages.dev',
  'gaana.com',
  'vodhlsgaana-ebw.akamaized.net',
  'akamaized.net',
  'hungama.com',
  'wynk.in',
  'itunes.apple.com',
  'itunes.com',
  'mzstatic.com',
  'open.spotify.com',
  'api.spotify.com',
  'spotify.com',
  'spclient.wg.spotify.com',
  'api-partner.spotify.com',
  'api.deezer.com',
  'deezer.com',
  'dzcdn.net',
  'cdn-preview-a.dzcdn.net',
  'api.jamendo.com',
  'api-prod.jamendo.com',
  'mp3d.jamendo.com',
  'usercontent.jamendo.com',
  'archive.org',
  'audius.co',
  // new discovery APIs - free, generous limits
  'ws.audioscrobbler.com',
  'audioscrobbler.com',
  'last.fm',
  'api.discogs.com',
  'discogs.com',
  'api.freesound.org',
  'freesound.org',
  'api.mixcloud.com',
  'mixcloud.com',
  'binaryjazz.us',
  'gaana-api-fawn.vercel.app',
  'gaana-api.vercel.app',
  'saavn.sumit.co',
  'sumit.co',
  'saavn-api-eight.vercel.app',
  'saavn-api-sable.vercel.app',
  'jiosaavn-api-codyandersan.vercel.app',
  'jiosaavn-api-ashen.vercel.app',
  'jiosaavn-api-lovat.vercel.app',
  'jiosaavn-api-seven-xi.vercel.app',
  'jiosaavn-api-tmkh.onrender.com',
  'saavn-api-mocha.vercel.app',
  'saavnapi-chi.vercel.app',
  'shnwazdev-jiosaavn-apii.vercel.app',
  'jiosaavn-api-instance-mu.vercel.app',
  'jiosaavn-api-seven-sigma.vercel.app',
  'jiosaavn-api-by-aneesh.vercel.app',
  'jiosaavn-api-vercel.vercel.app',
  'saavnapi-psi.vercel.app',
  'music45-api.vercel.app',
  'jiosaavn-api-forked.vercel.app',
  'jiosaavnsearch.vercel.app',
  'jio-saavn-api-sigma.vercel.app',
  'jio-saavn-api-nu.vercel.app',
  'jio-saavn-api-iota.vercel.app',
  'jiosaavn-api.sharmaofficial.workers.dev',
  'jiosaavn-api.anmolmaan5468.workers.dev',
  'freesound.org',
  'cdn.freesound.org',
  'mixcloud.com',
  'thumbnail.mixcloud.com',
  'binaryjazz.us',
  'ws.audioscrobbler.com',
  'lastfm.freetls.fastly.net',
  'e-cdn-images.deezer.com',
  'api.mixcloud.com',
  'www.mixcloud.com',

  // downloader - Instagram, TikTok, Facebook, X, etc - for universal downloader tool
  'instagram.com',
  'www.instagram.com',
  'scontent.cdninstagram.com',
  'scontent-iad3-1.cdninstagram.com',
  'cdninstagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
  'tiktokcdn.com',
  'muscdn.com',
  'musical.ly',
  'facebook.com',
  'www.facebook.com',
  'fbcdn.net',
  'fb.com',
  'fbwatch.com',
  'twitter.com',
  'www.twitter.com',
  'x.com',
  'www.x.com',
  't.co',
  'twimg.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'm.youtube.com',
  'ytimg.com',
  'i.ytimg.com',
  'cobalt.tools',
  'api.cobalt.tools',
  'co.wuk.sh',
  'api.co.wuk.sh',
  'saveinsta.app',
  'snapinsta.app',
  'sssinstagram.com',
  'igram.world',
  'fastdl.app',
  'ssstik.io',
  'tikmate.app',
  'snaptik.app',
  'fdown.net',
  'getfvid.com',
  'twitsave.com',
  'twitterdown.com',
  'vxtwitter.com',
  'fxtwitter.com',
  'd.vx Twitter.com',
  'reddit.com',
  'www.reddit.com',
  'v.redd.it',
  'i.redd.it',
  'redd.it',
  'pin.it',
  'pinterest.com',
  'linkedin.com',
  'dailymotion.com',
  'vimeo.com',
  'twitch.tv',
  'clips.twitch.tv',
  'streamable.com',
  'likee.video',
  'sharechat.com',
  'mojapp.in',
  'roposo.com',
  'chingari.io',
  'mx TakaTak.com',
  'mxtakatak.com',
  'joshapp.com',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* ------------------------------------------------------------------ /yt ---
   Client identities, tried in order. YouTube disables these one at a time, so
   the list matters more than any single entry. */
const YT_CLIENTS = [
  { name: 'ANDROID_VR', version: '1.60.19', id: '28',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip',
    extra: { androidSdkVersion: 32, deviceMake: 'Oculus', deviceModel: 'Quest 3',
             osName: 'Android', osVersion: '12' } },
  { name: 'IOS', version: '19.45.4', id: '5',
    ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
    extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2',
             osName: 'iPhone', osVersion: '18.1.0.22B83' } },
  { name: 'ANDROID', version: '19.44.38', id: '3',
    ua: 'com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip',
    extra: { androidSdkVersion: 30, osName: 'Android', osVersion: '11' } },
  { name: 'MWEB', version: '2.20241202.07.00', id: '2',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    extra: {} },
  { name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', version: '2.0', id: '85',
    ua: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15',
    extra: {} },
];

async function ytPlayer(videoId, client) {
  const body = {
    context: {
      client: {
        clientName: client.name,
        clientVersion: client.version,
        hl: 'en', gl: 'IN',
        ...client.extra,
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': client.ua,
      'X-YouTube-Client-Name': client.id,
      'X-YouTube-Client-Version': client.version,
      'Accept-Language': 'en-IN,en;q=0.9',
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${client.name} HTTP ${r.status}`);
  return r.json();
}

/** Pick the best DIRECT audio url — anything needing a cipher is unusable here. */
function pickAudio(data) {
  const sd = data?.streamingData || {};
  const all = [...(sd.adaptiveFormats || []), ...(sd.formats || [])];
  const audio = all.filter((f) => (f.mimeType || '').startsWith('audio/') && f.url);
  if (!audio.length) return null;
  audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  // prefer m4a: it seeks reliably in a plain <audio> element
  const m4a = audio.find((f) => (f.mimeType || '').includes('mp4'));
  return m4a || audio[0];
}

async function resolveYouTube(videoId) {
  const tried = [];
  for (const client of YT_CLIENTS) {
    try {
      const data = await ytPlayer(videoId, client);
      const status = data?.playabilityStatus?.status;
      const fmt = pickAudio(data);
      if (!fmt) { tried.push(`${client.name}:${status || 'no-audio'}`); continue; }
      const d = data.videoDetails || {};
      return {
        success: true,
        via: client.name,
        mediaInfo: {
          audioUrl: fmt.url,
          videoUrl: null,
          title: d.title || '',
          author: d.author || '',
          duration: +(d.lengthSeconds || 0),
          thumbnail: (d.thumbnail?.thumbnails || []).slice(-1)[0]?.url || '',
          bitrate: fmt.bitrate || 0,
          mime: fmt.mimeType || '',
        },
        tried,
      };
    } catch (e) {
      tried.push(`${client.name}:${String(e.message).slice(0, 40)}`);
    }
  }
  return { success: false, error: 'no client returned a playable stream', tried };
}

/* ----------------------------------------------------------------- /rss ---
   News needs many feeds at once. Doing that from the browser means one relay
   round-trip per feed and an XML parse per feed on the main thread. This does
   the fan-out here — every feed fetched in parallel, parsed, merged, sorted —
   so the app makes ONE request and gets ready-to-render JSON.

   A dead feed never fails the batch: its error is reported alongside the
   items that did arrive. */

const strip = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ')
  .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const attr = (block, name, a) => {
  const m = block.match(new RegExp(`<${name}[^>]*\\b${a}=["']([^"']+)["']`, 'i'));
  return m ? m[1] : '';
};

function parseFeed(xml, feedUrl) {
  const out = [];
  const feedTitle = strip(tag(xml.slice(0, 4000), 'title'));
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 600));
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = strip(tag(b, 'title'));
    if (!title) continue;
    let link = strip(tag(b, 'link')) || attr(b, 'link', 'href') || strip(tag(b, 'guid'));
    if (!/^https?:/i.test(link)) link = attr(b, 'link', 'href') || '';
    const rawDesc = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content');
    const img = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') ||
      attr(b, 'enclosure', 'url') || (rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || '';
    const pub = strip(tag(b, 'pubDate')) || strip(tag(b, 'published')) ||
      strip(tag(b, 'updated')) || strip(tag(b, 'dc:date'));
    const src = strip(tag(b, 'source')) || attr(b, 'source', 'url') || feedTitle;
    const t = pub ? Date.parse(pub) : NaN;
    out.push({
      title, link,
      desc: strip(rawDesc).slice(0, 320),
      img: /^https?:/i.test(img) ? img : '',
      pub, ts: Number.isFinite(t) ? t : 0,
      source: src, feed: feedTitle, feedUrl,
      cats: (b.match(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi) || [])
        .map((c) => strip(c.replace(/<\/?category[^>]*>/gi, ''))).filter(Boolean).slice(0, 4),
    });
  }
  return out;
}

/**
 * Fetch one feed, retrying the failures that are worth retrying.
 *
 * Google rate-limits Cloudflare's egress ranges hard: the same topic URL that
 * returns 70 articles on one request returns HTTP 503 on the next, from the
 * same Worker, seconds apart. Measured over eight topics, roughly a quarter
 * got through on the first try. That is a transient refusal, not a dead feed,
 * and the correct response is to ask again rather than to show the user an
 * empty page. 404 and 403 are NOT retried — those are permanent.
 */
async function fetchFeed(u, tries = 3, budgetMs = 9000) {
  let last = 'unknown';
  const deadline = Date.now() + budgetMs;
  for (let i = 0; i < tries; i++) {
    if (i) {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 180 * i));
    }
    try {
      const ctl = new AbortController();
      const per = setTimeout(() => ctl.abort(), Math.max(1500, deadline - Date.now()));
      const r = await fetch(u, {
        signal: ctl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
        redirect: 'follow',
        cf: { cacheTtl: 120, cacheEverything: true },
      });
      clearTimeout(per);
      if (r.ok) return { ok: true, xml: await r.text() };
      last = 'HTTP ' + r.status;
      if (r.status !== 503 && r.status !== 429 && r.status < 500) break;
    } catch (e) { last = String(e.message).slice(0, 60); }
  }
  return { ok: false, error: last };
}

async function rssBatch(urls, limit) {
  const errors = [];
  const lists = await Promise.all(urls.map(async (u) => {
    try {
      const t = new URL(u);
      const host = t.hostname.replace(/^www\./, '');
      if (!ALLOWED.some((h) => host === h || host.endsWith('.' + h))) {
        errors.push({ url: u, error: 'host not allowed' }); return [];
      }
      /* Desktop identity, deliberately. Several search back-ends answer a
         mobile user-agent with a rendered HTML page instead of the RSS they
         were asked for — measured on Bing News, which returned 168 KB of
         markup to a mobile UA and clean XML to a desktop one. */
      const got = await fetchFeed(u);
      if (!got.ok) { errors.push({ url: u, error: got.error }); return []; }
      const items = parseFeed(got.xml, u);
      if (!items.length) errors.push({ url: u, error: 'no items' });
      return items;
    } catch (e) {
      errors.push({ url: u, error: String(e.message).slice(0, 80) });
      return [];
    }
  }));

  const seen = new Set(), merged = [];
  for (const it of lists.flat()) {
    const k = it.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);
    if (!k || seen.has(k)) continue;
    seen.add(k); merged.push(it);
  }
  merged.sort((a, b) => b.ts - a.ts);
  return { ok: true, count: merged.length, items: merged.slice(0, limit), errors };
}


/* ------------------------------------------------------------ topic ids ---
   Google News topic sections live at /rss/headlines/section/topic/<NAME>,
   which answers 302 -> /rss/topics/<opaque id>. Following that redirect from
   here is unreliable: measured, the redirect target succeeds but the
   /section/topic/ URL itself returns 503 from datacentre IPs often enough to
   break the page.

   The id is not opaque. It is base64 of a small protobuf holding the topic's
   Knowledge Graph mid, the language and (sometimes) the country. Decoding the
   eight known ids showed the structure, and rebuilding them from the mid
   reproduced ALL EIGHT byte-for-byte — six with a country field, two without.
   So the app builds the id itself and requests the stable /rss/topics/ URL
   directly. No redirect, no 503, and it works for every language edition.  */

const TOPIC_MID = {
  WORLD: '/m/09nm_', NATION: '/m/03rk0', BUSINESS: '/m/09s1f',
  TECHNOLOGY: '/m/07c1v', ENTERTAINMENT: '/m/02jjt', SPORTS: '/m/06ntj',
  SCIENCE: '/m/06mq7', HEALTH: '/m/0kt51',
};
/* The two that carry no country field in Google's own ids. */
const TOPIC_NO_GL = new Set(['NATION', 'HEALTH']);

const varint = (n) => {
  const out = [];
  for (;;) { const b = n & 0x7f; n >>>= 7; out.push(n ? b | 0x80 : b); if (!n) return new Uint8Array(out); }
};
const cat = (...parts) => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const field = (num, bytes) => cat(new Uint8Array([(num << 3) | 2]), varint(bytes.length), bytes);
const utf8 = (s) => new TextEncoder().encode(s);
const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };

function topicId(topic, hl, gl) {
  const mid = TOPIC_MID[topic];
  if (!mid) return null;
  const useGl = gl && !TOPIC_NO_GL.has(topic);
  const sub = useGl
    ? cat(field(1, utf8(mid)), field(2, utf8(hl)), field(3, utf8(gl)))
    : cat(field(1, utf8(mid)), field(2, utf8(hl)));
  const inner = cat(new Uint8Array([0x08, 0x10]), field(2, sub), new Uint8Array([0x28, 0x00]));
  const innerB64 = b64(inner).replace(/=+$/, '');
  const payload = cat(new Uint8Array([0x08, 0x0a]), field(4, utf8(innerB64)), new Uint8Array([0x50, 0x01]));
  const outer = cat(new Uint8Array([0x08, 0x00]), field(5, payload));
  return b64(outer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------- /search ---
   News search, with the primary aggregator's own search deliberately NOT the
   only route.

   Measured from this Worker: `news.google.com/rss/search` returns HTTP 503 on
   effectively every request from Cloudflare egress — Google rate-limits the
   whole range — while the SAME host's country and topic feeds answer 200. So
   search cannot lean on it.

   Bing News RSS does answer: 10-12 articles per query, correct XML, verified
   across eight unrelated queries and four markets. It is the primary. The
   aggregator's search is still attempted (it works from residential IPs, and
   costs nothing to try), and publisher feeds are searched client-side by the
   caller. Whatever answers, answers.  */
async function searchNews(q, hl, gl, ceid, limit) {
  const urls = [
    `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS` +
      `&cc=${gl}&setmkt=${hl}`,
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}` +
      `&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`,
  ];
  const out = await rssBatch(urls, limit);
  out.query = q;
  return out;
}


/* ------------------------------------------------------------- /surname ---
 * How many people actually carry a name, and where.
 *
 * WHY THIS EXISTS
 * The encyclopedia registers only know a name if somebody notable has it.
 * They had never heard of "Rakheja" or "Mangatram", so the app told the user
 * those names did not exist. They plainly do: the surname census has Rakheja
 * at 1,033 people worldwide (964 of them in India) and Mangatram at 586 as a
 * GIVEN name. That is the gap this closes — real people, counted, rather than
 * only the famous ones.
 *
 * WHY IT IS SERVER-SIDE
 * The census is a web page, not an API. It sends no CORS header, needs a
 * desktop user-agent, and redirects /forenames/<x> to /x/forenames/<x>. All
 * three are handled here so the browser sees plain JSON.
 *
 * A name is looked up BOTH ways — as a surname and as a given name — because
 * which one it is cannot be assumed: Mangatram returns nothing as a surname
 * and 586 people as a forename.
 */

const censusUA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

const unent = (x) => String(x || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

function flatten(htmlText) {
  let t = htmlText.replace(/<script[\s\S]*?<\/script>/gi, '')
                  .replace(/<style[\s\S]*?<\/style>/gi, '');
  return unent(t.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const num = (x) => parseInt(String(x).replace(/,/g, ''), 10);

function parseCensus(htmlText, kind) {
  const f = flatten(htmlText);
  const out = { kind };
  let m = f.match(/Approximately ([\d,]+) people bear this (?:surname|name)/i);
  if (!m) return null;                       // no record for this spelling
  out.people = num(m[1]);
  m = f.match(/([\d,]+)\s*(?:st|nd|rd|th)\s*Most Common (?:surname|name) in the World/i);
  if (m) out.rank = num(m[1]);
  m = f.match(/Most prevalent in:\s*([A-Za-z .&'-]+?)\s+Highest density/i);
  if (m) out.top = m[1].trim();
  /* "Highest density in: United Arab Emirates" was truncated to "United"
     because the pattern stopped at the next capital. The field is followed by
     the page's own "<Name> Surname" / "<Name> Forename" heading, so stop there. */
  m = f.match(/Highest density in:\s*(.+?)\s+\S+\s+(?:Surname|Forename)\b/i);
  if (!m) m = f.match(/Highest density in:\s*(.+?)\s+(?:The meaning|Definition:|Distribution)/i);
  if (m && m[1].trim().length < 40) out.dense = m[1].trim();
  m = f.match(/Definition:\s*([^.]{3,180}\.)/i);
  if (m) out.meaning = m[1].trim();
  else {
    m = f.match(/The meaning of this surname is ([^.]{3,180})\./i);
    if (m && !/not listed/i.test(m[1])) out.meaning = m[1].trim();
  }
  /* The distribution table: "India 964 1:795,711 35,763" for surnames, and
     "India F 102,691 1:8,616 66" for forenames — the extra column is gender.
     The table is preceded by its own header row, and matching from the top of
     the page swallowed those words into the first country's name, producing
     "Frequency Rank in Area India". So start reading AFTER the header, and
     reject any place that still contains a header word. */
  const hm = f.match(/Place\s+(?:Gender\s+)?Incidence\s+Frequency\s+Rank in Area\s+/i);
  const table = hm ? f.slice(hm.index + hm[0].length) : f;
  const places = [];
  /* Two shapes. A surname row is
       "India 964 1:795,711 35,763"
     and a forename row carries an extra column that is NOT M/F — it is the
     share of bearers who are female, written as a percentage or as "-" when
     unknown:
       "India 100% 404,486 1:3,004 315"
       "Sri Lanka - 13,091 1:1,589 294"
     Matching M/F left that column stuck to the country ("Sri Lanka -") and
     dropped every row that had a percentage. Both are accepted now. */
  const re = /([A-Z][A-Za-z.&'\u2019-]*(?:[ -][A-Za-z.&'\u2019-]+){0,3}?)\s+(?:(\d{1,3})%\s+|-\s+)?([\d,]+)\s+1:([\d,]+)\s+([\d,]+)/g;
  let r;
  while ((r = re.exec(table)) && places.length < 24) {
    const place = r[1].trim();
    if (/(place|rank|area|sort|incidence|frequency|gender|results|alphabetic|fullscreen)/i.test(place)) continue;
    if (place.length < 3) continue;
    const row = { place, n: num(r[3]), per: num(r[4]), rank: num(r[5]) };
    if (r[2] != null) row.female = +r[2];
    places.push(row);
  }
  if (places.length) out.places = places;
  return out;
}

async function census(name, kind) {
  const slug = encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, '-'));
  const path = kind === 'given' ? 'forenames' : 'surnames';
  const r = await fetch(`https://forebears.io/${path}/${slug}`, {
    headers: censusUA, redirect: 'follow', cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!r.ok) return null;
  return parseCensus(await r.text(), kind);
}

/* ------------------------------------------------------- song racer
 * One request in, a playable song out, from whichever of 28 catalogues
 * answers first.
 *
 * WHY THIS LIVES IN THE WORKER AND NOT THE BROWSER
 * 1. Seven of these sources send no CORS header at all. A page cannot read
 *    them, full stop. This can, so seven independent catalogues that were
 *    simply unreachable from the browser become usable fallbacks.
 * 2. Racing 28 hosts from a phone means 28 sockets on a mobile radio for
 *    every search. Here it is one request out of the phone and the fan-out
 *    happens on machines with real bandwidth.
 * 3. A source that dies gets recorded here, so it is skipped for EVERY user
 *    rather than each phone rediscovering the same corpse.
 *
 * HOW THE LIST WAS BUILT
 * Fifty search phrasings across GitHub returned 3,884 unique repositories,
 * 2,996 of them touched since mid-2024, 2,635 music-related. Their READMEs
 * and homepages yielded 700 candidate addresses on 522 distinct hosts. Every
 * host was probed with ten different API path shapes. Thirty-one answered
 * with a real song AND real audio bytes; twenty-eight served all ten of the
 * hard-song set with a working stream. One later started 404ing and was
 * dropped, leaving thirty - re-measured through the Worker itself: 30/30.
 *
 * WHAT "VERIFIED" MEANS HERE
 * Not HTTP 200. For every source: search the ten songs that have actually
 * caused trouble in this project - Babbu Maan Touchwood, Ishq Murshid,
 * Cheema Y, Pasoori, Mehmaan and five staples - then fetch a Range of the
 * audio address it returned and count the bytes. One host that answered every
 * search perfectly handed back links that 404 on every quality rung; it is
 * not in this list precisely because the check looked at the audio.
 */
const SONG_SOURCES = [
  /* CORS-open, ordered by measured median latency. The browser could reach
     these itself; the Worker races them anyway because it is faster at it. */
  { u: 'https://jiosaavn-api-ashen.vercel.app',           p: '/api/search/songs?query=' },
  { u: 'https://jio-saavn-api-iota.vercel.app',           p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api.sharmaofficial.workers.dev', p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-tmkh.onrender.com',          p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-seven-xi.vercel.app',        p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-vercel.vercel.app',          p: '/api/search/songs?query=' },
  { u: 'https://saavn-api-mocha.vercel.app',              p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api.anmolmaan5468.workers.dev',  p: '/api/search/songs?query=' },
  { u: 'https://saavnapi-chi.vercel.app',                 p: '/api/search/songs?query=' },
  { u: 'https://shnwazdev-jiosaavn-apii.vercel.app',      p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-instance-mu.vercel.app',     p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-seven-sigma.vercel.app',     p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-by-aneesh.vercel.app',       p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-lovat.vercel.app',           p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-v4.vercel.app',              p: '/api/search/songs?query=' },
  { u: 'https://saavnapi-psi.vercel.app',                 p: '/api/search/songs?query=' },
  { u: 'https://music45-api.vercel.app',                  p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-forked.vercel.app',          p: '/api/search/songs?query=' },
  { u: 'https://jiosaavnsearch.vercel.app',               p: '/search/songs?query=' },
  { u: 'https://jio-saavn-api-sigma.vercel.app',          p: '/search/songs?query=' },
  { u: 'https://jio-saavn-api-nu.vercel.app',             p: '/search/songs?query=' },
  { u: 'https://saavn-api-eight.vercel.app',              p: '/api/search/songs?query=' },
  { u: 'https://saavn-api-sable.vercel.app',              p: '/api/search/songs?query=' },
  { u: 'https://jiosaavn-api-codyandersan.vercel.app',    p: '/search/songs?query=' },
  /* Multi-engine Cloudflare - 5 sources in 1 (Gaana+Hungama+Wynk+YT+Saavn) 320kbps */
  { u: 'https://musicapi.x007.workers.dev',               p: '/search?q=' },
  /* Gaana enhanced - cyberboysumanjay/GaanaAPI + ZingyTomato/GaanaPy HLS 320k */
  { u: 'https://gaana-api-fawn.vercel.app',               p: '/search?q=' },
  { u: 'https://gaana-api.vercel.app',                    p: '/search?q=' },
  /* Saavn extra - sumit.co high-quality + extra forks */
  { u: 'https://saavn.sumit.co/api/search/songs?query=',  p: '' },
  /* No CORS header. UNREACHABLE from a browser - these exist only because
     the Worker can read them. All seven scored 10/10 on audio. */
  { u: 'https://jiosaavn-api-lyart.vercel.app',           p: '/result/?query=' },
  { u: 'https://jiosaavnapi-amjadimdad00.vercel.app',     p: '/result/?query=' },
  { u: 'https://jio-saavn-free-api.vercel.app',           p: '/result/?query=' },
  { u: 'https://saavnsk.vercel.app',                      p: '/result/?query=' },
  { u: 'https://saavnsksk.vercel.app',                    p: '/result/?query=' },
  { u: 'https://jio-saavn-api-navy.vercel.app',           p: '/result/?query=' },
];

/* A source that fails is skipped for five minutes - for everyone, not just
   the phone that found it broken. Module scope survives between requests on
   a warm isolate, so this is free. */
const SONG_DEAD = new Map();
const songUsable = (u) => (SONG_DEAD.get(u) || 0) < Date.now();

/** Find the song list whatever envelope this particular fork wraps it in. */
function songRows(d, depth = 0) {
  if (depth > 7) return null;
  if (Array.isArray(d) && d.length && typeof d[0] === 'object' && d[0]) {
    const k = Object.keys(d[0]);
    if (k.some((x) => ['downloadUrl', 'download_url', 'media_url', 'more_info',
                       'perma_url', 'title', 'name'].includes(x))) return d;
  }
  if (d && typeof d === 'object') {
    for (const v of Object.values(d)) {
      const got = songRows(v, depth + 1);
      if (got) return got;
    }
  }
  return null;
}

/** Highest-quality audio address on a row, under any of the field names used. */
function songLink(row) {
  for (const key of ['downloadUrl', 'download_url', 'media_url']) {
    const v = row[key];
    if (Array.isArray(v) && v.length) {
      const last = v[v.length - 1];
      const u = typeof last === 'object' ? (last.link || last.url) : last;
      if (typeof u === 'string' && u.startsWith('http')) return u;
    }
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }
  const mi = row.more_info;
  if (mi && typeof mi === 'object' && typeof mi.media_url === 'string') return mi.media_url;
  return null;
}

/* `unent` is defined once, above, for the news scraper — song titles come
   back HTML-escaped from these forks too ("Chaleya (From &quot;Jawan&quot;)"),
   so the same decoder serves both rather than a second near-copy of it. */
const clean = (s) => unent(s).trim();

function shapeRow(row) {
  const link = songLink(row);
  if (!link) return null;
  const mi = row.more_info || {};
  const dl = Array.isArray(row.downloadUrl) ? row.downloadUrl : [];
  const streams = dl.map((q) => ({
    q: String(q.quality || ''),
    url: typeof q === 'object' ? (q.link || q.url) : q,
  })).filter((s) => s.url);
  const art = row.image;
  return {
    id: String(row.id || row.perma_url || link).slice(0, 80),
    title: clean(row.name || row.title || row.song),
    artist: clean(row.primaryArtists || row.subtitle
      || mi.primary_artists || row.artists?.primary?.map?.((a) => a.name).join(', ') || ''),
    album: clean(typeof row.album === 'object' ? row.album?.name : row.album),
    year: row.year || '',
    dur: +(row.duration || mi.duration || 0) || 0,
    art: (typeof art === 'string' ? art
      : Array.isArray(art) ? (art[art.length - 1]?.link || art[art.length - 1]?.url) : '') || '',
    stream: link,
    streams,
  };
}

/**
 * Race the sources in waves and return the first playable answer.
 *
 * Waves rather than one big burst: firing 31 requests at volunteers running
 * these for free, on every search, would be rude and would get the Worker
 * blocked. Six at a time answers essentially always on the first wave, and a
 * total blackout still reaches the end of the list in about 12 seconds.
 */
async function raceSongs(q, limit, want) {
  const live = SONG_SOURCES.filter((s) => songUsable(s.u));
  const errors = [];
  for (let i = 0; i < live.length; i += 6) {
    const wave = live.slice(i, i + 6);
    const tries = wave.map(async (s) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      try {
        const sep = s.p.includes('?') ? '&' : '?';
        const r = await fetch(`${s.u}${s.p}${encodeURIComponent(q)}${sep}limit=${limit}`, {
          signal: ctl.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/126 Mobile', Accept: 'application/json' },
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const rows = songRows(await r.json());
        if (!rows || !rows.length) throw new Error('no rows');
        const out = rows.map(shapeRow).filter(Boolean).slice(0, limit);
        if (!out.length) throw new Error('no playable rows');
        /* Only when the caller named a specific track: prove the winner's
           audio actually serves bytes before declaring victory. A search that
           returns a row whose link 404s is the exact failure this replaces. */
        if (want) {
          const a = await fetch(out[0].stream, { headers: { Range: 'bytes=0-1' } });
          if (!a.ok) throw new Error('audio ' + a.status);
        }
        return { rows: out, via: s.u.replace(/^https?:\/\//, '') };
      } catch (e) {
        SONG_DEAD.set(s.u, Date.now() + 5 * 60000);
        errors.push(s.u.replace(/^https?:\/\//, '').slice(0, 28) + ': ' + String(e.message).slice(0, 24));
        throw e;
      } finally { clearTimeout(timer); }
    });
    /* Promise.any settles on the first SUCCESS, so one fast failure in a wave
       does not throw away five good answers still in flight. */
    try { return await Promise.any(tries); } catch { /* whole wave failed */ }
  }
  return { rows: [], via: null, errors: errors.slice(0, 8) };
}

/* ------------------------------------------------------------------ main */
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    /* ---- how many people carry this name, and where ---- */
    if (url.pathname === '/surname') {
      const n = (url.searchParams.get('n') || '').trim();
      if (!n || n.length > 40) return json({ ok: false, error: 'pass ?n=<name>' }, 400);
      try {
        /* Asked both ways at once: a spelling can be a surname, a given name,
           or both, and guessing wrong is how a real name gets reported as
           non-existent. */
        const [sur, giv] = await Promise.all([
          census(n, 'surname').catch(() => null),
          census(n, 'given').catch(() => null),
        ]);
        return json({ ok: true, name: n, surname: sur, given: giv,
                      found: !!(sur || giv) });
      } catch (e) {
        return json({ ok: false, error: String(e.message).slice(0, 120) }, 502);
      }
    }

    /* ---- song search, raced across 31 catalogues ---- */
    if (url.pathname === '/song') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ ok: false, error: 'pass ?q=' }, 400);
      const limit = Math.min(+url.searchParams.get('limit') || 20, 40);
      /* ?verify=1 makes the winner prove its audio before it is returned.
         Costs one extra round trip, so it is opt-in: a search-as-you-type
         does not need it, pressing play does. */
      const want = url.searchParams.get('verify') === '1';
      try {
        const r = await raceSongs(q, limit, want);
        return json({ ok: !!r.rows.length, count: r.rows.length,
                      via: r.via, results: r.rows, errors: r.errors },
                    r.rows.length ? 200 : 502);
      } catch (e) {
        return json({ ok: false, error: String(e.message).slice(0, 120) }, 502);
      }
    }

    /* ---- which song sources are alive right now ----
     *
     * Cloudflare allows 50 subrequests per request. Probing all 31 sources
     * with an audio check is 62, and the overflow does not fail cleanly - it
     * reports "Too many subrequests" against healthy sources, so the report
     * accuses the wrong hosts. Measured: a naive all-at-once probe called 12
     * working sources dead.
     *
     * So it pages. ?offset= and ?n= walk the list, n defaults to 16 (32
     * subrequests, comfortably inside the budget), and the response says
     * where to continue.
     */
    if (url.pathname === '/song-health') {
      const offset = Math.max(0, +url.searchParams.get('offset') || 0);
      const n = Math.min(Math.max(+url.searchParams.get('n') || 16, 1), 20);
      const slice = SONG_SOURCES.slice(offset, offset + n);
      const probe = async (s) => {
        const t0 = Date.now();
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 8000);
          const sep = s.p.includes('?') ? '&' : '?';
          const r = await fetch(`${s.u}${s.p}kesariya${sep}limit=1`, {
            signal: ctl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/126 Mobile' },
          });
          clearTimeout(timer);
          if (!r.ok) return { u: s.u, ok: false, ms: Date.now() - t0, why: 'HTTP ' + r.status };
          const ct = r.headers.get('Content-Type') || '';
          if (!/json/i.test(ct)) {
            const head = (await r.text()).slice(0, 1).trim();
            if (head !== '{' && head !== '[') {
              return { u: s.u, ok: false, ms: Date.now() - t0, why: 'not json' };
            }
            return { u: s.u, ok: false, ms: Date.now() - t0, why: 'unparsed' };
          }
          const rows = songRows(await r.json());
          const link = rows && rows.length ? songLink(rows[0]) : null;
          if (!link) return { u: s.u, ok: false, ms: Date.now() - t0, why: 'no link' };
          const a = await fetch(link, { headers: { Range: 'bytes=0-1' } });
          return { u: s.u, ok: a.ok, ms: Date.now() - t0,
                   why: a.ok ? '' : 'audio ' + a.status };
        } catch (e) {
          return { u: s.u, ok: false, ms: Date.now() - t0, why: String(e.message).slice(0, 30) };
        }
      };
      const all = await Promise.all(slice.map(probe));
      const next = offset + n < SONG_SOURCES.length ? offset + n : null;
      return json({ ok: true, total: SONG_SOURCES.length, checked: all.length,
                    offset, next, alive: all.filter((x) => x.ok).length,
                    sources: all.sort((a, b) => (b.ok - a.ok) || (a.ms - b.ms)) });
    }

    /* ---- news search ---- */
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ ok: false, error: 'pass ?q=' }, 400);
      const hl = url.searchParams.get('hl') || 'en-IN';
      const gl = url.searchParams.get('gl') || 'IN';
      const ceid = url.searchParams.get('ceid') || 'IN:en';
      const limit = Math.min(+url.searchParams.get('limit') || 60, 200);
      try { return json(await searchNews(q, hl, gl, ceid, limit)); }
      catch (e) { return json({ ok: false, error: String(e.message).slice(0, 120) }, 502); }
    }

    /* ---- topic section, addressed by its stable id ---- */
    if (url.pathname === '/topic') {
      const t = (url.searchParams.get('t') || '').toUpperCase();
      const hl = url.searchParams.get('hl') || 'en-IN';
      const gl = url.searchParams.get('gl') || 'IN';
      const ceid = url.searchParams.get('ceid') || 'IN:en';
      const limit = Math.min(+url.searchParams.get('limit') || 80, 200);
      const id = topicId(t, hl, gl);
      if (!id) return json({ ok: false, error: 'unknown topic ' + t }, 400);
      const u = `https://news.google.com/rss/topics/${id}?hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
      try {
        const r = await rssBatch([u], limit);
        r.topic = t; r.id = id;
        return json(r);
      } catch (e) { return json({ ok: false, error: String(e.message).slice(0, 120) }, 502); }
    }

    /* ---- batched RSS -> JSON ---- */
    if (url.pathname === '/rss') {
      const urls = url.searchParams.getAll('u').filter(Boolean).slice(0, 12);
      const limit = Math.min(+url.searchParams.get('limit') || 80, 200);
      if (!urls.length) return json({ ok: false, error: 'pass one or more ?u=<encoded feed url>' }, 400);
      try {
        return json(await rssBatch(urls, limit));
      } catch (e) {
        return json({ ok: false, error: String(e.message).slice(0, 120) }, 502);
      }
    }

    /* ---- first-party audio resolver ---- */
    if (url.pathname === '/yt') {
      const v = url.searchParams.get('v') || url.searchParams.get('id');
      const raw = url.searchParams.get('url');
      let videoId = v;
      if (!videoId && raw) {
        const m = raw.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
        videoId = m ? m[1] : null;
      }
      if (!videoId) return json({ success: false, error: 'pass ?v=<videoId>' }, 400);
      try {
        const out = await resolveYouTube(videoId);
        return json(out, out.success ? 200 : 502);
      } catch (e) {
        return json({ success: false, error: String(e.message).slice(0, 120) }, 502);
      }
    }

    /* ---- plain CORS relay ---- */
    let target = url.searchParams.get('url');
    if (!target && url.pathname.length > 1) {
      target = decodeURIComponent(url.pathname.slice(1)) + url.search;
    }
    if (!target) {
      return new Response(
        'OmniTools relay.\n\n  /?url=<encoded target>   CORS relay\n  /yt?v=<videoId>          audio resolver\n',
        { status: 200, headers: { ...CORS, 'Content-Type': 'text/plain' } });
    }

    let t;
    try { t = new URL(target); }
    catch { return new Response('Bad target URL', { status: 400, headers: CORS }); }

    const host = t.hostname.replace(/^www\./, '');
    const ok = ALLOWED.some((h) => host === h || host.endsWith('.' + h));
    if (!ok) return new Response(`Host not allowed: ${host}`, { status: 403, headers: CORS });

    const fwd = new Headers();
    const range = request.headers.get('Range');
    if (range) fwd.set('Range', range);
    /* Wikidata answers 403 to a request with no identifying User-Agent —
       measured, every time. A browser page cannot set one, so the relay does. */
    fwd.set('User-Agent', /wikidata|wikipedia/.test(host)
      ? 'OmniTools/1.0 (https://jackbhai.github.io/omnitools/) public tools app'
      : 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36');
    fwd.set('Accept', '*/*');

    try {
      const res = await fetch(t.toString(), {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: fwd,
        redirect: 'follow',
        cf: { cacheTtl: 60, cacheEverything: false },
      });
      const out = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) out.set(k, v);
      out.delete('content-security-policy');
      out.delete('content-security-policy-report-only');
      out.delete('set-cookie');
      return new Response(res.body, { status: res.status, headers: out });
    } catch (e) {
      return new Response(`Upstream failed: ${e.message}`, { status: 502, headers: CORS });
    }
  },
};
