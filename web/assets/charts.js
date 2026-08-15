/**
 * charts.js — 统计面板模块（Day 3 · 3.2）
 *
 * 职责（基于 COSMOS_STATS 渲染三张 ECharts 图表）：
 *  - 天体类型分布饼图（type_distribution）
 *  - 情绪光谱柱状图（mood_distribution）
 *  - 领域贡献雷达图（domain_distribution）
 *  - 底部统计面板（可折叠），窗口 resize 图表自适应
 *
 * 依赖：echarts.min.js（经典脚本先加载）、window.COSMOS_STATS（cosmos-data.js）
 */
(() => {
  if (typeof echarts === 'undefined') {
    console.error('[charts] echarts 未加载，统计面板不可用');
    return;
  }
  const stats = window.COSMOS_STATS;
  if (!stats || !stats.type_distribution) {
    console.error('[charts] COSMOS_STATS 缺失，统计面板不可用');
    return;
  }

  // ---- 样式（3.3 base.css 将统一定制，此处保证模块独立可用） ----
  const style = document.createElement('style');
  style.textContent = `
    #stats-panel{position:fixed;left:0;right:0;bottom:0;z-index:15;
      background:rgba(8,10,24,.92);border-top:1px solid rgba(120,130,180,.3);
      backdrop-filter:blur(6px);color:#e2e8f0;
      font:12px "JetBrains Mono","Microsoft YaHei",monospace}
    #stats-header{display:flex;align-items:center;gap:10px;padding:6px 14px}
    #stats-header b{font-size:12px;letter-spacing:.15em;color:#8b95b5;font-weight:400}
    #stats-summary{color:#5e6a8c}
    #stats-toggle{margin-left:auto;background:rgba(20,20,40,.6);color:#cbd5e1;
      border:1px solid rgba(120,130,180,.4);border-radius:4px;padding:2px 10px;
      font:12px monospace;cursor:pointer}
    #stats-toggle:hover{background:rgba(60,70,120,.6)}
    #stats-charts{display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:8px;
      padding:0 14px 10px;height:190px}
    #stats-panel.collapsed #stats-charts{display:none}
    .chart-box{position:relative;min-width:0}
    .chart-title{color:#8b95b5;font-size:11px;letter-spacing:.1em;margin:2px 0 4px}
    .chart{width:100%;height:165px}
  `;
  document.head.appendChild(style);

  // ---- 面板 DOM（index.html 提供容器则复用，否则自建） ----
  let panel = document.getElementById('stats-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'stats-panel';
    document.body.appendChild(panel);
  }
  panel.innerHTML = `
    <div id="stats-header"><b>宇宙统计</b><span id="stats-summary"></span>
      <button id="stats-toggle">收起</button></div>
    <div id="stats-charts">
      <div class="chart-box"><div class="chart-title">天体类型分布</div>
        <div id="chart-type" class="chart"></div></div>
      <div class="chart-box"><div class="chart-title">情绪光谱</div>
        <div id="chart-mood" class="chart"></div></div>
      <div class="chart-box"><div class="chart-title">领域贡献</div>
        <div id="chart-domain" class="chart"></div></div>
    </div>
  `;

  document.getElementById('stats-summary').textContent =
    `${stats.total_bodies} 颗天体 · 编年史 ${stats.chronicle_entries} 条 · 最深第${stats.generation.max_generation}代`;

  const textStyle = {
    color: '#aeb8d4',
    fontFamily: '"JetBrains Mono","Microsoft YaHei",monospace',
    fontSize: 10,
  };
  const charts = {};

  // 饼图：类型分布
  charts.type = echarts.init(document.getElementById('chart-type'));
  charts.type.setOption({
    textStyle,
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle',
      itemWidth: 8, itemHeight: 8, textStyle: { ...textStyle, fontSize: 9 } },
    series: [{
      type: 'pie', radius: ['38%', '68%'], center: ['38%', '50%'],
      itemStyle: { borderColor: '#0a0c1c', borderWidth: 1 },
      label: { show: false },
      data: Object.entries(stats.type_distribution).map(([name, value]) => ({ name, value })),
    }],
  });

  // 柱状图：情绪光谱
  charts.mood = echarts.init(document.getElementById('chart-mood'));
  charts.mood.setOption({
    textStyle,
    grid: { left: 30, right: 8, top: 14, bottom: 34 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category',
      data: Object.keys(stats.mood_distribution),
      axisLabel: { ...textStyle, rotate: 40, fontSize: 9 },
      axisLine: { lineStyle: { color: 'rgba(120,130,180,.4)' } } },
    yAxis: { type: 'value', axisLabel: textStyle,
      splitLine: { lineStyle: { color: 'rgba(120,130,180,.15)' } } },
    series: [{
      type: 'bar', barWidth: '55%',
      data: Object.values(stats.mood_distribution),
      itemStyle: { color: '#7C3AED', borderRadius: [3, 3, 0, 0] },
    }],
  });

  // 雷达图：领域贡献
  charts.domain = echarts.init(document.getElementById('chart-domain'));
  const domEntries = Object.entries(stats.domain_distribution);
  const domMax = Math.max(...domEntries.map(([, v]) => v)) * 1.15;
  charts.domain.setOption({
    textStyle,
    tooltip: {},
    radar: {
      indicator: domEntries.map(([name, _]) => ({ name, max: domMax })),
      radius: '62%', center: ['50%', '54%'],
      axisName: { ...textStyle, fontSize: 9 },
      splitLine: { lineStyle: { color: 'rgba(120,130,180,.25)' } },
      splitArea: { areaStyle: { color: ['rgba(124,58,237,.03)', 'rgba(124,58,237,.06)'] } },
      axisLine: { lineStyle: { color: 'rgba(120,130,180,.25)' } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: domEntries.map(([, v]) => v),
        name: '领域贡献',
        areaStyle: { color: 'rgba(56,189,248,.25)' },
        lineStyle: { color: '#38bdf8', width: 1.5 },
        itemStyle: { color: '#38bdf8' },
      }],
    }],
  });

  // 折叠开关（同步 --stats-h CSS 变量，时间轴位置随之联动 · Day 7 · 7.1）
  const toggle = document.getElementById('stats-toggle');
  const setStatsH = (collapsed) =>
    document.documentElement.style.setProperty('--stats-h', collapsed ? '33px' : '232px');
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '展开' : '收起';
    setStatsH(collapsed);
    if (!collapsed) Object.values(charts).forEach((c) => c.resize());
  });

  // 窗口自适应
  window.addEventListener('resize', () => {
    Object.values(charts).forEach((c) => c.resize());
  });

  window.SkyMap && (window.SkyMap.charts = charts);
  console.log('[charts] 统计面板就绪：类型' + Object.keys(stats.type_distribution).length +
    '种 / 情绪' + Object.keys(stats.mood_distribution).length +
    '种 / 领域' + Object.keys(stats.domain_distribution).length + '个');
})();
