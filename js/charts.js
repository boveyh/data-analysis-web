/* =============================================================================
 * charts.js — ECharts renderers, one per chart type.
 *
 * ECharts ships with the repo (js/vendor/echarts.min.js) and is loaded from
 * disk first. The mirrors below are a fallback for a deployment that forgot to
 * copy that file. See loadECharts for why a naive fallback chain was not enough.
 * ========================================================================== */

/* The copy that travels with the repo, resolved against the document. */
const LOCAL = 'js/vendor/echarts.min.js';

/* Fallback mirrors.
 *
 * Note the pinned versions: bootcdn has no 5.5.1 (a 404), so it is pinned to
 * 5.5.0. The API surface used here is identical across those two releases.
 */
const CDNS = [
  'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
  'https://unpkg.com/echarts@5.5.1/dist/echarts.min.js',
  'https://cdn.bootcdn.net/ajax/libs/echarts/5.5.0/echarts.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.1/echarts.min.js',
];

/** No deadline. See the note in loadECharts for why. */
let libPromise = null;

/** Resolve `window.echarts` from the bundled copy, or a mirror as a fallback. */
export function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (libPromise) return libPromise;

  libPromise = new Promise((resolve) => {
    let settled = false;
    let poll = null;
    let lib = null;
    const tags = [];

    /* First writer wins; every later writer is ignored, silently.
     *
     * The mirrors go in as <script> tags, so they execute in whatever order
     * their downloads finish. Detaching the losers in `win()` aborts the ones
     * still in flight, but a loser that has already entered the execution queue
     * runs to completion — and its UMD wrapper does `window.echarts = {}` all
     * over again, swapping the instance registry out from under charts that
     * were already created against the winner. That is what made
     * `getInstanceByDom` return undefined for a canvas that visibly existed.
     *
     * An accessor with a guarded setter makes the late assignment a no-op. The
     * loser's `factory(newObject)` still runs and still receives a fresh object
     * — it just never becomes the global, so nothing observable changes. */
    try {
      Object.defineProperty(window, 'echarts', {
        configurable: true,
        get: () => lib,
        set: (v) => { if (!lib) lib = v; },
      });
    } catch { /* an exotic host may refuse; the rest of the chain still helps */ }

    const win = () => {
      if (settled || !lib) return;
      settled = true;
      if (poll) clearInterval(poll);
      /* detaching a <script> mid-flight aborts its download in every engine
         that matters, so the losing mirrors stop costing bandwidth */
      for (const tag of tags) tag.remove();
      resolve(lib);
    };

    /** Phase two — only reached if the bundled copy produced nothing. */
    let racing = false;
    const raceMirrors = () => {
      if (racing) return;
      racing = true;
      /* `onload` fires even for a mirror that served an error page — as
         lib.baomitu.com did, returning the literal text "404: Not Found" with a
         200 status. So the only trustworthy signal is whether a global actually
         appeared, which the guarded setter above has already decided.
         Mirrors are raced rather than queued: a mirror that is throttled rather
         than dead never errors, and on the machine this was written on
         jsDelivr delivered 96 KB of the bundle in 25 s. Sequential fallback
         would wait on it indefinitely while healthy mirrors sat untried. */
      for (const src of CDNS) {
        const tag = document.createElement('script');
        tag.src = src;
        tag.async = true;
        tag.onload = () => win();
        tag.onerror = () => {};
        tags.push(tag);
        document.head.appendChild(tag);
      }
      /* Belt and braces for the global appearing without an event we can see. */
      poll = setInterval(() => win(), 200);
    };

    /* Phase one — the bundled copy.
     *
     * Loading it from disk removes the network from the critical path
     * entirely, and with it every failure mode this file has had to defend
     * against: a throttled mirror taking 17 s, a 404 dressed up as HTTP 200, a
     * captive portal rewriting responses. Measured here, the local copy
     * resolves in milliseconds against 3.4–17 s for the same bytes over the
     * wire. The trade is ~1 MB in the repo, which is nothing for a static site
     * and buys an instant, offline-capable first paint. */
    const local = document.createElement('script');
    local.src = LOCAL;
    local.async = false;
    local.onload = () => { if (lib) win(); else raceMirrors(); };
    local.onerror = () => raceMirrors();
    tags.push(local);
    document.head.appendChild(local);

    /* A file that hangs is not a file that failed: without this the URL would
       have to be reset or the request killed before anything fired, and the
       loader would wait forever on its own bundled asset. Cheap to guard,
       since the local copy normally lands in milliseconds. */
    setTimeout(() => { if (!settled && !lib) raceMirrors(); }, 3000);
  });

  return libPromise;
}

