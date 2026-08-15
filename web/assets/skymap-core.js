/**
 * skymap-core.js — 场景核心模块（Day 2 · 2.1）
 *
 * 职责：
 *  - Three.js 场景初始化（深空背景 + 800 颗粒子星空）
 *  - 自适应螺旋坐标公式：radius = 5 + i*(maxR-5)/(n-1)
 *  - 窗口 resize 处理
 *  - 场景状态管理（当前天体列表 / 筛选状态 / 时间轴位置）
 *  - 统一渲染循环（updateHooks 供 controls / 标签渲染等注册逐帧回调）
 *
 * 全局命名空间：window.SkyMap（后续模块只读写该命名空间，不重复 init）
 */
import * as THREE from 'three';

const STAR_COUNT = 800;   // 粒子星空数量（验收标准）
const MAX_RADIUS = 30;    // 螺旋最大半径

const SkyMap = (window.SkyMap = {
  THREE,
  scene: null,
  camera: null,
  renderer: null,
  container: null,
  labelRenderer: null,     // 由 skymap-bodies.js 创建
  controls: null,          // 由 skymap-controls.js 创建
  updateHooks: [],         // 每帧回调：fn(dt)
  bodyMeshes: [],          // 天体网格（由 skymap-bodies.js 填充）
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

/** 800 颗粒子星空：球壳分布（半径 60~140），带轻微色温变化 */
function buildStarField() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = 60 + Math.random() * 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const c = new THREE.Color().setHSL(
      0.55 + Math.random() * 0.12, 0.5, 0.6 + Math.random() * 0.35,
    );
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.7, vertexColors: true, transparent: true,
    opacity: 0.9, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'starfield';
  SkyMap.scene.add(points);
  return points;
}

/** 窗口 resize：相机宽高比 + 渲染器尺寸 + 标签渲染器同步 */
function onResize() {
  const w = SkyMap.container.clientWidth;
  const h = SkyMap.container.clientHeight;
  SkyMap.camera.aspect = w / h;
  SkyMap.camera.updateProjectionMatrix();
  SkyMap.renderer.setSize(w, h);
  if (SkyMap.labelRenderer) SkyMap.labelRenderer.setSize(w, h);
  SkyMap.state.viewport = { width: w, height: h };
}

/** 统一渲染循环 */
function startLoop() {
  SkyMap.clock = new THREE.Clock();
  const loop = () => {
    requestAnimationFrame(loop);
    const dt = SkyMap.clock.getDelta();
    for (const hook of SkyMap.updateHooks) hook(dt);
    SkyMap.renderer.render(SkyMap.scene, SkyMap.camera);
  };
  loop();
}

function init() {
  SkyMap.container = document.getElementById('app');
  SkyMap.scene = new THREE.Scene();
  SkyMap.scene.background = new THREE.Color(0x030014); // 深空背景

  SkyMap.camera = new THREE.PerspectiveCamera(
    60, SkyMap.container.clientWidth / SkyMap.container.clientHeight, 0.1, 500,
  );
  SkyMap.camera.position.set(0, 18, 52);

  SkyMap.renderer = new THREE.WebGLRenderer({ antialias: true });
  SkyMap.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  SkyMap.renderer.setSize(SkyMap.container.clientWidth, SkyMap.container.clientHeight);
  SkyMap.container.appendChild(SkyMap.renderer.domElement);

  // 灯光：环境光 + 中心点光（天体自带 emissive 自发光，灯光作补充）
  SkyMap.scene.add(new THREE.AmbientLight(0x8888aa, 0.9));
  const sun = new THREE.PointLight(0xffffff, 300, 0, 1.2);
  SkyMap.scene.add(sun);

  buildStarField();
  window.addEventListener('resize', onResize);
  onResize();
  startLoop();
  console.log('[skymap-core] 场景初始化完成：starfield=' + STAR_COUNT);
}

SkyMap.spiralPosition = spiralPosition;
SkyMap.onResize = onResize;

/** 时间轴可见性接口（Day 4 · 4.1）：只显示 epoch <= maxEpoch 的天体 */
SkyMap.updateVisibleBodies = function (maxEpoch) {
  (SkyMap.bodyMeshes || []).forEach((m) => {
    m.visible = (m.userData.body ? m.userData.body.epoch : 0) <= maxEpoch;
  });
  SkyMap.state.visibleMaxEpoch = maxEpoch;
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
  return match;
};

/** 高亮单颗天体（Day 4 · 4.2）：放大 + 发光增强 */
SkyMap.highlightBody = function (id) {
  const m = (SkyMap.bodyMeshes || []).find((x) => x.userData.bodyId === id);
  if (!m || !m.visible) return null;
  m.scale.setScalar(1.35);
  m.material.emissiveIntensity = 1.6;
  return m;
};

/** 按 id 查询天体数据（Day 5 · 5.1，计划书指定接口） */
SkyMap.getBodyById = function (id) {
  const data = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];
  return data.find((b) => b.id === id) || null;
};

init();
