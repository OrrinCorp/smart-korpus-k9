/* Телефонний режим панелі (екран ≤ 900 px завширшки або ≤ 500 px заввишки).
 *
 * Розділ і картка приміщення / пристрою — одна ШТОРКА з трьома положеннями:
 *   min  — видно лише заголовок (карта на весь екран),
 *   half — половина екрана (карта згори, корпус центрується у видимій частині),
 *   full — увесь екран під шапкою.
 * Портрет: шторка знизу, тягнеться пальцем угору / вниз за заголовок.
 * Горизонтально: шторка справа, тягнеться вліво / вправо.
 * Дотик до заголовка — min ↔ half. Картка приміщення відкривається в тій самій шторці
 * (кнопка «← назад» повертає до розділу).
 *
 * Також: стан корпусу — значок на кнопці меню (повний рядок — у меню), легенда — за кнопкою «ℹ»,
 * таблиці прокручуються горизонтально, години / швидкість часу — у спливному вікні годинника.
 */
SK.phone = (function () {
  var U = SK.util, $ = U.$;
  var MQ = window.matchMedia('(max-width: 900px), (max-height: 500px) and (orientation: landscape)');
  var api = null, state = 'min', started = false, dragging = null, docBound = false;

  function active() { return MQ.matches; }
  function land() { return window.innerWidth > window.innerHeight; }
  function vh() { return window.innerHeight; }
  function vw() { return window.innerWidth; }
  function topH() { var t = $('.top'); return t ? t.getBoundingClientRect().height : 52; }
  function cardOn() { var c = $('#roomCard'); return c && !c.hidden; }
  function sheetEl() { return cardOn() ? $('#roomCard') : $('#sidePanel'); }

  /* Розміри положень, px: портрет — висота, горизонтально — ширина */
  function sizeOf(st) {
    if (land()) {
      var w = vw();
      return st === 'min' ? Math.min(240, w * 0.4) : st === 'half' ? Math.round(Math.min(440, Math.max(300, w * 0.46))) : w;
    }
    var h = vh() - topH();
    return st === 'min' ? 66 : st === 'half' ? Math.round(h * 0.52) : h - 6;
  }
  function apply(px, anim) {
    var b = document.body;
    b.classList.toggle('sh-anim', !!anim);
    b.style.setProperty('--sh', Math.round(px) + 'px');
    b.style.setProperty('--top-real', Math.round(topH()) + 'px');
    b.classList.remove('sh-min', 'sh-half', 'sh-full');
    b.classList.add('sh-' + state);
    sync();
  }
  function setState(st, anim) {
    state = st;
    apply(sizeOf(st), anim !== false);
    var m = $('#panelMin');
    if (m) m.title = st === 'min' ? 'Розгорнути' : 'Згорнути';
  }

  /* Відступи карти: рядки інструментів згори + шторка */
  function sync() {
    if (!api) return;
    var v = api.viewer(); if (!v || !v.setInsets) return;
    var L = land(), sh = Math.min(sizeOf(state === 'full' ? 'half' : state), L ? vw() * 0.6 : vh() * 0.6);
    var tools = $('.v-toolbar'), top = 0;
    if (tools) { var r = tools.getBoundingClientRect(), base = $('#viewer').getBoundingClientRect(); top = r.bottom - base.top; }
    var fl = $('.v-side');
    if (fl && !L) { var r2 = fl.getBoundingClientRect(), b2 = $('#viewer').getBoundingClientRect(); top = Math.max(top, r2.bottom - b2.top); }
    v.setInsets(L ? { t: top, r: sh, l: fl ? fl.getBoundingClientRect().right : 0 } : { t: top, b: sh });
  }

  /* ---------- Перетягування шторки за заголовок ---------- */
  function handleOf(el) { return el.id === 'roomCard' ? el.querySelector('.rc-h') : el.querySelector('.panel-h'); }
  function onDown(e) {
    var el = e.currentTarget, h = handleOf(el);
    if (!h || !h.contains(e.target) || e.target.closest('button, a, select, input, label')) return;
    dragging = { x: e.clientX, y: e.clientY, start: sizeOf(state), moved: false, id: e.pointerId, el: el, t: performance.now() };
  }
  function onMove(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    var L = land(), d = L ? dragging.x - e.clientX : dragging.y - e.clientY;
    if (!dragging.moved && Math.abs(d) < 6) return;
    if (!dragging.moved) dragging.moved = true;
    var px = Math.max(sizeOf('min'), Math.min(sizeOf('full'), dragging.start + d));
    dragging.cur = px;
    document.body.classList.remove('sh-anim');
    document.body.style.setProperty('--sh', px + 'px');
    e.preventDefault();
  }
  function onUp(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    var g = dragging; dragging = null;
    if (!g.moved) { setState(state === 'min' ? 'half' : state === 'full' ? 'half' : 'min'); return; }
    var px = g.cur, dt = Math.max(1, performance.now() - g.t), v = (px - g.start) / dt;   // px/мс, + — розгортання
    var c = ['min', 'half', 'full'].map(function (s) { return { s: s, d: Math.abs(sizeOf(s) - px) }; }).sort(function (a, b) { return a.d - b.d; })[0].s;
    if (Math.abs(v) > 0.6) c = v > 0 ? (px > sizeOf('half') ? 'full' : 'half') : (px < sizeOf('half') ? 'min' : 'half');
    setState(c);
  }
  function bindSheet(el) {
    if (!el || el.dataset.sheet) return;
    el.dataset.sheet = 1;
    el.addEventListener('pointerdown', onDown);
    if (!docBound) {      /* рух і відпускання — на рівні документа: палець швидко виходить за межі заголовка */
      docBound = true;
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', function () { if (dragging) { dragging = null; setState(state); } });
    }
  }

  /* ---------- Картка в шторці ---------- */
  function decorateCard() {
    var c = $('#roomCard'); if (!c || c.hidden) return;
    var h = c.querySelector('.rc-h');
    if (h && !h.querySelector('.sh-back')) {
      var b = document.createElement('button');
      b.className = 'btn small sh-back'; b.type = 'button';
      b.innerHTML = SK.icon('chevL', 'ico sm') + '<span>Розділ</span>';
      b.title = 'Повернутися до розділу';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var x = c.querySelector('[data-act="close"]'); if (x) x.click(); else c.hidden = true;
      });
      h.insertBefore(b, h.firstChild);
    }
  }
  var wasCard = false;
  function cardChanged() {
    var on = cardOn();
    document.body.classList.toggle('sh-card', on);
    if (on) { decorateCard(); if (!wasCard && state === 'min') setState('half'); }
    wasCard = on;
    sync();
  }

  /* ---------- Таблиці: горизонтальна прокрутка замість стискання ---------- */
  function wrapTables(root) {
    U.$all('table', root).forEach(function (t) {
      var p = t.parentElement;
      if (p && (p.classList.contains('tw') || p.classList.contains('ph-tw'))) return;
      var w = document.createElement('div'); w.className = 'ph-tw';
      p.insertBefore(w, t); w.appendChild(t);
    });
  }

  /* ---------- Стан корпусу: значок на кнопці меню ---------- */
  function mirrorPill() {
    var pill = $('#sysPill'), m = $('#menuBtn'); if (!pill || !m) return;
    var t = pill.textContent || '', n = (t.match(/\d+/) || [''])[0];
    m.dataset.badge = n;
    m.classList.toggle('st-bad', pill.classList.contains('bad'));
    m.classList.toggle('st-warn', pill.classList.contains('warn'));
    m.setAttribute('aria-label', 'Меню розділів · ' + t.trim());
  }

  /* ---------- Розміщення елементів шапки й карти ---------- */
  var homes = [];
  function move(el, parent, before) {
    if (!el || !parent || el.parentElement === parent) return;
    homes.push({ el: el, parent: el.parentElement, next: el.nextSibling });
    parent.insertBefore(el, before || null);
  }
  function restore() {
    homes.reverse().forEach(function (h) { h.parent.insertBefore(h.el, h.next && h.next.parentElement === h.parent ? h.next : null); });
    homes = [];
  }
  var ROLE_SHORT = { guest: 'Гість', responsible: 'Відповідальна', admin: 'Адмін' }, roleFull = {};
  function relayout(on) {
    if (on) {
      move($('#sysPill'), $('#drawer'), $('.drawer-b'));                       // повний рядок стану — у меню
      var pop = $('#clockPop'), row = pop && pop.querySelector('.row');
      if (row) move($('#clockSpeed'), row);                                     // швидкість часу — у вікні годинника
      U.$all('#role option').forEach(function (o) { roleFull[o.value] = o.textContent; o.textContent = ROLE_SHORT[o.value] || o.textContent; });
    } else {
      restore();
      U.$all('#role option').forEach(function (o) { if (roleFull[o.value]) o.textContent = roleFull[o.value]; });
    }
  }

  function init(a) {
    api = a;
    if (started) return;
    started = true;
    /* Кнопка легенди на карті */
    var views = $('.v-views');
    if (views && !$('#lgBtn')) {
      var lb = document.createElement('button');
      lb.className = 'vbtn'; lb.id = 'lgBtn'; lb.type = 'button'; lb.title = 'Легенда кольорів карти';
      lb.innerHTML = SK.icon('info') + '<em>Легенда</em>';
      lb.addEventListener('click', function () { var on = !document.body.classList.contains('lg-open'); document.body.classList.toggle('lg-open', on); lb.classList.toggle('on', on); });
      views.appendChild(lb);
      $('#legend').addEventListener('click', function () { document.body.classList.remove('lg-open'); lb.classList.remove('on'); });
    }
    bindSheet($('#sidePanel')); bindSheet($('#roomCard'));
    $('#panelMin').addEventListener('click', function (e) {
      if (!active()) return;
      e.stopImmediatePropagation();
      setState(state === 'min' ? 'half' : 'min');
    }, true);
    /* Годинник: дотик — вікно зміни часу */
    var clk = $('.clock');
    if (clk) clk.addEventListener('click', function (e) {
      if (!active() || e.target.closest('select, #clockSet')) return;
      $('#clockSet').click();
    });
    $('#sysPill').addEventListener('click', function () { if (active()) { api.setDrawer(false); setState('half'); } });
    new MutationObserver(cardChanged).observe($('#roomCard'), { attributes: true, attributeFilter: ['hidden'], childList: true });
    new MutationObserver(function () { if (active()) wrapTables($('#panel')); }).observe($('#panel'), { childList: true });
    new MutationObserver(function () { if (active()) wrapTables($('#roomCard')); }).observe($('#roomCard'), { childList: true });
    new MutationObserver(mirrorPill).observe($('#sysPill'), { attributes: true, childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', function () { if (active() && !dragging) setState(state, false); });
    MQ.addEventListener ? MQ.addEventListener('change', modeChange) : MQ.addListener(modeChange);
    if (active()) enter();
  }
  function enter() {
    document.body.classList.add('ph');
    document.body.classList.remove('panel-closed');
    var po = $('#panelOpen'); if (po) po.hidden = true;
    relayout(true);
    mirrorPill(); wrapTables($('#panel'));
    setState(cardOn() ? 'half' : 'min', false);
    cardChanged();
  }
  function leave() {
    document.body.classList.remove('ph', 'sh-min', 'sh-half', 'sh-full', 'sh-card', 'sh-anim', 'lg-open');
    document.body.style.removeProperty('--sh');
    relayout(false);
    var v = api && api.viewer(); if (v && v.setInsets) v.setInsets({});
    if (api) api.setPanelOpen(true);
  }
  function modeChange() { if (!api) return; if (active()) enter(); else leave(); }

  /* Виклик з dashboard.setPanelOpen: відкрити розділ (half) або згорнути (min) */
  function panel(open) {
    if (open) { if (state === 'min') setState('half'); }
    else setState('min');
  }

  return { active: active, init: init, sync: sync, panel: panel, setState: setState, state: function () { return state; } };
})();