/* ------------------------------ theming ---------------------------------- */

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function palette() {
  return ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--c9', '--c10'].map(cssVar);
}

/* Okabe & Ito's palette — distinguishable under deuteranopia, protanopia and
   tritanopia. Swapped in wholesale when the reader turns on colour-blind mode. */
const OKABE_ITO = [
  '#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9',
  '#D55E00', '#F0E442', '#8C564B', '#117733', '#332288',
];

let cbSafe = false;
export function setColorblindSafe(on) { cbSafe = !!on; }
export function isColorblindSafe() { return cbSafe; }

/** Sequential/diverging ramp for correlation. RdBu-style blue↔red is the
 *  classic trap for red-green colour blindness; blue↔orange is not. */
export function divergingRamp() {
  return cbSafe
    ? ['#1c5f9e', '#7fb2da', '#f2f2f2', '#f2a65a', '#c25203']
    : ['#3b82f6', '#93c5fd', '#f1f5f9', '#fca5a5', '#ef4444'];
}

function theme() {
  return {
    text: cssVar('--text') || '#14161d',
    text2: cssVar('--text-2') || '#575e6b',
    text3: cssVar('--text-3') || '#8b92a1',
    border: cssVar('--border') || '#e6e8ec',
    surface: cssVar('--surface') || '#fff',
    surface3: cssVar('--surface-3') || '#f1f3f6',
    font: cssVar('--font-sans') || 'sans-serif',
    colors: cbSafe ? OKABE_ITO : palette(),
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
      const scatterSeries = model.scatter.map((s) => ({
        name: s.name,
        type: 'scatter',
        symbolSize: 9,
        itemStyle: { opacity: 0.78, borderColor: t.surface, borderWidth: 1 },
        emphasis: { focus: 'series', itemStyle: { opacity: 1 } },
        data: s.points,
      }));

      /* Least-squares line, when the caller supplied a fit. Drawn last so it
         sits on top of the cloud; silent so it never swallows a hover. */
      if (model.fit) {
        const { slope, intercept, xRange } = model.fit;
        const [x0, x1] = xRange;
        scatterSeries.push({
          name: model.fitLabel || 'fit',
          type: 'line',
          silent: true,
          symbol: 'none',
          z: 5,
          data: [[x0, slope * x0 + intercept], [x1, slope * x1 + intercept]],
          lineStyle: { width: 2.2, type: 'dashed', color: t.text2 },
          itemStyle: { color: t.text2 },
          tooltip: { show: false },
          emphasis: { disabled: true },
        });
      }

      return {
        ...opt,
        tooltip: {
          ...opt.tooltip,
          trigger: 'item',
          formatter: (p) => (p.seriesType === 'line'
            ? `${p.seriesName}<br/><b>${fmtNum(p.value[0])} → ${fmtNum(p.value[1])}</b>`
            : `${p.seriesName}<br/><b>${model.xName}</b> ${fmtNum(p.value[0])}<br/><b>${model.yName}</b> ${fmtNum(p.value[1])}`),
        },
        // no axis names here — the card title already reads "<x> vs <y>"
        xAxis: { ...valAxis(t, ''), scale: true },
        yAxis: { ...valAxis(t, ''), scale: true },
        series: scatterSeries,
      };
    }

    /* ------------------------------ normal QQ ---------------------------- */
    case 'qq': {
      const { points, slope, intercept } = model.qq;
      const theoretical = points.map((p) => p[0]);
      const lo = Math.min(...theoretical), hi = Math.max(...theoretical);
      return {
        ...opt,
        tooltip: {
          ...opt.tooltip,
          trigger: 'item',
          formatter: (p) => (p.seriesType === 'line'
            ? `${p.seriesName}`
            : `${model.labels.theoretical} ${fmtNum(p.value[0], 3)}<br/>${model.labels.sample} ${fmtNum(p.value[1], 3)}`),
        },
        xAxis: { ...valAxis(t, model.labels.theoretical), scale: true },
        yAxis: { ...valAxis(t, model.labels.sample), scale: true },
        legend: { show: false },
        series: [
          {
            name: model.labels.points,
            type: 'scatter',
            symbolSize: 8,
            itemStyle: { opacity: 0.8, borderColor: t.surface, borderWidth: 1 },
            emphasis: { itemStyle: { opacity: 1 } },
            data: points,
          },
          {
            name: model.labels.reference,
            type: 'line',
            silent: true,
            symbol: 'none',
            z: 5,
            data: [[lo, slope * lo + intercept], [hi, slope * hi + intercept]],
            lineStyle: { width: 2, type: 'dashed', color: t.text2 },
            itemStyle: { color: t.text2 },
          },
        ],
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

    /* -------------------- heatmap: correlation or pivot ------------------- */
    case 'heat': {
      /* Two shapes land here: the correlation matrix (model.corr, always
         −1..1 and diverging) and a generic pivot (model.pivot, whose range
         comes from the data). Everything downstream of the numbers is shared. */
      const pv = model.pivot || null;
      const xKeys = pv ? pv.colKeys : model.corr.cols;
      const yKeys = pv ? pv.rowKeys : model.corr.cols;
      const cellAt = pv
        ? (i, j) => pv.grid[i][j]
        : (i, j) => model.corr.matrix[i][j];

      const flat = [];
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < yKeys.length; i++) {
        for (let j = 0; j < xKeys.length; j++) {
          const v = cellAt(i, j);
          if (v === null || v === undefined || Number.isNaN(Number(v))) {
            flat.push([j, i, '-']);
            continue;
          }
          const num = Number(v);
          flat.push([j, i, Number(num.toFixed(3))]);
          if (num < lo) lo = num;
          if (num > hi) hi = num;
        }
      }
      if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
      if (lo === hi) { lo -= 1; hi += 1; }

      // correlation always keeps its natural −1..1 frame
      const vmin = pv ? lo : -1;
      const vmax = pv ? hi : 1;
      const label = pv ? `${pv.value} · ${pv.agg}` : 'r';

      return {
        ...opt,
        grid: { left: 8, right: 76, top: 30, bottom: 8, containLabel: true },
        legend: { show: false },
        tooltip: {
          ...opt.tooltip, trigger: 'item',
          formatter: (p) => (p.value[2] === '-'
            ? `${yKeys[p.value[1]]} × ${xKeys[p.value[0]]}<br/><i>—</i>`
            : `${yKeys[p.value[1]]} × ${xKeys[p.value[0]]}<br/><b>${label} = ${p.value[2]}</b>`),
        },
        xAxis: { type: 'category', data: xKeys, ...axisCommon(t), splitLine: { show: false },
          axisLabel: { color: t.text3, fontFamily: t.font, fontSize: 10.5, rotate: xKeys.length > 6 ? 38 : 0, hideOverlap: true } },
        yAxis: { type: 'category', data: yKeys, ...axisCommon(t), splitLine: { show: false },
          axisLabel: { color: t.text3, fontFamily: t.font, fontSize: 10.5, hideOverlap: true } },
        visualMap: {
          min: vmin, max: vmax, calculable: true, orient: 'vertical', right: 6, top: 'middle',
          itemWidth: 12, itemHeight: 130,
          textStyle: { color: t.text3, fontFamily: t.font, fontSize: 10 },
          inRange: { color: divergingRamp() },
          formatter: (v) => Number(v).toFixed(vmax >= 1000 ? 0 : 1),
        },
        series: [{
          name: pv ? pv.value : 'corr',
          type: 'heatmap',
          data: flat,
          label: {
            show: xKeys.length <= 10 && yKeys.length <= 14,
            color: t.text, fontFamily: t.font, fontSize: 10,
            formatter: (p) => (p.value[2] === '-' ? '' : Number(p.value[2]).toFixed(vmax >= 100 ? 0 : 2)),
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

/* --------------------------- missingness map ----------------------------- */

/**
 * Missingno-style nullity matrix: one mark per (row, column) cell, columns
 * ordered worst-first and annotated with their missing rate. Reading the
 * pattern — isolated holes vs whole blocks — is what tells you whether a gap
 * is random or structural, which a headcount alone never shows.
 *
 * @param {object} model { matrix, labels }
 */
export function missingnessOption(model, t = theme()) {
  const { cols, rates, grid, sampled, total } = model.matrix;
  const rows = grid.length;
  const missingColor = cbSafe ? '#0072B2' : '#D55E00';
  const presentColor = t.surface3;

  const data = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols.length; c++) data.push([c, r, grid[r][c] ? 1 : 0]);
  }

  const rot = cols.length > 8 ? 42 : (cols.length > 5 ? 24 : 0);

  return {
    color: t.colors,
    textStyle: { fontFamily: t.font, color: t.text2 },
    animationDuration: 400,
    animation: false,
    grid: { left: 12, right: 14, top: 12, bottom: 58, containLabel: true },
    tooltip: {
      trigger: 'item',
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [9, 12],
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 26px rgba(16,24,40,.16);border-radius:10px;',
      formatter: (p) => {
        const [c, r, v] = p.value;
        return `<b>${cols[c]}</b> · ${(rates[c] * 100).toFixed(1)}% ${model.labels.missing}<br/>` +
          `${model.labels.row} ${r + 1}${v ? ' — ' + model.labels.isMissing : ''}`;
      },
    },
    xAxis: {
      type: 'category',
      data: cols.map((c, i) => `${c}\n${(rates[i] * 100).toFixed(0)}%`),
      ...axisCommon(t),
      splitLine: { show: false },
      axisLabel: {
        color: t.text3, fontFamily: t.font, fontSize: 10.5,
        rotate: rot, interval: 0, hideOverlap: false, lineHeight: 13,
      },
    },
    yAxis: {
      type: 'category',
      data: Array.from({ length: rows }, (_, i) => String(i)),
      inverse: true,
      ...axisCommon(t),
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    visualMap: {
      type: 'piecewise',
      show: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 14,
      itemHeight: 11,
      itemGap: 14,
      textStyle: { color: t.text3, fontFamily: t.font, fontSize: 11 },
      pieces: [
        { value: 0, label: model.labels.present, color: presentColor },
        { value: 1, label: model.labels.missing, color: missingColor },
      ],
    },
    series: [{
      type: 'heatmap',
      data,
      itemStyle: { borderWidth: 0, borderRadius: 0 },
      emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1.4 } },
      progressive: 6000,
      progressiveThreshold: 6000,
    }],
  };
}

/* --------------------------- parallel coordinates ------------------------ */

/**
 * Parallel coordinates — every row becomes a polyline crossing all numeric
 * axes. The fastest way to spot whether clusters separate on some combination
 * of dimensions, which a scatter matrix only shows two at a time.
 *
 * @param {object} model { dims: [{name,min,max}], groups: [{name,color,rows}] }
 */
export function parallelOption(model, cfg = {}, t = theme()) {
  const c = { smooth: false, opacity: 0.45, ...cfg };
  const k = model.dims.length;

  return {
    color: t.colors,
    textStyle: { fontFamily: t.font, color: t.text2 },
    animationDuration: 520,
    parallel: {
      left: 56,
      right: 56,
      top: 58,
      bottom: 26,
      parallelAxisDefault: {
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { lineStyle: { color: t.border } },
        axisLabel: { color: t.text3, fontFamily: t.font, fontSize: 10.5 },
        nameTextStyle: { color: t.text2, fontFamily: t.font, fontSize: 11 },
        nameGap: 12,
        nameLocation: 'start',
        nameRotate: 0,
      },
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [9, 12],
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 26px rgba(16,24,40,.16);border-radius:10px;',
      formatter: (p) => {
        const lines = model.dims.map((d, i) => `${d.name} <b>${fmtNum(p.value[i])}</b>`);
        return `${p.seriesName ? `<b>${p.seriesName}</b><br/>` : ''}${lines.join('<br/>')}`;
      },
    },
    parallelAxis: model.dims.map((d, i) => ({
      dim: i,
      name: d.name,
      min: d.min === d.max ? d.min - 0.5 : d.min,
      max: d.min === d.max ? d.max + 0.5 : d.max,
      type: 'value',
    })),
    series: model.groups.map((g) => ({
      name: g.name,
      type: 'parallel',
      smooth: c.smooth ? 0.3 : false,
      lineStyle: { width: k > 6 ? 1.2 : 1.8, opacity: c.opacity, color: g.color },
      emphasis: { lineStyle: { width: 3.2, opacity: 1 } },
      data: g.rows,
    })),
  };
}

/* ---------------------------- scatter matrix ----------------------------- */

/**
 * Scatter-plot matrix (SPLOM): every pair of numeric variables in one figure.
 * Built from k×k ECharts grids — labels only on the outer edges, variable
 * names on the diagonal.
 */
export function splomOption(model, t = theme()) {
  const vars = model.variables;
  const k = vars.length;
  const gap = 0.6;
  /* The outside margins are reserved for the two label edges a scatter matrix
   * keeps: tick labels down the left column and along the bottom row. With
   * `containLabel: false` the labels are drawn outside the grid, so the grid
   * must stop short of the canvas or the last row gets clipped. */
  const M = { left: 8, right: 1, top: 4, bottom: 8 };
  const spanW = (100 - M.left - M.right) / k;
  const spanH = (100 - M.top - M.bottom) / k;

  const grids = [], xAxes = [], yAxes = [], series = [], titles = [], pairs = [];

  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      const left = M.left + c * spanW;
      const top = M.top + r * spanH;

      if (r === c) {
        titles.push({
          text: vars[r],
          left: `${left + spanW / 2}%`,
          top: `${top + spanH / 2}%`,
          textAlign: 'center',
          textVerticalAlign: 'middle',
          textStyle: { color: t.text2, fontFamily: t.font, fontSize: 11.5, fontWeight: 500 },
        });
        continue;
      }

      // grid indices are dense: diagonal cells contribute a label, not a plot
      const gi = grids.length;
      grids.push({
        left: `${left}%`,
        top: `${top}%`,
        width: `${spanW - gap}%`,
        height: `${spanH - gap}%`,
        containLabel: false,
      });
      xAxes.push({
        type: 'value', gridIndex: gi, scale: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: r === k - 1, color: t.text3, fontFamily: t.font, fontSize: 9.5, hideOverlap: true },
        splitLine: { lineStyle: { color: t.border, type: 'dashed', opacity: 0.5 } },
      });
      yAxes.push({
        type: 'value', gridIndex: gi, scale: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: c === 0, color: t.text3, fontFamily: t.font, fontSize: 9.5, hideOverlap: true },
        splitLine: { lineStyle: { color: t.border, type: 'dashed', opacity: 0.5 } },
      });
      pairs.push([c, r]);                       // x = column var, y = row var
      series.push({
        type: 'scatter', xAxisIndex: gi, yAxisIndex: gi,
        symbolSize: k > 3 ? 3.4 : 4.6,
        itemStyle: { opacity: 0.5, borderWidth: 0, color: t.colors[0] },
        emphasis: { itemStyle: { opacity: 1 } },
        data: model.cells[`${r},${c}`] || [],
      });
    }
  }

  return {
    color: t.colors,
    textStyle: { fontFamily: t.font, color: t.text2 },
    animationDuration: 420,
    title: titles,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: 'item',
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [9, 12],
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 26px rgba(16,24,40,.16);border-radius:10px;',
      formatter: (p) => {
        const [xi, yi] = pairs[p.seriesIndex] || [0, 0];
        return `${vars[xi]} <b>${fmtNum(p.value[0])}</b><br/>${vars[yi]} <b>${fmtNum(p.value[1])}</b>`;
      },
    },
    series,
  };
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

