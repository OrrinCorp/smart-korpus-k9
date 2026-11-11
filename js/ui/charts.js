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

  return { line: line, bars: bars };
})();
