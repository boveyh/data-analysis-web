/* =============================================================================
 * charts.js — ECharts renderers, one per chart type.
 * The library is fetched from a short CDN fallback chain so a single outage
 * never breaks the page.
 * ========================================================================== */

const CDNS = [
  'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
  'https://unpkg.com/echarts@5.5.1/dist/echarts.min.js',
  'https://cdn.bootcdn.net/ajax/libs/echarts/5.5.1/echarts.min.js',
  'https://lib.baomitu.com/echarts/5.5.1/echarts.min.js',
];

let libPromise = null;

/** Resolve window.echarts, trying each CDN in turn. */
export function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (libPromise) return libPromise;

  libPromise = new Promise((resolve, reject) => {
    let i = 0;
    const attempt = () => {
      if (i >= CDNS.length) { reject(new Error('echarts-unavailable')); return; }
      const src = CDNS[i++];
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => (window.echarts ? resolve(window.echarts) : attempt());
      s.onerror = attempt;
      document.head.appendChild(s);
    };
    attempt();
  });
  return libPromise;
}

/* ------------------------------ theming ---------------------------------- */

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function palette() {
  return ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--c9', '--c10'].map(cssVar);
}

function theme() {
  return {
    text: cssVar('--text') || '#14161d',
    text2: cssVar('--text-2') || '#575e6b',
    text3: cssVar('--text-3') || '#8b92a1',
    border: cssVar('--border') || '#e6e8ec',
    surface: cssVar('--surface') || '#fff',
    font: cssVar('--font-sans') || 'sans-serif',
    colors: palette(),
  };
}

/* ---------------------------- number format ------------------------------ */

export function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs !== 0 && abs < 0.01) return n.toExponential(2);
  const d = Number.isInteger(n) ? 0 : (abs >= 1000 ? Math.min(digits, 2) : digits);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

/** Expose the resolved theme so callers can build ad-hoc options. */
export function chartTheme() { return theme(); }

const compact = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1) + '亿';
  if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e5 ? 0 : 1) + 'w';
  if (a >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n * 100) / 100);
};

/* ------------------------------ base option ------------------------------ */

function baseOption(t, title) {
  return {
    color: t.colors,
    textStyle: { fontFamily: t.font, color: t.text2 },
    animationDuration: 520,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.text3, type: 'dashed' } },
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [9, 12],
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 26px rgba(16,24,40,.16);border-radius:10px;',
      valueFormatter: (v) => (typeof v === 'number' ? fmtNum(v) : v),
    },
    legend: {
      type: 'scroll', top: 2, right: 6, left: 6,
      icon: 'roundRect', itemWidth: 9, itemHeight: 9, itemGap: 14,
      textStyle: { color: t.text2, fontFamily: t.font, fontSize: 11.5 },
    },
    grid: { left: 8, right: 22, top: 46, bottom: 18, containLabel: true },
    title: title ? {
      text: title, left: 4, top: 0,
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 13.5, fontWeight: 600 },
    } : undefined,
  };
}

const axisCommon = (t, name) => ({
  name,
  nameTextStyle: { color: t.text3, fontFamily: t.font, fontSize: 11, padding: [0, 0, 0, 0] },
  nameGap: 14,
  axisLine: { lineStyle: { color: t.border } },
  axisTick: { show: false },
  axisLabel: { color: t.text3, fontFamily: t.font, fontSize: 11, hideOverlap: true },
  splitLine: { lineStyle: { color: t.border, type: 'dashed', opacity: 0.7 } },
});

/* Category axes carry no name — the card title already says "… by <x>", and a
   centred name collides with rotated tick labels. */
const catAxis = (t, name, rotate = 0, data = []) => ({
  type: 'category',
  data,
  ...axisCommon(t, name),
  name: '',
  splitLine: { show: false },
  axisLabel: {
    color: t.text3, fontFamily: t.font, fontSize: 11,
    rotate,
    interval: data.length > 30 ? 'auto' : 0,
    hideOverlap: true,
  },
});