/**
 * Attach (or replace) the click handler on a chart. Always clears the previous
 * binding first — re-rendering must not stack listeners.
 */
export function bindChartClick(dom, handler) {
  const c = instances.get(dom);
  if (!c || c.isDisposed?.()) return;
  c.off('click');
  if (handler) c.on('click', handler);
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

/**
 * The current chart as a PNG data URL, or null if it cannot be captured.
 *
 * Split out from `downloadChartPng` so the HTML report can embed the same
 * pixels without triggering a second download.
 *
 * A hidden panel has no layout box, so ECharts' canvas is 0x0 and
 * `getDataURL` returns the degenerate string `"data:,"` instead of throwing —
 * meaning a report exported from the Table tab would silently lose its chart.
 * When that happens the instance is temporarily given a real canvas size,
 * captured, and resized back, so the capture no longer depends on which tab
 * the user happens to be looking at.
 */
export function chartPngUrl(dom, { width = 1200, height = 640 } = {}) {
  if (!dom) return null;
  const c = instances.get(dom);
  if (!c) return null;
  if (c.isDisposed?.()) return null;

  const collapsed = !dom.clientWidth || !dom.clientHeight;
  try {
    if (collapsed) c.resize({ width, height, silent: true });
    const url = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: cssVar('--surface') });
    if (collapsed) c.resize({ silent: true });
    /* Validate the payload, not just the prefix: a blank canvas yields
       "data:," which starts with nothing useful and is only 6 characters. */
    return url && url.startsWith('data:image') && url.length > 512 ? url : null;
  } catch {
    if (collapsed) { try { c.resize({ silent: true }); } catch { /* nothing to restore */ } }
    return null;
  }
}

