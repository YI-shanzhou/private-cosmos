/**
 * skymap-bodies.js — 天体渲染模块（Day 2 · 2.2）
 *
 * 职责：
 *  - 天体球体渲染（SphereGeometry + MeshPhongMaterial）
 *  - 光晕效果（半透明外球壳，AdditiveBlending）
 *  - CSS2DRenderer 文字标签（天体名称）
 *  - 天体大小 = visual.size，颜色 = visual.color，亮度 = visual.luminosity
 *  - 颜色微调函数（字符串解析，±30 色相偏移，用于世代子代）
 *
 * 依赖：window.SkyMap（skymap-core.js 已初始化）与全局 COSMOS_DATA（cosmos-data.js）
 */
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const SkyMap = window.SkyMap;

/** 颜色微调：hex 字符串色相偏移 deg（-180~180），世代子代用（调用方限制在 ±30 内） */
function shiftHue(hex, deg) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + deg / 360 + 1) % 1, hsl.s, hsl.l);
  return '#' + c.getHexString();
}

function makeLabel(text) {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  return div;
}

/** 挂载 CSS2DRenderer（覆盖层，pointer-events:none 不挡画布交互） */
function ensureLabelRenderer() {
  if (SkyMap.labelRenderer) return;
  const lr = new CSS2DRenderer();
  lr.setSize(SkyMap.container.clientWidth, SkyMap.container.clientHeight);
  lr.domElement.style.position = 'absolute';
  lr.domElement.style.top = '0';
  lr.domElement.style.left = '0';
  lr.domElement.style.pointerEvents = 'none';
  SkyMap.container.appendChild(lr.domElement);
  SkyMap.labelRenderer = lr;
  SkyMap.updateHooks.push(() => lr.render(SkyMap.scene, SkyMap.camera));
}

/** 天体网格构建：球体 + 光晕 + 标签，按螺旋坐标放置 */
function buildBodies(bodiesData) {
  const group = new THREE.Group();
  group.name = 'bodies';
  const n = bodiesData.length;
  const meshes = [];

  bodiesData.forEach((body, i) => {
    const visual = body.visual || {};
    const rawColor = visual.color || '#9AA7CE';

    // 世代子代：色相偏移（代数 × 17，限制在 ±30 内），保持血缘可辨又不喧宾夺主
    const isChild = !!(body.lineage && body.lineage.generation);
    const colorHex = isChild
      ? shiftHue(rawColor, Math.max(-30, Math.min(30, body.lineage.generation * 17)))
      : rawColor;

    const size = Math.max(0.3, Math.min(1.0, visual.size ?? 0.5));       // 大小 = visual.size（0.3~1.0）
    const lum = Math.max(0, Math.min(1, visual.luminosity ?? 0.5));      // 亮度 = visual.luminosity

    // 球体（自发光随亮度，深空中天体自身可读）
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(colorHex),
      emissive: new THREE.Color(colorHex).multiplyScalar(0.25 + lum * 0.45),
      shininess: 30,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 24), mat);
    mesh.position.copy(SkyMap.spiralPosition(i, n, 30));
    mesh.userData = { bodyId: body.id, body };

    // 光晕：半透明外球壳（内侧面渲染 + 加色混合）
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.12 + lum * 0.22,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(size * 1.8, 24, 18), haloMat);
    mesh.add(halo);

    // 名称标签
    const label = new CSS2DObject(makeLabel(body.name));
    label.position.set(0, size + 0.6, 0);
    mesh.add(label);

    // 供搜索筛选模块（Day 4 · 4.2）淡化操作引用
    halo.userData.baseOpacity = haloMat.opacity;
    mesh.userData.haloMesh = halo;
    mesh.userData.labelObj = label;

    group.add(mesh);
    meshes.push(mesh);
  });

  SkyMap.scene.add(group);
  SkyMap.bodyGroup = group;
  SkyMap.bodyMeshes = meshes;
  return meshes;
}

// ---- 启动 ----
const data = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];
SkyMap.state.bodies = data;
ensureLabelRenderer();
buildBodies(data);
SkyMap.shiftHue = shiftHue;
console.log('[skymap-bodies] 天体渲染完成：' + SkyMap.bodyMeshes.length + ' 颗');

  // 标签 LOD（Day 7 · 7.1）：远视角收敛标签数量，降低 DOM/渲染负担
  SkyMap.updateHooks.push(() => {
    const dist = SkyMap.camera.position.length();
    const full = dist <= 90; // 近/中视角：全量标签
    SkyMap.bodyMeshes.forEach((m, i) => {
      const lo = m.userData.labelObj;
      if (!lo || !m.visible) return;
      lo.visible = full || i < 20; // 远视角只保留前 20 个（早期纪元）
    });
  });
