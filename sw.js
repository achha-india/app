// Ачча — Service Worker: сохраняет приложение, фразы и шрифты на телефоне, чтобы всё работало без интернета.
// При изменении файлов приложения увеличьте номер версии, чтобы телефоны скачали обновление.
const VERSION = 'achha-v12';
const APP_CACHE = VERSION + '-app';
const FONT_CACHE = 'achha-fonts-v1';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Pliant:wght@500;700&display=swap';

const APP_FILES = [
  './',
  './index.html',
  './phrases.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// Озвучка: берём список фраз и сохраняем audio/<id>.mp3 для каждой (около 1 МБ на все фразы).
// Если какого-то файла нет, приложение озвучит фразу голосом телефона.
async function cacheAudio(cache) {
  try {
    const res = await cache.match('./phrases.json');
    if (!res) return;
    const data = await res.clone().json();
    const ids = [];
    (data.stages || []).forEach(s => (s.situations || []).forEach(sit => (sit.lines || []).forEach(l => l.id && ids.push(l.id))));
    await Promise.all(ids.map(id => {
      const u = './audio/' + id + '.mp3';
      return fetch(u, { cache: 'reload' }).then(r => r.ok && cache.put(u, r)).catch(() => {});
    }));
  } catch (e) { /* без файлов озвучки работает голос телефона */ }
}

// Шрифты: сохраняем CSS Google Fonts и все файлы шрифтов из него.
async function cacheFonts() {
  try {
    const cache = await caches.open(FONT_CACHE);
    const res = await fetch(FONT_CSS, { mode: 'cors' });
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(FONT_CSS, res);
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(urls.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && cache.put(u, r)).catch(() => {})));
  } catch (e) { /* без шрифтов приложение всё равно работает на системном шрифте */ }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' })));
    await cacheAudio(cache);
    await cacheFonts();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== APP_CACHE && k !== FONT_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Шрифты: сначала из памяти телефона.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      } catch (e) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Озвучка: сначала из памяти телефона. iPhone запрашивает аудио кусками (Range),
  // поэтому отдаём нужный кусок файла сами.
  if (url.pathname.includes('/audio/') && url.pathname.endsWith('.mp3')) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const key = './audio/' + url.pathname.split('/').pop();
      let res = await cache.match(key);
      if (!res) {
        try {
          const net = await fetch(url.href);
          if (!net.ok) return net;
          await cache.put(key, net.clone());
          res = net;
        } catch (e) { return new Response('', { status: 504 }); }
      }
      const range = req.headers.get('range');
      if (!range) return res;
      const buf = await res.arrayBuffer();
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : buf.byteLength - 1;
      if (!m[1] && m[2]) { start = Math.max(0, buf.byteLength - parseInt(m[2], 10)); end = buf.byteLength - 1; }
      end = Math.min(end, buf.byteLength - 1);
      if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': 'bytes */' + buf.byteLength } });
      return new Response(buf.slice(start, end + 1), { status: 206, headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(end - start + 1),
        'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength,
        'Accept-Ranges': 'bytes'
      } });
    })());
    return;
  }

  // Приложение и фразы: при наличии интернета берём свежую версию (ждём до 4 секунд),
  // без сети или при медленной сети показываем сохранённую.
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const key = req.mode === 'navigate' ? './index.html' : req;
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, 4000, null));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (e) { /* нет сети */ }
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) { event.waitUntil(network.catch(() => {})); return hit; }
    try { return await network; } catch (e) {
      return new Response('Нет соединения', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
