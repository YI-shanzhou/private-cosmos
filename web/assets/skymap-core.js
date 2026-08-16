/**
 * skymap-core.js — 场景核心模块（Day 2 · 2.1）
 *
 * 职责：
 *  - Three.js 场景骨架初始化（背景色与星幕已移交 skymap-env.js，V4 · M1）
 *  - 自适应螺旋坐标公式：radius = 5 + i*(maxR-5)/(n-1)
 *  - 窗口 resize 处理
 *  - 场景状态管理（当前天体列表 / 筛选状态 / 时间轴位置）
 *  - 统一渲染循环（updateHooks 供 controls / 标签渲染等注册逐帧回调）
 *  - V4-M4：按需渲染调度器（三态 continuous/on-demand/suspended + invalidate 零延迟唤醒）
 *    与自适应画质调节器（qualityLevel 2→0 分级升降，迟滞防振荡）
 *
 * 全局命名空间：window.SkyMap（后续模块只读写该命名空间，不重复 init）
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MAX_RADIUS = 30;    // 螺旋最大半径

const SkyMap = (window.SkyMap = {
  THREE,
  scene: null,
  camera: null,
  renderer: null,
  container: null,
  labelRenderer: null,     // 由 skymap-bodies.js 创建
  composer: null,          // V4-M3：EffectComposer（由 init 创建，env 挂载后参数依 theme 校准）
  bloomPass: null,         // V4-M3：UnrealBloomPass（applyBloomTheme 热切换）
  controls: null,          // 由 skymap-controls.js 创建
  updateHooks: [],         // 每帧回调：fn(dt)
  bodyMeshes: [],          // 天体网格（由 skymap-bodies.js 填充）
  theme: null,             // 主题挂载点（由 skymap-env.js 填充，V4 · M1）
  env: null,               // 环境模块挂载点（starfield/themes，由 skymap-env.js 填充）
  state: {
    bodies: [],            // 当前天体列表（COSMOS_DATA 引用）
    filterState: null,     // 筛选状态（Day 4 使用）
    timelinePos: 1.0,      // 时间轴位置（1.0 = 最新，Day 4 使用）
    viewport: null,        // 视口尺寸（init 时由 onResize 填充）
  },
});

/** 自适应螺旋坐标：radius = 5 + i*(maxR-5)/(n-1)，黄金角散布，轻微起伏 */
function spiralPosition(i, n, maxR = MAX_RADIUS) {
  const radius = n > 1 ? 5 + (i * (maxR - 5)) / (n - 1) : 5;
  const angle = i * Math.PI * (3 - Math.sqrt(5)); // 黄金角 ≈ 137.5°
  const y = Math.sin(i * 0.7) * (radius * 0.18);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    y,
    Math.sin(angle) * radius,
  );
}

/** 窗口 resize：相机宽高比 + 渲染器尺寸 + 标签渲染器同步 */
function onResize() {
  const w = SkyMap.container.clientWidth;
  const h = SkyMap.container.clientHeight;
  SkyMap.camera.aspect = w / h;
  SkyMap.camera.updateProjectionMatrix();
  SkyMap.renderer.setSize(w, h);
  if (SkyMap.composer) { // V4-M3：resize 链路同步 composer
    SkyMap.composer.setSize(w, h);
    SkyMap.composer.setPixelRatio(SkyMap.renderer.getPixelRatio());
  }
  if (SkyMap.labelRenderer) SkyMap.labelRenderer.setSize(w, h);
  SkyMap.state.viewport = { width: w, height: h };
  if (SkyMap.invalidate) SkyMap.invalidate('resize'); // V4-M4：resize 即需重绘
}