/**
 * Save a rendered chart as a PNG.
 *
 * Returns a result object rather than a bare boolean: the old `false` return
 * was swallowed by an `if (...) toast(...)`, so a chart that had not finished
 * rendering made the button look broken with no explanation.
 */
export function downloadChartPng(dom, filename) {
  if (!dom) return { ok: false, reason: 'no-chart' };
  const c = instances.get(dom);
  if (!c) return { ok: false, reason: 'not-ready' };
  if (c.isDisposed?.()) return { ok: false, reason: 'disposed' };

  const url = chartPngUrl(dom);
  if (url === null) return { ok: false, reason: 'empty' };

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { ok: true, bytes: url.length };
}

/** True when a chart box currently has a live ECharts instance attached. */
export function hasChartInstance(dom) { return !!dom && instances.has(dom); }

/**
 * A text alternative for a chart. ECharts paints to a canvas, which assistive
 * technology cannot read at all; this flattens the same option into a table a
 * screen reader can walk. Capped, so a 10k-point scatter does not become a
 * novel — the point is the shape, not every value.
 */
export function describeOption(option, { maxSeries = 8, maxPoints = 40 } = {}) {
  const out = { seriesCount: 0, pointCount: 0, headers: [], rows: [], truncated: false };
  if (!option || !Array.isArray(option.series)) return out;

  const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  const cats = xAxis?.data || [];
  out.headers = ['series', 'x', 'y'];
  out.seriesCount = option.series.length;

  for (const s of option.series.slice(0, maxSeries)) {
    const data = Array.isArray(s.data) ? s.data : [];
    if (s.type === 'boxplot') continue;           // five-number summary, not x/y
    out.pointCount += data.length;

    for (let i = 0; i < Math.min(data.length, maxPoints); i++) {
      const d = data[i];
      let x, y;
      if (Array.isArray(d)) { x = fmtNum(d[0]); y = fmtNum(d[1]); }
      else if (d && typeof d === 'object') { x = d.name ?? cats[i] ?? String(i + 1); y = fmtNum(d.value); }
      else { x = cats[i] ?? String(i + 1); y = fmtNum(d); }
      out.rows.push([s.name || '', String(x), String(y)]);
    }
    if (data.length > maxPoints) out.truncated = true;
  }
  if (option.series.length > maxSeries) out.truncated = true;
  return out;
}
