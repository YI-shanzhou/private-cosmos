/**
 * skymap-env.js - 环境模块（V4 · M1）
 *
 * 职责（S1 计划 1.2/1.3/3.1 节落地）：
 *  - 主题注册表：THEME_VOID（方案2默认全量生效）；THEME_DEEPSPACE 仅键名占位（S4 前不实现）
 *  - SkyMap.theme 挂载 + SkyMap.setTheme(params)：深合并 -> 逐层分发 -> theme-changed 事件
 *  - 纯黑虚空天穹：#050505，无渐变无边界（FR-01）
 *  - 稀疏星幕：约 300 颗冷白微星，逐星 aSize/aPhase 属性 + GPU 端闪烁 + 独立视差缓旋（FR-02）
 *
 * 挂载顺序（强约束，S1 计划 1.3 节）：index.html 中紧随 skymap-core.js 之后、
 * skymap-bodies.js 之前（bodies/M3 读 SkyMap.theme，晚于本模块挂载即安全）。
 */
import * as THREE from 'three';
// V4-M5-B：fatal 态守卫——数据校验失败时本模块整体跳过（防 null 链式崩溃与控制台噪音）
if (window.SkyMap && window.SkyMap.fatal) {
  console.warn('[skymap] fatal 态，跳过模块：' + (import.meta.url || '').split('/').pop());
} else {

const SkyMap = window.SkyMap;

/* ---------- 深合并工具（自研，零外部依赖 NFR-06） ---------- */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    const pv = patch[k];
    if (isPlainObject(pv) && isPlainObject(out[k])) out[k] = deepMerge(out[k], pv);
    else if (pv !== undefined) out[k] = pv;
  }
  return out;
}

/* ---------- 主题注册表（单一事实源：渲染层视觉常量只从这里读） ---------- */
const THEME_VOID = {
  name: 'void',
  sky: {                                   // 天穹层（消费者：本模块）
    background: '#050505',                 // FR-01：纯黑虚空
    gradient: null,                        // 方案1 预留键（V4 仅校验存储，不渲染）
  },
  stars: {                                 // 星幕层（消费者：本模块）
    count: 300,                            // FR-02：约 300 颗（验收读此参数，动态口径）
    radiusMin: 60, radiusMax: 140,         // 球壳分布域（沿用旧星空分布）
    sizeMin: 0.5, sizeMax: 1.4,            // 逐星 aSize 取值域（尺寸差异）
    color: { h: 0.60, s: 0.05, l: 0.92, jitterH: 0.02, jitterL: 0.05 }, // 冷白色温抖动
    twinkleSpeed: 1.6,                     // GPU 闪烁速率（rad/s）
    twinkleAmp: 0.38,                      // 闪烁幅度
    driftSpeed: 0.004,                     // 视差缓旋角速度（rad/s）
  },
  body: {                                  // 天体层（消费者 skymap-bodies.js，M2 接入；M1 存储分发）
    fresnelPower: 2.5, fresnelIntensity: 0.9,
    noiseScale: 6.0, noiseAmp: 0.12,
    baseBrightness: 0.55, haloScale: 1.8, haloOpacityBase: 0.12,
  },
  bloom: {                                 // 辉光层（消费者 M3；M1 仅存储）
    enabled: true, strength: 0.35, radius: 0.6, threshold: 0.6,
    toneMapping: 'ACESFilmic', autoDowngradeFps: 50,
  },
  quality: {                               // 画质层（消费者 M4；M1 仅存储）
    pixelRatioCap: 2, adaptive: true, fpsLow: 50, fpsHigh: 58, idleTimeoutMs: 10000,
  },
};

const THEMES = { void: THEME_VOID, deepspace: null }; // deepspace：方案1 骨架占位（计划书 1.1 硬约束：S4 前禁止开发性编码）

/* ---------- 星幕着色器（S1 计划 3.1 节骨架） ---------- */
const STAR_VERT = /* glsl */`
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime, uPixelRatio, uSizeScale, uTwinkleSpeed, uTwinkleAmp;
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vTwinkle = 1.0 + uTwinkleAmp * sin(uTime * uTwinkleSpeed + aPhase * 6.28318);
  gl_PointSize = aSize * uSizeScale * vTwinkle * uPixelRatio * (140.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;
const STAR_FRAG = /* glsl */`
varying vec3 vColor;
varying float vTwinkle;
uniform float uOpacity;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * uOpacity * clamp(vTwinkle, 0.0, 1.5);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