/* ================= V4-M4：按需渲染调度器（S1 计划 2.2/M4-A 三态机） =================
 * 三态：continuous=逐帧渲染（兼容态/动画过渡期）；on-demand=rAF 常驻、按脏标记渲染
 *       （星幕缓旋/GPU 闪烁等持续环境动画自动保持渲染，S1 1.3/3.1 口径）；
 *       suspended=rAF 已 cancel，画面完全冻结（含闪烁/缓旋，FR-05"挂起"语义）。
 * 挂起条件：无交互 idle >= theme.quality.idleTimeoutMs 且 autoRotate 关闭且无过渡动画（fade/tween）。
 * 唤醒：任一 invalidate（pointerdown/wheel/keydown/resize/controls change/...）下一帧即渲染（零延迟）。 */

const SCHED = {
  mode: 'on-demand',          // 启动即按需态（缓旋常驻 -> 实际逐帧渲染，与旧版观感一致）
  dirty: true,
  idleMs: 0,
  qualityLevel: 2,            // M4-C：2=全画质 -> 0=最低档
  get bloomEnabled() { return !!(SkyMap.bloomPass && SkyMap.bloomPass.enabled); },
};
SkyMap.renderScheduler = SCHED;
SkyMap._renderedFrameCount = 0;   // 渲染帧计数（FPS 采样仅计渲染帧，防 on-demand 空转虚高）
SkyMap.activeTweens = 0;          // 过渡动画计数（timeline fadeIn 注册/注销，挂起判定消费）

let _rafId = 0;
let _rafRunning = false;
let _lastActivityAt = performance.now();
let _qCfg = { pixelRatioCap: 2, adaptive: true, fpsLow: 50, fpsHigh: 58, idleTimeoutMs: 10000 };

/** 环境持续动画源：星幕（缓旋+GPU 闪烁）在 on-demand 态保持渲染，仅 suspended 冻结 */
function envAnimating() {
  return !!(SkyMap.env && SkyMap.env.starfield);
}

/** 本帧是否需要渲染：脏标记 / autoRotate / 过渡动画 / 环境缓旋任一命中即渲 */
function needRender() {
  return SCHED.mode === 'continuous'
    || SCHED.dirty
    || !!(SkyMap.controls && SkyMap.controls.autoRotate)
    || SkyMap.activeTweens > 0
    || envAnimating();
}

/** 统一渲染帧：WebGL（composer 优先）+ CSS2D 标签层（S1 M4-A：CSS2D 仅渲染帧调用） */
function renderFrame() {
  if (SkyMap.composer) SkyMap.composer.render();
  else SkyMap.renderer.render(SkyMap.scene, SkyMap.camera);
  if (SkyMap.labelRenderer) SkyMap.labelRenderer.render(SkyMap.scene, SkyMap.camera);
  SkyMap._renderedFrameCount++;
}

/** 挂起：cancel rAF（GPU 归零，NFR-03）；dirty 置真保证唤醒首帧必渲 */
function suspendLoop() {
  if (_rafRunning) cancelAnimationFrame(_rafId);
  _rafRunning = false;
  SCHED.mode = 'suspended';
  SCHED.dirty = true;
  console.log('[skymap-core] 调度器挂起：静止 ' + _qCfg.idleTimeoutMs + 'ms（autoRotate 关/无过渡动画），rAF 已取消');
}

function loop() {
  _rafId = requestAnimationFrame(loop);
  const dt = Math.min(SkyMap.clock.getDelta(), 0.25); // 钳制：防挂起唤醒/标签页切回的巨帧 dt
  for (const hook of SkyMap.updateHooks) hook(dt);
  if (needRender()) {
    renderFrame();
    SCHED.dirty = false;
  }
  if (SCHED.mode === 'on-demand') {
    SCHED.idleMs = performance.now() - _lastActivityAt;
    const noAnim = !(SkyMap.controls && SkyMap.controls.autoRotate) && SkyMap.activeTweens === 0;
    if (SCHED.idleMs >= _qCfg.idleTimeoutMs && noAnim) suspendLoop();
  }
}

function startLoop() {
  if (_rafRunning) return;
  _rafRunning = true;
  if (!SkyMap.clock) SkyMap.clock = new THREE.Clock();
  else SkyMap.clock.getDelta(); // 预消费：丢弃挂起期间累积的时间（防唤醒首帧 dt 异常）
  loop();
}

