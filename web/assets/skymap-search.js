// V4-M5-B：fatal 态守卫——数据校验失败时本模块整体跳过（防 null 链式崩溃与控制台噪音）
if (window.SkyMap && window.SkyMap.fatal) {
  console.warn('[skymap] fatal 态，跳过模块：' + (import.meta.url || '').split('/').pop());
} else {
/**
 * skymap-search.js — 搜索筛选模块（Day 4 · 4.2）
 *
 * 职责：
 *  - 搜索栏：关键词（天体名称 / 碰撞文本 / 素材来源）
 *  - 领域筛选：多选标签（9 域）；类型筛选 / 情绪筛选：多选
 *  - 筛选实时更新星图：匹配正常，不匹配淡化 opacity 0.15（SkyMap.filterBodies）
 *  - 筛选条件持久化到 URL hash（#q=黑洞&domain=literature&type=black_hole&mood=诡谲）
 *  - 重置按钮恢复全部
 *
 * 依赖：window.SkyMap（filterBodies/highlightBody）、COSMOS_DATA
 */
(() => {
  const SkyMap = window.SkyMap;
  const DATA = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];
  const DOMAIN_CN = SkyMap.DOMAIN_CN || {};
  // 领域 chips 从数据实际域集合派生（Day 7 · 7.1）：自动覆盖新增域（如 art）
  const DOMAINS = [...new Set(DATA.flatMap((b) => (b.tags && b.tags.domains) || []))].sort();
  const TYPES = [...new Set(DATA.map((b) => b.type_cn).filter(Boolean))];
  const MOODS = [...new Set(DATA.flatMap((b) => (b.tags && b.tags.moods) || []))];

  // ---- 样式 ----
  const style = document.createElement('style');
  style.textContent = `
    #searchbar{position:fixed;left:12px;top:48px;z-index:12;max-width:340px;
      display:flex;flex-direction:column;gap:6px;padding:10px 12px;
      background:rgba(8,10,24,.9);border:1px solid rgba(120,130,180,.3);border-radius:10px;
      color:#cbd5e1;font:12px "JetBrains Mono","Microsoft YaHei",monospace;backdrop-filter:blur(6px)}
    #search-q{width:100%;box-sizing:border-box;background:rgba(20,20,40,.6);color:#e2e8f0;
      border:1px solid rgba(120,130,180,.4);border-radius:4px;padding:5px 8px;
      font:12px "JetBrains Mono","Microsoft YaHei",monospace;outline:none}
    #search-q:focus{border-color:#7C3AED}
    .chip-row{display:flex;flex-wrap:wrap;gap:4px}
    .s-chip{padding:2px 8px;border-radius:99px;font-size:11px;cursor:pointer;user-select:none;
      background:rgba(255,255,255,.05);border:1px solid rgba(120,130,180,.35);color:#8b95b5}
    .s-chip.on{background:rgba(124,58,237,.25);border-color:#7C3AED;color:#fff}
    #searchbar details{border-top:1px dashed rgba(120,130,180,.25);padding-top:5px}
    #searchbar summary{cursor:pointer;color:#8b95b5;font-size:11px;user-select:none;list-style:none}
    #searchbar summary::before{content:'▸ '}
    #searchbar details[open] summary::before{content:'▾ '}
    #searchbar details .chip-row{margin-top:5px}
    #search-foot{display:flex;align-items:center;gap:8px}
    #search-reset{background:rgba(20,20,40,.6);color:#cbd5e1;border:1px solid rgba(120,130,180,.4);
      border-radius:4px;padding:3px 12px;font:12px monospace;cursor:pointer}
    #search-reset:hover{background:rgba(60,70,120,.6)}
    #search-count{color:#9aa8cc;font-size:11px}
    @media (max-width:768px){
      #searchbar{left:8px;right:8px;max-width:none;top:118px}
    }
  `;
  document.head.appendChild(style);

  // ---- DOM ----
  const bar = document.createElement('div');
  bar.id = 'searchbar';
  bar.innerHTML = `
    <input id="search-q" type="text" placeholder="搜索天体名 / 碰撞文本 / 素材来源…" aria-label="搜索天体关键词">
    <div class="chip-row" id="domain-chips"></div>
    <details><summary>类型（${TYPES.length}）</summary><div class="chip-row" id="type-chips"></div></details>
    <details><summary>情绪（${MOODS.length}）</summary><div class="chip-row" id="mood-chips"></div></details>
    <div id="search-foot"><button id="search-reset">重置</button><span id="search-count"></span></div>
  `;
  document.body.appendChild(bar);

  const qInput = bar.querySelector('#search-q');
  const countEl = bar.querySelector('#search-count');

  function buildChips(container, values, labels) {
    const chips = {};
    values.forEach((v, i) => {
      const c = document.createElement('span');
      c.className = 's-chip';
      c.textContent = labels ? labels[i] : v;
      c.dataset.value = v;
      c.addEventListener('click', () => { c.classList.toggle('on'); apply(); });
      container.appendChild(c);
      chips[v] = c;
    });
    return chips;
  }
  buildChips(bar.querySelector('#domain-chips'), DOMAINS, DOMAINS.map((d) => DOMAIN_CN[d] || d));
  buildChips(bar.querySelector('#type-chips'), TYPES);
  buildChips(bar.querySelector('#mood-chips'), MOODS);

  // ---- 筛选状态收集与应用 ----
  const picked = (container) => [...container.querySelectorAll('.s-chip.on')].map((c) => c.dataset.value);

  function currentFilters() {
    return {
      q: qInput.value,
      domains: picked(bar.querySelector('#domain-chips')),
      types: picked(bar.querySelector('#type-chips')),
      moods: picked(bar.querySelector('#mood-chips')),
    };
  }

  function writeHash(f) {
    // 保留外部命名空间参数（如个人星图 #seed=），仅重写搜索自身四个参数
    const p = new URLSearchParams(location.hash.slice(1));
    ['q', 'domain', 'type', 'mood'].forEach((k) => p.delete(k));
    if (f.q) p.set('q', f.q);
    if (f.domains.length) p.set('domain', f.domains.join(','));
    if (f.types.length) p.set('type', f.types.join(','));
    if (f.moods.length) p.set('mood', f.moods.join(','));
    const h = p.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }

  function apply() {
    const f = currentFilters();
    const n = SkyMap.filterBodies(f);
    countEl.textContent = DATA.length ? `${n} / ${DATA.length} 颗匹配` : '';
    writeHash(f);
  }

  qInput.addEventListener('input', apply);

  // ---- 重置（仅清搜索参数，保留外部命名空间如 #seed=） ----
  bar.querySelector('#search-reset').addEventListener('click', () => {
    qInput.value = '';
    bar.querySelectorAll('.s-chip.on').forEach((c) => c.classList.remove('on'));
    writeHash({ q: '', domains: [], types: [], moods: [] });
    apply();
  });

  // ---- 从 URL hash 恢复（持久化） ----
  function restoreFromHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    qInput.value = p.get('q') || '';
    const setChips = (container, values) => {
      values.forEach((v) => {
        const c = container.querySelector(`.s-chip[data-value="${CSS.escape(v)}"]`);
        if (c) c.classList.add('on');
      });
    };
    setChips(bar.querySelector('#domain-chips'), (p.get('domain') || '').split(',').filter(Boolean));
    setChips(bar.querySelector('#type-chips'), (p.get('type') || '').split(',').filter(Boolean));
    setChips(bar.querySelector('#mood-chips'), (p.get('mood') || '').split(',').filter(Boolean));
    apply();
  }
  restoreFromHash();

  console.log('[skymap-search] 搜索筛选就绪：领域9 / 类型' + TYPES.length + ' / 情绪' + MOODS.length);
})();

} // V4-M5-B：fatal 态守卫结束
