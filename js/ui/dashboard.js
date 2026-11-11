/* Панель керування «Розумний корпус» — головний екран (ТЗ п. 3.1–3.5).
 * Модулі-вкладки: Огляд, Аудиторії, Комфорт, Безпека, Енергія, Обладнання i3, Налаштування. */
SK.dashboard = (function () {
  var U = SK.util, B = SK.building, S = SK.schedule, SEN = SK.sensors, I3 = SK.i3, E = SK.energy,
    SEC = SK.security, DEV = SK.devicesI3, DS = SK.devices, TR = SK.territory, CM = SK.colorModes, store = SK.store, $ = U.$, esc = U.esc;

  var ui = { tab: 'overview', colorMode: 'status', room: null, lastIn: {},
    rf: { block: '', floor: '', status: '', type: '' }, evFilter: 'all', secRoom: null,
    device: null, devCats: null, df: { cat: '', floor: '', status: '' }, rcDur: '90' };
  var viewer;

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
          '<br><span class="lvl ' + DS.STATUS[s.status].lvl + '">' + DS.STATUS[s.status].name + '</span>';
      },
      onDeviceSelect: function (d) {
        if (d && ui.tab === 'wiring' && role() === 'admin') { SK.adminTabs.focusDevice(d); return; }   // у «Комутації» — виділити трасу
        ui.device = d ? d.id : null; if (d) { ui.room = null; viewer.select(null); } renderRoomCard(); },
      spotColor: function (s) { return DS.spotTaken(s, now()) ? 0xd96b6b : s.mgn ? 0x8fb8e8 : 0x8fd19e; },
      onOpenRoom: function (r) { if (role() === 'guest') { U.toast('Модель кімнати доступна відповідальним особам і адміністратору', 'warn'); return; } SK.RoomView.open(r.id); },
      defaultModelUrl: 'assets/models/korpus9.glb'
    });
    initDevLayer(); initCardDrag();
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
      if (viewer.isPlan() && !b.dataset.f) { viewer.setPlan(false); $('#planBtn').classList.remove('on'); }
      viewer.setFloor(b.dataset.f ? +b.dataset.f : null);
    });

    var cm = $('#colorMode');
    cm.innerHTML = Object.keys(CM).map(function (k) { return '<option value="' + k + '">' + CM[k].name + '</option>'; }).join('');
    cm.addEventListener('change', function () { ui.colorMode = cm.value; viewer.refresh(); renderLegend(); });
    $('#homeBtn').addEventListener('click', function () {
      if (viewer.isPlan()) { viewer.setPlan(false); $('#planBtn').classList.remove('on'); }
      if (viewer.getIsolated()) viewer.isolate(null);
      if (viewer.hasFocus()) { viewer.setFocus(null); SK.adminTabs.clearFocus(); if (ui.tab === 'wiring') renderPanel(); }
      setFloorBtn(''); viewer.setFloor(null, true); viewer.home();
    });
    $('#planBtn').addEventListener('click', function (e) {
      var on = !viewer.isPlan();
      if (on && ui.expl) { ui.expl = false; $('#explBtn').classList.remove('on'); viewer.setExplode(false); }
      var f = viewer.setPlan(on); e.currentTarget.classList.toggle('on', on);
      if (on) setFloorBtn(f);
    });
    /* Пошук приміщення на карті */
    $('#mapSearch').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var id = findRoom(e.target.value);
      if (!id) { U.toast('Приміщення «' + e.target.value + '» не знайдено (приклад: А-305, Б-013, А-001)', 'warn'); return; }
      var r = B.room(id); setFloorBtn(r.floor); viewer.setFloor(r.floor); viewer.select(id); viewer.focusRoom(id);
    });
    $('#lblBtn').addEventListener('click', function (e) { ui.lbl = !ui.lbl; e.currentTarget.classList.toggle('on', ui.lbl); viewer.setLabelsAll(ui.lbl); });
    $('#explBtn').addEventListener('click', function (e) { if (viewer.isPlan()) { viewer.setPlan(false); $('#planBtn').classList.remove('on'); } ui.expl = !ui.expl; e.currentTarget.classList.toggle('on', ui.expl); if (ui.expl) { setFloorBtn(''); viewer.setFloor(null); } viewer.setExplode(ui.expl); });
    $('#modelFile').addEventListener('change', function (e) { importModel(e.target.files[0]); e.target.value = ''; });

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
    if (/^(overview|control|rooms|events|scenarios|comfort|security|access|energy|power|wiring|territory|equipment|settings|devices)$/.test(hashTab)) setTab(hashTab === 'devices' ? 'equipment' : hashTab);
    if (hashTab === 'devices') setDevCats(Object.keys(DEV.CATS));
    /* index.html#room=А-305 — одразу відкрити модель кімнати */
    if (/^room=/.test(hashTab)) { var rid = findRoom(decodeURIComponent(hashTab.slice(5))); if (rid) setTimeout(function () { SK.RoomView.open(rid); }, 200); }
    setInterval(tick, 2000);
  }

  /* ---------- Навігація: 7 груп і підвкладки ---------- */
  var NAV = [
    { id: 'home', icon: '⌂', name: 'Огляд', tabs: ['overview'] },
    { id: 'ctl', icon: '🎛', name: 'Пульт', title: 'Диспетчерська А-001 — ручне керування', tabs: ['control'] },
    { id: 'sched', icon: '▦', name: 'Розклад', tabs: ['rooms', 'events'] },
    { id: 'climate', icon: '☀', name: 'Клімат', tabs: ['comfort', 'scenarios'] },
    { id: 'sec', icon: '🛡', name: 'Безпека', tabs: ['security', 'access'] },
    { id: 'energy', icon: '⚡', name: 'Енергія', tabs: ['energy', 'power'] },
    { id: 'infra', icon: '🏗', name: 'Об’єкт', tabs: ['wiring', 'equipment', 'territory'] },
    { id: 'cfg', icon: '⚙', name: 'Опції', tabs: ['settings'] }
  ];
  function groupOf(t) { for (var i = 0; i < NAV.length; i++) if (NAV[i].tabs.indexOf(t) >= 0) return NAV[i].id; return 'home'; }
  function renderNav() {
    var g = $('#tabGroups'), cur = groupOf(ui.tab);
    if (!g.dataset.init) {
      g.dataset.init = 1;
      g.innerHTML = NAV.map(function (n) {
        return '<button data-group="' + n.id + '" title="' + (n.title || n.name) + '"><span class="gi">' + n.icon + '</span><span class="gl">' + n.name + '</span>' +
          (n.id === 'sec' ? '<span class="cnt" id="grpSecCnt" hidden></span>' : '') + '</button>';
      }).join('');
      g.addEventListener('click', function (e) {
        var b = e.target.closest('[data-group]'); if (!b) return;
        var n = NAV.filter(function (x) { return x.id === b.dataset.group; })[0];
        var last = ui.lastIn[n.id];
        setTab(last && tabAllowed(last) ? last : n.tabs.filter(tabAllowed)[0]);
      });
    }
    U.$all('[data-group]', g).forEach(function (b) {
      var n = NAV.filter(function (x) { return x.id === b.dataset.group; })[0];
      b.hidden = !n.tabs.some(tabAllowed); b.classList.toggle('on', n.id === cur);
    });
    var tabs = NAV.filter(function (x) { return x.id === cur; })[0].tabs.filter(tabAllowed);
    U.$all('#tabs button[data-tab]').forEach(function (b) { b.hidden = tabs.indexOf(b.dataset.tab) < 0; b.classList.toggle('on', b.dataset.tab === ui.tab); });
    $('#tabs').hidden = tabs.length < 2;
  }

  /* ---------- Що бачить кожна роль ---------- */
  var ALL = ['guest', 'responsible', 'admin'], STAFF = ['responsible', 'admin'], ADM = ['admin'];
  var TAB_ROLES = { overview: ALL, rooms: ALL, events: ALL, comfort: ALL, energy: STAFF, territory: ALL,
    control: STAFF, scenarios: STAFF, security: STAFF, access: STAFF, power: STAFF, wiring: ADM, equipment: ADM, settings: ADM };
  /* Категорії пристроїв на карті: гість — не бачить, відповідальна особа — без мережі/живлення */
  var CAT_ROLES = { guest: [], responsible: ['sensors', 'control', 'boards', 'access', 'safety', 'territory'], admin: null };
  function tabAllowed(t) { return (TAB_ROLES[t] || ADM).indexOf(role()) >= 0; }
  function allowedCats() { var c = CAT_ROLES[role()]; return c === null ? Object.keys(DEV.CATS) : c; }
  function applyRole() {
    var r = role();
    renderNav();
    $('#devBtn').hidden = r === 'guest';
    $('#modelBtn').hidden = r !== 'admin';
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
    var m = /([АБПABPабпabp])\s*[-_ ]?\s*(\d{3}|\dС\d|\dC\d)/.exec(q || '');
    if (!m) return null;
    var L2 = { A: 'А', B: 'Б', P: 'П', a: 'А', b: 'Б', p: 'П', 'а': 'А', 'б': 'Б', 'п': 'П' }[m[1]] || m[1].toUpperCase();
    var id = L2 + '-' + m[2].replace('C', 'С');
    return B.room(id) ? id : null;
  }

  function setTab(t) {
    if (!tabAllowed(t)) t = 'overview';
    if (ui.tab === 'wiring' && t !== 'wiring' && viewer) { viewer.setFocus(null); viewer.setWiring(null); SK.adminTabs.clearFocus(); }
    ui.tab = t;
    ui.lastIn[groupOf(t)] = t;
    renderNav();
    var modeFor = { comfort: 'co2', energy: 'power' };
    if (modeFor[t] && ui.colorMode === 'status') { ui.colorMode = modeFor[t]; $('#colorMode').value = ui.colorMode; viewer.refresh(); renderLegend(); }
    if ((t === 'rooms' || t === 'overview') && (ui.colorMode === 'co2' || ui.colorMode === 'power')) { ui.colorMode = 'status'; $('#colorMode').value = 'status'; viewer.refresh(); renderLegend(); }
    renderPanel();
  }

  function tick() {
    updateClock();
    viewer.refresh();
    renderRoomCard();
    var n = now(), p = E.power(n);
    if (E.checkThreshold(n, p)) {
      SEC.addEvent('energy', null, 'Потужність ' + U.fmt(p.total / 1000, 1) + ' кВт перевищила поріг ' + store.state.settings.energyThresholdKw + ' кВт.');
    }
    serviceChecks(n);
    SK.power.check(n); SK.faults.check(n);
    if (['overview', 'comfort', 'energy', 'territory', 'power', 'wiring'].indexOf(ui.tab) >= 0) renderPanel(true);
  }

  function renderAll(soft) { updateClock(); renderPanel(soft); renderRoomCard(); updateSecCount(); }

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
    var h = '<b>' + esc(r.id) + '</b> · ' + esc(r.name);
    if (r.bookable) h += '<br><span class="st ' + S.STATUS[s.status].css + '">' + S.STATUS[s.status].name + '</span>' + (s.lesson ? ' ' + esc(s.lesson.group) : '');
    if (r.type !== 'stairs') h += '<br>' + v.temp + ' °C · CO₂ ' + v.co2 + ' · ' + v.people + ' ос.';
    return h;
  }

  /* ---------------- Картка аудиторії ---------------- */
  function renderRoomCard() {
    var box = $('#roomCard');
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    if (ui.device) { renderDeviceCard(box); return; }
    if (!ui.room) { box.hidden = true; return; }
    var r = B.room(ui.room), n = now(), v = I3.read(r.id, n), s = S.status(r.id, n);
    var h = '<div class="rc-h"><div class="grow"><h2>' + esc(r.id) + '</h2><div class="muted small">' + esc(r.name) + ' · ' + B.blockById(r.block).name +
      ', ' + r.floor + ' пов. · ' + r.area + ' м²' + (r.capacity ? ' · ' + r.capacity + ' місць' : '') + (r.pcs ? ' · ' + r.pcs + ' ПК' : '') + '</div></div>' +
      '<button class="btn small" data-act="close" aria-label="Закрити">✕</button></div>';
    var G = role() === 'guest';
    var alarm = G ? null : SEC.roomAlarm(r.id);
    if (alarm) h += '<div class="note" style="border-left-color:var(--bad)"><b>⚠ ' + esc(SEC.TYPES[alarm.type].name) + '</b><br>' + esc(alarm.note) + '</div>';
    if (r.bookable) {
      h += '<div style="margin-top:8px"><span class="st ' + S.STATUS[s.status].css + '">' + S.STATUS[s.status].name + '</span>';
      if (s.lesson) h += ' — ' + esc(s.lesson.subject) + ', <b>' + esc(s.lesson.group) + '</b>, ' + esc(s.lesson.teacher) + (s.conflict && !G ? ' <span class="sev critical">конфлікт</span>' : '');
      if (s.booking) h += ' — ' + esc(s.booking.purpose) + ' (' + esc(s.booking.who) + ')';
      if (s.next) h += '<div class="small muted">Далі: ' + s.next.pair.n + '-га пара (' + s.next.pair.start + ') — ' +
        esc(s.next.lesson ? s.next.lesson.subject + ', ' + s.next.lesson.group : 'бронювання') + '</div>';
      h += '</div>';
    }
    if (r.type !== 'stairs') {
      h += '<div class="metrics">' +
        metric(v.temp + ' °C', 'Температура') +
        metric('<span class="lvl ' + SEN.co2Level(v.co2) + '">' + v.co2 + '</span>', 'CO₂, ppm') +
        metric(v.hum + ' %', 'Вологість') +
        metric(v.people, 'Людей (PIR)') +
        metric(v.lightOn ? Math.round(v.lightLevel * 100) + ' %' : 'вимк.', 'Світло') +
        (G ? metric(esc(v.scName), 'Режим') : metric(U.fmt(v.power / 1000, 2) + ' кВт', 'Потужність')) + '</div>' +
        '<div class="small muted">' + SEN.co2Text(v.co2) + ' · <span class="demo-badge">симуляція</span>' + (v.fault && !G ? ' · <span class="sev warning">датчик несправний</span>' : '') + '</div>';
    }
    if (r.bookable && !G) {
      var SCN = SK.scenarios;
      h += '<div class="small" style="margin:6px 0 2px">Сценарій: <b>' + esc(v.scName) + '</b>' +
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
      h += '<details><summary>Розклад на сьогодні' + (curRow ? ' · зараз: ' + esc(curRow) : '') + '</summary><div class="pairs">' + rowsH + '</div></details>';
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
    h += '<div class="row" style="margin-top:10px">' + (role() !== 'guest' ? '<button class="btn small primary" data-act="model">🔍 Модель кімнати</button>' : '') +
      '<button class="btn small' + (viewer.getIsolated() === r.id ? ' on' : '') + '" data-act="iso">' + (viewer.getIsolated() === r.id ? 'Скасувати виділення' : '◎ Виділити') + '</button>' +
      '<button class="btn small" data-act="focus">Наблизити</button><button class="btn small" data-act="route">Маршрут</button></div>';
    box.innerHTML = cardHtml(h); box.hidden = false;
    box.onclick = function (e) {
      var pw = e.target.closest('[data-pwr]');
      if (pw) { SK.adminTabs.toastCmd(SK.control.toggle(DEV.device(pw.dataset.pwr))); return; }
      var dl = e.target.closest('[data-dev]');
      if (dl) { e.preventDefault(); showDevice(DEV.device(dl.dataset.dev)); return; }
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.act === 'close') { viewer.select(null); viewer.clearRoute(); if (viewer.getIsolated()) { viewer.isolate(null); setFloorBtn(''); viewer.setFloor(null); } }
      if (b.dataset.act === 'focus') viewer.focusRoom(r.id);
      if (b.dataset.act === 'model') SK.RoomView.open(r.id);
      if (b.dataset.act === 'iso') { var on = viewer.getIsolated() !== r.id; viewer.isolate(on ? r.id : null); setFloorBtn(on ? r.floor : ''); if (!on) viewer.setFloor(null); renderRoomCard(); }
      if (b.dataset.act === 'route') { viewer.route(r.id); viewer.focusRoom(r.id); }
    };
    box.onchange = function (e) {
      if (e.target.id === 'rcDur') ui.rcDur = e.target.value;
      if (e.target.id === 'rcMode') {
        var mode = e.target.value, mins = ui.rcDur ? +ui.rcDur : null;
        SK.scenarios.apply([r.id], mode, mins);
        U.toast(r.id + ': ' + (mode === 'auto' ? 'повернуто автоматику' : 'сценарій «' + SK.scenarios.get(mode).name + '»' + (mins ? ' на ' + mins + ' хв' : '')), 'good');
        e.target.blur();
      }
    };
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
    box.addEventListener('pointerdown', function (e) {
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
  function metric(v, l) { return '<div class="metric"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
  function ctrlSummary(list) {
    var c = {}; list.forEach(function (m) { c[m] = (c[m] || 0) + 1; });
    return Object.keys(c).map(function (m) { return m + (c[m] > 1 ? ' ×' + c[m] : ''); }).join(', ');
  }

  /* ---------------- Панель вкладок ---------------- */
  function renderPanel(soft) {
    var p = $('#panel');
    var ae = document.activeElement;
    if (soft && ae && p.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return; // не заважаємо введенню
    var scroll = p.scrollTop;
    var fn = { overview: overview, rooms: rooms, comfort: comfort, security: security, energy: energy, territory: territory, equipment: equipment, settings: settings }[ui.tab] || (SK.adminTabs || {})[ui.tab];
    p.innerHTML = '';
    p.onclick = null; p.onchange = null;
    fn(p);
    /* Посилання на вкладки, недоступні поточній ролі, — звичайний текст */
    U.$all('[data-goto]', p).forEach(function (a) { if (!tabAllowed(a.dataset.goto)) a.replaceWith(document.createTextNode(a.textContent)); });
    p.scrollTop = scroll;
    updateSecCount();
  }

  function lockedNote(what) { if (role() === 'guest') return ''; return '<div class="locked">🔒 ' + what + ' — доступно ролі «Адміністратор».</div>'; }

  /* ---- Огляд ---- */
  function overview(p) {
    var n = now(), cnt = { free: 0, busy: 0, booked: 0 }, t = 0, c = 0, k = 0, people = 0;
    B.bookableRooms().forEach(function (r) {
      cnt[S.status(r.id, n).status]++;
      var v = I3.read(r.id, n); t += v.temp; c += v.co2; k++; people += v.people;
    });
    var pw = E.power(n), td = E.today(n), act = SEC.active();
    var pr = S.pairAt(n);
    var h = '<h2>Зведення по корпусу</h2><div class="muted small" style="margin-bottom:8px">' + esc(B.name) + ' · ' +
      (pr ? pr.n + '-га пара (' + pr.start + '–' + pr.end + ')' : 'поза парою') + ' · <span class="demo-badge">симуляція</span></div>';
    h += '<div class="kpis">' +
      kpi(cnt.free, 'вільних аудиторій', 'var(--free)') + kpi(cnt.busy, 'зайнятих', 'var(--busy)') + kpi(cnt.booked, 'заброньованих', 'var(--booked)') +
      kpi(people, 'людей в аудиторіях') + kpi(U.fmt(t / k, 1) + ' °C', 'середня температура') + kpi(Math.round(c / k) + '', 'середній CO₂, ppm') +
      (role() !== 'guest' ? kpi(U.fmt(pw.total / 1000, 1) + ' кВт', 'потужність зараз') + kpi(U.fmt(td.kwh, 0), 'кВт·год сьогодні') : '') +
      (role() !== 'guest' ? kpi(act.length, 'активних сповіщень', act.length ? 'var(--bad)' : null) : '') +
      (role() !== 'guest' ? kpi(DS.summary(n).total, 'розумних пристроїв') : '') + kpi(DS.parking(n).free, 'вільних паркомісць', 'var(--free)') + '</div>';

    var stuffy = B.bookableRooms().map(function (r) { return { r: r, v: I3.read(r.id, n) }; })
      .filter(function (x) { return x.v.co2 >= 1000; }).sort(function (a, b) { return b.v.co2 - a.v.co2; }).slice(0, 5);
    h += '<h3>Потребують провітрювання</h3>' + (stuffy.length ? '<table class="t"><tbody>' + stuffy.map(function (x) {
      return '<tr class="click" data-room="' + x.r.id + '"><td><b>' + x.r.id + '</b></td><td>' + esc(x.r.name) + '</td><td><span class="lvl ' + SEN.co2Level(x.v.co2) + '">' + x.v.co2 + ' ppm</span></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="muted small">Усі аудиторії в нормі.</div>');

    if (role() !== 'guest') h += '<h3>Останні події</h3>' + eventsTable(store.state.events.slice(0, 5), false);

    h += '<h3>Оголошення для студентів</h3>';
    h += store.state.announcements.slice(0, 3).map(function (a) {
      return '<div class="small" style="margin-bottom:6px"><b>' + esc(a.from) + ':</b> ' + esc(a.text) + '</div>';
    }).join('');
    if (SEC.can('announce')) h += '<div class="row"><input type="text" id="annText" class="grow" placeholder="Текст оголошення (з’явиться у студентському додатку)"><button class="btn small primary" id="annSend">Надіслати</button></div>';
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
    var n = now(), rf = ui.rf;
    var h = '<h2>Аудиторії та розклад</h2><div class="row" style="margin:8px 0">' +
      sel('rfBlock', [['', 'Усі блоки'], ['A', 'Блок А'], ['B', 'Блок Б'], ['C', 'Перемичка']], rf.block) +
      sel('rfFloor', [['', 'Усі поверхи'], ['0', '0 (хол)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], rf.floor) +
      sel('rfStatus', [['', 'Усі статуси'], ['free', 'Вільні'], ['busy', 'Зайняті'], ['booked', 'Заброньовані']], rf.status) +
      sel('rfType', [['', 'Усі типи']].concat(Object.keys(B.types).filter(function (k) { return B.types[k].bookable; }).map(function (k) { return [k, B.types[k].name]; })), rf.type) +
      '</div>';
    var list = B.bookableRooms().filter(function (r) {
      if (rf.block && r.block !== rf.block) return false;
      if (rf.floor && r.floor !== +rf.floor) return false;
      if (rf.type && r.type !== rf.type) return false;
      return !rf.status || S.status(r.id, n).status === rf.status;
    });
    h += '<div class="small muted">Знайдено: ' + list.length + '. Клік — показати на карті.</div><div class="tw"><table class="t"><thead><tr><th>Ауд.</th><th>Статус</th><th>Зараз</th><th>Далі</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var s = S.status(r.id, n);
      h += '<tr class="click" data-room="' + r.id + '"><td><b>' + r.id + '</b><div class="small muted">' + esc(B.types[r.type].name) + ', ' + r.capacity + ' м.</div></td>' +
        '<td><span class="st ' + S.STATUS[s.status].css + '">' + S.STATUS[s.status].name + '</span></td>' +
        '<td class="small">' + (s.lesson ? esc(s.lesson.group) + ' · ' + esc(s.lesson.subject) + '<div class="muted">' + esc(s.lesson.teacher) + '</div>' : s.booking ? esc(s.booking.purpose) : '—') + '</td>' +
        '<td class="small">' + (s.next ? s.next.pair.start + ' ' + esc(s.next.lesson ? s.next.lesson.group : 'бронь') : '—') + '</td></tr>';
    });
    h += '</tbody></table></div>';

    /* Конфлікти */
    if (role() !== 'guest') {
    var cf = S.conflicts();
    h += '<h3>Перевірка конфліктів розкладу</h3>';
    if (!cf.length) h += '<div class="small" style="color:var(--good)">● Конфліктів не виявлено.</div>';
    else h += cf.map(function (c) {
      var l = c.lessons[0];
      return '<div class="card" style="box-shadow:none"><span class="sev critical">' + (c.kind === 'room' ? 'Аудиторія' : 'Група') + '</span> ' +
        U.DAYS[l.day] + ', ' + l.pair + '-га пара — ' + (c.kind === 'room' ? '<b>' + l.room + '</b>' : '<b>' + l.group + '</b>') + ':<div class="small">' +
        c.lessons.map(function (x) {
          return esc(x.group + ' · ' + x.subject + ' · ' + x.room) + (x.imported ? ' <span class="muted">(імпорт)</span>' : '') +
            (SEC.can('schedule') ? ' <button class="btn small danger" data-rm="' + x.id + '">зняти</button>' : '');
        }).join('<br>') + '</div></div>';
    }).join('');

    /* Додавання заняття */
    if (SEC.can('schedule')) {
    h += '<h3>Зміни розкладу</h3>';
    if (SEC.can('schedule')) {
      h += '<div class="form-grid">' +
        '<label>Аудиторія' + sel('alRoom', B.bookableRooms().map(function (r) { return [r.id, r.id]; }), ui.room && B.room(ui.room).bookable ? ui.room : '') + '</label>' +
        '<label>Група' + sel('alGroup', S.groups.map(function (g) { return [g.id, g.id]; })) + '</label>' +
        '<label>День' + sel('alDay', [1, 2, 3, 4, 5].map(function (d) { return [d, U.DAYS[d]]; }), U.dow(n) <= 5 ? U.dow(n) : 1) + '</label>' +
        '<label>Пара' + sel('alPair', S.PAIRS.map(function (x) { return [x.n, x.n + ' (' + x.start + ')']; })) + '</label>' +
        '<label style="grid-column:1/3">Дисципліна<input type="text" id="alSubj" value="Консультація"></label></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn primary small" id="alAdd">Додати з перевіркою конфліктів</button></div>';
    } else h += lockedNote('Внесення змін до розкладу');
    }

    var bk = store.state.bookings;
    if (role() !== 'guest') h += '<h3>Бронювання (' + bk.length + ')</h3>' + (bk.length ? '<table class="t"><tbody>' + bk.map(function (b) {
      return '<tr><td><b>' + b.room + '</b></td><td class="small">' + b.date + ', ' + b.pair + '-га пара<br>' + esc(b.purpose) + ' · ' + esc(b.who) + '</td><td>' +
        (SEC.can('ack') ? '<button class="btn small" data-cancel="' + b.id + '">Скасувати</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table>' : '<div class="small muted">Бронювань немає.</div>');
    }
    if (SEC.can('book')) {
      h += '<div class="form-grid" style="margin-top:8px">' +
        '<label>Аудиторія' + sel('bkRoom', B.bookableRooms().map(function (r) { return [r.id, r.id + ' · ' + r.name]; }), ui.room && B.room(ui.room).bookable ? ui.room : '') + '</label>' +
        '<label>Пара (сьогодні)' + sel('bkPair', S.PAIRS.map(function (x) { return [x.n, x.n + ' (' + x.start + ')']; })) + '</label>' +
        '<label style="grid-column:1/3">Мета<input type="text" id="bkPurpose" value="Консультація / самостійна робота"></label></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn small primary" id="bkAdd">Забронювати</button><span class="small muted">Події інституту — вкладка <a href="#" data-goto="events">«Події»</a>.</span></div>';
    }

    p.innerHTML = h;
    bindRoomRows(p);
    ['Block', 'Floor', 'Status', 'Type'].forEach(function (k) {
      $('#rf' + k, p).onchange = function (e) { ui.rf[k.toLowerCase()] = e.target.value; renderPanel(); };
    });
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.rm) { S.removeLesson(b.dataset.rm); U.toast('Заняття знято з розкладу', 'good'); }
      if (b.dataset.cancel) S.cancelBooking(b.dataset.cancel);
      if (b.id === 'bkAdd') {
        var e2 = S.book($('#bkRoom', p).value, now(), +$('#bkPair', p).value, SEC.ROLES[role()].name, $('#bkPurpose', p).value);
        U.toast(e2 ? '✕ ' + e2 : 'Аудиторію заброньовано', e2 ? 'bad' : 'good');
      }
      if (b.id === 'alAdd') {
        var err = S.addLesson({ room: $('#alRoom', p).value, group: $('#alGroup', p).value, day: +$('#alDay', p).value, pair: +$('#alPair', p).value,
          subject: $('#alSubj', p).value || 'Заняття', teacher: 'призначає деканат', kind: 'Практична' });
        U.toast(err ? '✕ ' + err : 'Заняття додано без конфліктів', err ? 'bad' : 'good');
      }
    };
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
  function energy(p) {
    var n = now(), pw = E.power(n), td = E.today(n), st = store.state.settings, m = n.getHours() * 60 + n.getMinutes();
    var h = '<h2>Енергоефективність</h2><div class="muted small">Облік за блоками · <span class="demo-badge">демонстраційні дані</span></div>' +
      '<div class="kpis" style="margin-top:8px">' + kpi(U.fmt(pw.total / 1000, 1) + ' кВт', 'потужність зараз', pw.total / 1000 > st.energyThresholdKw ? 'var(--bad)' : null) +
      kpi(U.fmt(td.kwh, 0), 'кВт·год сьогодні') + kpi(U.fmt(td.saved, 0), 'кВт·год заощаджено', 'var(--good)') + '</div>';
    if (pw.total / 1000 > st.energyThresholdKw) h += '<div class="note" style="border-left-color:var(--bad)"><b>Споживання вище за поріг ' + st.energyThresholdKw + ' кВт.</b> Подію записано в журнал.</div>';
    h += '<h3>Потужність сьогодні, кВт</h3><div id="chDay"></div>';
    h += '<h3>Споживання за 7 днів, кВт·год</h3><div id="chWeek"></div>';
    h += '<h3>За блоками зараз</h3><div class="kpis">' + kpi(U.fmt(pw.A / 1000, 1), 'кВт · блок А') + kpi(U.fmt(pw.B / 1000, 1), 'кВт · блок Б') + kpi(U.fmt(pw.C / 1000, 1), 'кВт · перемичка') + '</div>';
    h += '<h3>Найбільші споживачі</h3><table class="t"><tbody>' + E.topRooms(n, 6).map(function (x) {
      return '<tr class="click" data-room="' + x.room.id + '"><td><b>' + x.room.id + '</b></td><td class="small">' + esc(x.room.name) + '</td><td>' + U.fmt(x.w / 1000, 2) + ' кВт</td></tr>';
    }).join('') + '</tbody></table>';
    h += '<div class="note">Потенціал заощадження: порівнюється фактичний режим з автоматикою та розрахунковий режим «без автоматики» (світло, проєктори й ПК працюють від першої пари до 18:00). ' + '</div>';
    h += '<div class="row"><span>Поріг сповіщення:</span>' + (SEC.can('settings') ? '<input type="number" id="thr" value="' + st.energyThresholdKw + '" min="5" max="500" style="width:80px"> кВт <button class="btn small" id="thrSave">Зберегти</button>' : '<b>' + st.energyThresholdKw + ' кВт</b>') + '</div>';
    p.innerHTML = h;
    bindRoomRows(p);
    var prof = td.profile;
    SK.charts.line($('#chDay', p), [
      { name: 'З автоматикою', cls: 's1', values: prof.map(function (x) { return { x: x.t, y: x.kw }; }) },
      { name: 'Без автоматики (розрахунок)', cls: 's2', dashed: true, values: prof.map(function (x) { return { x: x.t, y: x.kwBase }; }) }
    ], { xMin: 0, xMax: 24 * 60, xTicks: [0, 360, 720, 1080, 1440], xFmt: U.minToHHMM, unit: 'кВт', threshold: st.energyThresholdKw, label: 'Потужність сьогодні до ' + U.minToHHMM(m) });
    var wk = E.week(n);
    SK.charts.bars($('#chWeek', p), wk.map(function (d) {
      return { label: U.DAYS_SHORT[U.dow(d.date)], title: U.DAYS[U.dow(d.date)] + ', ' + U.dateKey(d.date) + (d.partial ? ' (до цього моменту)' : ''), values: [d.kwh, d.kwhBase], partial: d.partial };
    }), ['З автоматикою', 'Без автоматики'], { unit: 'кВт·год', label: 'Споживання за 7 днів' });
    var ts = $('#thrSave', p);
    if (ts) ts.onclick = function () { st.energyThresholdKw = +$('#thr', p).value || st.energyThresholdKw; store.save(); U.toast('Поріг збережено', 'good'); };
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
    h += '<h3>Схема інтеграції</h3><div class="small">Датчики → контролери Atom → MQTT-брокер → сервер «Розумного корпусу» → вебпанель і студентський додаток. ' +
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
      '<div class="note">Місць для куріння на території немає — кімнати для куріння з окремою витяжкою є на кожному поверсі (вкладка <a href="#" data-goto="comfort">«Комфорт»</a>).</div>';

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
        '<div class="small muted" style="margin-top:6px">Порада: оберіть поверх — так менше маркерів. Червоне кільце — тривога, жовте — несправність, зелена крапка — активний.</div>';
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
    btn.textContent = '📡 Пристрої' + (ui.devCats ? ' · ' + ui.devCats.length : '');
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

  function renderDeviceCard(box) {
    var d = DEV.device(ui.device), n = now(), s = DS.state(d, n), k = DEV.KINDS[d.kind];
    var where = d.block === 'T' ? TR.zone(d.zone).name : (d.room ? d.room + ' · ' : '') + B.blockById(d.block).name + ', ' + d.floor + ' пов.';
    var h = '<div class="rc-h"><div class="grow"><div class="small" style="color:' + DEV.CATS[d.cat].css + ';font-weight:700">' + DEV.CATS[d.cat].name + '</div>' +
      '<h2>' + k.icon + ' ' + esc(d.label || d.name) + '</h2><div class="muted small">' + esc(where) + '</div></div>' +
      '<button class="btn small" data-act="close" aria-label="Закрити">✕</button></div>';
    h += '<div class="metrics" style="grid-template-columns:1fr 1fr">' + metric('<span class="lvl ' + DS.STATUS[s.status].lvl + '">' + DS.STATUS[s.status].name + '</span>', 'Стан') +
      metric(esc(s.value || '—'), 'Значення') + '</div><div class="small"><span class="demo-badge">симуляція</span></div>';
    if (role() === 'admin') h += '<h3>Комутація</h3><div class="small">' + (d.conn || []).map(function (c) {
      return '<span class="cat-dot" style="background:' + SK.wiring.BUS[c.type].css + '"></span><b>' + esc(c.inst ? c.inst.id : d.cabinet || '—') + '</b> · ' + esc(c.port) +
        '<br><span class="muted">' + esc(SK.wiring.BUS[c.type].name) + ' · ' + esc(c.cable) + (c.len ? ' · ≈' + c.len + ' м' : '') + '</span>';
    }).join('<br>') + '<br><span class="muted">ID: ' + esc(d.id) + '</span><br><code>' + esc(d.topic) + '</code></div>' +
      (d.cabinet ? '<div class="row" style="margin-top:6px"><button class="btn small" data-act="wires">Показати комутацію шафи ' + esc(d.cabinet) + '</button></div>' : '');
    var extra = {
      board: 'Онлайн-дошка зберігає конспект заняття в хмару; студенти групи отримують посилання в додатку після пари (концепт).',
      finger: 'Безключовий доступ за відбитком пальця. Шаблон відбитка зберігається лише в зашифрованому вигляді на контролері доступу. Права — за групою, зоною й часом (вкладка «Доступ»).',
      turnstile: 'Прохід за відбитком пальця (для тих, хто не дав згоди на біометрію, — картка або PIN). Кількість проходів рахується знеособлено.',
      vape: 'Реагує на аерозоль і дим. Подія йде в журнал безпеки черговому; пожежна сигналізація не задіяна.',
      signage: 'Показує розклад поверху, вільні аудиторії, оголошення й навігацію. Дані — з того самого сервера.',
      exhaust: 'Окрема витяжна вентиляція кімнати для куріння: розрідження щодо коридору, вмикається за PIR і працює ще 10 хв. Розміщення кімнат погодити з адміністрацією (ст. 13 Закону № 2899-IV).',
      parking: 'Датчики присутності авто на кожному місці; дані — на табло в’їзду й у студентському додатку.'
    }[d.kind];
    if (extra) h += '<div class="small muted" style="margin-top:6px">' + esc(extra) + '</div>';
    if (d.room) h += '<div class="row" style="margin-top:8px"><button class="btn small" data-act="room">Приміщення ' + esc(d.room) + '</button></div>';
    if (SK.control.controllable(d) && SEC.can('scenario'))   // кнопка ручного вимкнення — у заголовку картки
      h = h.replace('<button class="btn small" data-act="close"', '<button class="pwr sm' + (SK.control.isOff(d) ? ' off' : '') + '" data-act="pwr" title="' + (SK.control.isOff(d) ? 'Увімкнути' : 'Вимкнути вручну') + '">' + SK.PWR_ICON + '</button><button class="btn small" data-act="close"');
    box.innerHTML = cardHtml(h); box.hidden = false;
    box.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'close') viewer.selectDevice(null);
      if (b.dataset.act === 'wires') { ui.wCab = d.cabinet; setTab('wiring'); return; }
      if (b.dataset.act === 'room') { viewer.select(d.room); viewer.focusRoom(d.room); }
      if (b.dataset.act === 'pwr') SK.adminTabs.toastCmd(SK.control.toggle(d));
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

  return { kpi: kpi, sel: sel, metric: metric, lockedNote: lockedNote, bindRoomRows: bindRoomRows, showDevice: showDevice, setDevCats: setDevCats,
    setFloorBtn: setFloorBtn, renderPanel: renderPanel, now: now, eventsTable: eventsTable,
    init: init, setTab: setTab, get viewer() { return viewer; }, ui: ui, setSimTime: setSimTime, setColorMode: function (m) {
    ui.colorMode = m; $('#colorMode').value = m; viewer.refresh(); renderLegend();
  } };
})();

document.addEventListener('DOMContentLoaded', SK.dashboard.init);
