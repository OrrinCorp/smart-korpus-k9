/* Панель керування «Розумний корпус» — головний екран (ТЗ п. 3.1–3.5).
 * Модулі-вкладки: Огляд, Аудиторії, Комфорт, Безпека, Енергія, Обладнання i3, Налаштування. */
SK.dashboard = (function () {
  var U = SK.util, B = SK.building, S = SK.schedule, SEN = SK.sensors, I3 = SK.i3, E = SK.energy,
    SEC = SK.security, DEV = SK.devicesI3, DS = SK.devices, TR = SK.territory, CM = SK.colorModes, store = SK.store, $ = U.$, esc = U.esc;

  var ui = { tab: 'overview', colorMode: 'status', room: null, lastIn: {},
    rf: { block: '', floor: '', status: '', type: '' }, evFilter: 'all', secRoom: null,
    device: null, devCats: null, df: { cat: '', floor: '', status: '' }, rcDur: '90',
    ef: { date: '', scope: 'all', block: 'A', floor: '2', room: '', device: '' }, lg: null };
  var viewer, pressing = false;

  function now() { return store.clock.now(); }
  function role() { return store.state.role; }

  /* ---------------- Ініціалізація ---------------- */
  function init() {
    viewer = new SK.Viewer($('#viewer'), {
      colorFor: function (r) { return CM[ui.colorMode].color(r, now()); },
      alarmFor: function (r) { return role() !== 'guest' && !!SEC.roomAlarm(r.id); },   // гість не бачить тривог
      tipFor: tipFor,
      onSelect: function (r) { if (r && ui.tab === 'control') SK.adminTabs.setCtlRoom(r.id); ui.room = r ? r.id : null; if (r) { ui.device = null; viewer && viewer.selectDevice(null); } renderRoomCard(); },
      deviceState: function (d) { return DS.state(d, now()); },
      deviceTip: function (d) {
        var s = DS.state(d, now());
        return DEV.KINDS[d.kind].icon + ' <b>' + esc(d.name) + '</b><br>' + esc(d.room || d.label || '') + (s.value ? ' · ' + esc(s.value) : '') +
          '<br><span class="lvl ' + DS.STATUS[s.status].lvl + '">' + DS.STATUS[s.status].name + '</span><br><span class="muted">клік — картка · подвійний клік — наблизити</span>';
      },
      onDeviceSelect: function (d) {
        var back = ui.pendingBack; ui.pendingBack = null;
        if (d && ui.tab === 'wiring' && role() === 'admin') { SK.adminTabs.focusDevice(d, back); return; }   // у «Комутації» — ще й траса
        if (!d && ui.tab === 'wiring' && SK.adminTabs.devFocused()) { SK.adminTabs.clearFocus(); viewer.setFocus(null); ui.device = null; renderPanel(); }
        openDevice(d, back); },
      onOpenDevice: function (d) { ui.pendingBack = ui.devBack; showDevice(d); },   // подвійний клік по іконці
      spotColor: function (s) { var dk = SK.theme.isDark(); return DS.spotTaken(s, now()) ? (dk ? 0x3a4a5a : 0xaab6c0) : s.mgn ? 0x22c3dd : 0x3ecf8e; },   // зайняте місце — нейтральне (це не тривога)
      onOpenRoom: function (r) { if (role() === 'guest') { U.toast('Модель кімнати доступна відповідальним особам і адміністратору', 'warn'); return; } SK.RoomView.open(r.id); },
      defaultModelUrl: 'assets/models/korpus9.glb'
    });
    initShell(); initDevLayer(); initCardDrag();
    /* Поки кнопку миші/палець затиснуто на картці чи панелі, періодичне оновлення їх не чіпає —
       інакше елемент під курсором замінюється і клік губиться */
    ['#roomCard', '#panel'].forEach(function (s) { $(s).addEventListener('pointerdown', function () { pressing = true; }); });
    ['pointerup', 'pointercancel'].forEach(function (t) { window.addEventListener(t, function () { pressing = false; }); });
    viewer.restoreModel().then(function (res) { if (res) U.toast('3D-модель «' + res.name + '» відновлено. Прив’язано аудиторій: ' + res.bound); });

    /* Поверхи */
    var fl = $('#floors');
    var fhtml = '';
    for (var f = B.maxFloor; f >= B.minFloor; f--) fhtml += '<button data-f="' + f + '" title="Поверх ' + B.floorNames[f] + '">' + f + '<small>' + (f === 0 ? 'хол' : 'поверх') + '</small></button>';
    fhtml += '<button data-f="" class="on" title="Увесь корпус">Усі<small>корпус</small></button>';
    fl.innerHTML = fhtml;
    fl.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      U.$all('button', fl).forEach(function (x) { x.classList.toggle('on', x === b); });
      if (viewer.isPlan() && !b.dataset.f) { viewer.setPlan(false); $('#planBtn').classList.remove('on'); $('#view3d').classList.add('on'); }
      viewer.setFloor(b.dataset.f ? +b.dataset.f : null);
    });

    var cm = $('#colorMode');
    cm.innerHTML = Object.keys(CM).map(function (k) { return '<option value="' + k + '">' + CM[k].name + '</option>'; }).join('');
    cm.addEventListener('change', function () { ui.colorMode = cm.value; viewer.refresh(); renderLegend(); });
    $('#homeBtn').addEventListener('click', function () {
      if (viewer.isPlan()) { viewer.setPlan(false); $('#planBtn').classList.remove('on'); $('#view3d').classList.add('on'); }
      if (viewer.getIsolated()) viewer.isolate(null);
      if (viewer.hasFocus()) { viewer.setFocus(null); SK.adminTabs.clearFocus(); if (ui.tab === 'wiring') renderPanel(); }
      setFloorBtn(''); viewer.setFloor(null, true); viewer.home();
    });
    $('#planBtn').addEventListener('click', function (e) {
      var on = !viewer.isPlan();
      if (on && ui.expl) { ui.expl = false; $('#explBtn').classList.remove('on'); viewer.setExplode(false); }
      var f = viewer.setPlan(on); e.currentTarget.classList.toggle('on', on); $('#view3d').classList.toggle('on', !on);
      if (on) setFloorBtn(f);
    });
    /* Пошук приміщення на карті */
    $('#mapSearch').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var id = findRoom(e.target.value);
      if (!id) { U.toast('Приміщення «' + e.target.value + '» не знайдено (приклад: 310, 205А, Б-110, ауд. 3, А-001)', 'warn'); return; }
      var r = B.room(id); setFloorBtn(r.floor); viewer.setFloor(r.floor); viewer.select(id); viewer.focusRoom(id);
    });
    $('#lblBtn').addEventListener('click', function (e) { ui.lbl = !ui.lbl; e.currentTarget.classList.toggle('on', ui.lbl); viewer.setLabelsAll(ui.lbl); });
    $('#explBtn').addEventListener('click', function (e) { if (viewer.isPlan()) { viewer.setPlan(false); $('#planBtn').classList.remove('on'); $('#view3d').classList.add('on'); } ui.expl = !ui.expl; e.currentTarget.classList.toggle('on', ui.expl); if (ui.expl) { setFloorBtn(''); viewer.setFloor(null); } viewer.setExplode(ui.expl); });

    $('#panel').addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); setTab(g.dataset.goto); }
    });
    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]'); if (!b) return;
      setTab(b.dataset.tab);
    });

    var roleSel = $('#role');
    roleSel.value = role();
    roleSel.addEventListener('change', function () {
      store.state.role = roleSel.value; store.save();
      applyRole();
      U.toast('Роль: ' + SEC.ROLES[roleSel.value].name + (roleSel.value === 'admin' ? ' (у реальній системі — вхід за обліковим записом)' : ''));
    });

    initClock();

    store.on('change', function () { viewer.refresh(); renderAll(true); });
    store.on('event', function (ev) {
      if (role() === 'guest') return;   // службові сповіщення — не для глядачів
      U.toast((ev.sev === 'critical' ? '⚠ ' : '') + SEC.TYPES[ev.type].name + (ev.room ? ' · ' + ev.room : ''),
        ev.sev === 'critical' ? 'bad' : 'warn');
    });

    var hp = location.hash.replace('#', '').split('&');
    if (SEC.ROLES[hp[1]]) { store.state.role = hp[1]; roleSel.value = hp[1]; store.save(); }   // напр. index.html#wiring&admin
    applyRole();
    renderLegend();
    renderAll();
    var hashTab = hp[0];
    hp.forEach(function (part) {   // index.html#wiring&admin&dev=FINGER-А-202-1 — виділити трасу пристрою
      if (part.indexOf('dev=') === 0) { var dv = DEV.device(decodeURIComponent(part.slice(4))); if (dv) setTimeout(function () { setTab('wiring'); SK.adminTabs.focusDevice(dv); }, 150); }
      if (part.indexOf('sel=') === 0) { var sr = findRoom(decodeURIComponent(part.slice(4))); if (sr) setTimeout(function () { var rr = B.room(sr); setFloorBtn(rr.floor); viewer.setFloor(rr.floor); viewer.select(sr); viewer.focusRoom(sr); }, 200); }   // #overview&sel=А-205
      if (part === 'simdemo') setTimeout(function () { var dd = SK.faults.demo('ЩА-А2'); ui.wCab = 'ЩА-А2'; setTab('wiring'); if (dd) SK.adminTabs.focusDevice(dd); }, 150);   // #wiring&admin&simdemo
      if (part.indexOf('inst=') === 0) { var iid = decodeURIComponent(part.slice(5)); setTimeout(function () { ui.wCab = iid.split('/')[0]; setTab('wiring'); SK.adminTabs.focusInst(iid); }, 150); }   // #wiring&admin&inst=ЩА-А2/KR1
    });
    if (hp.indexOf('plan') >= 0) setTimeout(function () { $('#planBtn').click(); }, 100);   // index.html#overview&admin&plan
    if (/^(overview|control|rooms|events|scenarios|comfort|security|access|logs|energy|power|wiring|territory|equipment|settings|devices)$/.test(hashTab)) setTab(hashTab === 'devices' ? 'equipment' : hashTab);
    if (hashTab === 'devices') setDevCats(Object.keys(DEV.CATS));
    /* index.html#room=А-305 — одразу відкрити модель кімнати */
    if (/^room=/.test(hashTab)) { var rid = findRoom(decodeURIComponent(hashTab.slice(5))); if (rid) setTimeout(function () { SK.RoomView.open(rid); }, 200); }
    setInterval(tick, 2000);
  }

  /* ---------- Навігація: меню розділів (виїжджає зліва) + плаваюча панель справа ---------- */
  var NAV = [
    { id: 'home', icon: 'home', name: 'Огляд', sub: 'Стан корпусу одним поглядом', tabs: ['overview'] },
    { id: 'ctl', icon: 'sliders', name: 'Керування', sub: 'Диспетчерська й автоматичні сценарії', tabs: ['control', 'scenarios'] },
    { id: 'sched', icon: 'calendar', name: 'Розклад', sub: 'Аудиторії, бронювання, події', tabs: ['rooms', 'events'] },
    { id: 'climate', icon: 'thermo', name: 'Клімат', sub: 'Температура, CO₂, освітлення', tabs: ['comfort'] },
    { id: 'sec', icon: 'shield', name: 'Безпека', sub: 'Сповіщення, доступ за відбитком, журнали', tabs: ['security', 'access', 'logs'] },
    { id: 'energy', icon: 'bolt', name: 'Енергія', sub: 'Споживання й резервне живлення', tabs: ['energy', 'power'] },
    { id: 'infra', icon: 'chip', name: 'Техніка', sub: 'Пристрої, комутація, територія', tabs: ['equipment', 'wiring', 'territory'] },
    { id: 'cfg', icon: 'gear', name: 'Система', sub: 'Налаштування прототипу', tabs: ['settings'] }
  ];
  var TAB_ICON = { overview: 'home', control: 'sliders', scenarios: 'layers', rooms: 'calendar', events: 'megaphone', comfort: 'thermo',
    security: 'bell', access: 'finger', logs: 'doc', energy: 'chart', power: 'battery', equipment: 'radar', wiring: 'cable', territory: 'car', settings: 'gear' };
  function tabName(t) { var b = document.querySelector('#tabs button[data-tab="' + t + '"]'); return b ? b.firstChild.textContent.trim() : t; }
  function groupOf(t) { for (var i = 0; i < NAV.length; i++) if (NAV[i].tabs.indexOf(t) >= 0) return NAV[i].id; return 'home'; }
  function navGroup(id) { return NAV.filter(function (x) { return x.id === id; })[0]; }
  /* Іконки в статичній розмітці: <span data-i="cube"></span> */
  function paintIcons(root) { U.$all('[data-i]', root || document).forEach(function (el) { if (!el.firstChild) el.innerHTML = SK.icon(el.dataset.i); }); }
  function setDrawer(open) {
    document.body.classList.toggle('drawer-open', open);
    $('#scrim').hidden = !open; $('#drawer').setAttribute('aria-hidden', String(!open)); $('#menuBtn').setAttribute('aria-expanded', String(open));
  }
  function setPanelOpen(open) {
    /* Телефон: панель — шторка з трьома положеннями (js/ui/phone.js) */
    if (SK.phone && SK.phone.active()) { SK.phone.panel(open); return; }
    ui.panelClosed = !open; document.body.classList.toggle('panel-closed', !open); $('#panelOpen').hidden = open;
    syncInset();
  }
  /* Карта знає, скільки місця справа займає панель, і центрує корпус у видимій частині */
  function syncInset() {
    if (!viewer || !viewer.setRightInset) return;
    if (SK.phone && SK.phone.active()) { SK.phone.sync(); return; }
    var wide = !window.matchMedia('(max-width: 900px)').matches, pnl = $('#sidePanel');
    viewer.setRightInset(wide && !ui.panelClosed ? pnl.offsetWidth + 12 : 0);
  }
  function initShell() {
    paintIcons();
    $('#menuBtn').innerHTML = SK.icon('menu', 'ico lg');
    $('#drawerClose').innerHTML = SK.icon('x');
    $('#panelMin').innerHTML = SK.icon('chevR');
    $('#clockSet').innerHTML = SK.icon('clock');
    U.$all('.role-ico').forEach(function (e) { e.innerHTML = SK.icon('user', 'ico sm'); });
    $('#menuBtn').addEventListener('click', function () { setDrawer(!document.body.classList.contains('drawer-open')); });
    $('#drawerClose').addEventListener('click', function () { setDrawer(false); });
    $('#scrim').addEventListener('click', function () { setDrawer(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) setDrawer(false); });
    $('#panelMin').addEventListener('click', function () { setPanelOpen(false); });
    $('#tourBtn').addEventListener('click', function () { setDrawer(false); });
    $('#panelOpen').addEventListener('click', function () { setPanelOpen(true); });
    $('#sysPill').addEventListener('click', function () { setTab('overview'); setPanelOpen(true); });
    $('#view3d').addEventListener('click', function () { if (viewer.isPlan()) $('#planBtn').click(); });
    if (SK.phone) SK.phone.init({ setTab: setTab, setPanelOpen: setPanelOpen, setDrawer: setDrawer, viewer: function () { return viewer; } });
    if (!SK.phone || !SK.phone.active()) syncInset();
    window.addEventListener('resize', syncInset);
  }
  function renderNav() {
    var g = $('#tabGroups'), cur = groupOf(ui.tab);
    if (!g.dataset.init) {
      g.dataset.init = 1;
      g.addEventListener('click', function (e) {
        var b = e.target.closest('[data-navtab]'); if (!b) return;
        setTab(b.dataset.navtab); setPanelOpen(true); setDrawer(false);
      });
    }
    /* Меню: групи з підрозділами; показуються лише доступні поточній ролі */
    g.innerHTML = NAV.map(function (n) {
      var tabs = n.tabs.filter(tabAllowed); if (!tabs.length) return '';
      if (tabs.length === 1) return '<div class="d-grp">' + item(tabs[0], n.icon, n.name, n.sub) + '</div>';
      return '<div class="d-grp"><div class="d-grp-t">' + SK.icon(n.icon, 'ico sm') + esc(n.name) + '</div>' +
        tabs.map(function (t) { return item(t, TAB_ICON[t], tabName(t)); }).join('') + '</div>';
    }).join('');
    function item(t, ic, name, sub) {
      return '<button class="d-item' + (t === ui.tab ? ' on' : '') + '" data-navtab="' + t + '" title="' + esc(sub || name) + '"><span class="d-ico">' + SK.icon(ic) + '</span>' +
        esc(name) + (t === 'security' ? '<span class="cnt" id="grpSecCnt" hidden></span>' : sub ? '' : '') + '</button>';
    }
    /* Шапка панелі та підвкладки групи */
    var grp = navGroup(cur), tabs = grp.tabs.filter(tabAllowed);
    $('#phIco').innerHTML = SK.icon(TAB_ICON[ui.tab] || grp.icon, 'ico');
    $('#phTitle').textContent = tabs.length > 1 ? grp.name : tabName(ui.tab);
    $('#phSub').textContent = grp.sub;
    $('#poIco').innerHTML = SK.icon(TAB_ICON[ui.tab] || grp.icon); $('#poTxt').textContent = tabName(ui.tab);
    U.$all('#tabs button[data-tab]').forEach(function (b) { b.hidden = tabs.indexOf(b.dataset.tab) < 0; b.classList.toggle('on', b.dataset.tab === ui.tab); });
    $('#tabs').hidden = tabs.length < 2;
    updateSecCount();
  }
  /* Пігулка стану в шапці: те саме, що «Що потребує уваги» в огляді */
  function updateSysPill() {
    var pill = $('#sysPill'); if (!pill) return;
    var n = now(), G = role() === 'guest', bad = 0, warn = 0;
    if (!G) {
      var ps = SK.power.state(n), fs = SK.faults.summary(n), ds = DS.summary(n);
      if (!ps.grid) bad++;
      bad += SEC.active().length;
      warn += fs.cabOff + fs.cabBatt + fs.cabLink + fs.ctrl + ds.fault + ds.alarm;
    }
    B.bookableRooms().forEach(function (r) { if (I3.read(r.id, n).co2 >= 1000) warn++; });
    pill.className = 'sys-pill' + (bad ? ' bad' : warn ? ' warn' : '');
    pill.querySelector('span').textContent = bad ? 'Тривог: ' + bad : warn ? 'Потребує уваги: ' + warn : 'Усе в нормі';
  }

  /* ---------- Що бачить кожна роль ---------- */
  var ALL = ['guest', 'responsible', 'admin'], STAFF = ['responsible', 'admin'], ADM = ['admin'];
  var TAB_ROLES = { overview: ALL, rooms: ALL, events: ALL, comfort: ALL, energy: STAFF, territory: ALL,
    control: STAFF, scenarios: STAFF, security: STAFF, access: STAFF, logs: STAFF, power: STAFF, wiring: ADM, equipment: ADM, settings: ADM };
  /* Категорії пристроїв на карті: гість — не бачить, відповідальна особа — без мережі/живлення */
  var CAT_ROLES = { guest: [], responsible: ['sensors', 'control', 'boards', 'access', 'safety', 'territory'], admin: null };
  function tabAllowed(t) { return (TAB_ROLES[t] || ADM).indexOf(role()) >= 0; }
  function allowedCats() { var c = CAT_ROLES[role()]; return c === null ? Object.keys(DEV.CATS) : c; }
  function applyRole() {
    var r = role();
    renderNav();
    $('#devBtn').hidden = r === 'guest';
    $('#devPop').hidden = true;
    var cm = $('#colorMode'), modes = Object.keys(CM).filter(function (k) { return r !== 'guest' || (k !== 'scenario' && k !== 'power'); });
    cm.innerHTML = modes.map(function (k) { return '<option value="' + k + '">' + CM[k].name + '</option>'; }).join('');
    if (modes.indexOf(ui.colorMode) < 0) ui.colorMode = 'status';
    cm.value = ui.colorMode;
    if (ui.devCats) setDevCats(ui.devCats.filter(function (c) { return allowedCats().indexOf(c) >= 0; }));
    if (ui.device && allowedCats().indexOf(DEV.device(ui.device).cat) < 0) viewer.selectDevice(null);
    if (r !== 'admin') viewer.setWiring(null);
    if (r === 'guest' && SK.RoomView && SK.RoomView.isOpen()) SK.RoomView.close();
    if (!tabAllowed(ui.tab)) setTab('overview'); else renderPanel();
    renderLegend(); renderRoomCard();
  }
  function findRoom(q) {
    q = String(q || '').trim();
    if (B.room(q)) return q;
    /* Номери як у розкладі: «310», «205А», «А109», «ауд. 3», «В4», «24П» */
    var k = SK.scheduleImport.roomKey('к.9, а.' + q.replace(/^(ауд\.?|а\.)\s*/i, '').toUpperCase());
    if (k && B.room(k)) return k;
    var m = /([АБПABPабпabp])\s*[-_ ]?\s*(\d{3}|\dС\d|\dC\d)/.exec(q);
    if (!m) return null;
    var L2 = { A: 'А', B: 'Б', P: 'П', a: 'А', b: 'Б', p: 'П', 'а': 'А', 'б': 'Б', 'п': 'П' }[m[1]] || m[1].toUpperCase();
    var id = L2 + '-' + m[2].replace('C', 'С');
    return B.room(id) ? id : null;
  }

  function setTab(t) {
    if (!tabAllowed(t)) t = 'overview';
    if (ui.tab === 'wiring' && t !== 'wiring' && viewer) { viewer.setFocus(null); viewer.setWiring(null); SK.adminTabs.clearFocus(); SK.adminTabs.hideTrays(); }
    ui.tab = t;
    ui.lastIn[groupOf(t)] = t;
    renderNav();
    var modeFor = { comfort: 'co2', energy: 'power' };
    if (modeFor[t] && ui.colorMode === 'status') { ui.colorMode = modeFor[t]; $('#colorMode').value = ui.colorMode; viewer.refresh(); renderLegend(); }
    if ((t === 'rooms' || t === 'overview') && (ui.colorMode === 'co2' || ui.colorMode === 'power')) { ui.colorMode = 'status'; $('#colorMode').value = 'status'; viewer.refresh(); renderLegend(); }
    renderPanel();
  }

  function tick() {
    updateClock(); updateSysPill();
    viewer.refresh();
    renderRoomCard();
    var n = now(), p = E.power(n);
    if (E.checkThreshold(n, p)) {
      SEC.addEvent('energy', null, 'Потужність ' + U.fmt(p.total / 1000, 1) + ' кВт перевищила поріг ' + store.state.settings.energyThresholdKw + ' кВт.');
    }
    serviceChecks(n);
    SK.power.check(n); SK.faults.check(n);
    if (['overview', 'comfort', 'energy', 'territory', 'power', 'wiring'].indexOf(ui.tab) >= 0) renderPanel(true, true);
  }

  function renderAll(soft) { updateClock(); renderPanel(soft); renderRoomCard(); updateSecCount(); updateSysPill(); }

  function updateSecCount() {
    var n = SEC.active().filter(function (e) { return e.status === 'new'; }).length;
    var c = $('#secCnt'); c.textContent = n; c.hidden = !n;
    var gc = $('#grpSecCnt'); if (gc) { gc.textContent = n; gc.hidden = !n || role() === 'guest'; }
  }

  /* ---------------- Годинник ---------------- */
  function initClock() {
    var sp = $('#clockSpeed'); sp.value = String(store.clock.speed());
    sp.addEventListener('change', function () { store.clock.setSpeed(+sp.value); });
    var pop = $('#clockPop');
    $('#cpDay').innerHTML = [1, 2, 3, 4, 5, 6, 7].map(function (d) { return '<option value="' + d + '">' + U.DAYS[d] + '</option>'; }).join('');
    $('#clockSet').addEventListener('click', function () {
      var n = now(); $('#cpDay').value = U.dow(n); $('#cpTime').value = U.hhmm(n); pop.hidden = !pop.hidden;
    });
    $('#cpApply').addEventListener('click', function () { setSimTime(+$('#cpDay').value, $('#cpTime').value); pop.hidden = true; });
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-quick]'); if (!b) return;
      if (b.dataset.quick === 'real') { store.clock.set(new Date()); }
      else { var q = b.dataset.quick.split(','); setSimTime(+q[0], q[1]); }
      pop.hidden = true;
    });
  }
  function setSimTime(day, hm) {
    var d = now(), cur = U.dow(d);
    d.setDate(d.getDate() + (day - cur));
    var t = hm.split(':'); d.setHours(+t[0], +t[1], 0, 0);
    store.clock.set(d);
  }
  function updateClock() {
    var n = now();
    $('#clockDay').textContent = U.DAYS[U.dow(n)] + ', ' + U.pad(n.getDate()) + '.' + U.pad(n.getMonth() + 1);
    $('#clockTime').textContent = U.hhmm(n);
    var p = S.pairAt(n), nx = S.nextPair(n);
    $('#clockPair').textContent = U.dow(n) > 5 ? 'вихідний' : p ? p.n + '-га пара до ' + p.end : nx ? 'перерва, далі ' + nx.n + '-га о ' + nx.start : 'пари завершено';
  }

  /* ---------------- Легенда й підказка ---------------- */
  function renderLegend() {
    $('#legend').innerHTML = '<div class="lg-title">' + CM[ui.colorMode].name + (ui.colorMode !== 'status' ? ' · <span class="demo-badge">симуляція</span>' : '') +
      '</div><div class="legend-map">' + CM[ui.colorMode].legend() + '</div>';
  }
  function tipFor(r) {
    var n = now(), v = I3.read(r.id, n), s = S.status(r.id, n);
    var h = '<b>' + esc(r.label || r.id) + '</b> · ' + esc(r.name);
    if (r.bookable) h += '<br><span class="st ' + S.STATUS[s.status].css + '">' + S.STATUS[s.status].name + '</span>' + (s.lesson ? ' ' + esc(s.lesson.group) : '');
    if (r.type !== 'stairs') h += '<br>' + v.temp + ' °C · CO₂ ' + v.co2 + ' · ' + peopleText(r, v);
    return h;
  }

  /* Крива «люди в аудиторії» за день (лічильник людей), малюється лише в розгорнутому блоці */
  function drawPeople(r, n) {
    var c = $('#rcPpl'); if (!c || !ui.rcPpl) return;
    var pts = S.dayCurve(r.id, n, 5).map(function (x) { return { x: x.m, y: x.people }; });
    SK.charts.line(c, [{ name: 'Людей', cls: 's1', values: pts }], { height: 130, unit: 'ос.', xMin: 7 * 60, xMax: 20 * 60,
      xTicks: [480, 600, 720, 840, 960, 1080, 1200], xFmt: function (m) { return Math.floor(m / 60) + ':' + ('0' + Math.round(m % 60)).slice(-2); },
      label: 'Кількість людей в аудиторії за день' });
  }
  /* Кількість людей бачить лише лічильник; де його немає — тільки факт руху з PIR */
  function peopleText(r, v) {
    if (DEV.hasCounter(r)) return v.people + ' ос.';
    return v.people ? 'є рух' : 'руху немає';
  }
  function weekText(w) { return w === 1 ? '1-й тиждень' : w === 2 ? '2-й тиждень' : 'щотижня'; }
  function lessonLine(l, G) {
    return esc(l.subject) + ' <span class="muted">(' + esc(l.kind) + ')</span>, ' + (l.stream ? 'потік ' : '') + '<b>' + esc(l.group) + '</b>' +
      (l.teacher ? ', ' + esc(l.teacher) : '');
  }

  /* ---------------- Картка аудиторії ---------------- */
  function renderRoomCard() {
    var box = $('#roomCard');
    if (pressing) return;
    /* Відкритий список не перемальовуємо — але лише доки картка та сама; інакше нове приміщення не відкрилося б */
    var want = ui.device ? 'dev:' + ui.device : ui.room ? 'room:' + ui.room : null;
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT' && want === cardKey && !box.hidden) return;
    if (ui.device) { renderDeviceCard(box); return; }
    if (!ui.room) { box.hidden = true; return; }
    var r = B.room(ui.room), n = now(), v = I3.read(r.id, n), s = S.status(r.id, n);
    var h = '<div class="rc-h"><div class="grow"><h2>' + esc(r.label || r.id) + '</h2><div class="muted small">' + esc(r.name) + ' · ' + B.blockById(r.block).name +
      ', ' + r.floor + ' пов. · ' + r.area + ' м²' + (r.capacity ? ' · ' + r.capacity + ' місць' : '') + (r.pcs ? ' · ' + r.pcs + ' ПК' : '') + '</div></div>' +
      '<button class="btn small" data-act="close" aria-label="Закрити">✕</button></div>';
    var G = role() === 'guest';
    var alarm = G ? null : SEC.roomAlarm(r.id);
    if (alarm) h += '<div class="note" style="border-left-color:var(--bad)"><b>' + SK.icon('alert', 'ico sm') + ' ' + esc(SEC.TYPES[alarm.type].name) + '</b><br>' + esc(alarm.note) + '</div>';
    if (r.bookable) {
      h += '<div style="margin-top:8px"><span class="st ' + S.STATUS[s.status].css + '">' + S.STATUS[s.status].name + '</span>';
      if (s.lesson) h += ' — ' + lessonLine(s.lesson, G) + (s.conflict && !G ? ' <span class="sev critical">конфлікт: ' + s.lessons.length + ' заняття</span>' : '') +
        '<div class="small muted">' + s.pair.n + '-га пара, ' + s.pair.start + '–' + s.pair.end + ' · ' + weekText(s.lesson.week) + ' (зараз ' + s.week + '-й) · за списком ' + s.lesson.people + ' студ.</div>';
      if (s.booking) h += ' — ' + esc(s.booking.purpose) + ' (' + esc(s.booking.who) + ')';
      if (s.next) h += '<div class="small muted">Далі: ' + s.next.pair.n + '-га пара (' + s.next.pair.start + ') — ' +
        esc(s.next.lesson ? s.next.lesson.subject + ', ' + s.next.lesson.group : 'бронювання') + '</div>';
      h += '</div>';
    }
    if (r.type !== 'stairs') {
      h += '<div class="metrics">' +
        metric(v.temp + ' °C', 'Температура', 'thermo') +
        metric('<span class="lvl ' + SEN.co2Level(v.co2) + '">' + v.co2 + '</span>', 'CO₂, ppm', 'co2') +
        metric(v.hum + ' %', 'Вологість', 'drop') +
        (DEV.hasCounter(r) ? metric(v.people, 'Людей (лічильник)', 'users') : metric(v.people ? 'є' : 'немає', 'Рух (PIR)', 'pir')) +
        metric(v.lightOn ? Math.round(v.lightLevel * 100) + ' %' : 'вимк.', 'Світло', 'bulb') +
        (G ? metric(esc(v.scName), 'Режим', 'layers') : metric(U.fmt(v.power / 1000, 2) + ' кВт', 'Потужність', 'bolt')) + '</div>' +
        '<div class="small muted">' + SEN.co2Text(v.co2) + ' · <span class="demo-badge">симуляція</span>' + (v.fault && !G ? ' · <span class="sev warning">датчик несправний</span>' : '') + '</div>';
    }
    if (r.bookable && !G) {
      var SCN = SK.scenarios;
      h += '<div class="dc-sec">Режим кімнати</div><div class="small" style="margin:0 0 2px">Зараз: <b>' + esc(v.scName) + '</b>' +
        (v.manual ? ' · вручну' + (v.manual.until ? ' до ' + U.hhmm(new Date(v.manual.until)) : '') : ' · за правилом') + '</div>';
      if (SEC.can('scenario')) {
        h += '<div class="row rc-mode">' + sel('rcMode', [['auto', 'Авто (за правилами)']].concat(SCN.list().map(function (s) { return [s.id, s.name]; })), v.mode) +
          sel('rcDur', [['90', '90 хв'], ['30', '30 хв'], ['180', '3 год'], ['', 'безстроково']], ui.rcDur) + '</div>';
      }
    }
    if (r.bookable) {
      var cur = S.pairAt(n), curRow = null;
      var rowsH = S.roomDay(r.id, n).map(function (row) {
        var l = row.lessons[0], c = cur && cur.n === row.pair.n ? ' class="now"' : '';
        if (c) curRow = l ? l.subject + ' · ' + l.group : row.booking ? 'бронь' : 'вільно';
        return '<span' + c + '>' + row.pair.n + '. ' + row.pair.start + '</span><span' + c + '>' +
          (l ? esc(l.subject) + ' · ' + esc(l.group) + (!G && row.lessons.length > 1 ? ' <span class="sev critical">+' + (row.lessons.length - 1) + ' конфлікт</span>' : '') :
            row.booking ? '<span class="st booked">Бронь</span> ' + esc(row.booking.purpose) : '<span class="muted">вільно</span>') + '</span>';
      }).join('');
      h += '<details><summary>Розклад на сьогодні' + (curRow ? ' · зараз: ' + esc(curRow) : '') + '</summary><div class="pairs">' + rowsH + '</div>' +
        '<div class="small muted">' + S.weekOf(n) + '-й тиждень · джерело — розклад ННІФТКН</div></details>';
      if (DEV.hasCounter(r)) h += '<details id="rcPplD"' + (ui.rcPpl ? ' open' : '') + '><summary>Люди в аудиторії за день</summary><div id="rcPpl" class="ppl-chart"></div>' +
        '<div class="small muted">Показ лічильника людей, крок 5 хв · <span class="demo-badge">симуляція за розкладом</span></div></details>';
    }
    var devs = role() === 'guest' ? [] : DEV.roomDevices(r).filter(function (d) { return allowedCats().indexOf(d.cat) >= 0; }), cab = role() === 'admin' ? DEV.cabinetFor(r) : null;
    var probs = devs.filter(function (d) { var s = DS.state(d, n).status; return s === 'fault' || s === 'alarm' || s === 'off'; }).length;
    if (devs.length) h += '<details' + (probs ? ' open' : '') + '><summary>Розумні пристрої (' + devs.length + ')' + (probs ? ' · <span class="lvl warn">' + probs + ' потребують уваги</span>' : '') + '</summary><div>' + devs.map(function (d) {
      var s = DS.state(d, n), ctl = SK.control.controllable(d) && SEC.can('scenario');
      return '<div class="devrow">' + (ctl ? '<button class="pwr sm' + (SK.control.isOff(d) ? ' off' : '') + '" data-pwr="' + esc(d.id) + '" title="' + (SK.control.isOff(d) ? 'Увімкнути' : 'Вимкнути вручну') + '">' + SK.PWR_ICON + '</button>' : '<span style="width:22px"></span>') +
        '<a href="#" data-dev="' + esc(d.id) + '" title="' + esc(d.name + ' — ' + s.value) + '">' + DEV.KINDS[d.kind].icon + ' ' + esc(d.name) + '</a>' +
        (s.status === 'alarm' || s.status === 'fault' || s.status === 'off' ? '<span class="lvl ' + DS.STATUS[s.status].lvl + '">' + DS.STATUS[s.status].name + '</span>' : '<span class="muted">' + esc(String(s.value).slice(0, 18)) + '</span>') + '</div>';
    }).join('') +
      (cab ? '<div class="muted">Шафа ' + esc(cab.id) + ' · ' + cab.controllers.length + ' контролерів (вкладка «Комутація»)</div>' : '') + '</div></details>';
    /* Дії — одразу під заголовком, однаковий вигляд з карткою пристрою */
    var HEND = 'aria-label="Закрити">✕</button></div>', iso = viewer.getIsolated() === r.id;
    h = h.replace(HEND, HEND + '<div class="row dc-acts">' + (role() !== 'guest' ? '<button class="btn small primary" data-act="model" title="Окрема 3D-модель приміщення (або подвійний клік на карті)">' + SK.icon('cube', 'ico sm') + 'Модель кімнати</button>' : '') +
      '<button class="btn small' + (iso ? ' on' : '') + '" data-act="iso" title="Показати лише це приміщення">' + (iso ? SK.icon('x', 'ico sm') + 'Показати все' : SK.icon('target', 'ico sm') + 'Окремо') + '</button>' +
      '<button class="btn small" data-act="focus" title="Наблизити камеру">' + SK.icon('search', 'ico sm') + 'Наблизити</button><button class="btn small" data-act="route" title="Як дійти від входу">' + SK.icon('compass', 'ico sm') + 'Маршрут</button>' +
      (role() !== 'guest' ? '<button class="btn small" data-act="energy" title="Споживання приміщення за добу">' + SK.icon('chart', 'ico sm') + 'Споживання</button>' +
        '<button class="btn small" data-act="log" title="Журнали датчиків і дверей приміщення">' + SK.icon('doc', 'ico sm') + 'Журнал</button>' : '') + '</div>');
    setCard(box, h, 'room:' + r.id);
    drawPeople(r, n);
    var pd = $('#rcPplD', box);
    if (pd) pd.ontoggle = function () { ui.rcPpl = pd.open; drawPeople(r, n); };
    box.onclick = function (e) {
      var pw = e.target.closest('[data-pwr]');
      if (pw) { SK.adminTabs.toastCmd(SK.control.toggle(DEV.device(pw.dataset.pwr))); return; }
      var dl = e.target.closest('[data-dev]');
      if (dl) { e.preventDefault(); ui.pendingBack = r.id; showDevice(DEV.device(dl.dataset.dev)); return; }
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.act === 'close') { viewer.select(null); viewer.clearRoute(); if (viewer.getIsolated()) { viewer.isolate(null); setFloorBtn(''); viewer.setFloor(null); } }
      if (b.dataset.act === 'focus') viewer.focusRoom(r.id);
      if (b.dataset.act === 'model') SK.RoomView.open(r.id);
      if (b.dataset.act === 'iso') { var on = viewer.getIsolated() !== r.id; viewer.isolate(on ? r.id : null); setFloorBtn(on ? r.floor : ''); if (!on) viewer.setFloor(null); renderRoomCard(); }
      if (b.dataset.act === 'route') { viewer.route(r.id); viewer.focusRoom(r.id); }
      if (b.dataset.act === 'energy') showEnergy({ room: r.id });
      if (b.dataset.act === 'log') showLogs({ kind: 'sensors', room: r.id });
    };
    box.onchange = function (e) {
      if (e.target.id === 'rcDur') { ui.rcDur = e.target.value; e.target.blur(); }
      if (e.target.id === 'rcMode') {
        var mode = e.target.value, mins = ui.rcDur ? +ui.rcDur : null;
        SK.scenarios.apply([r.id], mode, mins);
        U.toast(r.id + ': ' + (mode === 'auto' ? 'повернуто автоматику' : 'сценарій «' + SK.scenarios.get(mode).name + '»' + (mins ? ' на ' + mins + ' хв' : '')), 'good');
        e.target.blur();
      }
    };
  }
  /* Панель і картки перемальовуються що дві секунди, тому стан, який змінив користувач
     (розгорнуті блоки, прокрутка картки), зберігається між перемальовуваннями. */
  var detOpen = {}, cardKey = null;
  function keepDetails(root, prefix) {
    U.$all('details:not(.sec)', root).forEach(function (d) {
      var sm = d.querySelector('summary'); if (!sm) return;
      var key = prefix + '|' + sm.textContent.split(/[(·]/)[0].trim();
      if (key in detOpen) d.open = detOpen[key];
      sm.addEventListener('click', function (e) { if (!e.target.closest('button, a')) detOpen[key] = !d.open; });
    });
  }
  function forgetDetails(prefix) { Object.keys(detOpen).forEach(function (k) { if (k.indexOf(prefix) === 0) delete detOpen[k]; }); }
  function setCard(box, h, key) {
    var b = box.querySelector('.rc-b'), sc = b && cardKey === key && !box.hidden ? b.scrollTop : 0;
    box.innerHTML = cardHtml(h).replace('<button class="btn small" data-act="close" aria-label="Закрити">✕</button>', '<button class="icon-btn rc-x" data-act="close" aria-label="Закрити">' + SK.icon('x') + '</button>');
    box.hidden = false; cardKey = key;
    box.dataset.st = key.indexOf('room:') === 0 && B.room(key.slice(5)).bookable ? S.status(key.slice(5), now()).status : '';
    keepDetails(box, key);
    b = box.querySelector('.rc-b'); if (b && sc) b.scrollTop = sc;
  }
  /* Картка = заголовок (перетягується) + тіло, що прокручується */
  function cardHtml(h) {
    var k = h.indexOf('aria-label="Закрити">✕</button></div>');
    if (k < 0) return h;
    k += 'aria-label="Закрити">✕</button></div>'.length;
    return h.slice(0, k) + '<div class="rc-b">' + h.slice(k) + '</div>';
  }
  /* Перетягування картки за заголовок; позиція запам'ятовується на сеанс */
  function initCardDrag() {
    var box = $('#roomCard'), drag = null;
    /* На телефоні картка — шторка; її перетягування — у js/ui/phone.js */
    box.addEventListener('pointerdown', function (e) {
      if (SK.phone && SK.phone.active()) return;
      if (!e.target.closest('.rc-h') || e.target.closest('button, a, select, input')) return;
      var r = box.getBoundingClientRect(), pr = box.offsetParent.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, pr: pr }; box.classList.add('dragging'); box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var x = Math.max(0, Math.min(drag.pr.width - box.offsetWidth, e.clientX - drag.pr.left - drag.dx));
      var y = Math.max(0, Math.min(drag.pr.height - 60, e.clientY - drag.pr.top - drag.dy));
      box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto';
    });
    box.addEventListener('pointerup', function () { if (drag) { drag = null; box.classList.remove('dragging'); } });
  }
  function metric(v, l, ic) { return '<div class="metric">' + (ic ? '<span class="m-ico">' + SK.icon(ic, 'ico sm') + '</span>' : '') + '<div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
  function ctrlSummary(list) {
    var c = {}; list.forEach(function (m) { c[m] = (c[m] || 0) + 1; });
    return Object.keys(c).map(function (m) { return m + (c[m] > 1 ? ' ×' + c[m] : ''); }).join(', ');
  }

  /* ---------------- Панель вкладок ---------------- */
  function renderPanel(soft, fromTick) {
    var p = $('#panel');
    var ae = document.activeElement;
    if (soft && ae && p.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return; // не заважаємо введенню
    if (soft && pressing) return;
    var scroll = p.scrollTop;
    var fn = { overview: overview, rooms: rooms, comfort: comfort, security: security, energy: energy, territory: territory, equipment: equipment, settings: settings, logs: SK.logsTab && SK.logsTab.render }[ui.tab] || (SK.adminTabs || {})[ui.tab];
    /* Періодичне оновлення не повинно стирати те, що користувач уже ввів у поля форми */
    var dirty = {};
    if (fromTick) U.$all('input[id], textarea[id]', p).forEach(function (i) {
      if (i.type !== 'checkbox' && i.type !== 'radio' && i.type !== 'file' && i.value !== i.defaultValue) dirty[i.id] = [i.value, i.defaultValue];
    });
    p.innerHTML = '';
    p.onclick = null; p.onchange = null;
    fn(p);
    Object.keys(dirty).forEach(function (id) { var i = document.getElementById(id); if (i && p.contains(i) && i.defaultValue === dirty[id][1]) i.value = dirty[id][0]; });
    /* Посилання на вкладки, недоступні поточній ролі, — звичайний текст */
    U.$all('[data-goto]', p).forEach(function (a) {
      if (tabAllowed(a.dataset.goto)) return;
      if (a.classList.contains('kpi') || a.classList.contains('att-row')) { a.removeAttribute('data-goto'); a.removeAttribute('href'); a.classList.add('nolink'); }
      else a.replaceWith(document.createTextNode(a.textContent));
    });
    sections(p);
    keepDetails(p, 'tab:' + ui.tab);
    p.scrollTop = scroll;
    updateSecCount();
  }

  /* Єдина структура вкладок: кожен розділ (h3) згортається; довідкові розділи згорнуті одразу.
     Стан «розгорнуто/згорнуто» запам'ятовується на сеанс окремо для кожної вкладки. */
  var REF_SEC = /^(Як проходить команда|Схема інтеграції|Категорії навантажень|Обладнання|Кабельний журнал|Топологія мережі|Про прототип|Журнал змін|Журнал команд|Журнал проходів|Шафи автоматики|Контролери|Без порту|Користувачі|Групи доступу|Перевірка конфліктів|Зміни розкладу|Демо-дані|За блоками|Найбільші споживачі)/;
  function sections(p) {
    ui.sec = ui.sec || {};
    U.$all(':scope > h3', p).forEach(function (h3) {
      var title = h3.textContent.trim(), key = ui.tab + '|' + title.replace(/[\d().:·—–-].*$/, '').trim();
      var det = document.createElement('details'), sum = document.createElement('summary'), body = document.createElement('div');
      det.className = 'sec'; body.className = 'sec-b';
      det.open = key in ui.sec ? ui.sec[key] : !REF_SEC.test(title);
      var init = det.open;
      while (h3.nextSibling && !(h3.nextSibling.nodeType === 1 && /^(H2|H3)$/.test(h3.nextSibling.tagName))) body.appendChild(h3.nextSibling);
      p.insertBefore(det, h3); sum.appendChild(h3); det.appendChild(sum); det.appendChild(body);
      det.addEventListener('toggle', function () { if (det.open === init) return; init = det.open; ui.sec[key] = det.open; if (det.open) renderPanel(true); });
    });
  }

  function lockedNote(what) { if (role() === 'guest') return ''; return '<div class="locked">' + SK.icon('lock', 'ico sm') + ' ' + what + ' — доступно ролі «Адміністратор».</div>'; }

  /* ---- Огляд ---- */
  function overview(p) {
    var n = now(), cnt = { free: 0, busy: 0, booked: 0 }, t = 0, c = 0, k = 0, people = 0, G = role() === 'guest';
    var stuffy = [];
    B.bookableRooms().forEach(function (r) {
      cnt[S.status(r.id, n).status]++;
      var v = I3.read(r.id, n); t += v.temp; c += v.co2; k++; people += v.people;
      if (v.co2 >= 1000) stuffy.push({ r: r, v: v });
    });
    stuffy.sort(function (a, b) { return b.v.co2 - a.v.co2; });
    var pw = E.power(n), act = SEC.active(), pr = S.pairAt(n);
    var h = '<h2>Огляд корпусу</h2><div class="muted small" style="margin-bottom:8px">' + esc(B.name) + ' · ' +
      (pr ? pr.n + '-га пара (' + pr.start + '–' + pr.end + ')' : 'поза парою') + ' · <span class="demo-badge">симуляція</span></div>';

    /* 1. Що потребує уваги — єдиний список із переходом у потрібний розділ */
    var att = [];
    if (!G) {
      var ps = SK.power.state(n), fs = SK.faults.summary(n), ds = DS.summary(n), offN = Object.keys(SK.control.offList() || {}).length;
      if (!ps.grid) att.push(['bad', 'Немає мережі — ' + (ps.genOn ? 'працює генератор' : 'живлення від ДБЖ'), 'power']);
      if (act.length) att.push(['bad', 'Активних сповіщень безпеки: ' + act.length, 'security']);
      if (fs.cabOff + fs.cabBatt + fs.cabLink + fs.ctrl) att.push(['warn', 'Проблеми шаф і контролерів: ' + (fs.cabOff + fs.cabBatt + fs.cabLink + fs.ctrl), 'wiring']);
      if (ds.fault + ds.alarm) att.push(['warn', 'Пристроїв з несправністю чи тривогою: ' + (ds.fault + ds.alarm), 'equipment']);
      if (offN) att.push(['off', 'Вимкнено вручну: ' + offN, 'control']);
    }
    if (stuffy.length) att.push(['warn', 'Аудиторій потребують провітрювання: ' + stuffy.length, 'comfort']);
    h += att.length ? '<div class="att">' + att.map(function (a) {
      return '<a href="#" class="att-row" data-goto="' + a[2] + '"><span class="lvl ' + a[0] + '">' + esc(a[1]) + '</span><span class="muted">відкрити →</span></a>';
    }).join('') + '</div>' : '<div class="att ok"><span class="lvl good">Усе в нормі — нічого не потребує уваги</span></div>';

    /* 2. Головні показники (клік — відповідний розділ) */
    function K(v, l, tab, color) { return '<a href="#" class="kpi kpi-link" data-goto="' + tab + '"><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div><div class="l">' + l + '</div></a>'; }
    h += '<div class="kpis">' +
      K(cnt.free + ' <small>з ' + k + '</small>', 'вільних аудиторій', 'rooms', 'var(--free)') +
      K(people, 'людей в аудиторіях', 'rooms') +
      K(U.fmt(t / k, 1) + ' °C', 'середня температура', 'comfort') +
      K(Math.round(c / k), 'середній CO₂, ppm', 'comfort') +
      (G ? '' : K(U.fmt(pw.total / 1000, 1) + ' кВт', 'потужність зараз', 'energy')) +
      K(DS.parking(n).free, 'вільних паркомісць', 'territory', 'var(--free)') + '</div>';

    if (stuffy.length) h += '<h3>Потребують провітрювання</h3><table class="t"><tbody>' + stuffy.slice(0, 5).map(function (x) {
      return '<tr class="click" data-room="' + x.r.id + '"><td><b>' + x.r.id + '</b></td><td>' + esc(x.r.name) + '</td><td><span class="lvl ' + SEN.co2Level(x.v.co2) + '">' + x.v.co2 + ' ppm</span></td></tr>';
    }).join('') + '</tbody></table>';

    if (!G) h += '<h3>Останні події</h3>' + eventsTable(store.state.events.slice(0, 5), false);

    h += '<h3>Оголошення</h3>';
    h += store.state.announcements.slice(0, 3).map(function (a) {
      return '<div class="small" style="margin-bottom:6px"><b>' + esc(a.from) + ':</b> ' + esc(a.text) + '</div>';
    }).join('');
    if (SEC.can('announce')) h += '<div class="row"><input type="text" id="annText" class="grow" placeholder="Текст оголошення (з’явиться на інфотабло холів)"><button class="btn small primary" id="annSend">Надіслати</button></div>';
    p.innerHTML = h;
    bindRoomRows(p);
    var s = $('#annSend', p);
    if (s) s.onclick = function () {
      var v = $('#annText', p).value.trim(); if (!v) return;
      store.state.announcements.unshift({ id: U.uid('an'), ts: Date.now(), text: v, from: 'Адміністрація корпусу' });
      store.save(); U.toast('Оголошення опубліковано', 'good');
    };
  }
  function kpi(v, l, color) { return '<div class="kpi"><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div><div class="l">' + l + '</div></div>'; }
  function bindRoomRows(p) {
    U.$all('[data-room]', p).forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        viewer.select(tr.dataset.room); viewer.focusRoom(tr.dataset.room);
      });
    });
  }

  /* ---- Аудиторії та розклад ---- */
  function rooms(p) {
    var n = now(), rf = ui.rf, G = role() === 'guest', inf = S.info(), wk = S.weekOf(n);
    var h = '<h2>Аудиторії та розклад</h2>';
    /* Джерело розкладу */
    h += '<div class="note src-note">' + SK.icon('calendar', 'ico sm') + ' <b>Розклад занять — реальний</b>: ' +
      (inf.info.imported ? 'імпортований файл «' + esc(inf.info.name) + '» (' + U.fmtDateTime(new Date(inf.info.at)) + ')' :
        '<a href="' + esc(inf.info.page) + '" target="_blank" rel="noopener">' + esc(inf.info.name) + '</a>') +
      ' · ' + inf.lessons + ' занять, ' + inf.report.streams + ' потоків, ' + inf.groups + ' груп, ' + inf.report.rooms + ' аудиторій корпусу 9.' +
      '<br>Зараз <b>' + wk + '-й тиждень</b> (чергування від 1 вересня). Кількість людей — симуляція за розкладом: розміри груп за курсом, ' +
      'відвідуваність, запізнення, перерви; її показують лічильники людей в аудиторіях. <span class="demo-badge">симуляція присутності</span></div>';
    if (SEC.can('schedule')) {
      h += '<div class="row imp-row"><label class="btn small" title="JSON у форматі сайту розкладу ННІФТКН (src/data/schedule.json)">' + SK.icon('upload', 'ico sm') +
        'Імпортувати JSON<input type="file" id="schFile" accept=".json,application/json" hidden></label>' +
        (inf.info.imported ? '<button class="btn small" id="schReset">' + SK.icon('refresh', 'ico sm') + 'Повернути розклад з сайту</button>' : '') +
        '<span class="small muted">Беруться заняття в аудиторіях корпусу 9; інші корпуси й онлайн пропускаються.</span></div>';
      if (ui.impReport) h += importReport(ui.impReport);
    }
    h += '<div class="row" style="margin:8px 0">' +
      sel('rfBlock', [['', 'Усі блоки'], ['A', 'Блок А'], ['B', 'Блок Б']], rf.block) +
      sel('rfFloor', [['', 'Усі поверхи'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], rf.floor) +
      sel('rfStatus', [['', 'Усі статуси'], ['free', 'Вільні'], ['busy', 'Зайняті'], ['booked', 'Заброньовані']], rf.status) +
      sel('rfType', [['', 'Усі типи']].concat(Object.keys(B.types).filter(function (k) { return B.types[k].bookable; }).map(function (k) { return [k, B.types[k].name]; })), rf.type) +
      '</div>';
    var list = B.bookableRooms().filter(function (r) {
      if (rf.block && r.block !== rf.block) return false;
      if (rf.floor && r.floor !== +rf.floor) return false;
      if (rf.type && r.type !== rf.type) return false;
      return !rf.status || S.status(r.id, n).status === rf.status;
    }).sort(function (a, b) { return a.floor - b.floor || a.label.localeCompare(b.label, 'uk', { numeric: true }); });
    var busyN = 0, ppl = 0;
    list.forEach(function (r) { if (S.status(r.id, n).status === 'busy') busyN++; ppl += SK.i3.read(r.id, n).people; });
    h += '<div class="small muted">Знайдено: ' + list.length + ' · зайнято зараз ' + busyN + ' · людей в аудиторіях ' + ppl + ' (лічильники). Клік — показати на карті.</div>' +
      '<div class="tw"><table class="t"><thead><tr><th>Ауд.</th><th>Статус</th><th>Зараз</th><th>Людей</th><th>Далі</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var s = S.status(r.id, n), v = SK.i3.read(r.id, n);
      h += '<tr class="click" data-room="' + esc(r.id) + '"><td><b>' + esc(r.label) + '</b><div class="small muted">' + esc(B.types[r.type].name) + '</div></td>' +
        '<td><span class="st ' + S.STATUS[s.status].css + '">' + S.STATUS[s.status].name + '</span>' + (s.conflict && !G ? '<div><span class="sev critical">конфлікт</span></div>' : '') + '</td>' +
        '<td class="small">' + (s.lesson ? esc(s.lesson.group) + ' · ' + esc(s.lesson.subject) + '<div class="muted">' + esc(s.lesson.kind) + (s.lesson.teacher ? ' · ' + esc(s.lesson.teacher) : '') + '</div>' : s.booking ? esc(s.booking.purpose) : '—') + '</td>' +
        '<td>' + (DEV.hasCounter(r) ? '<b>' + v.people + '</b>' : '<span class="muted">' + (v.people ? 'рух' : '—') + '</span>') + '</td>' +
        '<td class="small">' + (s.next ? s.next.pair.start + (s.next.lesson ? '' : ' бронь') : '—') + '</td></tr>';
    });
    h += '</tbody></table></div>';

    /* Розклад групи (обидва тижні) */
    var gs = S.groups;
    if (!ui.schGroup || !gs.some(function (g) { return g.id === ui.schGroup; })) ui.schGroup = (gs.filter(function (g) { return g.id === '424'; })[0] || gs[0] || {}).id;
    h += '<h3>Розклад групи</h3><div class="row">' + sel('schGroup', gs.map(function (g) { return [g.id, g.id + ' · ' + g.specialtyName]; }), ui.schGroup) + '</div>';
    var gi = S.groupInfo(ui.schGroup), gw = S.groupWeek(ui.schGroup);
    h += '<div class="small muted">' + esc(gi.level) + (gi.course ? ', ' + gi.course + ' курс' : '') + ' · орієнтовно ' + gi.size + ' студентів (за курсом, у розкладі чисельності немає) · ' +
      gw.length + ' занять у корпусі 9</div>';
    if (gw.length) {
      h += '<div class="tw"><table class="t grp-week"><thead><tr><th>День</th><th>Пара</th><th>Тиждень</th><th>Заняття</th><th>Ауд.</th></tr></thead><tbody>' + gw.map(function (l) {
        var cur = U.dow(n) === l.day && (!l.week || l.week === wk);
        return '<tr class="click' + (cur ? ' today' : '') + '" data-room="' + esc(l.room) + '"><td>' + U.DAYS_SHORT[l.day] + '</td><td>' + l.pair + ' <span class="muted small">' + S.PAIRS[l.pair - 1].start + '</span></td>' +
          '<td class="small">' + weekText(l.week) + '</td><td class="small">' + esc(l.subject) + ' <span class="muted">(' + esc(l.kind) + ')</span>' +
          (l.stream ? '<div class="muted">потік: ' + esc(l.group) + '</div>' : '') + (l.teacher ? '<div class="muted">' + esc(l.teacher) + '</div>' : '') + '</td><td><b>' + esc((B.room(l.room) || {}).label || l.room) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>';
    }

    /* Конфлікти */
    if (!G) {
      var cf = S.conflicts();
      h += '<h3>Перевірка конфліктів розкладу</h3>';
      if (!cf.length) h += '<div class="small" style="color:var(--good)">● Конфліктів не виявлено.</div>';
      else h += '<details><summary>Знайдено ' + cf.length + ' (так у джерелі: різні заняття в одній аудиторії або група у двох аудиторіях одночасно)</summary>' + cf.map(function (c) {
        var l = c.lessons[0];
        return '<div class="card" style="box-shadow:none"><span class="sev critical">' + (c.kind === 'room' ? 'Аудиторія' : 'Група') + '</span> ' +
          U.DAYS[l.day] + ', ' + l.pair + '-га пара, ' + (c.weeks.length > 1 ? 'обидва тижні' : c.weeks[0] + '-й тиждень') + ' — ' +
          (c.kind === 'room' ? '<b>' + esc((B.room(l.room) || {}).label || l.room) + '</b>' : '<b>' + esc(c.lessons.map(function (x) { return x.group; }).filter(function (g, i, a) { return a.indexOf(g) === i; }).join(' / ')) + '</b>') + ':<div class="small">' +
          c.lessons.map(function (x) {
            return esc(x.group + ' · ' + x.subject + ' · ' + ((B.room(x.room) || {}).label || x.room) + (x.teacher ? ' · ' + x.teacher : '')) +
              (SEC.can('schedule') ? ' <button class="btn small danger" data-rm="' + x.id + '">зняти</button>' : '');
          }).join('<br>') + '</div></div>';
      }).join('') + '</details>';

      /* Додавання заняття */
      if (SEC.can('schedule')) {
        h += '<h3>Зміни розкладу</h3><div class="form-grid">' +
          '<label>Аудиторія' + sel('alRoom', B.bookableRooms().map(function (r) { return [r.id, r.label]; }), ui.room && B.room(ui.room).bookable ? ui.room : '') + '</label>' +
          '<label>Група' + sel('alGroup', S.groups.map(function (g) { return [g.id, g.id]; }), ui.schGroup) + '</label>' +
          '<label>День' + sel('alDay', [1, 2, 3, 4, 5].map(function (d) { return [d, U.DAYS[d]]; }), U.dow(n) <= 5 ? U.dow(n) : 1) + '</label>' +
          '<label>Пара' + sel('alPair', S.PAIRS.map(function (x) { return [x.n, x.n + ' (' + x.start + ')']; })) + '</label>' +
          '<label>Тиждень' + sel('alWeek', [[0, 'щотижня'], [1, '1-й'], [2, '2-й']], 0) + '</label>' +
          '<label>Дисципліна<input type="text" id="alSubj" value="Консультація"></label></div>' +
          '<div class="row" style="margin-top:8px"><button class="btn primary small" id="alAdd">Додати з перевіркою конфліктів</button></div>';
      }

      var bk = store.state.bookings;
      h += '<h3>Бронювання (' + bk.length + ')</h3>' + (bk.length ? '<table class="t"><tbody>' + bk.map(function (b) {
        return '<tr><td><b>' + esc((B.room(b.room) || {}).label || b.room) + '</b></td><td class="small">' + b.date + ', ' + b.pair + '-га пара<br>' + esc(b.purpose) + ' · ' + esc(b.who) + '</td><td>' +
          (SEC.can('ack') ? '<button class="btn small" data-cancel="' + b.id + '">Скасувати</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="small muted">Бронювань немає.</div>');
    }
    if (SEC.can('book')) {
      h += '<div class="form-grid" style="margin-top:8px">' +
        '<label>Аудиторія' + sel('bkRoom', B.bookableRooms().map(function (r) { return [r.id, r.label + ' · ' + r.name]; }), ui.room && B.room(ui.room).bookable ? ui.room : '') + '</label>' +
        '<label>Пара (сьогодні)' + sel('bkPair', S.PAIRS.map(function (x) { return [x.n, x.n + ' (' + x.start + ')']; })) + '</label>' +
        '<label style="grid-column:1/3">Мета<input type="text" id="bkPurpose" value="Консультація / самостійна робота"></label></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn small primary" id="bkAdd">Забронювати</button><span class="small muted">Події інституту — вкладка <a href="#" data-goto="events">«Події»</a>.</span></div>';
    }

    p.innerHTML = h;
    bindRoomRows(p);
    ['Block', 'Floor', 'Status', 'Type'].forEach(function (k) {
      $('#rf' + k, p).onchange = function (e) { ui.rf[k.toLowerCase()] = e.target.value; renderPanel(); };
    });
    var sg = $('#schGroup', p); if (sg) sg.onchange = function (e) { ui.schGroup = e.target.value; renderPanel(); };
    var sf = $('#schFile', p);
    if (sf) sf.onchange = function () {
      var f = sf.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var res = S.importJson(String(rd.result), f.name);
        ui.impReport = res;
        U.toast(res.error ? '✕ ' + res.error : 'Розклад імпортовано: ' + res.report.lessons + ' занять', res.error ? 'bad' : 'good');
        renderPanel();
      };
      rd.readAsText(f, 'utf-8');
    };
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'schReset') { S.resetImport(); ui.impReport = null; U.toast('Повернуто розклад з сайту інституту', 'good'); }
      if (b.dataset.rm) { S.removeLesson(b.dataset.rm); U.toast('Заняття знято з розкладу', 'good'); }
      if (b.dataset.cancel) S.cancelBooking(b.dataset.cancel);
      if (b.id === 'bkAdd') {
        var e2 = S.book($('#bkRoom', p).value, now(), +$('#bkPair', p).value, SEC.ROLES[role()].name, $('#bkPurpose', p).value);
        U.toast(e2 ? '✕ ' + e2 : 'Аудиторію заброньовано', e2 ? 'bad' : 'good');
      }
      if (b.id === 'alAdd') {
        var err = S.addLesson({ room: $('#alRoom', p).value, group: $('#alGroup', p).value, day: +$('#alDay', p).value, pair: +$('#alPair', p).value,
          week: +$('#alWeek', p).value, subject: $('#alSubj', p).value || 'Заняття', teacher: '', kind: 'Практична', type: 'practice' });
        U.toast(err ? '✕ ' + err : 'Заняття додано без конфліктів', err ? 'bad' : 'good');
      }
    };
  }
  function importReport(res) {
    if (res.error && !res.report) return '<div class="note bad-note">' + esc(res.error) + '</div>';
    var r = res.report, unk = Object.keys(r.unknownRoom || {});
    return '<div class="note' + (res.error ? ' bad-note' : '') + '">' + (res.error ? esc(res.error) + '<br>' : '<b>Імпорт:</b> ') +
      'рядків ' + r.total + ' · корпус 9: ' + r.k9 + ' → ' + r.lessons + ' занять (' + r.streams + ' потоків), ' + r.groups + ' груп' +
      ' · інші корпуси ' + r.otherBuilding + ', онлайн ' + r.online + ', без аудиторії ' + r.noRoom + (r.badRow ? ', некоректних ' + r.badRow : '') +
      (unk.length ? '<br>Аудиторій немає в моделі корпусу (пропущено): ' + esc(unk.join(', ')) : '') + '</div>';
  }
  function sel(id, opts, val) {
    return '<select id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  /* ---- Комфорт (моніторинг; керування — вкладка «Сценарії») ---- */
  function comfort(p) {
    var n = now(), st = store.state.settings, G = role() === 'guest';
    var emptyRule = SK.scenarios.rules().filter(function (r) { return r.type === 'empty'; })[0];
    var h = '<h2>Комфорт і «розумна аудиторія»</h2><div class="note">PIR-датчики фіксують присутність, датчики CO₂ — якість повітря; контролер Atom виконує сценарій, який обрав рушій правил. ' +
      (emptyRule ? 'Без людей довше ' + emptyRule.minutes + ' хв — сценарій «' + esc(SK.scenarios.get(emptyRule.sc).name) + '». ' : '') +
      'При CO₂ > 1000 ppm вентиляція посилюється автоматично. ' + (G ? '' : 'Правила й сценарії — вкладка <a href="#" data-goto="scenarios">«Сценарії»</a>. ') + '<span class="demo-badge">значення симульовані</span></div>';
    h += '<div class="row"><b>Автоматика:</b> <span class="lvl ' + (st.automation ? 'good' : 'warn') + '">' + (st.automation ? 'увімкнена' : 'вимкнена (порівняльний режим)') + '</span>' +
      (SEC.can('settings') ? '<button class="btn small" id="autoTgl">' + (st.automation ? 'Вимкнути для порівняння' : 'Увімкнути') + '</button>' : '') + '</div>';
    var rows = B.bookableRooms().map(function (r) { return { r: r, v: I3.read(r.id, n) }; });
    var wasted = rows.filter(function (x) { return !x.v.people && x.v.lightOn; });
    if (!G) h += '<h3>Світло без людей: ' + wasted.length + '</h3><div class="small muted">' + (wasted.length ? wasted.map(function (x) { return x.r.id + (x.v.hold ? ' (затримка)' : ''); }).join(', ') : 'Немає — автоматика працює.') + '</div>';
    /* Кімнати для куріння — на кожному поверсі обох блоків */
    var sr = DS.smokingRooms(n);
    h += '<h3>Кімнати для куріння (' + sr.length + ')</h3>' + (G ? '<div class="small muted" style="margin-bottom:6px">Куріння в корпусі дозволене лише в позначених кімнатах на кожному поверсі.</div>' : '<div class="note" style="border-left-color:var(--warn)"><b>Потребує погодження.</b> Ст. 13 Закону України № 2899-IV ' +
      'забороняє куріння в приміщеннях закладів освіти; облаштування кімнат для куріння в корпусі потрібно погодити з адміністрацією ЧНУ та юристом. ' +
      'Технічно: окрема витяжка з розрідженням, двері з доводчиком, датчик PM2.5, PIR, детектори вейпу в санвузлах і на сходах (там куріння заборонене).</div>') +
      '<div class="tw"><table class="t"><thead><tr><th>Кімната</th><th>Люди</th><th>PM2.5</th><th>Витяжка</th>' + (G ? '' : '<th>Двері</th>') + '</tr></thead><tbody>' + sr.map(function (x) {
        return '<tr class="click" data-room="' + x.room.id + '"><td><b>' + x.room.id + '</b><div class="small muted">' + esc(B.blockById(x.room.block).name) + ', поверх ' + x.room.floor + '</div></td>' +
          '<td>' + x.s.people + '</td><td><span class="lvl ' + (x.s.pm25 < 35 ? 'good' : x.s.pm25 < 150 ? 'warn' : 'bad') + '">' + x.s.pm25 + '</span></td>' +
          '<td class="small">' + (x.s.exhaust ? 'працює' : 'черговий') + '</td>' + (G ? '' : '<td class="small">' + (x.s.doorOpen ? '<span class="lvl bad">відчинено</span>' : 'зачинено') + '</td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
    var wcs = B.rooms.filter(function (r) { return r.type === 'wc'; });
    if (!G) h += '<div class="small muted" style="margin-top:6px">Санвузли: ' + wcs.length + ' (жіночий і чоловічий на кожному поверсі обох блоків) — датчики протікання, вейп-детектори, освітлення за PIR.</div>';
    rows.sort(function (a, b) { return b.v.co2 - a.v.co2; });
    h += '<h3>Аудиторії (за CO₂)</h3><div class="tw"><table class="t"><thead><tr><th>Ауд.</th><th>Люди</th><th>T, °C</th><th>CO₂</th><th>Світло</th><th>Сценарій</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr class="click" data-room="' + x.r.id + '"><td><b>' + x.r.id + '</b></td><td>' + x.v.people + '</td><td>' + x.v.temp + '</td><td><span class="lvl ' + SEN.co2Level(x.v.co2) + '">' + x.v.co2 + '</span></td><td>' +
          (x.v.lightOn ? Math.round(x.v.lightLevel * 100) + '%' : '—') + '</td><td class="small">' + esc(x.v.scName) + (x.v.manual ? ' (ручн.)' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    p.innerHTML = h;
    bindRoomRows(p);
    var tg = $('#autoTgl', p);
    if (tg) tg.onclick = function () { st.automation = !st.automation; store.save(); };
  }

  /* ---- Безпека ---- */
  function eventsTable(list, actions) {
    if (!list.length) return '<div class="small muted">Подій немає.</div>';
    return '<div class="tw"><table class="t"><thead><tr><th>Час</th><th>Подія</th><th>Статус</th>' + (actions ? '<th></th>' : '') + '</tr></thead><tbody>' + list.map(function (e) {
      var guest = role() === 'guest';
      return '<tr' + (e.room ? ' class="click" data-room="' + e.room + '"' : '') + '><td class="small">' + U.fmtDateTime(new Date(e.ts)) + '</td><td><span class="sev ' + e.sev + '">' + SEC.SEV[e.sev] + '</span> ' +
        esc(SEC.TYPES[e.type].name) + (e.room ? ' · <b>' + e.room + '</b>' : '') + (guest ? '' : '<div class="small muted">' + esc(e.note) + '</div>') + '</td><td class="small">' + SEC.STATUS[e.status] +
        (e.by ? '<div class="muted">' + esc(e.by) + '</div>' : '') + (e.resolved ? '<div class="resolved">✓ ' + esc(e.resolved) + (e.at ? ' о ' + U.hhmm(new Date(e.at)) : '') + '</div>' : '') + '</td>' +
        (actions ? '<td>' + (SEC.can('ack') ? (e.status === 'new' ? '<button class="btn small" data-ack="' + e.id + '">Підтвердити</button>' : '') +
          (e.status !== 'closed' ? '<button class="btn small" data-close="' + e.id + '">Закрити</button>' : '') : '') + '</td>' : '') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }

  function security(p) {
    var h = '<h2>Безпека та сповіщення</h2><div class="sys">' + SEC.systems().map(function (s) {
      return '<div class="card"><div class="small muted">' + esc(s.name) + '</div><span class="lvl ' + s.state + '">' + esc(s.text) + '</span></div>';
    }).join('') + '</div>';
    h += '<div class="note">Пожежна сигналізація та евакуаційні системи — чинні сертифіковані системи. Прототип лише показує їх умовний стан і не втручається в їхню роботу.</div>';

    h += '<h3>Тестові події</h3>';
    if (SEC.can('test')) h += '<div class="row">' + SEC.TESTS.map(function (t, i) { return '<button class="btn small" data-test="' + i + '">' + esc(t.label) + '</button>'; }).join('') + '</div>';
    else h += lockedNote('Генерація тестових подій');

    var all = store.state.events, f = ui.evFilter;
    var list = all.filter(function (e) { return f === 'all' || (f === 'open' ? e.status !== 'closed' : e.status === f); });
    h += '<h3>Журнал подій</h3><div class="row" style="margin-bottom:6px">' +
      sel('evF', [['all', 'Усі (журнал)'], ['open', 'Активні'], ['new', 'Нові'], ['ack', 'Підтверджені'], ['closed', 'Закриті / усунуті']], f) +
      '<span class="small muted">' + list.length + ' з ' + all.length + '</span><span class="grow"></span>' +
      (role() !== 'guest' ? '<button class="btn small" id="evCsv">Експорт CSV</button>' : '') + '</div>';
    if (role() === 'guest') h += '<div class="small muted" style="margin-bottom:6px">Гість бачить лише тип і статус подій; деталі — для відповідальних осіб.</div>';
    h += eventsTable(list.slice(0, 60), true);

    h += '<div class="note">Двері, користувачі й журнал проходів за відбитками — вкладка <a href="#" data-goto="access">«Доступ»</a>. Стан живлення — <a href="#" data-goto="power">«Живлення»</a>.</div>';
    p.innerHTML = h;
    bindRoomRows(p);
    $('#evF', p).onchange = function (e) { ui.evFilter = e.target.value; renderPanel(); };
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.test) { var ev = SEC.TESTS[+b.dataset.test].run(); viewer.select(ev.room); viewer.focusRoom(ev.room); }
      if (b.dataset.ack) SEC.setStatus(b.dataset.ack, 'ack');
      if (b.dataset.close) SEC.setStatus(b.dataset.close, 'closed');
      if (b.id === 'evCsv') download('zhurnal-podiy.csv', SEC.toCSV(), 'text/csv');
    };
  }
  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---- Енергія ---- */
  /* ---- Споживання: кожен пристрій окремо, добовий графік шарами з піком ---- */
  function energy(p) {
    var DP = SK.devpower, n = now(), st = store.state.settings, ef = ui.ef;
    var dateKey = ef.date || U.dateKey(n), date = new Date(dateKey + 'T12:00:00'), isToday = dateKey === U.dateKey(n);
    var m = n.getHours() * 60 + n.getMinutes();
    var f = { scope: ef.scope, block: ef.block, floor: ef.floor, room: ef.room, device: ef.device };
    if (f.scope === 'device' && !f.device) f.scope = f.room ? 'room' : 'all';
    if (f.scope === 'room' && !f.room) f.scope = 'all';
    var ser = DP.series(date, f), pk = DP.peak(ser), kwhDay = DP.kwh(ser);
    var done = isToday ? ser.filter(function (x) { return x.t + DP.STEP <= m; }) : ser, kwhDone = DP.kwh(done);
    var nowW = isToday ? (ser.filter(function (x) { return x.t <= m; }).slice(-1)[0] || { total: 0 }).total : null;
    var big = !f.scope || f.scope === 'all', unitK = (pk && pk.total < 2000) ? 1 : 1000, uN = unitK === 1 ? 'Вт' : 'кВт';
    function W_(w, d) { return U.fmt(w / unitK, d != null ? d : (w / unitK < 10 ? 2 : 1)) + ' ' + uN; }
    var scopeTitle = f.scope === 'device' ? DP.entries.filter(function (e) { return e.id === f.device; })[0].name :
      f.scope === 'room' ? f.room + ' · ' + B.room(f.room).name : f.scope === 'floor' ? B.blockById(f.block).name + ', поверх ' + f.floor :
      f.scope === 'block' ? B.blockById(f.block).name : f.scope === 'system' ? 'система «Розумний корпус»' : 'увесь корпус';

    var rooms = B.rooms.slice().sort(function (a, b) { return a.id.localeCompare(b.id, 'uk'); });
    var h = '<h2>Споживання</h2><div class="muted small">Потужність кожного пристрою — за паспортом і станом (сценарій, розклад, люди, ручні команди). ' +
      '<span class="demo-badge">симуляція</span></div>';
    h += '<div class="ef-row"><input type="date" id="efDate" value="' + dateKey + '" title="Дата">' +
      sel('efScope', [['all', 'Увесь корпус'], ['system', 'Лише система «Розумний корпус»'], ['block', 'Блок'], ['floor', 'Поверх'], ['room', 'Приміщення'], ['device', 'Окремий пристрій']], ef.scope) +
      (ef.scope === 'block' || ef.scope === 'floor' ? sel('efBlock', [['A', 'Блок А'], ['B', 'Блок Б']].concat(ef.scope === 'block' ? [['C', 'Перемичка'], ['T', 'Територія']] : []), ef.block) : '') +
      (ef.scope === 'floor' ? sel('efFloor', [0, 1, 2, 3, 4].map(function (x) { return [String(x), 'поверх ' + x]; }), ef.floor) : '') +
      (ef.scope === 'room' || ef.scope === 'device' ? sel('efRoom', [['', '— приміщення —']].concat(rooms.map(function (r) { return [r.id, r.id + ' · ' + r.name]; })), ef.room) : '') +
      (ef.scope === 'device' && ef.room ? sel('efDev', [['', '— пристрій —']].concat(DEV.devices.filter(function (d) { return d.room === ef.room; }).map(function (d) { return [d.id, DEV.KINDS[d.kind].name + ' · ' + d.id]; })), ef.device) : '') +
      (isToday ? '' : '<button class="btn small" id="efToday">Сьогодні</button>') + '</div>';
    h += '<div class="small muted">Показано: <b>' + esc(scopeTitle) + '</b>, ' + U.DAYS[U.dow(date)].toLowerCase() + ' ' + dateKey.split('-').reverse().join('.') + '</div>';

    h += '<div class="kpis" style="margin-top:8px">' +
      (isToday ? kpi(W_(nowW), 'потужність зараз', big && nowW / 1000 > st.energyThresholdKw ? 'var(--bad)' : null) : kpi(W_(kwhDay * 1000 / 24), 'середня за добу')) +
      kpi(pk ? W_(pk.total) : '—', pk ? 'пік о ' + U.minToHHMM(pk.t) : 'пік', 'var(--bad)') +
      kpi(U.fmt(isToday ? kwhDone : kwhDay, kwhDay < 10 ? 2 : 0) + ' кВт·год', isToday ? 'спожито до ' + U.minToHHMM(m) + ' · за добу ≈ ' + U.fmt(kwhDay, kwhDay < 10 ? 2 : 0) : 'спожито за добу') + '</div>';
    h += '<h3>Потужність протягом доби, ' + uN + '</h3><div id="chStack"></div>' +
      '<div class="small muted">Крок 5 хв. ' + (isToday ? 'Після позначки «зараз» — розрахунок за розкладом і сценаріями. ' : '') + 'Наведіть на графік — склад потужності в цей момент.</div>';

    /* Складові доби */
    var tot = {}; DP.LAYERS.forEach(function (L) { tot[L.id] = 0; });
    ser.forEach(function (x) { DP.LAYERS.forEach(function (L) { tot[L.id] += x.layers[L.id] * DP.STEP / 60 / 1000; }); });
    h += '<div class="layer-legend">' + DP.LAYERS.slice().reverse().filter(function (L) { return tot[L.id] > 0; }).map(function (L) {
      return '<span title="' + esc(L.note || L.name) + '"><i style="background:' + L.css + '"></i>' + esc(L.name) + '</span><span class="num">' + U.fmt(tot[L.id], tot[L.id] < 10 ? 2 : 1) + ' кВт·год</span>' +
        '<span class="pct">' + Math.round(tot[L.id] / (kwhDay || 1) * 100) + ' %</span>';
    }).join('') + '</div>';

    /* Пік: з чого складається і хто створює */
    if (pk && pk.total > 0) {
      var who = DP.at(date, f, pk.t, 6);
      h += '<div class="peak-box"><div class="row"><span class="grow">Пікове споживання</span><b class="big" style="color:var(--bad)">' + W_(pk.total) + '</b></div>' +
        '<div class="small">о ' + U.minToHHMM(pk.t) + '–' + U.minToHHMM(pk.t + DP.STEP) + ' · ' + DP.LAYERS.slice().reverse().filter(function (L) { return pk.layers[L.id] > 0; }).map(function (L) {
          return '<span style="white-space:nowrap"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + L.css + '"></i> ' + esc(L.short) + ' ' + Math.round(pk.layers[L.id] / pk.total * 100) + ' %</span>';
        }).join(' · ') + '</div>' +
        (f.scope !== 'device' ? '<table class="t" style="margin-top:6px"><tbody>' + who.map(function (x) {
          return '<tr' + (x.e.dev ? ' class="click" data-edev="' + esc(x.e.id) + '"' : x.e.room ? ' data-room="' + esc(x.e.room) + '"' : '') + '><td class="small">' + (x.e.dev ? DEV.KINDS[x.e.kind].icon + ' ' : '') + esc(x.e.name) + '</td>' +
            '<td class="small" style="text-align:right;white-space:nowrap">' + W_(x.w) + '</td></tr>';
        }).join('') + '</tbody></table>' : '') + '</div>';
    }

    /* Рейтинг за добу */
    if (f.scope !== 'device') {
      var rk = DP.ranking(date, f, null, 10);
      h += '<h3>Найбільші споживачі за добу</h3><table class="t"><thead><tr><th>Споживач</th><th style="text-align:right">кВт·год</th><th style="text-align:right">макс.</th></tr></thead><tbody>' + rk.map(function (x) {
        return '<tr' + (x.e.dev ? ' class="click" data-edev="' + esc(x.e.id) + '"' : x.e.room ? ' data-room="' + esc(x.e.room) + '"' : '') + '><td class="small">' + (x.e.dev ? DEV.KINDS[x.e.kind].icon + ' ' : '') + esc(x.e.name) + '</td>' +
          '<td style="text-align:right">' + U.fmt(x.kwh, x.kwh < 1 ? 3 : 1) + '</td><td class="small" style="text-align:right;white-space:nowrap">' + W_(x.max) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }

    /* Паспортні дані типів пристроїв у вибірці */
    var kinds = DP.kindsIn(f);
    h += '<details class="sec" data-key="ef-pass"' + (f.scope === 'device' ? ' open' : '') + '><summary><h3>Паспортна потужність пристроїв</h3></summary><table class="t"><thead><tr><th>Тип</th><th>шт.</th><th>робота / макс. / черговий, Вт</th></tr></thead><tbody>' +
      Object.keys(kinds).map(function (k) {
        var pp = DP.passportOf(k); if (!pp) return '';
        var P = pp.p, v = P.avg == null ? 'за навантаженням' : U.fmt(P.avg, P.avg < 1 ? 2 : 0) + ' / ' + U.fmt(P.max, P.max < 1 ? 2 : 0) + ' / ' + U.fmt(P.stby, P.stby < 1 ? 2 : 1);
        return '<tr><td class="small">' + DEV.KINDS[k].icon + ' ' + esc(DEV.KINDS[k].name) + '<div class="muted">' + esc(P.how) + '</div>' +
          '<div class="muted">' + (pp.src.url ? '<a href="' + esc(pp.src.url) + '" target="_blank" rel="noopener">' + esc(pp.src.t) + ' ↗</a>' : esc(pp.src.t)) + (P.ref ? '<span class="src-ref">довідково</span>' : '') + '</div></td>' +
          '<td>' + kinds[k] + '</td><td class="small" style="white-space:nowrap">' + v + '</td></tr>';
      }).join('') + '</tbody></table></details>';

    /* Тиждень і заощадження від автоматики — для всього корпусу */
    if (big) {
      var td = E.today(n);
      h += '<h3>Споживання за 7 днів, кВт·год</h3><div id="chWeek"></div>';
      h += '<div class="kpis">' + kpi(U.fmt(td.kwh, 0), 'кВт·год сьогодні') + kpi(U.fmt(td.saved, 0), 'заощаджено автоматикою', 'var(--good)') + '</div>';
      h += '<div class="note">Заощадження: фактичний режим з автоматикою порівнюється з розрахунковим «без автоматики» (світло й техніка увімкнені від першої пари до 18:00).</div>';
      h += '<div class="row"><span>Поріг сповіщення:</span>' + (SEC.can('settings') ? '<input type="number" id="thr" value="' + st.energyThresholdKw + '" min="5" max="500" style="width:80px"> кВт <button class="btn small" id="thrSave">Зберегти</button>' : '<b>' + st.energyThresholdKw + ' кВт</b>') + '</div>';
    }
    p.innerHTML = h;
    bindRoomRows(p);
    U.$all('[data-edev]', p).forEach(function (tr) { tr.addEventListener('click', function () { var d = DEV.device(tr.dataset.edev); if (d) openDevice(d); }); });
    SK.charts.stack($('#chStack', p), ser, DP.LAYERS, { now: isToday ? m : null, threshold: big ? st.energyThresholdKw : null, scale: unitK, unit: uN, label: 'Потужність за добу: ' + scopeTitle });
    function setEf(k, v) { ef[k] = v; renderPanel(); }
    $('#efDate', p).onchange = function (e) { setEf('date', e.target.value === U.dateKey(n) ? '' : e.target.value); };
    $('#efScope', p).onchange = function (e) { setEf('scope', e.target.value); };
    ['efBlock', 'efFloor', 'efRoom', 'efDev'].forEach(function (id) {
      var el2 = $('#' + id, p); if (!el2) return;
      el2.onchange = function (e) { var k = { efBlock: 'block', efFloor: 'floor', efRoom: 'room', efDev: 'device' }[id]; if (k === 'room') ef.device = ''; setEf(k, e.target.value); };
    });
    var tb = $('#efToday', p); if (tb) tb.onclick = function () { setEf('date', ''); };
    if (big) {
      var wk = E.week(n);
      SK.charts.bars($('#chWeek', p), wk.map(function (d) {
        return { label: U.DAYS_SHORT[U.dow(d.date)], title: U.DAYS[U.dow(d.date)] + ', ' + U.dateKey(d.date) + (d.partial ? ' (до цього моменту)' : ''), values: [d.kwh, d.kwhBase], partial: d.partial };
      }), ['З автоматикою', 'Без автоматики'], { unit: 'кВт·год', label: 'Споживання за 7 днів' });
      var ts = $('#thrSave', p);
      if (ts) ts.onclick = function () { st.energyThresholdKw = +$('#thr', p).value || st.energyThresholdKw; store.save(); U.toast('Поріг збережено', 'good'); };
    }
  }
  /* Відкрити «Журнали» з фільтром на приміщення / пристрій */
  function showLogs(o) { SK.logsTab.open(o); setTab('logs'); setPanelOpen(true); }
  /* Відкрити «Споживання» з фільтром на пристрій або приміщення (з картки на карті) */
  function showEnergy(o) {
    ui.ef.date = ''; ui.ef.scope = o.device ? 'device' : 'room'; ui.ef.room = o.room || ''; ui.ef.device = o.device || '';
    setTab('energy'); setPanelOpen(true);
  }

  /* ---- Обладнання i3 Engineering ---- */
  function equipment(p) {
    var t = DEV.totals();
    var h = '<h2>Обладнання i3 Engineering</h2><div class="note">Концептуальний підбір на базі контролерів серії <b>Atom</b> українського виробника i3 Engineering (Львів): ' +
      'DIN-рейкові контролери, налаштування через застосунок i3 Home, підтримка MQTT, Modbus RS-485, 1-Wire. ' +
      'Точні моделі, кількість і схему монтажу визначають після обстеження корпусу разом із виробником. ' +
      '<a href="' + DEV.vendorUrl + '" target="_blank" rel="noopener">Каталог серії Atom ↗</a></div>';
    h += '<h3>Контролери</h3><table class="t"><thead><tr><th>Модель</th><th>К-сть</th><th>Призначення</th></tr></thead><tbody>' + Object.keys(t.controllers).map(function (k) {
      return '<tr><td><b>' + esc(k) + '</b><div class="small muted">' + esc(DEV.CATALOG[k].u) + '</div></td><td>' + t.controllers[k] + '</td><td class="small">' + esc(DEV.CATALOG[k].role) + '</td></tr>';
    }).join('') + '</tbody></table>';
    /* Реєстр пристроїв за категоріями */
    var n = now(), sum = DS.summary(n);
    h += '<h3>Розумні пристрої · ' + sum.total + ' шт.' + (sum.alarm ? ' · <span class="lvl bad">' + sum.alarm + ' тривога</span>' : '') +
      (sum.fault ? ' · <span class="lvl warn">' + sum.fault + ' потребують уваги</span>' : '') + '</h3>';
    h += '<table class="t"><tbody>' + Object.keys(DEV.CATS).map(function (c) {
      var kinds = Object.keys(t.kinds).filter(function (k) { return DEV.KINDS[k].cat === c; });
      return '<tr><td><span class="cat-dot" style="background:' + DEV.CATS[c].css + '"></span><b>' + DEV.CATS[c].name + '</b><div class="small muted">' +
        kinds.map(function (k) { return DEV.KINDS[k].icon + ' ' + esc(DEV.KINDS[k].name) + ' ×' + t.kinds[k]; }).join('<br>') + '</div></td>' +
        '<td>' + (t.cats[c] || 0) + '</td><td><button class="btn small" data-showcat="' + c + '">На плані</button></td></tr>';
    }).join('') + '</tbody></table>';

    var df = ui.df;
    h += '<h3>Пошук пристрою</h3><div class="row" style="margin-bottom:6px">' +
      sel('dfCat', [['', 'Усі категорії']].concat(Object.keys(DEV.CATS).map(function (c) { return [c, DEV.CATS[c].name]; })), df.cat) +
      sel('dfFloor', [['', 'Усі поверхи'], ['0', '0 (хол)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['T', 'Територія']], df.floor) +
      sel('dfStatus', [['', 'Будь-який стан'], ['problem', 'Тривога / несправність'], ['active', 'Активні']], df.status) + '</div>';
    var list = DEV.devices.filter(function (d) {
      if (df.cat && d.cat !== df.cat) return false;
      if (df.floor === 'T' && d.block !== 'T') return false;
      if (df.floor && df.floor !== 'T' && (d.block === 'T' || d.floor !== +df.floor)) return false;
      if (df.status) {
        var s = DS.state(d, n).status;
        if (df.status === 'problem' && s !== 'alarm' && s !== 'fault') return false;
        if (df.status === 'active' && s !== 'active') return false;
      }
      return true;
    });
    h += '<div class="small muted">Знайдено: ' + list.length + (list.length > 80 ? ' (показано 80 — уточніть фільтр)' : '') + '</div>';
    h += '<div class="tw"><table class="t dev-list"><tbody>' + list.slice(0, 80).map(function (d) {
      var s = DS.state(d, n);
      return '<tr class="click" data-dev="' + esc(d.id) + '"><td><span class="ico">' + DEV.KINDS[d.kind].icon + '</span></td><td><b>' + esc(d.room || d.label || d.zone || d.id) + '</b>' +
        '<div class="small muted">' + esc(d.name) + '</div></td><td class="small">' + esc(s.value) + '</td><td><span class="lvl ' + DS.STATUS[s.status].lvl + ' small">' + DS.STATUS[s.status].name + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';

    h += '<h3>Шафи автоматики</h3><table class="t"><thead><tr><th>Шафа</th><th>Склад</th><th>Стан</th></tr></thead><tbody>' + DEV.cabinets.map(function (c) {
      var where = c.territory ? 'Територія' : B.blockById(c.block).name + ', ' + c.floor + ' пов.';
      return '<tr><td><b>' + esc(c.id) + '</b><div class="small muted">' + esc(where) + '</div></td><td class="small">' + esc(ctrlSummary(c.controllers)) +
        '<div class="muted"><code>' + esc(c.mqtt) + '</code></div></td><td><span class="lvl good">онлайн</span> <span class="demo-badge">сим.</span></td></tr>';
    }).join('') + '</tbody></table>';
    h += '<h3>Схема інтеграції</h3><div class="small">Датчики → контролери Atom → MQTT-брокер → сервер «Розумного корпусу» → вебпанель та інфотабло. ' +
      'Зчитувачі доступу, онлайн-дошки й камери — окремими мережевими сервісами через той самий сервер. ' +
      'Поточне джерело даних: <b>' + (I3.mode === 'sim' ? 'симулятор' : 'MQTT') + '</b>. Деталі — docs/architecture.md.</div>';
    p.innerHTML = h;
    ['Cat', 'Floor', 'Status'].forEach(function (k) { $('#df' + k, p).onchange = function (e) { ui.df[k.toLowerCase()] = e.target.value; renderPanel(); }; });
    p.onclick = function (e) {
      var b = e.target.closest('[data-showcat]');
      if (b) { setDevCats([b.dataset.showcat]); return; }
      var tr = e.target.closest('[data-dev]');
      if (tr) showDevice(DEV.device(tr.dataset.dev));
    };
  }

  /* ---- Територія ---- */
  function territory(p) {
    var n = now(), p1 = DS.parking(n, 'P1'), p2 = DS.parking(n, 'P2'), all = DS.parking(n);
    var h = '<h2>Територія корпусу</h2><div class="muted small">' + esc(TR.note) + ' · <span class="demo-badge">симуляція</span></div>';
    h += '<h3>Розумна парковка</h3><div class="kpis">' + kpi(all.free + ' / ' + all.total, 'вільних місць', all.free ? 'var(--free)' : 'var(--bad)') +
      kpi(p1.free, 'вільно в P1 (схід)') + kpi(p2.free, 'вільно в P2 (північ)') + kpi(all.mgnFree, 'вільно для МГН', 'var(--booked)') + '</div>' +
      '<div class="small muted" style="margin-top:6px">Датчики на кожному місці → шлюз → Atom Cobalt. На карті: зелене — вільне, червоне — зайняте, блакитне — місце для МГН. Табло біля в’їзду показує кількість вільних місць.</div>' +
      '<div class="row" style="margin-top:6px"><button class="btn small" data-zone="P1">Показати P1</button><button class="btn small" data-zone="P2">Показати P2</button></div>';

    h += '<h3>Зона відпочинку</h3><div class="small">Двір перед головним входом (≈ 17 × 20 м): 2 розумні лавки з USB-зарядкою й підсвіткою, вулична точка Wi-Fi, освітлення за PIR-датчиками.</div>' +
      '<div class="row" style="margin-top:6px"><button class="btn small" data-zone="REST">Показати</button></div>';

    h += '<h3>Майданчик ДГУ</h3><div class="small">' + esc(TR.zone('GEN').note) + ' Стан — вкладка <a href="#" data-goto="power">«Живлення»</a>.</div>' +
      '<div class="note">Місць для куріння на території немає — кімнати для куріння з окремою витяжкою є на кожному поверсі (вкладка <a href="#" data-goto="comfort">«Клімат»</a>).</div>';

    if (role() !== 'guest') h += '<h3>Пристрої території</h3><table class="t dev-list"><tbody>' + DEV.devices.filter(function (d) { return d.block === 'T'; }).map(function (d) {
      var s = DS.state(d, n);
      return '<tr class="click" data-dev="' + esc(d.id) + '"><td><span class="ico">' + DEV.KINDS[d.kind].icon + '</span></td><td><b>' + esc(TR.zone(d.zone).name) + '</b><div class="small muted">' + esc(d.name) +
        '</div></td><td class="small">' + esc(s.value) + '</td><td><span class="lvl ' + DS.STATUS[s.status].lvl + ' small">' + DS.STATUS[s.status].name + '</span></td></tr>';
    }).join('') + '</tbody></table>';
    p.innerHTML = h;
    p.onclick = function (e) {
      var z = e.target.closest('[data-zone]');
      if (z) {
        var zz = TR.zone(z.dataset.zone);
        setDevCats(['territory']); setFloorBtn('');
        viewer.setFloor(null);
        viewer.focusDevice({ block: 'T', x: (zz.x0 + zz.x1) / 2, y: (zz.y0 + zz.y1) / 2, z: 0 });
        return;
      }
      var tr = e.target.closest('[data-dev]');
      if (tr) showDevice(DEV.device(tr.dataset.dev));
    };
  }

  /* ---- Шар пристроїв на карті ---- */
  function initDevLayer() {
    var pop = $('#devPop'), btn = $('#devBtn');
    var t = DEV.totals();
    function draw() {
      var on = ui.devCats || [];
      pop.innerHTML = '<div class="row"><b class="grow">Розумні пристрої на плані</b><button class="btn small" data-x="1" aria-label="Закрити">✕</button></div>' +
        allowedCats().map(function (c) {
          return '<label><input type="checkbox" data-cat="' + c + '"' + (on.indexOf(c) >= 0 ? ' checked' : '') + '><span class="dot" style="border-color:' + DEV.CATS[c].css + '"></span>' +
            DEV.CATS[c].name + '<span class="n">' + (t.cats[c] || 0) + '</span></label>';
        }).join('') +
        '<div class="row" style="margin-top:6px"><button class="btn small" data-all="1">Усі</button><button class="btn small" data-none="1">Сховати</button></div>' +
        '<div class="small muted" style="margin-top:6px">Колір кільця — категорія. Значок «!» — тривога чи несправність, ⏻ — вимкнено вручну. Клік по іконці — картка пристрою, подвійний клік — наблизити. Порада: оберіть поверх — так менше маркерів.</div>';
    }
    btn.onclick = function () { draw(); pop.hidden = !pop.hidden; };
    pop.addEventListener('change', function (e) {
      if (!e.target.dataset.cat) return;
      setDevCats(U.$all('input[data-cat]', pop).filter(function (i) { return i.checked; }).map(function (i) { return i.dataset.cat; }), true);
    });
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x) pop.hidden = true;
      if (b.dataset.all) { setDevCats(allowedCats()); draw(); }
      if (b.dataset.none) { setDevCats(null); draw(); }
    });
    window.SK_redrawDevPop = draw;
  }
  function setDevCats(cats, keepPop) {
    if (cats) cats = cats.filter(function (c) { return allowedCats().indexOf(c) >= 0; });
    ui.devCats = cats && cats.length ? cats : null;
    viewer.setDevices(ui.devCats);
    var btn = $('#devBtn');
    btn.classList.toggle('on', !!ui.devCats);
    btn.innerHTML = SK.icon('radar') + 'Пристрої' + (ui.devCats ? ' · ' + ui.devCats.length : ''); btn.classList.toggle('on', !!ui.devCats);
    if (!keepPop && !$('#devPop').hidden && window.SK_redrawDevPop) window.SK_redrawDevPop();
  }
  function setFloorBtn(f) { U.$all('#floors button').forEach(function (x) { x.classList.toggle('on', x.dataset.f === String(f)); }); }
  function showDevice(d) {
    if (!d) return;
    if (!ui.devCats || ui.devCats.indexOf(d.cat) < 0) setDevCats((ui.devCats || []).concat(d.cat));
    if (d.block !== 'T') { setFloorBtn(d.floor); viewer.setFloor(d.floor); }
    viewer.selectDevice(d, true);
    viewer.focusDevice(d);
  }

  /* Єдина картка пристрою: однакова з карти, зі схеми комутації, зі списків і з картки приміщення.
     Розділи: стан → дії → підключення (адмін) → імітація (адмін, демо) → довідка. */
  function openDevice(d, back) {
    ui.device = d ? d.id : null; ui.devBack = d ? back || null : null;
    if (d && ui.room) { ui.room = null; viewer.select(null); }
    renderRoomCard();
  }
  var CAUSE = { cab: 'шафа автоматики без живлення', ctrl: 'відмова контролера', dev: 'пристрій не відповідає', link: 'обрив зв’язку шафи із серверною' };
  function simB(act, label, on) {
    return '<button class="btn small' + (on ? ' danger on' : '') + '" data-dsim="' + act + '">' + (on ? '✕ ' : '') + esc(label) + '</button>';
  }
  function renderDeviceCard(box) {
    var d = DEV.device(ui.device); if (!d) { ui.device = null; box.hidden = true; return; }
    var n = now(), s = DS.state(d, n), k = DEV.KINDS[d.kind], A = role() === 'admin', G = role() === 'guest';
    var CT = SK.control, FL = SK.faults, W = SK.wiring, AT = SK.adminTabs, inW = ui.tab === 'wiring';
    var ctl = CT.controllable(d) && SEC.can('scenario'), off = CT.isOff(d), iss = G ? null : FL.deviceIssue(d, n);
    var st = DS.STATUS[s.status], cat = DEV.CATS[d.cat];
    var where = d.block === 'T' ? TR.zone(d.zone).name : (d.room ? d.room + ' · ' : '') + B.blockById(d.block).name + ', ' + d.floor + ' пов.';
    var h = '<div class="rc-h">' + (ui.devBack ? '<button class="btn small" data-act="back" title="Повернутися до ' + esc(ui.devBack) + '">' + SK.icon('chevL', 'ico sm') + '</button>' : '') +
      '<div class="grow"><div class="dc-cat"><span class="cat-dot" style="background:' + cat.css + '"></span>' + esc(cat.name) + '</div>' +
      '<h2>' + k.icon + ' ' + esc(d.label || d.name) + '</h2><div class="muted small">' + esc(where) + '</div></div>' +
      (ctl ? '<button class="pwr' + (off ? ' off' : '') + '" data-act="pwr" title="' + (off ? 'Увімкнути' : 'Вимкнути вручну') + '" aria-label="' + (off ? 'Увімкнути' : 'Вимкнути') + '">' + SK.PWR_ICON + '</button>' : '') +
      '<button class="btn small" data-act="close" aria-label="Закрити">✕</button></div>';

    /* 1. Стан */
    h += '<div class="dc-state ' + st.lvl + '"><div class="row"><span class="lvl ' + st.lvl + '">' + st.name + '</span><span class="grow"></span><span class="demo-badge">симуляція</span></div>' +
      '<div class="dc-val">' + esc(s.value || '—') + '</div>' +
      (iss && iss.cause !== 'dev' ? '<div class="small">Причина: <b>' + esc(CAUSE[iss.cause] || iss.value) + '</b></div>' : '') +
      (off ? '<div class="small">Вимкнено з диспетчерської. Кнопка живлення вгорі картки вмикає знову.</div>' : '') + '</div>';
    if (d.label && d.label !== d.name) h += '<div class="small muted">' + esc(d.name) + '</div>';

    /* 2. Дії */
    var acts = ['<button class="btn small" data-act="fly" title="Наблизити камеру до пристрою">' + SK.icon('target', 'ico sm') + 'На карті</button>'];
    if (d.room) acts.push('<button class="btn small" data-act="room" title="Картка приміщення">' + SK.icon('door', 'ico sm') + ' ' + esc(d.room) + '</button>');
    if (d.room && !G) acts.push('<button class="btn small" data-act="model" title="Окрема 3D-модель приміщення">' + SK.icon('cube', 'ico sm') + 'Модель кімнати</button>');
    if (A && d.cabinet && !inW) acts.push('<button class="btn small" data-act="wires" title="Траса кабелю до шафи у вкладці «Комутація»">' + SK.icon('cable', 'ico sm') + 'Траса кабелю</button>');
    if (!G && SEC.can('ack')) acts.push('<button class="btn small" data-act="log" title="Журнал цього пристрою (CSV)">' + SK.icon('doc', 'ico sm') + 'Журнал</button>');
    h += '<div class="row dc-acts">' + acts.join('') + '</div>';

    /* Споживання пристрою: зараз, пік і графік доби */
    var DPw = SK.devpower, pp = DPw.passportOf(d.kind);
    if (!G && pp) {
      var dser = DPw.series(n, { scope: 'device', device: d.id }), dpk = DPw.peak(dser), mm = n.getHours() * 60 + n.getMinutes();
      var wNow = (dser.filter(function (x) { return x.t <= mm; }).slice(-1)[0] || { total: 0 }).total, dk = DPw.kwh(dser);
      var fw = function (w) { return w >= 1000 ? U.fmt(w / 1000, 2) + ' кВт' : U.fmt(w, w < 1 ? 2 : w < 10 ? 1 : 0) + ' Вт'; };
      h += '<details open data-key="dev-energy"><summary>Споживання · ' + fw(wNow) + ' зараз</summary>' +
        '<div class="dc-energy"><div id="dcEnergy"></div><div class="small">' + (dpk && dser.every(function (x) { return Math.abs(x.total - dpk.total) <= Math.max(0.01, dpk.total * 0.02); }) ? 'Постійно ' + fw(dpk.total) : 'Пік ' + (dpk ? fw(dpk.total) + ' о ' + U.minToHHMM(dpk.t) : '—')) +
          ' · за добу ' + (dk >= 1 ? U.fmt(dk, 2) + ' кВт·год' : U.fmt(dk * 1000, dk < 0.01 ? 2 : 0) + ' Вт·год') + '</div>' +
        '<div class="small muted">' + esc(pp.p.how) + (pp.p.ref ? ' <span class="src-ref">довідково</span>' : '') + '</div>' +
        '<button class="btn small" data-act="energy" style="margin-top:6px">' + SK.icon('chart', 'ico sm') + 'Детально в «Споживанні»</button></div></details>';
    }

    /* 3. Підключення та 4. Імітація — лише адміністратор */
    var inst = d.conn && d.conn[0] && d.conn[0].inst;
    if (A && d.cabinet) {
      var jb = d.room ? W.jbox(d.room) : null, PT = AT.PORT_TXT;
      h += '<details' + (inW || iss ? ' open' : '') + '><summary>Підключення · ' + esc(d.cabinet) + '</summary>' +
        '<div class="dc-route">' + [[k.icon, 'пристрій'], jb ? [SK.icon('cabinet', 'ico sm'), jb.id] : null, jb ? [SK.icon('cable', 'ico sm'), 'лоток'] : null, [SK.icon('bolt', 'ico sm'), d.cabinet]]
          .filter(Boolean).map(function (x) { return '<span>' + x[0] + ' ' + esc(x[1]) + '</span>'; }).join('<i>→</i>') + '</div>' +
        (function () { var r = W.route(d); return r ? '<div class="small muted">Траса ≈ ' + Math.round(r.geo) + ' м: ' + r.parts.filter(function (x) { return x.len > 0.3; }).map(function (x) { return esc(x.name) + ' ' + Math.round(x.len) + ' м'; }).join(' · ') +
          '; кабель з запасом ≈ ' + r.len + ' м' + (d.conn.some(function (l) { return l.bus; }) ? ' (шина: відгалуження від шлейфа)' : '') + '</div>' : ''; })() +
        (d.conn || []).map(function (l) {
          var ps = FL.portState(l, n);
          return '<div class="dc-port"><span class="pdot p-' + ps + '" title="' + esc(PT[ps]) + '"></span><span class="cat-dot" style="background:' + W.BUS[l.type].css + '"></span>' +
            '<b>' + esc(l.inst ? l.inst.short + ' · ' + l.port : W.BUS[l.type].name) + '</b><span class="muted grow">' + esc(W.BUS[l.type].name) + (l.len ? ' · ≈' + l.len + ' м' : '') + '</span>' +
            (ps !== 'ok' ? '<span class="lvl ' + (ps === 'alarm' ? 'bad' : ps === 'manual' ? 'off' : 'warn') + '">' + esc(PT[ps]) + '</span>' : '') + '</div>';
        }).join('') + '<div class="small muted">ID ' + esc(d.id) + ' · <code>' + esc(d.topic) + '</code></div></details>';

      var tr = FL.TRIGGERS[d.kind], devF = !!(store.state.faults || {})[d.id];
      h += '<details' + (inW ? ' open' : '') + '><summary>Імітація (демо)</summary><div class="row dc-acts">' +
        simB('dev', devF ? 'Пристрій несправний' : 'Несправність пристрою', devF) +
        (tr ? simB('trig', tr.label, false) : '') +
        (inst ? simB('ctrl', FL.ctrlDown(inst.id) ? inst.short + ' offline' : 'Відмова ' + inst.short, FL.ctrlDown(inst.id)) : '') + '</div>' +
        '<div class="small muted">Червона кнопка — імітацію ввімкнено; натисніть ще раз, щоб усунути.</div></details>';
    }

    /* 5. Довідка */
    var extra = {
      board: 'Онлайн-дошка зберігає конспект заняття в хмару; студенти групи отримують посилання в додатку після пари (концепт).',
      finger: 'Безключовий доступ за відбитком пальця. Шаблон відбитка зберігається лише в зашифрованому вигляді на контролері доступу. Права — за групою, зоною й часом (вкладка «Доступ»).',
      turnstile: 'Прохід за відбитком пальця (для тих, хто не дав згоди на біометрію, — картка або PIN). Кількість проходів рахується знеособлено.',
      vape: 'Реагує на аерозоль і дим. Подія йде в журнал безпеки черговому; пожежна сигналізація не задіяна.',
      signage: 'Показує розклад поверху, вільні аудиторії, оголошення й навігацію. Дані — з того самого сервера.',
      exhaust: 'Окрема витяжна вентиляція кімнати для куріння: розрідження щодо коридору, вмикається за PIR і працює ще 10 хв.',
      parking: 'Датчики присутності авто на кожному місці; дані — на табло в’їзду й у панелі.'
    }[d.kind];
    if (extra) h += '<details><summary>Про пристрій</summary><div class="small muted">' + esc(extra) + '</div></details>';

    setCard(box, h, 'dev:' + d.id);
    var dce = box.querySelector('#dcEnergy');
    if (dce) SK.charts.stack(dce, SK.devpower.series(n, { scope: 'device', device: d.id }), SK.devpower.LAYERS, { height: 120, now: n.getHours() * 60 + n.getMinutes(), scale: 1, unit: 'Вт', label: 'Споживання пристрою за добу' });
    box.onchange = null;
    box.onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      var a = b.dataset.act, sm = b.dataset.dsim;
      if (a === 'close') { viewer.selectDevice(null); return; }
      if (a === 'back') { var r = ui.devBack; ui.device = null; ui.devBack = null; viewer.select(r); return; }
      if (a === 'fly') { ui.pendingBack = ui.devBack; showDevice(d); return; }
      if (a === 'room') { ui.device = null; ui.devBack = null; viewer.select(d.room); viewer.focusRoom(d.room); return; }
      if (a === 'model') { SK.RoomView.open(d.room); return; }
      if (a === 'wires') { setTab('wiring'); AT.focusDevice(d); return; }
      if (a === 'energy') { showEnergy({ device: d.id, room: d.room }); return; }
      if (a === 'log') { showLogs({ kind: 'sensors', room: d.room, device: d.id }); return; }
      if (a === 'pwr') { AT.toastCmd(CT.toggle(d)); return; }
      if (sm === 'dev') FL.toggleDevice(d);
      if (sm === 'trig') { FL.trigger(d); U.toast('Подію згенеровано — див. «Безпека → Сповіщення»', 'warn'); }
      if (sm === 'ctrl' && inst) FL.toggleCtrl(W.instances(d.cabinet).filter(function (i) { return i.id === inst.id; })[0]);
      if (sm) { if (inW) AT.refocus(); renderRoomCard(); }
    };
  }

  /* Сервісні перевірки: двері кімнати для куріння відчинені надто довго */
  function serviceChecks(n) { }

  /* ---- Налаштування ---- */
  function settings(p) {
    var st = store.state.settings, mt = st.model;
    var h = '<h2>Налаштування</h2>';
    h += '<h3>3D-модель корпусу</h3><div class="small">Поточна: <b>' + (viewer.hasModel() ? 'імпортована модель' : 'процедурна схема (за попереднім планом)') + '</b></div>' +
      '<div class="note">Підтримуються файли <b>.glb</b> (рекомендовано) або .gltf з вбудованими текстурами. Назвіть меші аудиторій номерами («А-301», «A_301», «room_B-105») — ' +
      'тоді вони стануть клікабельними й фарбуватимуться за статусом. Масштаб: 1 одиниця = 1 метр. Інструкція: assets/models/README.md.</div>';
    if (SEC.can('settings')) {
      h += '<div class="row"><label class="btn small primary">Завантажити .glb<input type="file" id="mFile" accept=".glb,.gltf" hidden></label>' +
        (viewer.hasModel() ? '<button class="btn small danger" id="mClear">Прибрати модель</button>' : '') + '</div>' +
        '<div class="form-grid" style="margin-top:8px">' +
        '<label>Масштаб<input type="number" step="0.01" id="mScale" value="' + mt.scale + '"></label>' +
        '<label>Поворот, °<input type="number" step="1" id="mRot" value="' + mt.rotY + '"></label>' +
        '<label>Зсув X (схід), м<input type="number" step="0.5" id="mX" value="' + mt.x + '"></label>' +
        '<label>Зсув Y (північ), м<input type="number" step="0.5" id="mZ" value="' + mt.z + '"></label>' +
        '<label>Висота, м<input type="number" step="0.1" id="mY" value="' + mt.y + '"></label>' +
        '<label>Схема аудиторій поверх моделі<select id="mRooms"><option value="1"' + (mt.showRooms !== false ? ' selected' : '') + '>показувати</option><option value="0"' + (mt.showRooms === false ? ' selected' : '') + '>приховати</option></select></label>' +
        '</div><div class="row" style="margin-top:8px"><button class="btn small primary" id="mApply">Застосувати</button></div>';
      h += '<h3>Демо-дані</h3><div class="row"><button class="btn small danger" id="sReset">Скинути всі демо-дані</button></div>' +
        '<div class="small muted">Очищує бронювання, журнал подій, зміни розкладу та налаштування.</div>';
    } else h += lockedNote('Зміна налаштувань');
    h += '<h3>Про прототип</h3><div class="small">' + esc(B.note) + ' Усі показники датчиків, енергоспоживання й події — змодельовані. ' +
      'Групи й викладачі — вигадані. Команда «Ша-Пі-То»: дизайн і 3D — Вакарюк Іван; програмна частина — Шестобуз Олег; маскот «Шахеда» — Реус Ірина.</div>';
    p.innerHTML = h;
    var f = $('#mFile', p); if (f) f.onchange = function (e) { importModel(e.target.files[0]); };
    var c = $('#mClear', p); if (c) c.onclick = function () { viewer.clearModel(); renderPanel(); };
    var a = $('#mApply', p); if (a) a.onclick = function () {
      mt.scale = +$('#mScale', p).value || 1; mt.rotY = +$('#mRot', p).value || 0; mt.x = +$('#mX', p).value || 0;
      mt.z = +$('#mZ', p).value || 0; mt.y = +$('#mY', p).value || 0; mt.showRooms = $('#mRooms', p).value === '1';
      store.save(); viewer.applyModelTransform();
    };
    var r = $('#sReset', p); if (r) r.onclick = function () {
      if (r.dataset.armed) { store.reset(); U.toast('Демо-дані скинуто'); }
      else { r.dataset.armed = '1'; r.textContent = 'Натисніть ще раз для підтвердження'; }
    };
  }

  function importModel(file) {
    if (!file) return;
    if (!SEC.can('settings')) { U.toast('Завантаження моделі — для ролі «Адміністратор»', 'warn'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      viewer.loadModel(rd.result, file.name).then(function (res) {
        U.toast('Модель «' + res.name + '» завантажено. Прив’язано аудиторій: ' + res.bound + (res.bound ? '' : ' (назвіть меші номерами аудиторій)'), 'good');
        if (ui.tab === 'settings') renderPanel();
      }).catch(function (err) { U.toast('Не вдалося відкрити модель: ' + (err && err.message || err), 'bad'); });
    };
    rd.readAsArrayBuffer(file);
  }

  return { showEnergy: showEnergy, showLogs: showLogs, kpi: kpi, sel: sel, metric: metric, lockedNote: lockedNote, bindRoomRows: bindRoomRows, showDevice: showDevice, setDevCats: setDevCats, openDevice: openDevice, forgetDetails: forgetDetails, renderCard: renderRoomCard,
    setFloorBtn: setFloorBtn, renderPanel: renderPanel, now: now, eventsTable: eventsTable,
    init: init, setTab: setTab, get viewer() { return viewer; }, ui: ui, setSimTime: setSimTime, setColorMode: function (m) {
    ui.colorMode = m; $('#colorMode').value = m; viewer.refresh(); renderLegend();
  } };
})();

document.addEventListener('DOMContentLoaded', SK.dashboard.init);