/** 脏标记入口（S1 2.2 契约）：置脏 + 重置 idle 计时 + 从 suspended 零延迟唤醒（下一帧即渲） */
SkyMap.invalidate = function (reason) {
  SCHED.dirty = true;
  _lastActivityAt = performance.now();
  if (SCHED.mode === 'suspended') {
    SCHED.mode = 'on-demand';
    SCHED.idleMs = 0;
    startLoop();
    if (SkyMap.debug) console.log('[skymap-core] invalidate(' + reason + ')：suspended -> on-demand 唤醒');
  }
};

/** 手动切换渲染模式（测试/调试入口；suspended 不可直接设——由挂起条件自动进入）
 *  V4-M4-D1 修补：suspended 态调用时必须先重启 rAF（startLoop）再设 mode——
 *  若先改 mode 再走 invalidate，其唤醒分支（mode==='suspended' 判定）将失效致死锁 */
SkyMap.setRenderMode = function (mode) {
  if (mode !== 'continuous' && mode !== 'on-demand') {
    console.warn('[skymap-core] setRenderMode 仅支持 continuous | on-demand');
    return;
  }
  if (!_rafRunning) startLoop(); // suspended 态直接唤醒（rAF 重启 + clock 预消费）
  SCHED.mode = mode;
  SCHED.dirty = true;
  _lastActivityAt = performance.now();
};

function init() {
  SkyMap.container = document.getElementById('app');
  SkyMap.scene = new THREE.Scene();

  SkyMap.camera = new THREE.PerspectiveCamera(
    60, SkyMap.container.clientWidth / SkyMap.container.clientHeight, 0.1, 500,
  );
  SkyMap.camera.position.set(0, 18, 52);

  SkyMap.renderer = new THREE.WebGLRenderer({ antialias: true });
  SkyMap.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  SkyMap.renderer.setSize(SkyMap.container.clientWidth, SkyMap.container.clientHeight);
  SkyMap.container.appendChild(SkyMap.renderer.domElement);

  // V4-M3：后处理管线 RenderPass -> UnrealBloomPass -> OutputPass（M3-B）
  SkyMap.renderer.toneMapping = THREE.ACESFilmicToneMapping; // 色调映射（applyBloomTheme 依 theme.bloom.toneMapping 热切）
  SkyMap.composer = new EffectComposer(SkyMap.renderer);
  SkyMap.composer.addPass(new RenderPass(SkyMap.scene, SkyMap.camera));
  const vpSize = new THREE.Vector2(SkyMap.container.clientWidth, SkyMap.container.clientHeight);
  SkyMap.bloomPass = new UnrealBloomPass(vpSize, 0.35, 0.6, 0.85); // 占位默认；env 挂载后 applyBloomTheme(theme.bloom) 校准
  SkyMap.composer.addPass(SkyMap.bloomPass);
  SkyMap.composer.addPass(new OutputPass());

  // 灯光：环境光 + 中心点光（天体自带 emissive 自发光，灯光作补充）
  SkyMap.scene.add(new THREE.AmbientLight(0x8888aa, 0.9));
  const sun = new THREE.PointLight(0xffffff, 300, 0, 1.2);
  SkyMap.scene.add(sun);

  window.addEventListener('resize', onResize);
  onResize();
  startLoop();
  console.log('[skymap-core] 场景骨架初始化完成（背景/星幕由 skymap-env.js 提供）；theme 挂载点已就绪');
}

SkyMap.spiralPosition = spiralPosition;
SkyMap.onResize = onResize;

/** 时间轴可见性接口（Day 4 · 4.1）：只显示 epoch <= maxEpoch 的天体 */
SkyMap.updateVisibleBodies = function (maxEpoch) {
  (SkyMap.bodyMeshes || []).forEach((m) => {
    m.visible = (m.userData.body ? m.userData.body.epoch : 0) <= maxEpoch;
  });
  SkyMap.state.visibleMaxEpoch = maxEpoch;
  SkyMap.invalidate('updateVisibleBodies'); // V4-M4：可见性变化即需一帧
};

