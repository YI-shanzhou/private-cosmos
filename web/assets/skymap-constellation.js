/**
 * skymap-constellation.js — 星座连线模块（Day 5 · 5.1）
 *
 * 职责：
 *  - 连线数据：共享父素材（parents 匹配）边 + 共享主导情绪（tags.moods[0] 匹配）边
 *    按关联强度（父素材×3 + 情绪×1）降序，截取前 50 条上限
 *  - 渲染：THREE.Line + LineBasicMaterial（vertexColors 两端渐变、半透明）
 *  - 开关：HUD「星座连线」按钮，关闭时从 scene 移除
 *  - 悬停联动：raycast 仅针对连线集合，命中 → 高亮两端天体 + 光标 pointer
 *  - 正交适配：时间轴隐藏天体 → 连线同步隐藏；搜索淡化天体 → 连线同步淡化
 *
 * 依赖：window.SkyMap（scene/bodyMeshes/updateHooks/getBodyById）、COSMOS_DATA
 */
(() => {
  const SkyMap = window.SkyMap;
  const THREE = SkyMap.THREE;
  const DATA = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];
  const MAX_EDGES = 50; // 计划书功能上限

  // ---- 1. 连线数据构建 ----
  function buildEdges() {
    const edges = [];
    for (let i = 0; i < DATA.length; i++) {
      for (let j = i + 1; j < DATA.length; j++) {
        const A = DATA[i];
        const B = DATA[j];
        const pa = A.parents || [];
        const pb = B.parents || [];
        let sharedParents = 0;
        for (const p of pa) if (pb.includes(p)) sharedParents += 1;
        const moodA = (A.tags && A.tags.moods && A.tags.moods[0]) || null;
        const moodB = (B.tags && B.tags.moods && B.tags.moods[0]) || null;
        const sharedMood = (moodA && moodA === moodB) ? 1 : 0;
        const strength = sharedParents * 3 + sharedMood;
        if (strength > 0) {
          edges.push({ a: A.id, b: B.id, sharedParents, sharedMood, strength });
        }
      }
    }
    edges.sort((x, y) => y.strength - x.strength || (x.a < y.a ? -1 : 1));
    return edges.slice(0, MAX_EDGES);
  }
  const edges = buildEdges();

  // ---- 2. 渲染 ----
  const group = new THREE.Group();
  group.name = 'constellation-lines';
  group.visible = false; // 默认关闭，点击开关启用（验收：点击后出现连线）
  SkyMap.scene.add(group);

  const meshById = new Map();
  (SkyMap.bodyMeshes || []).forEach((m) => meshById.set(m.userData.bodyId, m));

  const lines = [];
  let parentEdgeCount = 0;
  let moodEdgeCount = 0;
  edges.forEach((e) => {
    const aMesh = meshById.get(e.a);
    const bMesh = meshById.get(e.b);
    if (!aMesh || !bMesh) return;
    const ca = new THREE.Color(aMesh.userData.body.visual.color);
    const cb = new THREE.Color(bMesh.userData.body.visual.color);
    const geo = new THREE.BufferGeometry().setFromPoints([aMesh.position.clone(), bMesh.position.clone()]);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.38, // 半透明
      depthWrite: false,
    });
    const pos = geo.attributes.position;
    const colors = new Float32Array(6);
    [ca, cb].forEach((c, k) => {
      colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    });
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const line = new THREE.Line(geo, mat);
    line.userData = { edge: e, aMesh, bMesh };
    group.add(line);
    lines.push({ line, aMesh, bMesh, baseOpacity: 0.38 });
    if (e.sharedParents > 0) parentEdgeCount += 1;
    if (e.sharedMood > 0) moodEdgeCount += 1;
  });

  // ---- 3. 开关（HUD 按钮，样式复用 base.css 的 #hud button） ----
  const hud = document.getElementById('hud');
  const btn = document.createElement('button');
  btn.id = 'btn-constellation';
  btn.textContent = '星座连线：关';
  let enabled = false;
  btn.addEventListener('click', () => {
    enabled = !enabled;
    group.visible = enabled;
    btn.textContent = enabled ? '星座连线：开' : '星座连线：关';
    if (!enabled) clearLineHover();
  });
  hud.appendChild(btn);

  // ---- 4. 悬停联动（raycast 仅针对连线集合） ----
  const canvas = SkyMap.renderer.domElement;
  const lineRay = new THREE.Raycaster();
  lineRay.params.Line.threshold = 0.35;
  const ndc = new THREE.Vector2();
  let hovered = null; // { line, restored: [...] }

  function toNdc(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function clearLineHover() {
    if (!hovered) return;
    // 无条件恢复快照值：即使悬停期间天体被时间轴隐藏，恢复后也不残留 1.35 放大态
    hovered.restored.forEach((r) => {
      r.mesh.scale.setScalar(r.scale);
      r.mesh.material.emissiveIntensity = r.emissive;
    });
    canvas.style.cursor = ''; // 解除对 controls 模块 cursor 兜底的隐式依赖
    hovered = null;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (!enabled) return;
    toNdc(e);
    lineRay.setFromCamera(ndc, SkyMap.camera);
    const visibleLines = group.children.filter((l) => l.visible);
    const hits = lineRay.intersectObjects(visibleLines, false);
    const hitLine = hits.length ? hits[0].object : null;

    if (hitLine === (hovered && hovered.line)) return; // 未变化
    clearLineHover();
    if (hitLine) {
      const { aMesh, bMesh } = hitLine.userData;
      const restored = [aMesh, bMesh].map((mesh) => {
        const snap = { mesh, scale: mesh.scale.x, emissive: mesh.material.emissiveIntensity };
        if (mesh.visible) {
          mesh.scale.setScalar(1.35);
          mesh.material.emissiveIntensity = 1.6;
        }
        return snap;
      });
      hovered = { line: hitLine, restored };
      canvas.style.cursor = 'pointer';
    }
  });
  canvas.addEventListener('pointerleave', clearLineHover);

  // ---- 5. 正交适配（每帧：可见性/淡化跟随两端天体） ----
  // 语义决策（依计划"避免天体没了线还挂着"）：取两端较弱一方——
  //  · 时间轴：任一端隐藏 → 线隐藏（AND）
  //  · 搜索  ：任一端淡化(0.15) → 线同步淡化（min），仅两端均匹配的连线保持全亮
  SkyMap.updateHooks.push(() => {
    if (!enabled) return;
    for (const item of lines) {
      const vis = item.aMesh.visible && item.bMesh.visible;
      item.line.visible = vis;
      if (vis) {
        const opA = item.aMesh.material.opacity ?? 1;
        const opB = item.bMesh.material.opacity ?? 1;
        item.line.material.opacity = item.baseOpacity * Math.min(opA, opB);
      }
    }
    if (hovered && !hovered.line.visible) clearLineHover();
  });

  // ---- 接口 ----
  SkyMap.constellation = {
    edges,
    group,
    toggle: () => btn.click(),
    get enabled() { return enabled; },
  };

  console.log('[skymap-constellation] 星座连线就绪：候选边截取 ' + lines.length +
    ' 条（父素材 ' + parentEdgeCount + ' / 主导情绪 ' + moodEdgeCount + '，上限 ' + MAX_EDGES + '）');
})();
