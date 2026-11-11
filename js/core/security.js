/* Модуль «Безпека та сповіщення» (ТЗ п. 3.4) + безключовий доступ за відбитками пальців.
 *
 * ВАЖЛИВО:
 *  - пожежна сигналізація та евакуаційні системи лише ВІДОБРАЖАЮТЬСЯ; розблокування
 *    дверей на шляхах евакуації виконує сертифікована система, не прототип;
 *  - відбиток пальця — біометричні (чутливі) персональні дані. Шаблони зберігаються
 *    лише в зашифрованому вигляді в контролері доступу/зчитувачі, а не в системі
 *    «Розумного корпусу»; потрібна письмова згода; для тих, хто не погоджується, —
 *    альтернатива (картка або PIN). У прототипі користувачі знеособлені. */
SK.security = (function () {
  var U = SK.util, B = SK.building;

  var ROLES = {
    guest:       { name: 'Гість / глядач', can: [] },
    responsible: { name: 'Відповідальна особа', can: ['ack', 'scenario', 'book'] },
    admin:       { name: 'Адміністратор', can: ['ack', 'scenario', 'book', 'schedule', 'test', 'settings', 'doors', 'announce', 'access', 'scenarios', 'power', 'events'] }
  };
  function can(perm) { return ROLES[SK.store.state.role].can.indexOf(perm) >= 0; }

  var TYPES = {
    door_forced:   { name: 'Відчинення дверей у закритій зоні', sev: 'critical' },
    access_denied: { name: 'Відмова доступу (невідомий відбиток)', sev: 'warning' },
    access_repeat: { name: 'Повторні невдалі спроби доступу', sev: 'serious' },
    access_granted:{ name: 'Вхід за відбитком пальця', sev: 'info' },
    sensor_fault:  { name: 'Несправність датчика', sev: 'warning' },
    ctrl_fault:    { name: 'Відмова контролера', sev: 'serious' },
    cab_power:     { name: 'Шафа автоматики: живлення від ДБЖ', sev: 'warning' },
    cab_off:       { name: 'Шафа автоматики знеструмлена', sev: 'critical' },
    cab_link:      { name: 'Обрив зв’язку шафи із серверною', sev: 'serious' },
    ups_fault:     { name: 'Несправність АКБ ДБЖ', sev: 'warning' },
    sim_ok:        { name: 'Несправність усунуто', sev: 'info' },
    command:       { name: 'Команда диспетчера виконана', sev: 'info' },
    command_fail:  { name: 'Команду не доставлено', sev: 'warning' },
    alarm:         { name: 'Спрацювання охоронної тривоги', sev: 'critical' },
    leak:          { name: 'Протікання води', sev: 'serious' },
    vape:          { name: 'Виявлено дим/вейп у приміщенні', sev: 'serious' },
    smoke_door:    { name: 'Двері кімнати для куріння відчинені', sev: 'warning' },
    energy:        { name: 'Високе енергоспоживання', sev: 'warning' },
    power:         { name: 'Живлення: перехід на резерв', sev: 'serious' },
    power_crit:    { name: 'Живлення: критичний стан', sev: 'critical' },
    power_ok:      { name: 'Живлення: мережу відновлено', sev: 'info' },
    co2:           { name: 'Високий рівень CO₂', sev: 'info' },
    service:       { name: 'Потрібне обслуговування', sev: 'info' }
  };
  var SEV = { critical: 'Критична', serious: 'Висока', warning: 'Попередження', info: 'Інформація' };
  var STATUS = { 'new': 'Нова', ack: 'Підтверджена', closed: 'Закрита' };

  /* ---------- Двері з біометричними зчитувачами ---------- */
  var ZONE_OF = { admin: 'admin', server: 'server', electric: 'tech', tech: 'tech', office: 'office', security: 'admin',
    computer: 'study', lab: 'lab', cowork: 'study' };
  var ZONES = {
    admin:  'Адміністративна (диспетчерська, пост охорони)',
    server: 'Серверна (закрита зона)',
    tech:   'Технічні приміщення (закрита зона)',
    office: 'Службові кабінети',
    lab:    'Лабораторії',
    study:  "Комп'ютерні класи й коворкінг",
    entry:  'Вхідна група (турнікети)'
  };
  var doors = B.rooms.filter(function (r) { return ZONE_OF[r.type]; }).map(function (r) {
    return { id: 'D-' + r.id, room: r.id, name: r.id + ' · ' + r.name, zone: ZONE_OF[r.type], closed: r.closed };
  });
  doors.unshift({ id: 'D-MAIN', room: 'П-101', name: 'Головний вхід (турнікети)', zone: 'entry' });
  var doorById = {}; doors.forEach(function (d) { doorById[d.id] = d; });

  /* Групи доступу: зони + часові вікна. Редагуються в коді/конфігурації сервера доступу. */
  var GROUPS = {
    admins:   { name: 'Адміністратори системи', zones: ['admin', 'server', 'tech', 'office', 'lab', 'study', 'entry'], from: '00:00', to: '24:00', days: [1, 2, 3, 4, 5, 6, 7] },
    guards:   { name: 'Охорона', zones: ['admin', 'tech', 'office', 'lab', 'study', 'entry'], from: '00:00', to: '24:00', days: [1, 2, 3, 4, 5, 6, 7] },
    teachers: { name: 'Викладачі', zones: ['office', 'lab', 'study', 'entry'], from: '07:00', to: '21:00', days: [1, 2, 3, 4, 5, 6] },
    labstaff: { name: 'Лаборанти', zones: ['lab', 'study', 'entry'], from: '07:00', to: '20:00', days: [1, 2, 3, 4, 5] },
    it:       { name: 'ІТ-служба', zones: ['server', 'tech', 'study', 'lab', 'entry'], from: '07:00', to: '22:00', days: [1, 2, 3, 4, 5, 6, 7] },
    cleaning: { name: 'Прибирання', zones: ['office', 'lab', 'study', 'entry'], from: '06:00', to: '09:00', days: [1, 2, 3, 4, 5, 6], extra: ['17:00', '21:00'] },
    students: { name: 'Студенти (за згодою)', zones: ['study', 'entry'], from: '07:30', to: '20:00', days: [1, 2, 3, 4, 5, 6] }
  };

  function demoUsers() {
    var plan = [['admins', 3], ['guards', 4], ['teachers', 22], ['labstaff', 6], ['it', 3], ['cleaning', 6], ['students', 16]];
    var out = [], n = 0;
    plan.forEach(function (p) {
      for (var i = 0; i < p[1]; i++) {
        n++;
        var id = 'U-' + ('000' + n).slice(-4);
        out.push({ id: id, group: p[0], prints: U.hash01(id) > 0.2 ? 2 : 1, consent: true, active: true,
          alt: U.hash01(id + 'a') > 0.85 ? 'PIN' : null });
      }
    });
    out[out.length - 1].prints = 0; out[out.length - 1].alt = 'Картка';  // приклад: без біометрії (не погодився)
    return out;
  }
  function users() { var st = SK.store.state; if (!st.access) st.access = { users: demoUsers() }; return st.access.users; }
  function user(id) { return users().filter(function (u) { return u.id === id; })[0]; }

  function doorMode(id) { return SK.store.state.doors[id] || 'auto'; }
  function doorState(id) {
    var m = doorMode(id);
    if (m === 'open' || m === 'locked') return m;
    if (SK.control && SK.control.doorPulseOpen(id)) return 'open';   // відчинено диспетчером на 5 с
    return id === 'D-MAIN' ? 'open' : 'locked';     // «авто»: зачинено, відчиняється за відбитком
  }
  function setDoor(id, v) { SK.store.state.doors[id] = v; SK.store.save(); }

  function hm(d) { return d.getHours() * 60 + d.getMinutes(); }
  function toMin(s) { var a = s.split(':'); return +a[0] * 60 + +a[1]; }

  /* Перевірка доступу: користувач + двері + час → {ok, reason} */
  function check(u, door, date) {
    if (!u) return { ok: false, reason: 'Відбиток не зареєстровано' };
    if (!u.active) return { ok: false, reason: 'Користувача заблоковано' };
    if (!u.prints) return { ok: false, reason: 'Немає біометрії — вхід лише за ' + (u.alt || 'карткою') };
    if (doorMode(door.id) === 'locked') return { ok: false, reason: 'Двері заблоковано адміністратором' };
    /* Зчитувач без живлення чи без контролера — двері лишаються в безпечному стані */
    if (SK.faults && door.room) {
      var rdr = SK.devicesI3.roomDevices(door.room).filter(function (x) { return x.kind === 'finger'; })[0];
      var iss = rdr ? SK.faults.deviceIssue(rdr, date) : null;
      if (iss && iss.cause !== 'link') return { ok: false, reason: 'Зчитувач недоступний: ' + iss.value };
    }
    var g = GROUPS[u.group];
    if (g.zones.indexOf(door.zone) < 0) return { ok: false, reason: 'Немає прав на зону «' + ZONES[door.zone] + '»' };
    var m = hm(date), d = U.dow(date);
    var inTime = g.days.indexOf(d) >= 0 && (m >= toMin(g.from) && m < toMin(g.to) || (g.extra && m >= toMin(g.extra[0]) && m < toMin(g.extra[1])));
    if (!inTime) return { ok: false, reason: 'Поза дозволеним часом (' + g.from + '–' + g.to + ')' };
    if (u.group === 'students' && door.zone === 'study' && door.room) {   // студентам — лише за бронюванням/розкладом
      var s = SK.schedule.status(door.room, date);
      if (s.status === 'free') return { ok: false, reason: 'Аудиторія не заброньована на цей час' };
    }
    return { ok: true, reason: 'Доступ дозволено (' + g.name + ')' };
  }

  /* Спроба проходу за відбитком (симуляція). userId = null — невідомий відбиток. */
  var fails = {};
  function attempt(userId, doorId) {
    var now = SK.store.clock.now(), door = doorById[doorId], u = userId ? user(userId) : null;
    var r = check(u, door, now);
    var rec = { ts: now.getTime(), door: doorId, user: u ? u.id : 'невідомий', ok: r.ok, reason: r.reason };
    var st = SK.store.state;
    st.accessLog.unshift(rec); if (st.accessLog.length > 300) st.accessLog.length = 300;
    if (r.ok) {
      fails[doorId] = 0;
      addEvent('access_granted', door.room, 'Двері ' + door.name + ' — ' + (u ? u.id : '') + ' (' + GROUPS[u.group].name + '). Відбиток розпізнано (симуляція).', true);
    } else {
      fails[doorId] = (fails[doorId] || 0) + 1;
      if (!u) addEvent('access_denied', door.room, door.name + ': ' + r.reason + ' (ТЕСТ).');
      if (fails[doorId] >= 3) { addEvent('access_repeat', door.room, door.name + ': ' + fails[doorId] + ' невдалі спроби поспіль — перевірити на місці.'); fails[doorId] = 0; }
      SK.store.save();
    }
    return rec;
  }
  function enroll(userId) { var u = user(userId); if (u && u.prints < 2) { u.prints++; u.consent = true; SK.store.save(); } }
  function revoke(userId) { var u = user(userId); if (u) { u.prints = 0; SK.store.save(); } }
  function block(userId) { var u = user(userId); if (u) { u.active = !u.active; SK.store.save(); } }
  function addUser(group) {
    var l = users(), id = 'U-' + ('000' + (l.length + 1)).slice(-4);
    l.push({ id: id, group: group, prints: 0, consent: false, active: true, alt: null });
    SK.store.save(); return id;
  }

  /* ---------- Журнал подій ---------- */
  /* ref — ключ причини (напр. «dev:CO2-А-201-1»): коли несправність усунуто, відкриті події з цим ключем
     закриваються автоматично, але ЛИШАЮТЬСЯ в журналі з позначкою «усунуто» */
  function addEvent(type, roomId, note, silent, ref) {
    var ev = { id: U.uid('EV'), ts: SK.store.clock.now().getTime(), type: type, room: roomId || null,
      sev: TYPES[type].sev, status: TYPES[type].sev === 'info' ? 'closed' : 'new', note: note || '', test: true, ref: ref || null };
    SK.store.state.events.unshift(ev);
    if (SK.store.state.events.length > 400) SK.store.state.events.length = 400;
    if (type === 'sensor_fault' && roomId) SK.store.state.faults['T-' + roomId] = true;
    SK.store.save();
    if (!silent) SK.store.emit('event', ev);
    return ev;
  }
  function setStatus(id, status) {
    var ev = SK.store.state.events.filter(function (e) { return e.id === id; })[0];
    if (!ev) return;
    ev.status = status; ev.by = ROLES[SK.store.state.role].name; ev.at = SK.store.clock.now().getTime();
    if (status === 'closed' && ev.type === 'sensor_fault' && ev.room) delete SK.store.state.faults['T-' + ev.room];
    if (status === 'closed' && ev.type === 'smoke_door' && ev.room) delete SK.store.state.faults['SMKDOOR-' + ev.room];
    SK.store.save();
  }
  function resolve(ref, text) {
    var n = 0, t = SK.store.clock.now().getTime();
    SK.store.state.events.forEach(function (e) {
      if (e.ref === ref && e.status !== 'closed') { e.status = 'closed'; e.by = 'Система (усунуто)'; e.at = t; e.resolved = text || 'усунуто'; n++; }
    });
    return n;
  }
  function active() { return SK.store.state.events.filter(function (e) { return e.status !== 'closed'; }); }
  function roomAlarm(roomId) {
    var ev = SK.store.state.events;
    for (var i = 0; i < ev.length; i++) if (ev[i].room === roomId && ev[i].status === 'new' && (ev[i].sev === 'critical' || ev[i].sev === 'serious')) return ev[i];
    return null;
  }

  /* ---------- Тестові сценарії ---------- */
  function pick(filter) { var rs = B.rooms.filter(filter); return rs[Math.floor(Math.random() * rs.length)]; }
  function pickDoor(zone) { var ds = doors.filter(function (d) { return d.zone === zone; }); return ds[Math.floor(Math.random() * ds.length)]; }
  var TESTS = [
    { type: 'door_forced', label: 'Двері серверної відчинено', run: function () {
      var r = pick(function (x) { return x.type === 'server'; });
      setDoor('D-' + r.id, 'open');
      return addEvent('door_forced', r.id, 'Геркон дверей: відкрито без розпізнаного відбитка (ТЕСТ).');
    } },
    { type: 'access_denied', label: 'Невідомий відбиток', run: function () {
      var d = pickDoor('office'); attempt(null, d.id);
      return SK.store.state.events[0];
    } },
    { type: 'sensor_fault', label: 'Несправність датчика', run: function () {
      var r = pick(function (x) { return x.bookable; });
      return addEvent('sensor_fault', r.id, 'Термодатчик 1-Wire не відповідає 60 с (ТЕСТ).');
    } },
    { type: 'alarm', label: 'Охоронна тривога', run: function () {
      var r = pick(function (x) { return x.type === 'lab' || x.type === 'computer'; });
      return addEvent('alarm', r.id, 'PIR-датчик: рух у постановленій на охорону зоні (ТЕСТ).');
    } },
    { type: 'leak', label: 'Протікання води', run: function () {
      var r = pick(function (x) { return x.type === 'wc'; });
      return addEvent('leak', r.id, 'Датчик протікання спрацював (ТЕСТ). Сценарій: перекрити кран (концепт).');
    } },
    { type: 'vape', label: 'Дим/вейп у приміщенні', run: function () {
      var r = pick(function (x) { return x.type === 'wc' || x.type === 'stairs'; });
      return addEvent('vape', r.id, 'Детектор диму/вейпу спрацював (ТЕСТ). Пожежна сигналізація не задіяна; черговому — перевірити. Куріння дозволене лише в кімнатах для куріння.');
    } },
    { type: 'smoke_door', label: 'Двері курильні відчинені', run: function () {
      var r = pick(function (x) { return x.type === 'smoking'; });
      SK.store.state.faults['SMKDOOR-' + r.id] = true;
      return addEvent('smoke_door', r.id, 'Геркон: двері кімнати для куріння відчинені понад 2 хв — дим потрапляє в коридор (ТЕСТ).');
    } }
  ];

  function systems() {
    var st = SK.store.state, act = active();
    var crit = act.filter(function (e) { return e.sev === 'critical' && e.type !== 'power_crit'; }).length;
    var faults = Object.keys(st.faults || {}).length;
    var ps = SK.power ? SK.power.state(SK.store.clock.now()) : { grid: true };
    return [
      { name: 'Доступ за відбитками', state: act.some(function (e) { return (e.type === 'door_forced' || e.type === 'access_repeat') && e.status === 'new'; }) ? 'bad' : 'good',
        text: doors.length + ' дверей · ' + users().filter(function (u) { return u.prints; }).length + ' користувачів' },
      { name: 'Охоронні датчики', state: crit ? 'bad' : faults ? 'warn' : 'good', text: crit ? 'Тривога!' : faults ? faults + ' несправн.' : 'Норма' },
      { name: 'Електроживлення', state: ps.grid ? 'good' : ps.phase === 'gen' ? 'warn' : 'bad', text: ps.grid ? 'Мережа' : ps.source },
      (function () { var fs = SK.faults ? SK.faults.summary() : { any: 0 }; return { name: 'Шафи автоматики', state: fs.cabOff || fs.ctrl ? 'bad' : fs.any ? 'warn' : 'good',
        text: fs.any ? [fs.cabOff ? fs.cabOff + ' знеструмл.' : '', fs.cabBatt ? fs.cabBatt + ' на батареї' : '', fs.cabLink ? fs.cabLink + ' без зв’язку' : '', fs.ctrl ? fs.ctrl + ' контр. offline' : '', fs.dev ? fs.dev + ' пристр. несправні' : ''].filter(Boolean).join(', ') : 'Норма' }; })(),
      { name: 'Пожежна сигналізація', state: 'good', text: 'Норма (лише відображення)', readonly: true },
      { name: 'Евакуаційне освітлення', state: 'good', text: 'Норма (власні АКБ)', readonly: true },
      { name: 'Відеоспостереження', state: 'good', text: 'Концепт: за погодженням', readonly: true }
    ];
  }

  function toCSV() {
    var rows = [['Дата і час', 'Тип', 'Приміщення', 'Важливість', 'Статус', 'Опис']];
    SK.store.state.events.forEach(function (e) {
      rows.push([U.fmtDateTime(new Date(e.ts)), TYPES[e.type].name, e.room || '', SEV[e.sev], STATUS[e.status], e.note]);
    });
    return '﻿' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
  }

  return { ROLES: ROLES, can: can, TYPES: TYPES, SEV: SEV, STATUS: STATUS,
    doors: doors, door: function (id) { return doorById[id]; }, doorState: doorState, doorMode: doorMode, setDoor: setDoor,
    ZONES: ZONES, GROUPS: GROUPS, users: users, user: user, check: check, attempt: attempt, enroll: enroll, revoke: revoke, block: block, addUser: addUser,
    addEvent: addEvent, resolve: resolve, setStatus: setStatus, active: active, roomAlarm: roomAlarm, TESTS: TESTS, systems: systems, toCSV: toCSV };
})();
