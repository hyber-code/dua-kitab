/* Cloudflare Pages Function: /api/bayans
   Reads the madrasa YouTube channel's public "latest videos" feed (newest 15)
   and returns it as small JSON for the app. Cached at Cloudflare for 15 minutes. */
const CHANNEL = 'UCbBs6iPrkkGAyxF1opkvJfQ';
const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CHANNEL;

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function tag(block, name) {
  const m = new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>').exec(block);
  return m ? decode(m[1].trim()) : '';
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const key = new Request(new URL('/api/bayans', context.request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  let res;
  try {
    const r = await fetch(FEED, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; duabook-feed)' } });
    if (!r.ok) throw new Error('feed ' + r.status);
    const xml = await r.text();
    const videos = xml.split('<entry>').slice(1).map(function (e) {
      const id = tag(e, 'yt:videoId');
      return { id: id, title: tag(e, 'title'), published: tag(e, 'published'), thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
    }).filter(function (v) { return /^[\w-]{11}$/.test(v.id); });
    res = new Response(JSON.stringify({ channel: 'https://www.youtube.com/channel/' + CHANNEL, updated: new Date().toISOString(), videos: videos }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900' }
    });
    context.waitUntil(cache.put(key, res.clone()));
  } catch (err) {
    res = new Response(JSON.stringify({ error: 'Could not load the latest bayans right now.' }), {
      status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  return res;
}
