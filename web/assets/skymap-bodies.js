/**
 * skymap-bodies.js - 天体渲染模块（V4 · M2：极简风格系统）
 *
 * 职责（S1 计划 3.2/3.3 节落地）：
 *  - ShaderMaterial 天体材质：Fresnel 边缘光 + 确定性块状微噪（FR-03）
 *  - 确定性外观链：seed = fnv1a(body.id)/0xFFFFFFFF -> uSeed；噪声域 = 本地坐标，
 *    片元不含 uTime -> 同 bodyId 同视角跨刷新逐像素一致（NFR-07）
 *  - 几何体全局共享：3 个常驻单位球（本体Hi/halo/Lo预留），scale 定尺寸（FR-06）
 *  - halo 保留 MeshBasicMaterial 氛围层（additive/BackSide），共享几何
 *  - CSS2D 标签：本地 y = 1 + 0.6/size（父 scale=size 下世界偏移 = size+0.6，与旧版等价）
 *  - material.opacity <-> uniforms.uOpacity 每帧同步（_setBodyFade/filterBodies/timeline
 *    直接写 material.opacity 的既有路径零改动即生效）
 *  - theme-changed：body 层 uniforms 热切换（S1 setTheme 分发注释"M2 接入"）
 *
 * 挂载顺序：skymap-core.js -> skymap-env.js -> 本模块（读 SkyMap.theme.body）
 *
 * 依赖：window.SkyMap（core 已 init、env 已挂载主题）与全局 COSMOS_DATA（cosmos-data.js）
 */
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const SkyMap = window.SkyMap;

/** 颜色微调：hex 字符串色相偏移 deg（-180~180），世代子代用（冻结接口；lineage.generation
 *  当前数据中不存在（0/58，S1 D1 定案），按"未来兼容"防御性保留，不作为验收路径） */
function shiftHue(hex, deg) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + deg / 360 + 1) % 1, hsl.s, hsl.l);
  return '#' + c.getHexString();
}

/** FNV-1a（32 位）：body.id -> 确定性外观种子（手册 1.3-4 先例） */
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------- 共享几何体（S1 计划 3.3 节：3 个常驻单位球，新增几何体种类 <=4） ---------- */
const unitSphereHi = new THREE.SphereGeometry(1, 32, 24);   // 本体（全部天体共享）
const unitSphereHalo = new THREE.SphereGeometry(1, 24, 18); // 光晕（共享）
const unitSphereLo = new THREE.SphereGeometry(1, 16, 12);   // 低模预留（M4 画质最低档可切换）

/* ---------- 天体着色器（S1 计划 3.2 节骨架；alpha 由 1.0 改 uOpacity 以支撑淡化链路） ---------- */
const BODY_VERT = /* glsl */`
varying vec3 vNormal, vViewDir, vPos;
void main() {
  vPos = position;                                   // 确定性噪声域（本地坐标，不受缩放/位移影响）
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);   // 均匀 scale 下法线安全
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BODY_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uSeed, uLuminosity, uFresnelPower, uFresnelIntensity;
uniform float uNoiseScale, uNoiseAmp, uBaseBrightness, uHighlight, uOpacity;
varying vec3 vNormal, vViewDir, vPos;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), uFresnelPower);
  float n = hash(floor(vPos * uNoiseScale) + uSeed * 17.0);   // 确定性块状微噪（无 uTime）
  vec3 base = uColor * (uBaseBrightness + 0.45 * uLuminosity) * (1.0 + uNoiseAmp * (n - 0.5) * 2.0);
  vec3 col = base + uColor * fres * uFresnelIntensity * (1.0 + uHighlight * 0.8);
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}
`;

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
  // V4-M4：CSS2D render 移交 core renderFrame 统一调用（仅渲染帧，S1 M4-A 口径）
}