const valAxis = (t, name) => ({
  type: 'value',
  ...axisCommon(t, name),
  axisLine: { show: false },
});

/* --------------------------- option builders ----------------------------- */

/**
 * @param {string} type  bar|grouped|line|area|scatter|hist|box|pie|heat
 * @param {object} model { categories, series, scatter, box, corr, xName, yName, title, sub }
 * @param {object} cfg   { stack, smooth, label }
 */
export function buildOption(type, model, cfg, t = theme()) {
  const c = { stack: false, smooth: false, label: false, ...cfg };
  const opt = baseOption(t, model.title);
  const n = model.categories ? model.categories.length : 0;
  const rot = n > 30 ? 45 : (n > 7 ? 24 : 0);

  const tip = (formatter) => ({
    ...opt.tooltip,
    trigger: type === 'pie' || type === 'scatter' ? 'item' : 'axis',
    formatter,
  });

  switch (type) {
    /* ---------------------------- bar / stacked -------------------------- */
    case 'bar':
    case 'grouped': {
      const stacked = type === 'grouped' || c.stack;
      return {
        ...opt,
        tooltip: tip(),
        xAxis: catAxis(t, model.xName, rot, model.categories),
        yAxis: valAxis(t, model.yName),
        series: model.series.map((s, i) => ({
          name: s.name,
          type: 'bar',
          stack: stacked ? 'total' : undefined,
          barMaxWidth: 34,
          barGap: '12%',
          itemStyle: {
            borderRadius: stacked ? [0, 0, 0, 0] : [5, 5, 0, 0],
            color: model.series.length === 1
              ? { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: t.colors[0] },
                    { offset: 1, color: t.colors[1] },
                  ] }
              : undefined,
          },
          label: c.label
            ? { show: true, position: 'top', color: t.text2, fontFamily: t.font, fontSize: 10.5,
                formatter: (p) => compact(p.value) }
            : { show: false },
          emphasis: { focus: 'series' },
          data: s.values,
        })),
      };
    }

    /* ------------------------------ line / area -------------------------- */
    case 'line':
    case 'area': {
      return {
        ...opt,
        tooltip: tip(),
        xAxis: catAxis(t, model.xName, rot, model.categories),
        yAxis: valAxis(t, model.yName),
        series: model.series.map((s) => ({
          name: s.name,
          type: 'line',
          smooth: c.smooth ? 0.35 : false,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: model.categories.length <= 40,
          lineStyle: { width: 2.4 },
          areaStyle: type === 'area' ? { opacity: 0.16 } : undefined,
          label: c.label
            ? { show: true, position: 'top', color: t.text2, fontFamily: t.font, fontSize: 10.5,
                formatter: (p) => compact(p.value) }
            : { show: false },
          emphasis: { focus: 'series' },
          data: s.values,
        })),
      };
    }

    /* ------------------------------ scatter ------------------------------ */
    case 'scatter': {
      return {
        ...opt,
        tooltip: {
          ...opt.tooltip,
          trigger: 'item',
          formatter: (p) => `${p.seriesName}<br/><b>${model.xName}</b> ${fmtNum(p.value[0])}<br/><b>${model.yName}</b> ${fmtNum(p.value[1])}`,
        },
        // no axis names here — the card title already reads "<x> vs <y>"
        xAxis: { ...valAxis(t, ''), scale: true },
        yAxis: { ...valAxis(t, ''), scale: true },
        series: model.scatter.map((s) => ({
          name: s.name,
          type: 'scatter',
          symbolSize: 9,
          itemStyle: { opacity: 0.78, borderColor: t.surface, borderWidth: 1 },
          emphasis: { focus: 'series', itemStyle: { opacity: 1 } },
          data: s.points,
        })),
      };
    }

    /* ----------------------------- histogram ----------------------------- */
    case 'hist': {
      return {
        ...opt,
        tooltip: {
          ...opt.tooltip,
          formatter: (arr) => {
            const p = arr[0];
            return `${model.xName}<br/>${p.name}<br/><b>${fmtNum(p.value)}</b>`;
          },
        },
        xAxis: { ...catAxis(t, model.xName, 45, model.categories), boundaryGap: true },
        yAxis: valAxis(t, model.yName),
        series: [{
          name: model.series[0]?.name || 'count',
          type: 'bar',
          barCategoryGap: '6%',
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: t.colors[1] }, { offset: 1, color: t.colors[0] }] },
          },
          emphasis: { itemStyle: { color: t.colors[5] } },
          data: model.series[0]?.values || [],
        }],
      };
    }

    /* ------------------------------- boxplot ----------------------------- */
    case 'box': {
      return {
        ...opt,
        tooltip: { ...opt.tooltip, trigger: 'item' },
        xAxis: catAxis(t, model.xName, rot, model.categories),
        yAxis: { ...valAxis(t, model.yName), scale: true },
        series: [{
          name: model.yName,
          type: 'boxplot',
          boxWidth: ['22%', '48%'],
          itemStyle: { color: t.colors[0], borderColor: t.colors[1], borderWidth: 1.6 },
          emphasis: { itemStyle: { borderColor: t.colors[4], shadowBlur: 8, shadowColor: 'rgba(0,0,0,.15)' } },
          data: model.box.map((b) => b.stats),
        }],
      };
    }

    /* --------------------------------- pie ------------------------------- */
    case 'pie': {
      const vals = model.series[0]?.values || [];
      return {
        ...opt,
        legend: { ...opt.legend, type: 'scroll', orient: 'vertical', right: 8, top: 'middle', left: 'auto', bottom: 'auto' },
        tooltip: {
          ...opt.tooltip, trigger: 'item',
          formatter: (p) => `${p.name}<br/><b>${fmtNum(p.value)}</b> · ${p.percent}%`,
        },
        series: [{
          name: model.series[0]?.name || 'value',
          type: 'pie',
          radius: ['42%', '72%'],
          center: ['38%', '54%'],
          avoidLabelOverlap: true,
          padAngle: 1.4,
          itemStyle: { borderRadius: 6, borderColor: t.surface, borderWidth: 2 },
          label: {
            show: true, color: t.text2, fontFamily: t.font, fontSize: 11,
            formatter: '{b}\n{d}%',
          },
          labelLine: { length: 10, length2: 8, lineStyle: { color: t.border } },
          emphasis: {
            scale: true, scaleSize: 6,
            itemStyle: { shadowBlur: 14, shadowColor: 'rgba(16,24,40,.24)' },
            label: { fontSize: 12, fontWeight: 600, color: t.text },
          },
          data: model.categories.map((n, i) => ({ name: n, value: vals[i] })),
        }],
      };
    }

    /* ---------------------------- correlation ---------------------------- */
    case 'heat': {
      const { cols, matrix } = model.corr;
      const flat = [];
      let min = 1, max = -1;
      for (let i = 0; i < cols.length; i++) {
        for (let j = 0; j < cols.length; j++) {
          const v = matrix[i][j];
          flat.push([j, i, v === null ? '-' : Number(v.toFixed(3))]);
          if (v !== null) { min = Math.min(min, v); max = Math.max(max, v); }
        }
      }
      return {
        ...opt,
        grid: { left: 8, right: 76, top: 30, bottom: 8, containLabel: true },
        tooltip: {
          ...opt.tooltip, trigger: 'item',
          formatter: (p) => `${cols[p.value[1]]} × ${cols[p.value[0]]}<br/><b>r = ${p.value[2]}</b>`,
        },
        xAxis: { type: 'category', data: cols, ...axisCommon(t), splitLine: { show: false },
          axisLabel: { color: t.text3, fontFamily: t.font, fontSize: 10.5, rotate: cols.length > 6 ? 38 : 0, hideOverlap: true } },
        yAxis: { type: 'category', data: cols, ...axisCommon(t), splitLine: { show: false },
          axisLabel: { color: t.text3, fontFamily: t.font, fontSize: 10.5 } },
        visualMap: {
          min: -1, max: 1, calculable: true, orient: 'vertical', right: 6, top: 'middle',
          itemWidth: 12, itemHeight: 130,
          textStyle: { color: t.text3, fontFamily: t.font, fontSize: 10 },
          inRange: { color: ['#3b82f6', '#93c5fd', '#f1f5f9', '#fca5a5', '#ef4444'] },
          formatter: (v) => Number(v).toFixed(1),
        },
        series: [{
          name: 'corr',
          type: 'heatmap',
          data: flat,
          label: {
            show: cols.length <= 10,
            color: t.text, fontFamily: t.font, fontSize: 10,
            formatter: (p) => (p.value[2] === '-' ? '' : p.value[2].toFixed(2)),
          },
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(16,24,40,.3)' } },
        }],
      };
    }

    default:
      return opt;
  }
}

