/**
 * skymap-personal.js — 个人星图模块（Day 5 · 5.2）
 *
 * 职责：
 *  - 种子算法：姓名字符串哈希（FNV-1a）→ mulberry32 确定性随机；空输入走纯随机分支
 *  - 天体选取：基于种子从 COSMOS_DATA 确定性选取 3-5 颗构成个人星座
 *  - 弹窗 UI：HUD「生成我的星图」按钮 + 模态弹窗（输入框/预览/天体列表/操作）
 *    预览用自绘 2D Canvas（不依赖 WebGL 主画布，规避 preserveDrawingBuffer 截图黑屏）
 *  - 截图保存：Canvas.toBlob → PNG 下载
 *  - 分享链接：URL hash 写入 #seed=<数值>；打开带种子链接还原同一星图
 *  - hash 共存：只读写 seed 参数，保留搜索模块的 q/domain/type/mood（命名空间隔离）
 *
 * 依赖：COSMOS_DATA、#hud 按钮容器
 */
(() => {
  const DATA = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];

  // ---- 种子算法 ----
  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let currentSeed = null;
  let picked = [];

  function generate(seed) {
    currentSeed = seed >>> 0;
    const rng = mulberry32(currentSeed);
    const n = 3 + Math.floor(rng() * 3); // 3-5 颗
    const idx = DATA.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    picked = idx.slice(0, n).map((k) => DATA[k]);
    drawPreview(currentSeed);
    renderList();
    writeSeedHash(currentSeed);
    linkInput.value = buildShareUrl(currentSeed);
  }

  // ---- 样式 ----
  const style = document.createElement('style');
  style.textContent = `
    #personal-overlay{position:fixed;inset:0;z-index:30;display:none;
      background:rgba(3,0,20,.6);backdrop-filter:blur(3px);align-items:center;justify-content:center}
    #personal-overlay.open{display:flex}
    #personal-modal{width:min(560px,92vw);max-height:88vh;overflow-y:auto;position:relative;
      background:rgba(10,12,28,.96);border:1px solid rgba(120,130,180,.35);border-radius:12px;
      padding:18px 20px;color:#e2e8f0;font:13px/1.6 "JetBrains Mono","Microsoft YaHei",monospace;
      box-shadow:0 8px 40px rgba(0,0,0,.6)}
    #personal-modal h3{margin:0 0 10px;font-size:15px}
    #personal-input-row{display:flex;gap:8px;margin-bottom:10px}
    #personal-name{flex:1;background:rgba(20,20,40,.6);color:#e2e8f0;
      border:1px solid rgba(120,130,180,.4);border-radius:4px;padding:6px 10px;
      font:13px "JetBrains Mono","Microsoft YaHei",monospace;outline:none}
    #personal-name:focus{border-color:#7C3AED}
    #personal-gen{background:rgba(124,58,237,.35);color:#fff;border:1px solid #7C3AED;
      border-radius:4px;padding:6px 16px;font:13px monospace;cursor:pointer;white-space:nowrap}
    #personal-gen:hover{background:rgba(124,58,237,.55)}
    #personal-preview{width:100%;border-radius:8px;border:1px solid rgba(120,130,180,.25);display:block}
    #personal-list{margin:10px 0;padding:0;list-style:none}
    #personal-list li{padding:4px 8px;border-left:2px solid var(--pc,#7C3AED);
      background:rgba(255,255,255,.03);border-radius:0 4px 4px 0;margin-bottom:4px;font-size:12px}
    #personal-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    #personal-actions button{background:rgba(20,20,40,.6);color:#cbd5e1;
      border:1px solid rgba(120,130,180,.4);border-radius:4px;padding:5px 14px;
      font:12px monospace;cursor:pointer}
    #personal-actions button:hover{background:rgba(60,70,120,.6)}
    #personal-link{flex:1;min-width:200px;background:rgba(20,20,40,.6);color:#8b95b5;
      border:1px dashed rgba(120,130,180,.35);border-radius:4px;padding:5px 8px;font-size:11px}
    #personal-close{position:absolute;top:10px;right:12px;background:none;border:none;
      color:#8b95b5;font-size:16px;cursor:pointer}
    #personal-close:hover{color:#fff}
    #personal-seed-tip{color:#5e6a8c;font-size:11px;margin-top:8px}
    @media (max-width:768px){
      #personal-modal{padding:14px}
      #personal-input-row{flex-wrap:wrap}
    }
  `;
  document.head.appendChild(style);

  // ---- HUD 按钮 ----
  const hudBtn = document.createElement('button');
  hudBtn.id = 'btn-personal';
  hudBtn.textContent = '生成我的星图';
  hudBtn.addEventListener('click', openModal);
  document.getElementById('hud').appendChild(hudBtn);

  // ---- 弹窗 DOM ----
  const overlay = document.createElement('div');
  overlay.id = 'personal-overlay';
  overlay.innerHTML = `
    <div id="personal-modal">
      <button id="personal-close" title="关闭">×</button>
      <h3>我的个人星图</h3>
      <div id="personal-input-row">
        <input id="personal-name" type="text" maxlength="30" placeholder="输入姓名（留空则随机）…" aria-label="姓名输入">
        <button id="personal-gen">生成</button>
      </div>
      <canvas id="personal-preview" width="1000" height="620"></canvas>
      <ul id="personal-list"></ul>
      <div id="personal-actions">
        <button id="personal-save">保存图片</button>
        <button id="personal-copy">复制链接</button>
        <input id="personal-link" readonly title="分享链接" aria-label="分享链接">
      </div>
      <div id="personal-seed-tip"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector('#personal-name');
  const genBtn = overlay.querySelector('#personal-gen');
  const canvasEl = overlay.querySelector('#personal-preview');
  const listEl = overlay.querySelector('#personal-list');
  const saveBtn = overlay.querySelector('#personal-save');
  const copyBtn = overlay.querySelector('#personal-copy');
  const linkInput = overlay.querySelector('#personal-link');
  const tipEl = overlay.querySelector('#personal-seed-tip');

  // ---- 2D 预览（确定性：同种子像素级一致） ----
  function drawPreview(seed) {
    const ctx = canvasEl.getContext('2d');
    const W = canvasEl.width, H = canvasEl.height;
    const rng = mulberry32(seed ^ 0x9E3779B9); // 装饰星空与布局独立流
    // 深空渐变背景
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#05001c');
    g.addColorStop(1, '#030014');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 装饰星星
    for (let i = 0; i < 160; i++) {
      const x = rng() * W, y = rng() * H, r = rng() * 1.4 + 0.2;
      ctx.globalAlpha = 0.25 + rng() * 0.5;
      ctx.fillStyle = '#dbe2f1';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!picked.length) return;
    // 星座顶点：围绕中心的确定性随机多边形（保持画布内边距）
    const pts = [];
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.34;
    for (let i = 0; i < picked.length; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = R * (0.45 + rng() * 0.55);
      pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
    }
    // 连线（按选取顺序成环）
    ctx.strokeStyle = 'rgba(124,58,237,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    // 天体（颜色/大小取自 visual）
    picked.forEach((b, i) => {
      const [x, y] = pts[i];
      const c = b.visual.color;
      const r = 10 + b.visual.size * 14;
      const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 3);
      glow.addColorStop(0, c + 'cc');
      glow.addColorStop(1, c + '00');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // 名称标签
      ctx.fillStyle = 'rgba(226,232,240,.92)';
      ctx.font = '20px "Microsoft YaHei", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.name, x, y - r - 12);
    });
    // 角标
    ctx.fillStyle = 'rgba(139,149,181,.7)';
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PRIVATE COSMOS · seed=' + seed, 18, H - 16);
  }

  function renderList() {
    listEl.innerHTML = '';
    picked.forEach((b) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', b.visual.color);
      li.textContent = `${b.type_cn}「${b.name}」 · 第${b.epoch}纪元 · ` +
        `${(b.tags && b.tags.moods && b.tags.moods[0]) || '—'} · ${b.collision_text.slice(0, 24)}…`;
      li.title = b.collision_text;
      listEl.appendChild(li);
    });
    tipEl.textContent = currentSeed != null
      ? `种子 ${currentSeed} · ${picked.length} 颗天体 · 同一姓名结果恒定，可分享链接复现`
      : '';
  }

  // ---- hash 命名空间（只管 seed，保留搜索参数） ----
  function buildShareUrl(seed) {
    // 剥离临时 query（如 cache-busting 参数），分享链接保持干净
    return location.origin + location.pathname + '#seed=' + seed;
  }
  function writeSeedHash(seed) {
    const p = new URLSearchParams(location.hash.slice(1));
    if (seed == null) p.delete('seed');
    else p.set('seed', String(seed));
    const s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }
  function readSeedHash() {
    const v = new URLSearchParams(location.hash.slice(1)).get('seed');
    return (v && /^\d+$/.test(v)) ? Number(v) : null;
  }

  // ---- 交互 ----
  function openModal() {
    overlay.classList.add('open');
    if (picked.length === 0) {
      const seed = readSeedHash();
      generate(seed != null ? seed : randomSeed());
    }
    nameInput.focus();
  }
  function closeModal() { overlay.classList.remove('open'); }

  function randomSeed() {
    return ((Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0);
  }

  genBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    generate(name ? fnv1a(name) : randomSeed());
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') genBtn.click();
  });

  saveBtn.addEventListener('click', () => {
    canvasEl.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `private-cosmos-${currentSeed}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }, 'image/png');
  });

  copyBtn.addEventListener('click', async () => {
    const url = buildShareUrl(currentSeed);
    linkInput.value = url;
    linkInput.select();
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = '已复制';
    } catch (e) {
      copyBtn.textContent = '已选中请 Ctrl+C'; // file:// 或权限受限降级
    }
    setTimeout(() => { copyBtn.textContent = '复制链接'; }, 1800);
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('#personal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---- 带 #seed= 的 URL 打开时还原同一星图 ----
  const initialSeed = readSeedHash();
  if (initialSeed != null) {
    overlay.classList.add('open');
    generate(initialSeed);
  }

  console.log('[skymap-personal] 个人星图就绪' +
    (initialSeed != null ? '：检测到分享种子 ' + initialSeed + '，已还原' : ''));
})();