/** 天体淡化（Day 4 · 4.2 内部）：本体/光晕/标签整体透明度 */
SkyMap._setBodyFade = function (mesh, op) {
  mesh.material.transparent = true;
  mesh.material.opacity = op;
  const halo = mesh.userData.haloMesh;
  if (halo && halo.material) {
    const base = halo.userData.baseOpacity ?? halo.material.opacity;
    halo.material.opacity = base * op;
  }
  const labelObj = mesh.userData.labelObj;
  if (labelObj && labelObj.element) labelObj.element.style.opacity = op;
  mesh.userData._faded = op < 1;
  SkyMap.invalidate('_setBodyFade'); // V4-M4：淡化变化即需一帧
};

/** 搜索筛选接口（Day 4 · 4.2）：filters = {q, domains[], types[], moods[]}；返回匹配数
 *  匹配保持原样，不匹配淡化至 0.15（本体/光晕/标签） */
SkyMap.filterBodies = function (filters = {}) {
  const q = String(filters.q || '').trim().toLowerCase();
  const doms = filters.domains || [];
  const types = filters.types || [];
  const moods = filters.moods || [];
  let match = 0;
  (SkyMap.bodyMeshes || []).forEach((m) => {
    const b = (m.userData && m.userData.body) || {};
    const comp = b.composition || {};
    let ok = true;
    if (q) {
      const hay = [
        b.name, b.collision_text, b.type_cn, b.type,
        comp.a && (comp.a.text + ' ' + comp.a.source),
        comp.b && (comp.b.text + ' ' + comp.b.source),
        comp.c && (comp.c.text + ' ' + comp.c.source),
      ].filter(Boolean).join(' ').toLowerCase();
      ok = ok && hay.includes(q);
    }
    if (doms.length) {
      ok = ok && ((b.tags && b.tags.domains) || []).some((d) => doms.includes(d));
    }
    if (types.length) {
      ok = ok && (types.includes(b.type) || types.includes(b.type_cn));
    }
    if (moods.length) {
      ok = ok && ((b.tags && b.tags.moods) || []).some((x) => moods.includes(x));
    }
    if (ok) match += 1;
    SkyMap._setBodyFade(m, ok ? 1 : 0.15);
  });
  SkyMap.state.filterState = { q, domains: doms, types, moods, matchCount: match };
  SkyMap.invalidate('filterBodies'); // V4-M4：筛选变化即需一帧
  return match;
};

/** 高亮单颗天体（Day 4 · 4.2）：放大 + 发光增强 */
SkyMap.highlightBody = function (id) {
  const m = (SkyMap.bodyMeshes || []).find((x) => x.userData.bodyId === id);
  if (!m || !m.visible) return null;
  const base = m.userData.baseScale || 1;      // V4-M2：共享几何后基准 scale = visual.size
  m.scale.setScalar(base * 1.35);
  if (m.material.uniforms && m.material.uniforms.uHighlight) {
    m.material.uniforms.uHighlight.value = 1; // V4-M2：ShaderMaterial 高亮（原 emissiveIntensity=1.6）
  }
  SkyMap.invalidate('highlightBody'); // V4-M4：高亮变化即需一帧
  return m;
};

/** V4-M3：bloom 主题应用（env 初始化/setTheme 分发调用；core init 时 theme 未挂载故延迟校准）
 *  toneMapping 字符串 -> THREE 常量；显式 setTheme 重设 bloom.enabled=true 时重置自动降级锁 */