/* ---------- 星幕构建（CPU 一次性生成属性，运行期闪烁零 CPU 开销） ---------- */
function buildStarfield(stars) {
  disposeStarfield(); // 幂等：重建前清理旧实例（FR-06 显式 dispose）

  const n = Math.max(1, Math.floor(stars.count));
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const phases = new Float32Array(n);
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color();
  const cj = stars.color;

  for (let i = 0; i < n; i++) {
    // 球壳均匀分布（沿用旧分布算法，参数主题化）
    const r = stars.radiusMin + Math.random() * (stars.radiusMax - stars.radiusMin);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    sizes[i] = stars.sizeMin + Math.random() * (stars.sizeMax - stars.sizeMin); // 逐星尺寸差异
    phases[i] = Math.random();                                                  // 逐星闪烁相位

    // 冷白微色温：HSL 域 + 小抖动（确定性观感基调，非逐帧变化）
    c.setHSL(
      cj.h + (Math.random() * 2 - 1) * cj.jitterH,
      Math.max(0, Math.min(1, cj.s)),
      Math.max(0, Math.min(1, cj.l + (Math.random() * 2 - 1) * cj.jitterL)),
    );
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uSizeScale: { value: 1.6 },
      uTwinkleSpeed: { value: stars.twinkleSpeed },
      uTwinkleAmp: { value: stars.twinkleAmp },
      uOpacity: { value: 0.9 },
    },
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'starfield'; // 沿用旧名，兼容既有取证脚本
  points.frustumCulled = false; // 球壳包住相机，剔除判定无意义且可能整片消失
  SkyMap.scene.add(points);
  SkyMap.env.starfield = points;
  return points;
}

/** 显式 dispose 旧星幕（setTheme 重建 / 主题切换时调用） */
function disposeStarfield() {
  const old = SkyMap.env && SkyMap.env.starfield;
  if (!old) return;
  SkyMap.scene.remove(old);
  old.geometry.dispose();
  old.material.dispose();
  SkyMap.env.starfield = null;
}

/* ---------- 逐帧驱动：uTime 时基 + 视差缓旋（updateHooks 协议，M4 挂起时自然冻结） ---------- */
SkyMap.updateHooks.push((dt) => {
  const sf = SkyMap.env && SkyMap.env.starfield;
  if (!sf) return;
  sf.material.uniforms.uTime.value += dt;      // GPU 闪烁时基
  sf.rotation.y += SkyMap.theme.stars.driftSpeed * dt; // 星幕独立缓旋（天体组不动 -> 视差）
});

/* ---------- setTheme：深合并 -> 逐层分发（S1 计划 1.3 节） ---------- */
function setTheme(params) {
  if (!isPlainObject(params)) {
    console.warn('[skymap-env] setTheme 参数必须是对象，已忽略');
    return deepMerge(SkyMap.theme, {});
  }
  const prev = SkyMap.theme;
  const next = deepMerge(prev, params);

  // 合法性守卫：非法值保持现值并警告（S1 计划 1.2 语义）
  if (!(next.stars.count >= 1) || !Number.isFinite(next.stars.count)) {
    console.warn('[skymap-env] stars.count 非法（' + next.stars.count + '），保持现值 ' + prev.stars.count);
    next.stars.count = prev.stars.count;
  }

  // sky 层：即时生效
  if (next.sky.background !== prev.sky.background) {
    SkyMap.scene.background.set(next.sky.background);
  }

  // stars 层：count/分布变化必须重建
  if (JSON.stringify(next.stars) !== JSON.stringify(prev.stars)) {
    buildStarfield(next.stars);
  }

  // body 层：M2 已接入 uniforms 热切换（skymap-bodies.js 监听 theme-changed）
  // bloom 层：M3 已接入 composer 分发（applyBloomTheme 热切 strength/radius/threshold/toneMapping/enabled）
  if ((JSON.stringify(next.bloom) !== JSON.stringify(prev.bloom) || (params.bloom && 'enabled' in params.bloom)) && typeof SkyMap.applyBloomTheme === 'function') {
    // P2 修补：显式传 enabled（即使同值）也强制分发——自动降级后 setTheme({bloom:{enabled:true}}) 的重开路径依赖此分支重置降级锁
    SkyMap.applyBloomTheme(next.bloom);
  }
  // quality 层：V4-M4 已接入调度器（阈值/pixelRatioCap/adaptive 热更新）
  if (JSON.stringify(next.quality) !== JSON.stringify(prev.quality) && typeof SkyMap.applyQualityTheme === 'function') {
    SkyMap.applyQualityTheme(next.quality);
  }

  SkyMap.theme = next;
  document.dispatchEvent(new CustomEvent('theme-changed', { detail: { name: next.name } }));
  if (SkyMap.invalidate) SkyMap.invalidate('setTheme'); // V4-M4：主题切换后需一帧
  return deepMerge(next, {}); // 只读快照
}

/* ---------- 初始化（env 挂载时执行；core 已 init，bodies 及后续模块尚未挂载） ---------- */
SkyMap.env = { starfield: null, themes: THEMES };
SkyMap.theme = deepMerge(THEME_VOID, {});
SkyMap.scene.background = new THREE.Color(SkyMap.theme.sky.background); // FR-01：#050505 纯黑虚空
buildStarfield(SkyMap.theme.stars);
SkyMap.setTheme = setTheme;
if (typeof SkyMap.applyBloomTheme === 'function') SkyMap.applyBloomTheme(SkyMap.theme.bloom); // V4-M3：bloom 参数依主题校准（core init 时 theme 未挂载，此处延迟生效）
console.log('[skymap-env] 环境初始化完成：theme=' + SkyMap.theme.name + ' sky=' + SkyMap.theme.sky.background + ' stars=' + SkyMap.theme.stars.count);

} // V4-M5-B：fatal 态守卫结束
