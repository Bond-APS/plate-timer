/* Service Worker: アプリ本体と音声ファイルを事前キャッシュし、オフライン・ホーム画面起動でも動くようにする。
   更新の仕方: 下の VERSION を上げる → install で新キャッシュを作り、activate で旧キャッシュを消す。
   注意: <audio>/<video> で読む keepalive.mp4 は Safari が Range 要求で取りに来るので、
   キャッシュから返すときは 206 Partial Content に切り出して返す(これが無いと再生できない)。 */
const VERSION = 'v1.1.0';
const CACHE = `aps-plate-timer-${VERSION}`;
const BASE = new URL('./', self.location.href).pathname; // サブパス配信(GitHub Pages)対応

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/views/timer.js',
  './js/views/history.js',
  './js/views/settings.js',
  './js/components/audiotimer.js',
  './js/components/livedetect.js',
  './js/components/shot-worklet.js',
  './js/components/platepanel.js',
  './js/components/plategrid.js',
  './js/components/timer.js',
  './js/components/charts.js',
  './js/logic/plateclip.js',
  './js/logic/rhythm.js',
  './js/logic/shotanalysis.js',
  './audio/plate-call.m4a',
  './audio/ref-opening.m4a',
  './audio/ref-break.m4a',
  './audio/ref-finish.m4a',
  './audio/keepalive.mp4',
  './audio/ai-male/ref-opening.m4a',
  './audio/ai-male/ref-break.m4a',
  './audio/ai-male/ref-finish.m4a',
  './audio/ai-female/ref-opening.m4a',
  './audio/ai-female/ref-break.m4a',
  './audio/ai-female/ref-finish.m4a',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 音声などが1つ欠けても他は使えるように、個別に addAll せず1件ずつ入れる
    await Promise.all(PRECACHE.map(async (p) => {
      try { await cache.add(new Request(p, { cache: 'reload' })); } catch (err) { /* 欠けは黙認 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('aps-plate-timer-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Range 要求をキャッシュ済みレスポンスから切り出す(メディア要素向け) */
async function rangeFromCache(req, cached) {
  const buf = await cached.arrayBuffer();
  const total = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = m && m[1] !== '' ? Number(m[1]) : 0;
  let end = m && m[2] !== '' ? Number(m[2]) : total - 1;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, total - Number(m[2])); end = total - 1; }
  end = Math.min(end, total - 1);
  if (start > end || start >= total) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  }
  const headers = new Headers();
  headers.set('Content-Type', cached.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ナビゲーション(ページ本体)は index.html を返す
    const key = req.mode === 'navigate' ? './index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true, ignoreVary: true });
    if (cached) {
      if (req.headers.has('range')) return rangeFromCache(req, cached);
      return cached;
    }
    try {
      const res = await fetch(req);
      // 事前キャッシュに無い同一オリジンのファイルも次回のために保存(Range応答=206は保存しない)
      if (res.ok && res.status === 200 && !req.headers.has('range')) cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const idx = await cache.match('./index.html');
        if (idx) return idx;
      }
      return new Response('オフラインのため読み込めません', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