/* ------------------------- standalone horizontal bar --------------------- */

export function horizontalBarOption(categories, values, { xName = '', formatter } = {}) {
  const t = theme();
  const label = (v) => (formatter ? formatter(v) : fmtNum(v));
  return {
    color: t.colors,
    textStyle: { fontFamily: t.font },
    animationDuration: 480,
    grid: { left: 4, right: 58, top: 10, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(99,102,241,.08)' } },
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 26px rgba(16,24,40,.16);border-radius:10px;',
      formatter: (arr) => `${arr[0].name}<br/><b>${label(arr[0].value)}</b>`,
    },
    xAxis: {
      type: 'value',
      name: xName,
      nameTextStyle: { color: t.text3, fontFamily: t.font, fontSize: 10.5 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.text3, fontFamily: t.font, fontSize: 10.5 },
      splitLine: { lineStyle: { color: t.border, type: 'dashed', opacity: 0.7 } },
    },
    yAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
      axisLabel: { color: t.text2, fontFamily: t.font, fontSize: 11, width: 110, overflow: 'truncate' },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 16,
      itemStyle: {
        borderRadius: [0, 5, 5, 0],
        color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [{ offset: 0, color: t.colors[0] }, { offset: 1, color: t.colors[1] }] },
      },
      label: {
        show: true, position: 'right',
        color: t.text3, fontFamily: t.font, fontSize: 10.5,
        formatter: (p) => label(p.value),
      },
      data: values,
    }],
  };
}

