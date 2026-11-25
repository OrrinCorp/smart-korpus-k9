/* Прості SVG-графіки без зовнішніх бібліотек: лінійний (з перехрестям і
 * підказкою) та стовпчиковий (згрупований). Кольори — через CSS-змінні,
 * тому працюють у світлій і темній темі. */
SK.charts = (function () {
  var U = SK.util, NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  /* series: [{name, values:[{x,y}], cls:'s1'|'s2', dashed}] ; opts: {xFmt, yFmt, unit, xMax} */
  function line(container, series, opts) {
    opts = opts || {};
    container.innerHTML = '';
    container.classList.add('chart');
    var W = container.clientWidth || 520, H = opts.height || 220, m = { l: 44, r: 12, t: 12, b: 26 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', 'aria-label': opts.label || 'Графік' }, container);
    var xs = [], ymax = 0;
    series.forEach(function (s) { s.values.forEach(function (p) { xs.push(p.x); ymax = Math.max(ymax, p.y); }); });
    var x0 = opts.xMin != null ? opts.xMin : Math.min.apply(null, xs), x1 = opts.xMax != null ? opts.xMax : Math.max.apply(null, xs);
    ymax = niceMax(ymax * 1.08);
    var X = function (v) { return m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r); };
    var Y = function (v) { return H - m.b - v / ymax * (H - m.t - m.b); };
    for (var i = 0; i <= 4; i++) {
      var yv = ymax * i / 4;
      el('line', { x1: m.l, x2: W - m.r, y1: Y(yv), y2: Y(yv), 'class': 'grid' }, svg);
      el('text', { x: m.l - 6, y: Y(yv) + 4, 'text-anchor': 'end', 'class': 'axis' }, svg).textContent = U.fmt(yv, yv < 10 && ymax < 10 ? 1 : 0);
    }
    (opts.xTicks || []).forEach(function (t) {
      el('text', { x: X(t), y: H - 8, 'text-anchor': 'middle', 'class': 'axis' }, svg).textContent = opts.xFmt ? opts.xFmt(t) : t;
    });
    if (opts.threshold) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(opts.threshold), y2: Y(opts.threshold), 'class': 'threshold' }, svg);
      el('text', { x: W - m.r - 4, y: Y(opts.threshold) - 4, 'text-anchor': 'end', 'class': 'axis' }, svg).textContent = 'поріг ' + opts.threshold;
    }
    series.forEach(function (s) {
      if (!s.values.length) return;
      var d = s.values.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ');
      el('path', { d: d, 'class': 'series ' + s.cls + (s.dashed ? ' dashed' : '') }, svg);
    });
    /* Перехрестя + підказка */
    var cross = el('line', { y1: m.t, y2: H - m.b, 'class': 'cross', visibility: 'hidden' }, svg);
    var dots = series.map(function (s) { return el('circle', { r: 4, 'class': 'dot ' + s.cls, visibility: 'hidden' }, svg); });
    var tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; container.appendChild(tip);
    var hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', function (e) {
      var rect = svg.getBoundingClientRect();
      var px = (e.clientX - rect.left) * W / rect.width;
      var xv = x0 + (px - m.l) / (W - m.l - m.r) * (x1 - x0);
      var rows = [], cx = null;
      series.forEach(function (s, k) {
        var best = null;
        s.values.forEach(function (p) { if (!best || Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p; });
        if (!best) { dots[k].setAttribute('visibility', 'hidden'); return; }
        cx = X(best.x);
        dots[k].setAttribute('cx', X(best.x)); dots[k].setAttribute('cy', Y(best.y)); dots[k].setAttribute('visibility', 'visible');
        rows.push('<span class="sw ' + s.cls + (s.dashed ? ' dashed' : '') + '"></span>' + U.esc(s.name) + ': <b>' + U.fmt(best.y, 1) + ' ' + (opts.unit || '') + '</b>');
        if (k === 0) rows.unshift('<b>' + (opts.xFmt ? opts.xFmt(best.x) : best.x) + '</b>');
      });
      if (cx == null) return;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = rows.join('<br>'); tip.hidden = false;
      var left = (cx / W) * rect.width;
      tip.style.left = Math.min(left + 12, rect.width - 170) + 'px'; tip.style.top = '8px';
    });
    hit.addEventListener('pointerleave', function () {
      tip.hidden = true; cross.setAttribute('visibility', 'hidden');
      dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
    });
    legend(container, series);
  }

  /* Шаровий (stacked area) графік потужності з позначкою піку.
     points: [{t (хв), total, layers:{id:Вт}}]; layers: [{id, name, short, css}] (знизу вгору);
     opts: {xMax, now (хв, необов'язково), threshold (кВт), unit, label, height, peakText} */
  function stack(container, points, layers, opts) {
    opts = opts || {};
    container.innerHTML = '';
    container.classList.add('chart', 'stack-chart');
    var W = container.clientWidth || 410, H = opts.height || 240, m = { l: 40, r: 10, t: 26, b: 24 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', 'aria-label': opts.label || 'Графік потужності' }, container);
    var k = opts.scale || 1000;                       // Вт → кВт
    var used = layers.filter(function (L) { return points.some(function (p) { return p.layers[L.id] > 0; }); });
    var pk = null; points.forEach(function (p) { if (!pk || p.total > pk.total) pk = p; });
    var ymax = niceMax(Math.max((pk ? pk.total : 0) / k, opts.threshold || 0) * 1.1 || 1);
    var x1 = opts.xMax || 1440;
    var X = function (v) { return m.l + v / x1 * (W - m.l - m.r); };
    var Y = function (v) { return H - m.b - v / ymax * (H - m.t - m.b); };
    for (var i = 0; i <= 4; i++) {
      var yv = ymax * i / 4;
      el('line', { x1: m.l, x2: W - m.r, y1: Y(yv), y2: Y(yv), 'class': 'grid' }, svg);
      el('text', { x: m.l - 6, y: Y(yv) + 4, 'text-anchor': 'end', 'class': 'axis' }, svg).textContent = U.fmt(yv, ymax < 10 ? 1 : 0);
    }
    [0, 360, 720, 1080, 1440].forEach(function (t) {
      el('text', { x: X(t), y: H - 7, 'text-anchor': t === 0 ? 'start' : t === 1440 ? 'end' : 'middle', 'class': 'axis' }, svg).textContent = U.minToHHMM(t % 1440 === 0 && t ? 1439 : t).replace('23:59', '24:00');
    });
    el('text', { x: m.l - 6, y: 12, 'text-anchor': 'end', 'class': 'axis' }, svg).textContent = opts.unit || 'кВт';
    /* Шари */
    if (points.length) {
      var base = points.map(function () { return 0; }), step = points.length > 1 ? points[1].t - points[0].t : 5;
      used.forEach(function (L) {
        var top = points.map(function (p, j) { return base[j] + (p.layers[L.id] || 0) / k; });
        var d = 'M' + X(points[0].t).toFixed(1) + ' ' + Y(base[0]).toFixed(1);
        points.forEach(function (p, j) { d += 'L' + X(p.t).toFixed(1) + ' ' + Y(top[j]).toFixed(1) + 'L' + X(p.t + step).toFixed(1) + ' ' + Y(top[j]).toFixed(1); });
        for (var j = points.length - 1; j >= 0; j--) d += 'L' + X(points[j].t + step).toFixed(1) + ' ' + Y(base[j]).toFixed(1) + 'L' + X(points[j].t).toFixed(1) + ' ' + Y(base[j]).toFixed(1);
        el('path', { d: d + 'Z', fill: L.css, 'fill-opacity': '.85', stroke: 'none' }, svg);
        base = top;
      });
      var tl = points.map(function (p, j) { return (j ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.total / k).toFixed(1) + 'L' + X(p.t + step).toFixed(1) + ' ' + Y(p.total / k).toFixed(1); }).join('');
      el('path', { d: tl, fill: 'none', stroke: 'var(--fg)', 'stroke-width': 1.2, 'stroke-opacity': '.65' }, svg);
    }
    if (opts.threshold) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(opts.threshold), y2: Y(opts.threshold), 'class': 'threshold' }, svg);
      el('text', { x: W - m.r - 2, y: Y(opts.threshold) - 4, 'text-anchor': 'end', 'class': 'axis' }, svg).textContent = 'поріг ' + opts.threshold;
    }
    if (opts.now != null) {
      el('line', { x1: X(opts.now), x2: X(opts.now), y1: m.t - 4, y2: H - m.b, stroke: 'var(--accent)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
      el('text', { x: X(opts.now) + 3, y: H - m.b - 4, 'class': 'axis', fill: 'var(--accent)' }, svg).textContent = 'зараз';
    }
    /* Пік: вертикальна позначка + підпис */
    var mn = null; points.forEach(function (p) { if (mn == null || p.total < mn) mn = p.total; });
    var flat = pk && (pk.total - mn) <= Math.max(0.01, pk.total * 0.02);     // постійне споживання — пік не позначаємо
    if (pk && pk.total > 0 && !flat) {
      var px = X(pk.t + (points.length > 1 ? (points[1].t - points[0].t) / 2 : 0)), py = Y(pk.total / k);
      el('line', { x1: px, x2: px, y1: py, y2: H - m.b, stroke: 'var(--bad)', 'stroke-width': 1.5 }, svg);
      el('circle', { cx: px, cy: py, r: 5, fill: 'var(--bad)', stroke: 'var(--panel)', 'stroke-width': 2 }, svg);
      var txt = opts.peakText || ('пік ' + U.fmt(pk.total / k, 1) + ' ' + (opts.unit || 'кВт') + ' о ' + U.minToHHMM(pk.t));
      var tx = Math.max(m.l + 2, Math.min(W - m.r - 2, px)), anchor = px > W * 0.7 ? 'end' : px < W * 0.3 ? 'start' : 'middle';
      var lbl = el('text', { x: tx, y: Math.max(12, py - 9), 'text-anchor': anchor, 'class': 'peak-label' }, svg); lbl.textContent = txt;
    }
    /* Наведення: значення шарів у точці */
    var cross = el('line', { y1: m.t, y2: H - m.b, 'class': 'cross', visibility: 'hidden' }, svg);
    var tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; container.appendChild(tip);
    var hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', function (e) {
      if (!points.length) return;
      var rect = svg.getBoundingClientRect(), px2 = (e.clientX - rect.left) * W / rect.width;
      var tv = (px2 - m.l) / (W - m.l - m.r) * x1, best = null;
      points.forEach(function (p) { if (p.t <= tv && (!best || p.t > best.t)) best = p; });
      if (!best) best = points[0];
      var cx = X(best.t); cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      var stp = points.length > 1 ? points[1].t - points[0].t : 5;
      tip.innerHTML = '<b>' + U.minToHHMM(best.t) + '–' + U.minToHHMM(best.t + stp) + ' · ' + U.fmt(best.total / k, 2) + ' ' + (opts.unit || 'кВт') + '</b>' +
        used.slice().reverse().map(function (L) { var v = best.layers[L.id] || 0; return v ? '<br><span class="sw" style="background:' + L.css + '"></span>' + U.esc(L.short || L.name) + ': ' + U.fmt(v / k, v / k < 1 ? 2 : 1) : ''; }).join('');
      tip.hidden = false;
      var left = (cx / W) * rect.width;
      tip.style.left = Math.min(left + 12, rect.width - 190) + 'px'; tip.style.top = '24px';
    });
    hit.addEventListener('pointerleave', function () { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    return pk;
  }

  /* groups: [{label, values:[v1, v2]}], names: ['...','...'] */
  function bars(container, groups, names, opts) {
    opts = opts || {};
    container.innerHTML = '';
    container.classList.add('chart');
    var W = container.clientWidth || 520, H = opts.height || 200, m = { l: 44, r: 12, t: 12, b: 26 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', 'aria-label': opts.label || 'Діаграма' }, container);
    var ymax = 0; groups.forEach(function (g) { g.values.forEach(function (v) { ymax = Math.max(ymax, v); }); });
    ymax = niceMax(ymax * 1.08);
    var Y = function (v) { return H - m.b - v / ymax * (H - m.t - m.b); };
    for (var i = 0; i <= 4; i++) {
      var yv = ymax * i / 4;
      el('line', { x1: m.l, x2: W - m.r, y1: Y(yv), y2: Y(yv), 'class': 'grid' }, svg);
      el('text', { x: m.l - 6, y: Y(yv) + 4, 'text-anchor': 'end', 'class': 'axis' }, svg).textContent = U.fmt(yv, 0);
    }
    var gw = (W - m.l - m.r) / groups.length, bw = Math.min(22, (gw - 10) / names.length - 2);
    var tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; container.appendChild(tip);
    groups.forEach(function (g, gi) {
      var gx = m.l + gi * gw + (gw - (bw + 2) * names.length) / 2;
      g.values.forEach(function (v, k) {
        var x = gx + k * (bw + 2), y = Y(v), h = H - m.b - y;
        var r = Math.min(4, bw / 2, h);
        var d = 'M' + x + ' ' + (H - m.b) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + bw - r) +
          'Q' + (x + bw) + ' ' + y + ' ' + (x + bw) + ' ' + (y + r) + 'V' + (H - m.b) + 'Z';
        el('path', { d: d, 'class': 'bar s' + (k + 1) + (g.partial ? ' partial' : '') }, svg);
      });
      el('text', { x: m.l + gi * gw + gw / 2, y: H - 8, 'text-anchor': 'middle', 'class': 'axis' }, svg).textContent = g.label;
      var hit = el('rect', { x: m.l + gi * gw, y: m.t, width: gw, height: H - m.t - m.b, fill: 'transparent' }, svg);
      hit.addEventListener('pointerenter', function () {
        tip.innerHTML = '<b>' + U.esc(g.title || g.label) + '</b><br>' + names.map(function (n, k) {
          return '<span class="sw s' + (k + 1) + '"></span>' + U.esc(n) + ': <b>' + U.fmt(g.values[k], 0) + ' ' + (opts.unit || '') + '</b>';
        }).join('<br>');
        tip.hidden = false;
        var rect = svg.getBoundingClientRect();
        tip.style.left = Math.min((m.l + gi * gw + gw) / W * rect.width, rect.width - 170) + 'px'; tip.style.top = '8px';
      });
      hit.addEventListener('pointerleave', function () { tip.hidden = true; });
    });
    legend(container, names.map(function (n, k) { return { name: n, cls: 's' + (k + 1) }; }));
  }

  function legend(container, series) {
    if (series.length < 2) return;
    var lg = document.createElement('div'); lg.className = 'legend';
    lg.innerHTML = series.map(function (s) {
      return '<span><span class="sw ' + s.cls + (s.dashed ? ' dashed' : '') + '"></span>' + U.esc(s.name) + '</span>';
    }).join('');
    container.appendChild(lg);
  }

  return { line: line, bars: bars, stack: stack };
})();
