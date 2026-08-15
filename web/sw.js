/**
 * sw.js — Service Worker（Day 6 · 6.1）
 *
 * 策略：
 *  - install：预缓存全部同源静态资源（three 已本地化至 _shared/js/three/，无跨域 CDN 依赖）
 *  - activate：清理旧版本缓存
 *  - fetch：预缓存资源 cache-first；导航请求离线回退缓存 index.html；其余 same-origin
 *    资源 stale-while-revalidate 兜底（运行期新增请求逐步入缓存）
 *
 * 版本： bump CACHE_VERSION 以触发更新（activate 清旧缓存 + skipWaiting 立即接管）
 */
const CACHE_VERSION = 'pc-v6.1.0';
const CACHE_NAME = 'private-cosmos-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  // 业务模块
  './assets/cosmos-data.js',
  './assets/skymap-core.js',
  './assets/skymap-bodies.js',
  './assets/skymap-controls.js',
  './assets/skymap-panel.js',
  './assets/charts.js',
  './assets/skymap-timeline.js',
  './assets/skymap-search.js',
  './assets/skymap-constellation.js',
  './assets/skymap-personal.js',
  // three 本地化
  './_shared/js/three/three.module.js',
  './_shared/js/three/addons/controls/OrbitControls.js',
  './_shared/js/three/addons/renderers/CSS2DRenderer.js',
  // echarts
  './_shared/js/echarts.min.js',
  // 字体（5）
  './_shared/fonts/JetBrainsMono-Regular.ttf',
  './_shared/fonts/InstrumentSans-Regular.ttf',
  './_shared/fonts/InstrumentSans-Bold.ttf',
  './_shared/fonts/BricolageGrotesque-Regular.ttf',
  './_shared/fonts/BricolageGrotesque-Bold.ttf',
  // 图标
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  // apod 图片（6）
  './assets/apod/apod_1997-01-09.jpg',
  './assets/apod/apod_1997-07-04.jpg',
  './assets/apod/apod_2004-01-15.jpg',
  './assets/apod/apod_2008-05-09.jpg',
  './assets/apod/apod_2018-02-21.jpg',
  './assets/apod/apod_2022-07-20.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域请求不接管

  // 页面导航：缓存优先，离线回退 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) =>
        cached || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // 静态资源：cache-first（预缓存命中即返回）
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => Response.error()); // 未缓存且离线：返回错误响应而非 null（避免未捕获 rejection）
    })
  );
});
