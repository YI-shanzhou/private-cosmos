/**
 * skymap-timeline.js — 时间轴回放模块（Day 4 · 4.1）
 *
 * 职责：
 *  - 基于 COSMOS_DATA 的 epoch 构建时间轴（底部滑块 UI）
 *  - 拖动滑块 → 只显示该时间点之前诞生的天体（SkyMap.updateVisibleBodies）
 *  - 播放/暂停：按时间顺序逐个显示天体诞生（带淡入动画）
 *  - 当前时间点标签（日期 + 纪元号）；播放速度 0.5x / 1x / 2x
 *
 * 依赖：window.SkyMap（skymap-core.js 的 updateVisibleBodies 接口）
 */
(() => {
  const SkyMap = window.SkyMap;
  const DATA = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];
  const MAX = DATA.length; // 最大纪元 = 天体总数（epoch 从 1 递增）

  // ---- 样式 ----
  const style = document.createElement('style');
  style.textContent = `
    #timeline{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--stats-h, 232px) + 16px);z-index:14;
      display:flex;align-items:center;gap:10px;padding:8px 14px;
      background:rgba(8,10,24,.9);border:1px solid rgba(120,130,180,.3);border-radius:10px;
      color:#cbd5e1;font:12px "JetBrains Mono","Microsoft YaHei",monospace;
      backdrop-filter:blur(6px);white-space:nowrap}
    #tl-play{background:rgba(20,20,40,.6);color:#cbd5e1;border:1px solid rgba(120,130,180,.4);
      border-radius:4px;padding:3px 12px;font:12px monospace;cursor:pointer;min-width:44px}
    #tl-play:hover{background:rgba(60,70,120,.6)}
    #tl-range{width:320px;accent-color:#7C3AED;cursor:pointer}
    #tl-label{min-width:180px;text-align:center;color:#8b95b5}
    #tl-speed{background:rgba(20,20,40,.6);color:#cbd5e1;border:1px solid rgba(120,130,180,.4);
      border-radius:4px;padding:3px 6px;font:12px monospace;cursor:pointer}
    @media (max-width:768px){
      #timeline{left:8px;right:8px;transform:none;bottom:auto;top:52px;flex-wrap:wrap;gap:6px}
      #tl-range{width:100%}
      #tl-label{min-width:0;flex:1}
    }
  `;
  document.head.appendChild(style);

  // ---- UI ----
  const tl = document.createElement('div');
  tl.id = 'timeline';
  tl.innerHTML = `
    <button id="tl-play" title="播放/暂停">▶</button>
    <input type="range" id="tl-range" min="0" max="${MAX}" step="1" value="${MAX}" aria-label="时间轴纪元滑块">
    <span id="tl-label"></span>
    <select id="tl-speed" title="播放速度">
      <option value="0.5">0.5x</option>
      <option value="1" selected>1x</option>
      <option value="2">2x</option>
    </select>
  `;
  document.body.appendChild(tl);

  const range = tl.querySelector('#tl-range');
  const label = tl.querySelector('#tl-label');
  const playBtn = tl.querySelector('#tl-play');
  const speedSel = tl.querySelector('#tl-speed');

  // ---- 标签：日期 + 纪元号 ----
  function epochDate(ep) {
    const b = DATA.find((x) => x.epoch === ep);
    return b ? String(b.born_at || '').slice(0, 10) : '';
  }
  function renderLabel(v) {
    if (v <= 0) { label.textContent = '纪元前 · 0 颗'; return; }
    const d = epochDate(v);
    label.textContent = `第 ${v} 纪元${d ? ' · ' + d : ''} · ${v} 颗`;
  }

  // ---- 淡入动画（播放时逐颗浮现） ----
  const anims = [];
  SkyMap.updateHooks.push((dt) => {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt / 0.45; // 450ms
      const k = Math.min(1, a.t);
      a.mesh.material.transparent = true;
      a.mesh.material.opacity = k;
      a.mesh.scale.setScalar(0.25 + 0.75 * k);
      if (k >= 1) {
        a.mesh.material.opacity = 1;
        a.mesh.scale.setScalar(1);
        anims.splice(i, 1);
      }
    }
  });
  function fadeIn(mesh) {
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    mesh.scale.setScalar(0.25);
    anims.push({ mesh, t: 0 });
  }

  // ---- 可见性更新 ----
  function applyValue(v, animateNew = false) {
    const prev = SkyMap.state.visibleMaxEpoch ?? MAX;
    SkyMap.updateVisibleBodies(v);
    renderLabel(v);
    if (animateNew && v > prev) {
      for (const m of SkyMap.bodyMeshes) {
        const ep = m.userData.body ? m.userData.body.epoch : 0;
        if (ep > prev && ep <= v) fadeIn(m);
      }
    }
  }

  // ---- 拖动 ----
  range.addEventListener('input', () => {
    stopPlay();
    applyValue(Number(range.value));
  });

  // ---- 播放 / 暂停 ----
  let timer = null;
  function step() {
    let v = Number(range.value);
    if (v >= MAX) { stopPlay(); return; }
    v += 1;
    range.value = v;
    applyValue(v, true);
  }
  function startPlay() {
    if (timer) return;
    if (Number(range.value) >= MAX) { // 从头播放
      range.value = 0;
      applyValue(0);
    }
    playBtn.textContent = '⏸';
    const speed = Number(speedSel.value);
    timer = setInterval(step, 800 / speed);
  }
  function stopPlay() {
    if (timer) { clearInterval(timer); timer = null; }
    playBtn.textContent = '▶';
  }
  playBtn.addEventListener('click', () => (timer ? stopPlay() : startPlay()));
  speedSel.addEventListener('change', () => {
    if (timer) { clearInterval(timer); timer = setInterval(step, 800 / Number(speedSel.value)); }
  });

  // ---- 初始：全部可见 ----
  applyValue(MAX);
  console.log('[skymap-timeline] 时间轴就绪：maxEpoch=' + MAX);
})();
