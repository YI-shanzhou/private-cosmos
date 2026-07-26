// 私宇宙 · 星空图交互逻辑
(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var accent3 = style.getPropertyValue('--accent3').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var muted2 = style.getPropertyValue('--muted2').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg = style.getPropertyValue('--bg').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var surface = style.getPropertyValue('--surface').trim();

  var cosmos = window.COSMOS_DATA || [];
  var chronicle = window.CHRONICLE_DATA || [];

  // 领域中文映射
  var DOMAIN_CN = {
    astronomy: '天文', literature: '文学', philosophy: '哲学',
    art: '艺术', myth: '神话'
  };

  // ---- 统计数据 ----
  var deepseekCount = cosmos.filter(function(b) { return b.collision_mode === 'deepseek'; }).length;
  var localCount = cosmos.filter(function(b) { return b.collision_mode === 'local'; }).length;
  var domains = {};
  cosmos.forEach(function(b) {
    (b.tags.domains || []).forEach(function(d) { domains[d] = (domains[d] || 0) + 1; });
  });
  var domainCount = Object.keys(domains).length;

  var statsHtml = '';
  statsHtml += '<div class="stat"><div class="num">' + cosmos.length + '</div><div class="label">天体总数</div></div>';
  statsHtml += '<div class="stat"><div class="num">' + deepseekCount + '</div><div class="label">AI 碰撞</div></div>';
  statsHtml += '<div class="stat"><div class="num">' + domainCount + '</div><div class="label">素材领域</div></div>';
  statsHtml += '<div class="stat"><div class="num">' + cosmos.length + '</div><div class="label">纪元</div></div>';
  document.getElementById('stats-area').innerHTML = statsHtml;

  // ---- 星空散点图 ----
  var skymap = echarts.init(document.getElementById('chart-skymap'), null, { renderer: 'canvas' });

  // 为每个天体生成位置（螺旋分布）
  var scatterData = cosmos.map(function(b, i) {
    var angle = i * 2.4;
    var radius = 8 + i * 2.2;
    var x = radius * Math.cos(angle) + (Math.random() - 0.5) * 4;
    var y = radius * Math.sin(angle) + (Math.random() - 0.5) * 4;
    return {
      name: b.name,
      value: [x, y, b.visual.size, b.visual.luminosity],
      id: b.id,
      body: b,
      itemStyle: {
        color: b.visual.color,
        shadowBlur: 20 * b.visual.luminosity,
        shadowColor: b.visual.color,
        opacity: 0.3 + 0.7 * b.visual.luminosity
      },
      symbolSize: 12 + b.visual.size * 30
    };
  });

  skymap.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: 'rgba(6,6,15,0.95)',
      borderColor: rule,
      textStyle: { color: ink, fontSize: 12 },
      formatter: function(p) {
        var b = p.data.body;
        return '<div style="font-weight:700;color:' + b.visual.color + ';margin-bottom:4px">' + b.name + '</div>' +
               '<div style="color:' + muted + ';font-size:11px">' + b.type_cn + ' · 第' + b.epoch + '纪元</div>' +
               '<div style="color:' + accent2 + ';font-size:11px;margin-top:4px">' + (b.collision_mode === 'deepseek' ? 'AI 碰撞' : '本地碰撞') + '</div>';
      }
    },
    xAxis: { show: false, min: -60, max: 60 },
    yAxis: { show: false, min: -60, max: 60, inverse: true },
    series: [{
      type: 'scatter',
      data: scatterData,
      emphasis: {
        scale: 1.5,
        itemStyle: { shadowBlur: 40 }
      },
      animationDelay: function(idx) { return idx * 80; }
    }],
    animation: true,
    animationDuration: 1000
  });

  // 点击天体显示详情
  skymap.on('click', function(params) {
    if (params.data && params.data.body) {
      showDetail(params.data.body);
    }
  });

  // 构建 APOD 图片映射: parents id -> apod 记录
  var apodMap = {};
  (window.APOD_DATA || []).forEach(function(a, idx) {
    var aid = 'apo_' + String(idx + 1).padStart(2, '0');
    apodMap[aid] = a;
    // 也用 title 做备用映射
    if (a.title) apodMap[a.title] = a;
  });

  function findApodImage(compositionSide) {
    // compositionSide: {domain, text, source}
    if (compositionSide.domain !== 'astronomy') return null;
    // 通过 source 中的日期匹配
    var src = compositionSide.source || '';
    var dateMatch = src.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      for (var i = 0; i < (window.APOD_DATA || []).length; i++) {
        if (window.APOD_DATA[i].date === dateMatch[0]) return window.APOD_DATA[i];
      }
    }
    // 通过 title 匹配
    var title = compositionSide.text || '';
    for (var i = 0; i < (window.APOD_DATA || []).length; i++) {
      if (window.APOD_DATA[i].title === title) return window.APOD_DATA[i];
    }
    return null;
  }

  function showDetail(b) {
    var panel = document.getElementById('detail-panel');
    var modeLabel = b.collision_mode === 'deepseek'
      ? '<span class="card-mode deepseek">DeepSeek</span>'
      : '<span class="card-mode local">本地降级</span>';
    var html = '';
    html += '<div class="dp-header">';
    html += '  <div class="dp-orb" style="background:' + b.visual.color + ';color:' + b.visual.color + ';width:' + (24 + b.visual.size * 30) + 'px;height:' + (24 + b.visual.size * 30) + 'px"></div>';
    html += '  <div>';
    html += '    <div class="dp-name">' + b.name + '</div>';
    html += '    <div class="dp-type">' + b.type_cn + ' · 第 ' + b.epoch + ' 纪元 · ' + modeLabel + '</div>';
    html += '  </div>';
    html += '</div>';
    html += '<div class="dp-collision">' + b.collision_text + '</div>';

    // 检查是否有天文素材图片
    var apodA = findApodImage(b.composition.a);
    var apodB = findApodImage(b.composition.b);
    if (apodA || apodB) {
      html += '<div class="dp-apod">';
      if (apodA) {
        html += '  <div class="dp-apod-item">';
        html += '    <img src="assets/apod/' + apodA.local_path.split('/').pop() + '" alt="' + apodA.title + '">';
        html += '    <div class="dp-apod-caption">NASA APOD · ' + apodA.title + ' · ' + apodA.date + '</div>';
        html += '  </div>';
      }
      if (apodB) {
        html += '  <div class="dp-apod-item">';
        html += '    <img src="assets/apod/' + apodB.local_path.split('/').pop() + '" alt="' + apodB.title + '">';
        html += '    <div class="dp-apod-caption">NASA APOD · ' + apodB.title + ' · ' + apodB.date + '</div>';
        html += '  </div>';
      }
      html += '</div>';
    }

    html += '<div class="dp-parents">';
    html += '  <div class="dp-parent">';
    html += '    <div class="dp-domain">素材甲 · ' + DOMAIN_CN[b.composition.a.domain] + '</div>';
    html += '    <div class="dp-text">' + b.composition.a.text + '</div>';
    html += '    <div class="dp-source">— ' + b.composition.a.source + '</div>';
    html += '  </div>';
    html += '  <div class="dp-parent">';
    html += '    <div class="dp-domain">素材乙 · ' + DOMAIN_CN[b.composition.b.domain] + '</div>';
    html += '    <div class="dp-text">' + b.composition.b.text + '</div>';
    html += '    <div class="dp-source">— ' + b.composition.b.source + '</div>';
    html += '  </div>';
    html += '</div>';
    html += '<div class="dp-meta">';
    html += '  <span>色彩 ' + b.visual.color + '</span>';
    html += '  <span>体积 ' + b.visual.size + '</span>';
    html += '  <span>光度 ' + b.visual.luminosity + '</span>';
    html += '  <span>诞生 ' + b.born_at + '</span>';
    html += '</div>';
    panel.innerHTML = html;
    panel.classList.add('active');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.addEventListener('resize', function() { skymap.resize(); });

  // ---- 碰撞画廊 ----
  var galleryHtml = '';
  cosmos.forEach(function(b) {
    galleryHtml += '<div class="card" style="--card-color:' + b.visual.color + '" data-id="' + b.id + '">';
    galleryHtml += '  <div class="card-epoch">第 ' + b.epoch + ' 纪元 · ' + b.type_cn + '</div>';
    galleryHtml += '  <div class="card-text">' + b.collision_text + '</div>';
    galleryHtml += '  <div class="card-meta">';
    galleryHtml += '    <span class="card-name">' + b.name + '</span>';
    galleryHtml += '    <span class="card-mode ' + b.collision_mode + '">' + (b.collision_mode === 'deepseek' ? 'AI' : '本地') + '</span>';
    galleryHtml += '  </div>';
    galleryHtml += '</div>';
  });
  var gallery = document.getElementById('gallery-area');
  gallery.innerHTML = galleryHtml;
  gallery.querySelectorAll('.card').forEach(function(card) {
    card.addEventListener('click', function() {
      var id = this.getAttribute('data-id');
      var body = cosmos.find(function(b) { return b.id === id; });
      if (body) {
        showDetail(body);
        document.getElementById('chart-skymap').scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // ---- 天体类型分布 ----
  var typeCount = {};
  cosmos.forEach(function(b) { typeCount[b.type_cn] = (typeCount[b.type_cn] || 0) + 1; });
  var typeData = Object.keys(typeCount).map(function(k) {
    return { name: k, value: typeCount[k] };
  });
  var typeColors = {
    '黑洞': '#7C3AED', '白矮星': '#64748B', '暗物质': '#7C3AED',
    '行星': '#14B8A6', '星云': '#6D5AE6', '星系': '#6D5AE6',
    '彗星': '#475569', '流浪行星': '#475569', '遗迹': '#64748B',
    '超新星': '#F2715E', '脉冲星': '#F2C94C', '类星体': '#F2C94C',
    '恒星': '#FBBF24', '原恒星': '#FBBF24', '虫洞': '#8B5CF6',
    '星团': '#0EA5E9', '尘埃云': '#8A86A8'
  };
  var chartTypes = echarts.init(document.getElementById('chart-types'), null, { renderer: 'svg' });
  chartTypes.setOption({
    tooltip: { trigger: 'item', backgroundColor: 'rgba(6,6,15,0.95)', borderColor: rule, textStyle: { color: ink } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '50%'],
      data: typeData,
      label: { color: muted, fontSize: 11 },
      labelLine: { lineStyle: { color: rule } },
      itemStyle: { borderColor: bg2, borderWidth: 2 },
      color: typeData.map(function(d) { return typeColors[d.name] || accent; })
    }]
  });
  window.addEventListener('resize', function() { chartTypes.resize(); });

  // ---- 碰撞领域矩阵（热力图）----
  var allDomains = ['astronomy', 'literature', 'philosophy', 'art', 'myth'];
  var matrixData = [];
  for (var i = 0; i < allDomains.length; i++) {
    for (var j = i + 1; j < allDomains.length; j++) {
      var count = 0;
      cosmos.forEach(function(b) {
        var d = b.tags.domains || [];
        if ((d[0] === allDomains[i] && d[1] === allDomains[j]) ||
            (d[0] === allDomains[j] && d[1] === allDomains[i])) {
          count++;
        }
      });
      matrixData.push([j - 1, i, count]);
    }
  }
  var chartDomains = echarts.init(document.getElementById('chart-domains'), null, { renderer: 'svg' });
  chartDomains.setOption({
    tooltip: {
      backgroundColor: 'rgba(6,6,15,0.95)', borderColor: rule, textStyle: { color: ink },
      formatter: function(p) {
        return DOMAIN_CN[allDomains[p.value[0]]] + ' × ' + DOMAIN_CN[allDomains[p.value[1]]] + '<br/>碰撞次数: ' + p.value[2];
      }
    },
    grid: { top: 10, bottom: 60, left: 60, right: 20 },
    xAxis: {
      type: 'category', data: allDomains.map(function(d) { return DOMAIN_CN[d]; }),
      axisLabel: { color: muted, fontSize: 11 }, axisLine: { lineStyle: { color: rule } }, axisTick: { show: false }
    },
    yAxis: {
      type: 'category', data: allDomains.map(function(d) { return DOMAIN_CN[d]; }),
      axisLabel: { color: muted, fontSize: 11 }, axisLine: { lineStyle: { color: rule } }, axisTick: { show: false }
    },
    visualMap: {
      min: 0, max: Math.max.apply(null, matrixData.map(function(d) { return d[2]; }).concat([1])),
      calculable: false, show: false,
      inRange: { color: [bg2, accent2, accent] }
    },
    series: [{
      type: 'heatmap',
      data: matrixData,
      label: { show: true, color: ink, fontSize: 13, fontWeight: 700 },
      itemStyle: { borderRadius: 4, borderColor: bg2, borderWidth: 2 }
    }]
  });
  window.addEventListener('resize', function() { chartDomains.resize(); });

  // ---- NASA 天文素材库 ----
  var apodData = window.APOD_DATA || [];
  var apodHtml = '';
  apodData.forEach(function(a) {
    var imgFile = a.local_path ? a.local_path.split('/').pop() : '';
    var themes = (a.tags && a.tags.themes) ? a.tags.themes : [];
    var moods = (a.tags && a.tags.moods) ? a.tags.moods : [];
    apodHtml += '<div class="apod-card">';
    apodHtml += '  <img src="assets/apod/' + imgFile + '" alt="' + a.title + '" loading="lazy">';
    apodHtml += '  <div class="apod-body">';
    apodHtml += '    <div class="apod-title">' + a.title + '</div>';
    apodHtml += '    <div class="apod-date">NASA APOD · ' + a.date + '</div>';
    apodHtml += '    <div class="apod-tags">';
    themes.forEach(function(t) { apodHtml += '<span class="apod-tag">' + (t.cn || t.en) + '</span>'; });
    moods.forEach(function(m) { apodHtml += '<span class="apod-tag mood">' + m + '</span>'; });
    apodHtml += '    </div>';
    apodHtml += '  </div>';
    apodHtml += '</div>';
  });
  document.getElementById('apod-grid').innerHTML = apodHtml;

  // ---- 编年史时间线 ----
  var tlHtml = '';
  chronicle.forEach(function(c) {
    var body = cosmos.find(function(b) { return b.id === c.body_id; });
    var color = body ? body.visual.color : accent;
    tlHtml += '<div class="tl-item" style="--tl-color:' + color + '">';
    tlHtml += '  <div class="tl-time">第 ' + c.epoch + ' 纪元 · ' + c.timestamp.replace('T', ' ') + '</div>';
    tlHtml += '  <div class="tl-summary">' + c.summary + '</div>';
    tlHtml += '</div>';
  });
  document.getElementById('timeline-area').innerHTML = tlHtml;

})();
