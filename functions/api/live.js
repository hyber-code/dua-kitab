/* Cloudflare Pages Function: /api/live
   Tells the app whether the madrasa YouTube channel is streaming live right now.
   Reads the channel's public /live page: while live it points to the live video and says "isLive":true.
   Cached at Cloudflare for 60 seconds. */
const CHANNEL = 'UCbBs6iPrkkGAyxF1opkvJfQ';

export async function onRequestGet(context) {
  const cache = caches.default;
  const key = new Request(new URL('/api/live', context.request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  let body = { live: false };
  try {
    const r = await fetch('https://www.youtube.com/channel/' + CHANNEL + '/live', {
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
                 'accept-language': 'en-GB,en;q=0.8', 'cookie': 'SOCS=CAI; CONSENT=YES+1' }
    });
    const html = await r.text();
    const canon = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html);
    if (canon && html.indexOf('"isLive":true') >= 0) {
      const t = /<meta name="title" content="([^"]*)"/.exec(html);
      body = { live: true, id: canon[1], title: t ? t[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : 'Live now' };
    }
  } catch (e) { body = { live: false, error: true }; }
  const res = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  if (!body.error) context.waitUntil(cache.put(key, res.clone()));
  return res;
}