SkyMap.applyBloomTheme = function (bloom) {
  if (!bloom || !SkyMap.bloomPass) return;
  SkyMap.bloomPass.enabled = bloom.enabled !== false;
  SkyMap.bloomPass.strength = bloom.strength;
  SkyMap.bloomPass.radius = bloom.radius;
  SkyMap.bloomPass.threshold = bloom.threshold;
  const tmMap = {
    ACESFilmic: THREE.ACESFilmicToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
    Linear: THREE.LinearToneMapping,
    None: THREE.NoToneMapping,
  };
  SkyMap.renderer.toneMapping = tmMap[bloom.toneMapping] ?? THREE.ACESFilmicToneMapping;
  if (bloom.enabled !== false && bloomAutoOff) bloomAutoOff = false; // 显式重设即重开（分级升降归 M4）
};

/* V4-M3：低帧率自动降级（FR-04 后半简版：FPS < autoDowngradeFps 持续 3s -> 关 bloom；
 * 不自动重开避免振荡；重开路径 = setTheme 显式重设或 M4 画质调节器分级管理） */
let bloomAutoOff = false;
let _lowFpsSince = 0;
SkyMap.updateHooks.push((dt) => {
  if (!SkyMap.bloomPass || !SkyMap.bloomPass.enabled || bloomAutoOff) { _lowFpsSince = 0; return; }
  const th = (SkyMap.theme && SkyMap.theme.bloom) || {};
  const fps = dt > 0 ? 1 / dt : 60;
  if (fps < (th.autoDowngradeFps ?? 50)) {
    if (!_lowFpsSince) _lowFpsSince = performance.now();
    else if (performance.now() - _lowFpsSince >= 3000) {
      SkyMap.bloomPass.enabled = false;
      bloomAutoOff = true;
      _lowFpsSince = 0;
      console.warn('[skymap-core] FPS 持续低于 ' + (th.autoDowngradeFps ?? 50) + ' 达 3s，已自动关闭轻辉光（分级回升由画质调节器管理，M4）');
    }
  } else {
    _lowFpsSince = 0;
  }
});

/* ================= V4-M4-C：自适应画质调节器（FR-05 后半 + US-04） =================
 * 三档 qualityLevel：2=全画质 -> 1=关 bloom -> 0=最低档（pixelRatio 降 1.0 + 星幕减半 + 低模球）
 * 迟滞防振荡：连续 3s 低于 fpsLow(50) 降一级；连续 5s 高于 fpsHigh(58) 升一级；
 * FPS 源 = SkyMap.getFPS()（0.5s 窗口渲染帧率，仅渲染帧计入，空转帧不采样）。
 * 切档原子性：pixelRatio + bloom + 星幕重建 + 球切换在同一调用内完成，末尾 invalidate 一次。 */

let _baseStarCount = 0;   // 降档前捕获的星幕基准数（升档恢复；用户在 level 0 期间改 stars.count 的场景记已知限制）
let _lowQSince = 0;
let _highQSince = 0;

/** 应用指定画质档（内部：档位参数原子切换） */
function applyQualityLevel(level) {
  const prev = SCHED.qualityLevel;
  if (level === prev) return;
  const q = _qCfg;

  // bloom：level 2 依 theme.bloom.enabled（走 applyBloomTheme 重置 M3 降级锁）；level 1/0 直接关
  if (level === 2) {
    if (SkyMap.theme && SkyMap.theme.bloom && typeof SkyMap.applyBloomTheme === 'function') {
      SkyMap.applyBloomTheme(SkyMap.theme.bloom);
    }
  } else if (SkyMap.bloomPass) {
    SkyMap.bloomPass.enabled = false;
  }

  // pixelRatio：level 0/1 依档位；level 2 恢复 cap
  const dpr = Math.min(window.devicePixelRatio || 1, level === 0 ? 1.0 : q.pixelRatioCap);
  SkyMap.renderer.setPixelRatio(dpr);
  if (SkyMap.composer) SkyMap.composer.setPixelRatio(dpr);
  SkyMap.onResize(); // 同步 renderer/composer/labelRenderer 尺寸链路

  // 星幕：level 0 减半（捕获基准），升档恢复
  if (level === 0) {
    if (!_baseStarCount && SkyMap.theme) _baseStarCount = SkyMap.theme.stars.count;
    if (typeof SkyMap.setTheme === 'function') {
      SkyMap.setTheme({ stars: { count: Math.max(80, Math.round(_baseStarCount / 2)) } });
    }
  } else if (_baseStarCount && typeof SkyMap.setTheme === 'function') {
    SkyMap.setTheme({ stars: { count: _baseStarCount } });
    if (level === 2) _baseStarCount = 0; // 回到基准后清捕获
  }

  // 天体几何：level 0 切低模球（M2 预留 unitSphereLo），否则回 Hi
  if (typeof SkyMap.setBodyGeometryLOD === 'function') SkyMap.setBodyGeometryLOD(level === 0);

  SCHED.qualityLevel = level;
  _lowQSince = 0;
  _highQSince = 0;
  SkyMap.invalidate('quality-level:' + prev + '->' + level);
  const fpsNow = (typeof SkyMap.getFPS === 'function') ? SkyMap.getFPS() : '?';
  console.log('[skymap-core] 画质调节：level ' + prev + ' -> ' + level + '（FPS ' + fpsNow + '）');
}

