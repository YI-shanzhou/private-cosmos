/**
 * skymap-controls.js — 交互控制模块（Day 2 · 2.3）
 *
 * 职责：
 *  - OrbitControls：旋转 / 缩放 / 平移（含阻尼）
 *  - 自动旋转开关 + 速度调节（默认开启，速度 0.5；HUD 按钮注入 #hud）
 *  - 点击天体 → 派发 body-clicked 自定义事件（document 级，Day 3 面板监听）
 *  - 悬停天体 → 高亮（放大 + 发光增强）+ 光标变化（Raycaster）
 *  - FPS 采样（SkyMap.getFPS()，HUD 实时显示；验收阈值 ≥55）
 *
 * 依赖：window.SkyMap（skymap-core.js 已初始化，bodyMeshes 由 skymap-bodies.js 填充）
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SkyMap = window.SkyMap;

// ---- OrbitControls：旋转 / 缩放 / 平移 ----
const controls = new OrbitControls(SkyMap.camera, SkyMap.renderer.domElement);
controls.enableDamping = true;       // 阻尼惯性
controls.dampingFactor = 0.08;
controls.autoRotate = true;          // 自动旋转默认开启
controls.autoRotateSpeed = 0.5;      // 速度 0.5（验收标准）
controls.minDistance = 8;
controls.maxDistance = 160;
SkyMap.controls = controls;
SkyMap.updateHooks.push(() => controls.update());

// ---- FPS 采样（0.5s 窗口） ----
const fps = { frames: 0, elapsed: 0, value: 0 };
SkyMap.updateHooks.push((dt) => {
  fps.frames += 1;
  fps.elapsed += dt;
  if (fps.elapsed >= 0.5) {
    fps.value = fps.frames / fps.elapsed;
    fps.frames = 0;
    fps.elapsed = 0;
  }
});
SkyMap.getFPS = () => Math.round(fps.value);

// ---- Raycaster：悬停高亮 + 点击事件 ----
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const canvas = SkyMap.renderer.domElement;
let hovered = null;

function setPointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pick(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, SkyMap.camera);
  // 仅拾取可见天体（时间轴回放隐藏的天体不可点击）
  const visible = (SkyMap.bodyMeshes || []).filter((m) => m.visible);
  const hits = raycaster.intersectObjects(visible, false);
  return hits.length ? hits[0].object : null;
}

function highlight(mesh) {
  mesh.scale.setScalar(1.35);
  mesh.material.emissiveIntensity = 1.6;
}

function unhighlight(mesh) {
  mesh.scale.setScalar(1);
  mesh.material.emissiveIntensity = 1;
}

function onPointerMove(e) {
  const mesh = pick(e);
  if (hovered && hovered !== mesh) unhighlight(hovered);
  if (mesh && mesh !== hovered) highlight(mesh);
  hovered = mesh;
  canvas.style.cursor = mesh ? 'pointer' : 'grab';
}

// 拖拽阈值：按下与抬起位移 >5px 视为旋转/平移操作，不触发点击
let downPos = null;
function onPointerDown(e) {
  downPos = [e.clientX, e.clientY];
}

function onClick(e) {
  if (downPos && (Math.abs(e.clientX - downPos[0]) > 5 || Math.abs(e.clientY - downPos[1]) > 5)) return;
  const mesh = pick(e);
  if (!mesh) {
    // 空白点击：供详情面板等模块关闭自身（Day 3）
    document.dispatchEvent(new CustomEvent('blank-clicked'));
    return;
  }
  const detail = { bodyId: mesh.userData.bodyId, body: mesh.userData.body };
  document.dispatchEvent(new CustomEvent('body-clicked', { detail }));
  console.log('[skymap-controls] body-clicked:', detail.bodyId, detail.body.name);
}

canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('click', onClick);

// ---- HUD：自动旋转开关 + 速度调节 + FPS 显示 ----
function buildHUD() {
  const hud = document.getElementById('hud');

  const mkBtn = (text, onClick) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.id = 'btn-' + text.split('：')[0];
    b.addEventListener('click', onClick);
    hud.appendChild(b);
    return b;
  };

  // 自动旋转开关（默认开）
  const rotBtn = mkBtn('自动旋转：开', () => {
    controls.autoRotate = !controls.autoRotate;
    rotBtn.textContent = '自动旋转：' + (controls.autoRotate ? '开' : '关');
  });

  // 速度调节：0.25 / 0.5 / 1 / 2 循环
  const speeds = [0.25, 0.5, 1.0, 2.0];
  let si = 1; // 默认 0.5
  const spdBtn = mkBtn('速度：0.5', () => {
    si = (si + 1) % speeds.length;
    controls.autoRotateSpeed = speeds[si];
    spdBtn.textContent = '速度：' + speeds[si];
  });

  // FPS 实时显示
  const fpsSpan = document.createElement('span');
  fpsSpan.id = 'fps';
  fpsSpan.style.marginLeft = '8px';
  hud.appendChild(fpsSpan);
  SkyMap.updateHooks.push(() => {
    fpsSpan.textContent = 'FPS ' + SkyMap.getFPS();
  });
}
buildHUD();

console.log(
  '[skymap-controls] 交互控制就绪：autoRotate=' + controls.autoRotate +
  ', speed=' + controls.autoRotateSpeed,
);
