/**
 * skymap-panel.js — 详情面板模块（Day 3 · 3.1）
 *
 * 职责：
 *  - 监听 body-clicked 事件 → 弹出天体详情面板（固定右侧栏）
 *  - 面板内容：名称、类型、碰撞文本、父素材、情绪标签、世代谱系、视觉参数
 *  - 面板关闭按钮 + 点击空白（blank-clicked）关闭 + Escape 关闭
 *
 * 依赖：window.SkyMap、COSMOS_DATA（父代名称回查）
 */
(() => {
  const SkyMap = window.SkyMap;
  const DATA = (typeof COSMOS_DATA !== 'undefined' && Array.isArray(COSMOS_DATA)) ? COSMOS_DATA : [];

  // 领域中文名映射（供面板与后续 Day 4 搜索模块复用）
  SkyMap.DOMAIN_CN = {
    literature: '文学', philosophy: '哲学', music: '音乐', myth: '神话',
    science: '科学', cinema: '电影', history: '历史', geography: '地理',
    astronomy: '天文', art: '艺术',
  };
  const domainCn = (d) => SkyMap.DOMAIN_CN[d] || d;

  // ---- 样式（3.3 的 base.css 将统一定制，此处保证模块独立可用） ----
  const style = document.createElement('style');
  style.textContent = `
    #panel{position:fixed;top:60px;right:16px;width:320px;max-height:calc(100vh - 220px);overflow-y:auto;
      background:rgba(10,12,28,.93);border:1px solid rgba(120,130,180,.35);border-radius:10px;
      padding:14px 16px 16px;color:#e2e8f0;z-index:20;display:none;
      font:13px/1.65 "JetBrains Mono","Microsoft YaHei",monospace;box-shadow:0 4px 24px rgba(0,0,0,.5)}
    #panel.open{display:block}
    #panel h3{margin:0 0 2px;font-size:15px;color:#fff}
    #panel .sub{color:#8b95b5;font-size:11px;margin-bottom:10px}
    #panel .sec{margin-top:12px;border-top:1px solid rgba(120,130,180,.25);padding-top:10px}
    #panel .sec h4{margin:0 0 6px;font-size:11px;color:#8b95b5;letter-spacing:.1em}
    #panel blockquote{margin:0;padding:8px 10px;background:rgba(124,58,237,.08);
      border-left:3px solid #7C3AED;border-radius:4px;color:#dbe2f1}
    #panel .comp{margin:6px 0;padding:6px 8px;background:rgba(255,255,255,.04);border-radius:6px}
    #panel .comp .src{color:#8b95b5;font-size:11px}
    #panel .chips{display:flex;flex-wrap:wrap;gap:6px}
    #panel .chip{padding:2px 9px;border-radius:99px;font-size:11px;
      background:rgba(124,58,237,.16);border:1px solid rgba(124,58,237,.4)}
    #panel .chip.domain{background:rgba(56,189,248,.12);border-color:rgba(56,189,248,.4)}
    #panel .chip.theme{background:rgba(52,211,153,.12);border-color:rgba(52,211,153,.4)}
    #panel .kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px}
    #panel .kv b{color:#8b95b5;font-weight:400}
    #panel .swatch{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:5px}
    #panel .lineage-box{padding:6px 8px;background:rgba(250,204,21,.08);border:1px dashed rgba(250,204,21,.35);border-radius:6px}
    #panel-close{position:absolute;top:8px;right:10px;background:none;border:none;color:#8b95b5;
      font-size:16px;cursor:pointer;line-height:1}
    #panel-close:hover{color:#fff}
  `;
  document.head.appendChild(style);

  // ---- 面板 DOM ----
  const panel = document.createElement('div');
  panel.id = 'panel';
  panel.innerHTML = '<button id="panel-close" title="关闭">×</button><div id="panel-body"></div>';
  document.body.appendChild(panel);
  const bodyBox = panel.querySelector('#panel-body');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function compositionHtml(comp) {
    if (!comp) return '';
    return ['a', 'b', 'c'].filter((k) => comp[k]).map((k) => {
      const s = comp[k];
      return `<div class="comp"><b>${esc(domainCn(s.domain))}</b> · ${esc(s.text || '')}
        <div class="src">—— ${esc(s.source || '佚名')}</div></div>`;
    }).join('');
  }

  function render(body) {
    const tags = body.tags || {};
    const lineage = body.lineage;
    let lineageHtml = '<div class="sec"><h4>世代谱系</h4><div class="kv"><b>世代</b><span>初代天体</span></div></div>';
    if (lineage) {
      const parent = DATA.find((b) => b.id === lineage.parent_id);
      lineageHtml = `<div class="sec"><h4>世代谱系</h4>
        <div class="lineage-box">第 ${lineage.generation} 代天体
        ${parent ? `，由 <b>${esc(parent.type_cn)}「${esc(parent.name)}」</b> 繁衍而生` : `（父代 ${esc(lineage.parent_id)}）`}
        <div style="color:#8b95b5;font-size:11px;margin-top:2px">继承特质：${(lineage.inherited_traits || []).map(esc).join(' / ')}</div></div></div>`;
    }
    const chips = (arr, cls) => (arr || []).map((t) =>
      `<span class="chip ${cls}">${esc(t)}</span>`).join('');
    const v = body.visual || {};

    bodyBox.innerHTML = `
      <h3><span class="swatch" style="background:${esc(v.color || '#999')}"></span>${esc(body.type_cn)}「${esc(body.name)}」</h3>
      <div class="sub">${esc(body.id)} · 第 ${body.epoch} 纪元 · ${esc((body.born_at || '').slice(0, 10))} · ${body.collision_type === 'triple' ? '三体碰撞' : '两体碰撞'} · ${esc(body.collision_mode === 'deepseek' ? 'DeepSeek' : '本地模板')}</div>

      <blockquote>${esc(body.collision_text)}</blockquote>

      <div class="sec"><h4>父素材</h4>${compositionHtml(body.composition)}</div>

      <div class="sec"><h4>情绪</h4><div class="chips">${chips(tags.moods, '') || '—'}</div></div>
      <div class="sec"><h4>主题</h4><div class="chips">${chips(tags.themes, 'theme') || '—'}</div></div>
      <div class="sec"><h4>领域</h4><div class="chips">${chips((tags.domains || []).map(domainCn), 'domain') || '—'}</div></div>

      ${lineageHtml}

      <div class="sec"><h4>视觉参数</h4><div class="kv">
        <b>颜色</b><span>${esc(v.color || '—')}</span>
        <b>大小</b><span>${v.size ?? '—'}</span>
        <b>亮度</b><span>${v.luminosity ?? '—'}</span>
      </div></div>
    `;
  }

  function openPanel(body) {
    render(body);
    panel.classList.add('open');
    panel.dataset.bodyId = body.id;
  }

  function closePanel() {
    panel.classList.remove('open');
    delete panel.dataset.bodyId;
  }

  document.addEventListener('body-clicked', (e) => openPanel(e.detail.body));
  document.addEventListener('blank-clicked', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  panel.querySelector('#panel-close').addEventListener('click', closePanel);

  SkyMap.panel = { open: openPanel, close: closePanel, el: panel };
  console.log('[skymap-panel] 详情面板就绪');
})();