/** theme.quality 分发入口（setTheme quality 层变化时由 skymap-env.js 调用） */
SkyMap.applyQualityTheme = function (quality) {
  if (!quality) return;
  _qCfg = {
    pixelRatioCap: quality.pixelRatioCap ?? _qCfg.pixelRatioCap,
    adaptive: quality.adaptive !== false,
    fpsLow: quality.fpsLow ?? _qCfg.fpsLow,
    fpsHigh: quality.fpsHigh ?? _qCfg.fpsHigh,
    idleTimeoutMs: quality.idleTimeoutMs ?? _qCfg.idleTimeoutMs,
  };
  // 非 level-0 态下 cap 变化即时生效
  if (SCHED.qualityLevel > 0) {
    const dpr = Math.min(window.devicePixelRatio || 1, _qCfg.pixelRatioCap);
    SkyMap.renderer.setPixelRatio(dpr);
    if (SkyMap.composer) SkyMap.composer.setPixelRatio(dpr);
    SkyMap.onResize();
  }
  SkyMap.invalidate('applyQualityTheme');
};

/** 调度器逐帧 hook：FPS 迟滞升降档（挂起态自然停摆） */
SkyMap.updateHooks.push(() => {
  if (!_qCfg.adaptive) return;
  if (typeof SkyMap.getFPS !== 'function') return; // controls 未挂载（模块加载时序）不采样
  const fps = SkyMap.getFPS();
  if (fps <= 0) return; // 尚无有效采样
  const now = performance.now();
  if (fps < _qCfg.fpsLow) {
    _highQSince = 0;
    if (!_lowQSince) _lowQSince = now;
    else if (now - _lowQSince >= 3000 && SCHED.qualityLevel > 0) applyQualityLevel(SCHED.qualityLevel - 1);
  } else if (fps > _qCfg.fpsHigh) {
    _lowQSince = 0;
    if (!_highQSince) _highQSince = now;
    else if (now - _highQSince >= 5000 && SCHED.qualityLevel < 2) applyQualityLevel(SCHED.qualityLevel + 1);
  } else {
    _lowQSince = 0;
    _highQSince = 0;
  }
});

/** 按 id 查询天体数据（Day 5 · 5.1，计划书指定接口） */
SkyMap.getBodyById = function (id) {
  const data = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];
  return data.find((b) => b.id === id) || null;
};

/* ================= V4-M5-B：数据加载校验 + 友好错误页（FR-08 前半） =================
 * 宽进严出口径（S1 M5-B）：仅阻断"完全不可渲染"态——非数组/空数组/首元素无有效 id；
 * 其余 4 个附属全局（CHRONICLE/APOD/DAILY_REPORTS/COSMOS_STATS）仅存在性警告不阻断。
 * 失败路径：#app 内渲染纯 DOM 错误界面（零素材）+ 顶层 await 挂起本模块求值——
 * ESM 按文档序求值，后续 skymap-* 模块（依赖 camera/renderer）不会执行，
 * 从而满足"控制台无未捕获异常"（白盒验收口径，US-05 友好提示而非白屏）。 */