/* ------------------------------ lifecycle -------------------------------- */

const instances = new WeakMap();

export function renderChart(dom, option, { notMerge = true } = {}) {
  const ec = window.echarts;
  if (!ec) return null;
  let chart = instances.get(dom);
  if (!chart || chart.isDisposed?.()) {
    chart = ec.init(dom, null, { renderer: 'canvas' });
    instances.set(dom, chart);
  }
  chart.setOption(option, notMerge);
  return chart;
}

/** Dispose the instance bound to a container and empty it. */
export function clearChart(dom) {
  const c = instances.get(dom);
  if (c && !c.isDisposed?.()) c.dispose();
  instances.delete(dom);
  dom.innerHTML = '';
}

export function disposeAll() {
  const ec = window.echarts;
  if (!ec) return;
  document.querySelectorAll('.chart-box').forEach((el) => {
    const c = instances.get(el);
    if (c && !c.isDisposed?.()) c.dispose();
    instances.delete(el);
  });
}

export function resizeAll() {
  document.querySelectorAll('.chart-box').forEach((el) => {
    const c = instances.get(el);
    if (c && !c.isDisposed?.()) c.resize();
  });
}

export function downloadChartPng(dom, filename) {
  const c = instances.get(dom);
  if (!c) return false;
  const url = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: cssVar('--surface') });
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  return true;
}
