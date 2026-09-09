#!/bin/bash
# SurBox Workers Deploy - music backends on Cloudflare free tier
# Free tier 100k req/day, edge caching, CORS bypass
#
# NOTE: these are the SAME workers OmniTools uses (same names/URLs), so
# deploying from here updates the shared infrastructure. The app's built-in
# relay (BUILTIN_PROXY in src/core/settings.js) already points at omni-proxy;
# nothing needs to change in the app after deploying.

echo "=== SurBox Workers Deploy ==="
echo "Free tier: 100k req/day, 10ms CPU, edge caching 300s"
echo ""

# Check wrangler
if ! command -v wrangler &> /dev/null; then
  echo "Installing wrangler..."
  npm install -g wrangler
fi

# Deploy main proxy (31 song sources race + 170+ allowed hosts + yt resolver + rss + surname)
echo "1. Deploying omni-proxy (main - 31 song sources, yt, rss, surname, CORS relay)..."
wrangler deploy worker/omni-proxy.js --name omni-proxy --compatibility-date 2024-01-01
echo "Main proxy deployed - put URL in Settings -> Custom Proxy URL"
echo ""

# Deploy music super (16 Saavn mirrors + multi-engine 5-in-1 + Jamendo + Deezer + iTunes + Audius + caching)
echo "2. Deploying omni-music-super (16 mirrors + multi-engine + open + previews, cached)..."
wrangler deploy worker/omni-music-super.js --name omni-music-super --compatibility-date 2024-01-01
echo "Music super deployed"
echo ""

# Deploy discovery (9 APIs: Jamendo full + Last.fm + Deezer + Discogs + Freesound + Mixcloud + Genrenator + Gaana + Saavn)
echo "3. Deploying omni-discovery (9 APIs best-to-best)..."
wrangler deploy worker/omni-discovery.js --name omni-discovery --compatibility-date 2024-01-01
echo "Discovery deployed"
echo ""

echo "=== All Workers Deployed ==="
echo "Endpoints:"
echo "  Main: https://omni-proxy.your-subdomain.workers.dev"
echo "    /?url= - CORS relay 170+ hosts"
echo "    /song?q=&limit=&verify= - 31 catalogues race, first win, audio proof"
echo "    /song-health?offset=&n= - health paging (50 subrequest limit)"
echo "    /yt?v= - YouTube audio resolver 5 clients"
echo ""
echo "  Music Super: https://omni-music-super.your-subdomain.workers.dev"
echo "    /?url= - generic CORS proxy"
echo "    /search?q=&limit=&engine= - super search (Saavn mirrors + multi-engine + Jamendo + Deezer + Audius)"
echo "    /song?q= - alias"
echo "    /search/multi?q=&engine=gaana - multi-engine specific (gaana, saavn, hungama, wynk, ytmusic)"
echo "    /health - 6 probes, Cache 60s"
echo ""
echo "  Discovery: https://omni-discovery.your-subdomain.workers.dev"
echo "    /discovery?q=&limit= - unified 9 APIs"
echo "    /jamendo, /lastfm, /deezer, /discogs, /mixcloud, /genrenator, /gaana, /saavn"
echo "    /health - 8 probes"
echo "    /?url= - generic CORS proxy"
echo ""
echo "The app ships with the built-in relay already configured (BUILTIN_PROXY)."
echo "To use your own: Music -> Library -> Speed -> Custom Proxy URL"
echo "Free tier 100k req/day each, 300k total, edge caching, future-proof"