function validateCosmosData() {
  const problems = [];
  if (typeof COSMOS_DATA === 'undefined' || COSMOS_DATA === null) {
    problems.push('COSMOS_DATA 未定义（cosmos-data.js 未加载或已损坏）');
  } else if (!Array.isArray(COSMOS_DATA)) {
    problems.push('COSMOS_DATA 不是数组（实际类型：' + typeof COSMOS_DATA + '）');
  } else if (COSMOS_DATA.length === 0) {
    problems.push('COSMOS_DATA 为空数组（宇宙中没有天体）');
  } else if (!COSMOS_DATA[0] || typeof COSMOS_DATA[0].id !== 'string' || !COSMOS_DATA[0].id) {
    problems.push('首元素缺少有效的 id 字段（抽样校验失败，数据结构不完整）');
  }
  // 附属全局：仅存在性警告，不阻断渲染
  ['CHRONICLE_DATA', 'APOD_DATA', 'DAILY_REPORTS', 'COSMOS_STATS'].forEach((k) => {
    if (typeof window[k] === 'undefined') {
      console.warn('[skymap-core] 警告：' + k + ' 未定义（附属功能可能退化，不阻断渲染）');
    }
  });
  return problems;
}

function renderDataErrorPage(problems) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:16px',
    'background:#050505', 'color:#9a9a9a', 'font-family:system-ui,sans-serif',
    'padding:32px', 'text-align:center', 'z-index:2147483646',
  ].join(';');
  const title = document.createElement('h1');
  title.textContent = '宇宙数据暂时无法加载';
  title.style.cssText = 'font-size:20px;font-weight:400;color:#e0e0e0;margin:0';
  const desc = document.createElement('p');
  desc.textContent = '星图依赖的天体数据缺失或已损坏，为避免白屏已停止渲染。请检查网络后刷新重试；若反复出现，请在 DevTools > Application > Service Workers 中 Unregister 后重试。';
  desc.style.cssText = 'font-size:13px;line-height:1.8;max-width:520px;margin:0';
  const detail = document.createElement('pre');
  detail.textContent = problems.map((p2, i) => (i + 1) + '. ' + p2).join('\n');
  detail.style.cssText = [
    'font-size:12px', 'color:#6f6f6f', 'background:#0d0d0d', 'border:1px solid #222',
    'border-radius:6px', 'padding:12px 16px', 'margin:0', 'max-width:560px',
    'overflow:auto', 'text-align:left', 'white-space:pre-wrap',
  ].join(';');
  const btn = document.createElement('button');
  btn.textContent = '刷新重试';
  btn.style.cssText = [
    'font-size:13px', 'color:#d0d0d0', 'background:#161616', 'border:1px solid #333',
    'border-radius:6px', 'padding:8px 24px', 'cursor:pointer', 'margin-top:8px',
  ].join(';');
  btn.addEventListener('click', () => location.reload());
  box.append(title, desc, detail, btn);
  app.appendChild(box);
  // fatal 态隐藏星图 HUD（数据已坏，星图控件无意义）
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
}

const _dataProblems = validateCosmosData();
if (_dataProblems.length) {
  console.error('[skymap-core] 数据校验失败（M5-B 守卫），已阻止场景初始化：', _dataProblems);
  SkyMap.fatal = true; // 供全局兜底识别 fatal 态（见 index.html：抑制默认 Uncaught 输出）
  renderDataErrorPage(_dataProblems);
  // 挂起本模块求值：标准浏览器下后续 skymap-* 模块不再执行；
  // 非标环境（实测本 webview 未阻塞兄弟模块）由 fatal 态 + 全局兜底归拢崩溃日志
  await new Promise(() => {});
}

init();
