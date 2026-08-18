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
const CACHE_VERSION = 'pc-v20260818.183541Z'; // V4-S3-B r2：boot 占位+core.js boot 移除（core 内容变更，引用参数 bump S3b）→ bump 清 S3b 防缓存清单残留； r1：echarts/charts.js 移出关键路径； // V4-S3-E：P-03 守卫补丁（skymap-env.js 变更）→ 缓存版本 bump // V4-M5c: M5b基础上补登5张apod图+移除孤儿2004-01-15; M5b: fatal测试期间M5预缓存被污染(缓存了COSMOS_DATA=null版), bump触发全量重装+activate清旧缓存 // V4-M4：按需渲染调度（三态机+invalidate）+ 自适应画质（三档升降） // V4-M3 修补：threshold 0.85->0.6（P1）+ setTheme enabled 强制分发（P2）
const CACHE_NAME = 'private-cosmos-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css?v=20260816M5',
  // 业务模块
  './assets/cosmos-data.js?v=20260816M5',
  './assets/skymap-core.js?v=20260816S3b',
  './assets/skymap-env.js?v=20260816S3',
  './assets/skymap-bodies.js?v=20260816M5',
  './assets/skymap-controls.js?v=20260816M5',
  './assets/skymap-panel.js?v=20260816M5',
  './assets/charts.js?v=20260816M5',
  './assets/skymap-timeline.js?v=20260816M5',
  './assets/skymap-search.js?v=20260816M5',
  './assets/skymap-constellation.js?v=20260816M5',
  './assets/skymap-personal.js?v=20260816M5',
  // three 本地化
  './_shared/js/three/three.module.js',
  './_shared/js/three/addons/controls/OrbitControls.js',
  './_shared/js/three/addons/renderers/CSS2DRenderer.js',
  // V4-M3：后处理管线本地化（10 文件，three r160）
  './_shared/js/three/addons/postprocessing/EffectComposer.js',
  './_shared/js/three/addons/postprocessing/RenderPass.js',
  './_shared/js/three/addons/postprocessing/ShaderPass.js',
  './_shared/js/three/addons/postprocessing/UnrealBloomPass.js',
  './_shared/js/three/addons/postprocessing/OutputPass.js',
  './_shared/js/three/addons/postprocessing/MaskPass.js',
  './_shared/js/three/addons/postprocessing/Pass.js',
  './_shared/js/three/addons/shaders/CopyShader.js',
  './_shared/js/three/addons/shaders/LuminosityHighPassShader.js',
  './_shared/js/three/addons/shaders/OutputShader.js',
  // echarts
  './_shared/js/echarts.min.js?v=20260816M5',
  // 字体（5）
  './_shared/fonts/JetBrainsMono-Regular.ttf',
  './_shared/fonts/InstrumentSans-Regular.ttf',
  './_shared/fonts/InstrumentSans-Bold.ttf',
  './_shared/fonts/BricolageGrotesque-Regular.ttf',
  './_shared/fonts/BricolageGrotesque-Bold.ttf',
  // 图标
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  // apod 图片（10，M5c 修补：与 data/apod.json local_path 实存清单一致；2004-01-15 已被数据淘汰移除，新补 5 张登记）
  // apod 图片（21，M5d：O1 采纳——仓库根 assets/apod 历史全量图校验后补入 web，FR-09 完全关闭）
  './assets/apod/apod_1997-01-09.jpg',
  './assets/apod/apod_1997-07-04.jpg',
  './assets/apod/apod_2000-07-21.jpg',
  './assets/apod/apod_2001-01-19.jpg',
  './assets/apod/apod_2001-09-29.jpg',
  './assets/apod/apod_2004-02-20.jpg',
  './assets/apod/apod_2004-05-28.jpg',
  './assets/apod/apod_2005-02-03.jpg',
  './assets/apod/apod_2008-05-09.jpg',
  './assets/apod/apod_2009-01-05.jpg',
  './assets/apod/apod_2011-01-03.jpg',
  './assets/apod/apod_2012-06-16.jpg',
  './assets/apod/apod_2013-03-10.jpg',
  './assets/apod/apod_2015-09-14.jpg',
  './assets/apod/apod_2015-10-12.jpg',
  './assets/apod/apod_2018-02-21.jpg',
  './assets/apod/apod_2020-10-30.jpg',
  './assets/apod/apod_2022-07-20.jpg',
  './assets/apod/apod_2022-11-14.jpg',
  './assets/apod/apod_2024-04-29.jpg',
  './assets/apod/apod_2026-01-17.jpg',
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