/** 天体网格构建：共享单位球 + Shader 材质 + 光晕 + 标签，按螺旋坐标放置 */
function buildBodies(bodiesData) {
  const group = new THREE.Group();
  group.name = 'bodies';
  const n = bodiesData.length;
  const meshes = [];
  const tb = SkyMap.theme.body;

  bodiesData.forEach((body, i) => {
    const visual = body.visual || {};
    const rawColor = visual.color || '#9AA7CE';

    // 世代子代：色相偏移（代数 x 17，限制在 +-30 内），保持血缘可辨又不喧宾夺主
    const isChild = !!(body.lineage && body.lineage.generation);
    const colorHex = isChild
      ? shiftHue(rawColor, Math.max(-30, Math.min(30, body.lineage.generation * 17)))
      : rawColor;

    const size = Math.max(0.3, Math.min(1.0, visual.size ?? 0.5));       // 大小 = visual.size（0.3~1.0）-> scale
    const lum = Math.max(0, Math.min(1, visual.luminosity ?? 0.5));      // 亮度 = visual.luminosity
    const seed = fnv1a(String(body.id ?? i)) / 0xFFFFFFFF;               // 确定性外观种子（FR-03/NFR-07）

    // 本体：ShaderMaterial（Fresnel + 微噪），每体一份 uniforms，几何共享
    const mat = new THREE.ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      transparent: true, // _setBodyFade/filterBodies/timeline 写 material.opacity 的链路依赖
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uSeed: { value: seed },
        uLuminosity: { value: lum },
        uFresnelPower: { value: tb.fresnelPower },
        uFresnelIntensity: { value: tb.fresnelIntensity },
        uNoiseScale: { value: tb.noiseScale },
        uNoiseAmp: { value: tb.noiseAmp },
        uBaseBrightness: { value: tb.baseBrightness },
        uHighlight: { value: 0 },
        uOpacity: { value: 1 },
      },
    });
    const mesh = new THREE.Mesh(unitSphereHi, mat);
    mesh.scale.setScalar(size);              // 单位球 x scale 定尺寸（raycast 对均匀 scale 自动正确）
    mesh.position.copy(SkyMap.spiralPosition(i, n, 30));
    mesh.userData = { bodyId: body.id, body, baseScale: size };

    // 光晕：共享单位球 + MeshBasicMaterial 氛围层（additive/BackSide 沿用），本地 scale = haloScale
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: tb.haloOpacityBase + lum * 0.22, // 公式沿用（S1 3.2 halo 策略），基值主题化
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(unitSphereHalo, haloMat);
    halo.scale.setScalar(tb.haloScale);      // 世界半径 = size x haloScale（与旧版 size*1.8 等价）
    mesh.add(halo);

    // 名称标签：本地 y = 1 + 0.6/size -> 世界偏移 = size x (1 + 0.6/size) = size + 0.6（与旧版等价）
    const label = new CSS2DObject(makeLabel(body.name));
    label.position.set(0, 1 + 0.6 / size, 0);
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

/* ---------- material.opacity <-> uniforms.uOpacity 每帧同步 ----------
 * 既有淡化链路（_setBodyFade / filterBodies / timeline fadeIn）直接写 material.opacity，
 * ShaderMaterial 不自动消费该属性，此处每帧桥接（58 次浮点赋值，开销可忽略；M4 挂起时冻结无碍）。 */
SkyMap.updateHooks.push(() => {
  for (const m of SkyMap.bodyMeshes) {
    const u = m.material.uniforms;
    if (u && u.uOpacity && u.uOpacity.value !== m.material.opacity) {
      u.uOpacity.value = m.material.opacity;
    }
  }
});

/* ---------- theme-changed：body 层 uniforms 热切换（S1 setTheme 分发注释"M2 接入"） ---------- */
document.addEventListener('theme-changed', () => {
  const tb = SkyMap.theme.body;
  for (const m of SkyMap.bodyMeshes) {
    const u = m.material.uniforms;
    if (!u) continue;
    u.uFresnelPower.value = tb.fresnelPower;
    u.uFresnelIntensity.value = tb.fresnelIntensity;
    u.uNoiseScale.value = tb.noiseScale;
    u.uNoiseAmp.value = tb.noiseAmp;
    u.uBaseBrightness.value = tb.baseBrightness;
    const halo = m.userData.haloMesh;
    if (halo && halo.material) {
      halo.scale.setScalar(tb.haloScale);
      const lum = u.uLuminosity.value;
      const base = tb.haloOpacityBase + lum * 0.22;
      halo.userData.baseOpacity = base;
      // 以标签 style.opacity 为"当前淡化系数"代理（_setBodyFade 三联动同步设置，值域一致）
      const el = m.userData.labelObj && m.userData.labelObj.element;
      const fade = el ? parseFloat(el.style.opacity || '1') : 1;
      halo.material.opacity = Number.isFinite(fade) ? base * fade : base;
    }
  }
});

// ---- 启动 ----
const data = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];
SkyMap.state.bodies = data;
ensureLabelRenderer();
buildBodies(data);
SkyMap.shiftHue = shiftHue;

/** V4-M4-C：画质档位几何切换（level 0 -> unitSphereLo 低模球；恢复 -> unitSphereHi）
 *  仅换 geometry 引用（材质/label/ userData 不动），返回切换的网格数 */
SkyMap.setBodyGeometryLOD = function (low) {
  const target = low ? unitSphereLo : unitSphereHi;
  let changed = 0;
  for (const m of SkyMap.bodyMeshes || []) {
    if (m.geometry !== target) { m.geometry = target; changed++; }
  }
  return changed;
};

console.log('[skymap-bodies] 天体渲染完成（V4-M2 Shader材质+共享几何）：' + SkyMap.bodyMeshes.length + ' 颗');

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