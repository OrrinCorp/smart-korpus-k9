/* Модуль «Розклад та використання аудиторій» (ТЗ п. 3.2).
 *
 * Джерело занять — РЕАЛЬНИЙ розклад ННІФТКН ЧНУ для корпусу 9
 * (знімок js/data/real-schedule.js або JSON, імпортований адміністратором;
 * розбір — js/core/schedule-import.js). Розклад повторюється щотижня з
 * чергуванням 1-го і 2-го тижня (відлік від 1 вересня).
 *
 * На основі розкладу СИМУЛЮЄТЬСЯ присутність людей:
 *  - чисельність груп — за курсом (1 к. ≈ 25, 2 ≈ 22, 3 ≈ 18, 4 ≈ 15, магістри ≈ 10, ±20 %),
 *    підгрупи — половина; потік — сума груп;
 *  - відвідуваність: лекції ≈ 72 %, практичні ≈ 84 %, лабораторні ≈ 92 %;
 *    1-ша і 6–7-ма пари та п'ятниця — менше; щодня ±10 %;
 *  - студенти сходяться за 12 хв до пари, частина запізнюється до 15 хв;
 *    після пари виходять за 5 хв; якщо та сама група лишається в аудиторії на наступну пару,
 *    ≈ 40 % чекає на перерві в аудиторії;
 *  - викладач — +1 особа (приходить за 3 хв).
 * Кількість людей бачать лише лічильники людей (SK.devicesI3, kind 'counter'),
 * PIR-датчики фіксують тільки рух.
 *
 * Об'єкт заняття: {id, room, label, day 1..5, pair 1..7, week 0|1|2 (0 — щотижня),
 *   groups[], group, teacher, subject, kind, type, people, stream} */
SK.schedule = (function () {
  var U = SK.util, B = SK.building, IMP = SK.scheduleImport;

  var PAIRS_SRC = [
    { n: 1, start: '08:20', end: '09:40' }, { n: 2, start: '09:50', end: '11:10' },
    { n: 3, start: '11:30', end: '12:50' }, { n: 4, start: '13:00', end: '14:20' },
    { n: 5, start: '14:40', end: '16:00' }, { n: 6, start: '16:10', end: '17:30' },
    { n: 7, start: '17:40', end: '19:00' }
  ];
  function toMin(hm) { var a = hm.split(':'); return +a[0] * 60 + +a[1]; }
  var PAIRS = PAIRS_SRC.map(function (p) { return { n: p.n, start: p.start, end: p.end, s: toMin(p.start), e: toMin(p.end) }; });

  /* ---- Дані розкладу ---- */
  var modelRooms = {};
  B.rooms.forEach(function (r) { if (r.bookable) modelRooms[r.id] = true; });
  var data = null, dataVer = -1, ver = 0;
  SK.store.on('change', function () { ver++; });
  function source() {
    var imp = SK.store.state.scheduleImport;
    if (imp && imp.rows && imp.rows.length) return { rows: imp.rows, info: { name: imp.name, at: imp.at, imported: true } };
    var R = SK.realSchedule || { rows: [], source: {} };
    return { rows: R.rows, info: { name: R.source.name + ', ' + R.source.semester, url: R.source.url, page: R.source.page, built: R.source.built, imported: false } };
  }
  var srcKey = null;
  function base() {
    var imp = SK.store.state.scheduleImport, key = imp ? imp.at : 'snapshot';
    if (data && srcKey === key) return data;
    var src = source();
    data = IMP.build(src.rows, { rooms: modelRooms });
    data.info = src.info;
    data.groupById = {};
    data.groups.forEach(function (g) { data.groupById[g.id] = g; });
    srcKey = key;
    return data;
  }

  function lessons() {
    var st = SK.store.state, removed = {};
    st.removedLessons.forEach(function (id) { removed[id] = 1; });
    return base().lessons.filter(function (l) { return !removed[l.id]; }).concat(st.customLessons.map(normCustom));
  }
  function normCustom(l) {
    if (!l.groups) { l.groups = [l.group]; }
    if (l.week == null) l.week = 0;
    if (l.people == null) l.people = l.groups.reduce(function (a, g) { return a + groupInfo(g).size; }, 0);
    l.type = l.type || (l.kind === 'Лекція' ? 'lecture' : l.kind === 'Лабораторна' ? 'lab' : 'practice');
    return l;
  }
  function groupInfo(id) { return base().groupById[id] || IMP.groupInfo(id); }

  /* Індекс room|day|pair → [заняття] (обидва тижні; фільтр за тижнем — у lessonsAt) */
  var idx = null, idxVer = -1;
  function index() {
    if (idx && idxVer === ver) return idx;
    idx = {};
    lessons().forEach(function (l) { var k = l.room + '|' + l.day + '|' + l.pair; (idx[k] = idx[k] || []).push(l); });
    idxVer = ver;
    return idx;
  }
  function weekOf(date) { return IMP.weekOf(date || SK.store.clock.now()); }
  function inWeek(l, w) { return !l.week || l.week === w; }

  function pairAt(date) {
    var m = date.getHours() * 60 + date.getMinutes();
    for (var i = 0; i < PAIRS.length; i++) if (m >= PAIRS[i].s && m < PAIRS[i].e) return PAIRS[i];
    return null;
  }
  function nextPair(date) {
    var m = date.getHours() * 60 + date.getMinutes();
    for (var i = 0; i < PAIRS.length; i++) if (PAIRS[i].s > m) return PAIRS[i];
    return null;
  }

  /* week — 1|2; без нього — тиждень поточної (симульованої) дати */
  function lessonsAt(roomId, day, pair, week) {
    var w = week || weekOf();
    return (index()[roomId + '|' + day + '|' + pair] || []).filter(function (l) { return inWeek(l, w); });
  }

  function bookingAt(roomId, date, pair) {
    var k = U.dateKey(date);
    var b = SK.store.state.bookings.filter(function (b) { return b.room === roomId && b.date === k && b.pair === pair; })[0];
    if (b) return b;
    if (SK.uniEvents) {
      var p = PAIRS[pair - 1], ev = SK.uniEvents.inRoom(roomId, date, p.s, p.e)[0];
      if (ev) return { id: ev.id, room: roomId, date: k, pair: pair, who: 'Розклад подій', purpose: ev.title, event: true };
    }
    return null;
  }

  function status(roomId, date, pairN) {
    var r = B.room(roomId);
    if (!r || !r.bookable) return { status: 'na' };
    var day = U.dow(date), w = weekOf(date);
    var p = pairN ? PAIRS[pairN - 1] : pairAt(date);
    var res = { status: 'free', pair: p, lesson: null, booking: null, next: null, week: w };
    if (p && day <= 5) {
      var ls = lessonsAt(roomId, day, p.n, w);
      if (ls.length) { res.status = 'busy'; res.lesson = ls[0]; res.lessons = ls; res.conflict = ls.length > 1; }
    }
    if (p && res.status === 'free') {
      var b = bookingAt(roomId, date, p.n);
      if (b) { res.status = 'booked'; res.booking = b; }
    }
    if (!pairN) {
      var from = p ? p.n + 1 : (nextPair(date) || { n: PAIRS.length + 1 }).n;
      for (var n = from; n <= PAIRS.length; n++) {
        var l2 = day <= 5 ? lessonsAt(roomId, day, n, w)[0] : null;
        var b2 = bookingAt(roomId, date, n);
        if (l2 || b2) { res.next = { pair: PAIRS[n - 1], lesson: l2, booking: b2 }; break; }
      }
    }
    return res;
  }

  function roomDay(roomId, date) {
    var day = U.dow(date), w = weekOf(date);
    return PAIRS.map(function (p) {
      return { pair: p, lessons: day <= 5 ? lessonsAt(roomId, day, p.n, w) : [], booking: bookingAt(roomId, date, p.n) };
    });
  }

  function groupWeek(groupId) {
    return lessons().filter(function (l) { return l.groups.indexOf(groupId) >= 0; })
      .sort(function (a, b) { return a.day - b.day || a.pair - b.pair || a.week - b.week; });
  }

  function freeRooms(date, pairN, filter) {
    return B.bookableRooms().filter(function (r) {
      if (filter && filter.block && r.block !== filter.block) return false;
      if (filter && filter.floor && r.floor !== +filter.floor) return false;
      if (filter && filter.type && r.type !== filter.type) return false;
      return status(r.id, date, pairN).status === 'free';
    });
  }

  /* Конфлікти (для кожного тижня окремо): аудиторія — кілька різних занять в одну пару;
     група — у двох аудиторіях одночасно. Потоки конфліктом не є. */
  var cfCache = null, cfVer = -1;
  function conflicts() {
    if (cfCache && cfVer === ver) return cfCache;
    var out = [], byRoom = {}, byGroup = {};
    lessons().forEach(function (l) {
      (l.week ? [l.week] : [1, 2]).forEach(function (w) {
        var k = l.room + '|' + l.day + '|' + l.pair + '|' + w;
        (byRoom[k] = byRoom[k] || []).push(l);
        l.groups.forEach(function (g) { var gk = g + '|' + l.day + '|' + l.pair + '|' + w; (byGroup[gk] = byGroup[gk] || []).push(l); });
      });
    });
    var seen = {};
    function push(kind, ls, w) {
      var key = kind + ls.map(function (l) { return l.id; }).sort().join(',');
      if (seen[key]) { seen[key].weeks.push(w); return; }
      seen[key] = { kind: kind, lessons: ls, weeks: [w] };
      out.push(seen[key]);
    }
    Object.keys(byRoom).forEach(function (k) { if (byRoom[k].length > 1) push('room', byRoom[k], +k.split('|')[3]); });
    Object.keys(byGroup).forEach(function (k) {
      var ls = byGroup[k];
      if (ls.length > 1 && ls.some(function (l) { return l.room !== ls[0].room; })) push('group', ls, +k.split('|')[3]);
    });
    cfCache = out; cfVer = ver;
    return out;
  }

  function checkLesson(l) {
    var weeks = l.week ? [l.week] : [1, 2];
    for (var i = 0; i < weeks.length; i++) {
      if (lessonsAt(l.room, l.day, l.pair, weeks[i]).length) return 'Аудиторія ' + l.room + ' уже зайнята в цей час (' + weeks[i] + '-й тиждень).';
      var clash = lessons().filter(function (x) { return x.groups.indexOf(l.group) >= 0 && x.day === l.day && x.pair === l.pair && inWeek(x, weeks[i]); })[0];
      if (clash) return 'Група ' + l.group + ' уже має заняття в ' + clash.room + ' у цей час.';
    }
    return null;
  }
  function addLesson(l) {
    var err = checkLesson(l);
    if (err) return err;
    l.id = U.uid('LC'); l.groups = [l.group]; l.week = l.week || 0;
    SK.store.state.customLessons.push(l);
    SK.store.save();
    return null;
  }
  function removeLesson(id) {
    var st = SK.store.state;
    var c = st.customLessons.filter(function (l) { return l.id !== id; });
    if (c.length !== st.customLessons.length) st.customLessons = c;
    else st.removedLessons.push(id);
    SK.store.save();
  }

  function book(roomId, date, pairN, who, purpose) {
    var s = status(roomId, date, pairN);
    if (s.status === 'na') return 'Ця аудиторія не бронюється.';
    if (s.status !== 'free') return 'Аудиторія вже ' + (s.status === 'busy' ? 'зайнята' : 'заброньована') + ' на цю пару.';
    var p = PAIRS[pairN - 1], now = SK.store.clock.now();
    if (U.dateKey(date) === U.dateKey(now) && now.getHours() * 60 + now.getMinutes() >= p.e) return 'Ця пара вже минула.';
    SK.store.state.bookings.push({ id: U.uid('BK'), room: roomId, date: U.dateKey(date), pair: pairN,
      who: who || 'Студент', purpose: purpose || 'Самостійна робота', createdAt: Date.now() });
    SK.store.save();
    return null;
  }
  function cancelBooking(id) {
    SK.store.state.bookings = SK.store.state.bookings.filter(function (b) { return b.id !== id; });
    SK.store.save();
  }

  /* ---------- Симуляція присутності ---------- */
  var RATE = { lecture: 0.72, practice: 0.84, lab: 0.92 };
  function attendance(l, date) {
    var day = U.dow(date), r = RATE[l.type] || 0.84;
    if (l.pair === 1) r *= 0.85;
    if (l.pair >= 6) r *= 0.85;
    if (day === 5) r *= 0.9;
    r *= 0.9 + 0.2 * U.hash01('att|' + l.id + '|' + U.dateKey(date));
    var students = Math.max(1, Math.round(l.people * Math.min(1, r)));
    return { students: students, rate: students / Math.max(1, l.people), total: students + 1 };
  }

  /* Сегменти за день: [{s, e, people, kind, lesson}] — s/e = межі пари або броні,
     people — очікувана кількість присутніх (студенти + викладач). */
  var segCache = {};
  function occupancy(roomId, date) {
    var key = roomId + '|' + U.dateKey(date) + '|' + ver;
    if (segCache[key]) return segCache[key];
    var day = U.dow(date), w = weekOf(date), out = [];
    PAIRS.forEach(function (p) {
      var ls = day <= 5 ? lessonsAt(roomId, day, p.n, w) : [];
      var b = bookingAt(roomId, date, p.n);
      if (ls.length) {
        var tot = 0, st = 0;
        ls.forEach(function (l) { var a = attendance(l, date); tot += a.total; st += a.students; });
        out.push({ s: p.s, e: p.e, people: tot, students: st, kind: 'lesson', lesson: ls[0], lessons: ls, pair: p.n });
      } else if (b) {
        out.push({ s: p.s, e: p.e, people: b.event ? 25 + Math.floor(U.hash01(b.id) * 30) : 3 + Math.floor(U.hash01(b.id) * 6),
          kind: b.event ? 'event' : 'booking', booking: b, pair: p.n });
      }
    });
    if (Object.keys(segCache).length > 6000) segCache = {};
    segCache[key] = out;
    return out;
  }

  /* Частка присутніх у момент m (хв доби) для сегмента; next — наступний сегмент тієї ж аудиторії */
  function share(seg, m, next, rid, dk) {
    var s = seg.s, e = seg.e, j = U.hash01(rid + '|' + dk + '|' + s);
    if (m < s - 12 || m >= e + 6) {
      /* перерва: частина групи лишається, якщо далі в цій самій аудиторії вона ж */
      if (next && m >= e && m < next.s && sameGroup(seg, next)) return 0.4 - 0.1 * j;
      return 0;
    }
    if (m < s) return 0.75 * (m - (s - 12)) / 12;
    if (m < s + 5) return 0.75 + 0.17 * (m - s) / 5;
    if (m < s + 15) return 0.92 + 0.08 * (m - s - 5) / 10;
    if (m < e) {
      /* усередині пари: 1–2 особи виходять на кілька хвилин */
      var t = Math.floor((m - s) / 5), out = U.hash01(rid + '|' + dk + '|' + s + '|' + t) > 0.86 ? 0.04 : 0;
      return 1 - out;
    }
    var keep = next && next.s - e <= 20 && sameGroup(seg, next) ? 0.4 - 0.1 * j : 0;
    return Math.max(keep, 1 - (m - e) / 6);
  }
  function sameGroup(a, b) {
    if (!a.lessons || !b.lessons) return false;
    var g = {};
    a.lessons.forEach(function (l) { l.groups.forEach(function (x) { g[x] = 1; }); });
    return b.lessons.some(function (l) { return l.groups.some(function (x) { return g[x]; }); });
  }

  /* Кількість людей в аудиторії в момент date (те, що показує лічильник людей) */
  function peopleAt(roomId, date) {
    var segs = occupancy(roomId, date);
    if (!segs.length) return 0;
    var m = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60, dk = U.dateKey(date), n = 0;
    segs.forEach(function (s, i) {
      var f = share(s, m, segs[i + 1], roomId, dk);
      if (f <= 0) return;
      var teacher = s.kind === 'lesson' ? (m >= s.s - 3 && m < s.e + 2 ? 1 : 0) : 0;
      n += Math.round((s.people - (s.kind === 'lesson' ? 1 : 0)) * f) + teacher;
    });
    return Math.max(0, n);
  }

  /* Присутність за день із кроком step хв: [{m, people}] */
  function dayCurve(roomId, date, step) {
    step = step || 5;
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate()), out = [];
    for (var m = 7 * 60; m <= 20 * 60; m += step) {
      d.setHours(0, m, 0, 0);
      out.push({ m: m, people: peopleAt(roomId, d) });
    }
    return out;
  }

  var STATUS = {
    free:   { name: 'Вільна', color: 0x3ecf8e, css: 'free' },
    busy:   { name: 'Зайнята', color: 0xf0606a, css: 'busy' },
    booked: { name: 'Заброньована', color: 0x9b8cff, css: 'booked' },
    na:     { name: 'Не бронюється', color: 0xb9c2c8, css: 'na' }
  };

  /* ---------- Імпорт власного JSON (формат src/data/schedule.json сайту розкладу) ---------- */
  function importJson(text, name) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return { error: 'Файл не є коректним JSON: ' + e.message }; }
    var rows = Array.isArray(json) ? json : json && (json.lessons || json.data || json.rows);
    if (!Array.isArray(rows) || !rows.length) return { error: 'У файлі немає масиву занять.' };
    var test = IMP.build(rows, { rooms: modelRooms });
    if (!test.lessons.length) return { error: 'Жодного заняття в аудиторіях корпусу 9 не знайдено.', report: test.report };
    var keep = rows.filter(function (o) { var k = IMP.roomKey(Array.isArray(o) ? o[6] : o.room); return k && modelRooms[k]; });
    SK.store.state.scheduleImport = { name: name || 'імпорт', at: Date.now(), rows: keep };
    SK.store.state.removedLessons = [];
    SK.store.save();
    return { report: test.report };
  }
  function resetImport() {
    SK.store.state.scheduleImport = null;
    SK.store.state.removedLessons = [];
    SK.store.save();
  }

  function info() { var b = base(); return { info: b.info, report: b.report, groups: b.groups.length, lessons: b.lessons.length }; }

  return {
    PAIRS: PAIRS, STATUS: STATUS, toMin: toMin, weekOf: weekOf,
    get groups() { return base().groups; },
    groupInfo: groupInfo, lessons: lessons, lessonsAt: lessonsAt, pairAt: pairAt, nextPair: nextPair, status: status,
    roomDay: roomDay, groupWeek: groupWeek, freeRooms: freeRooms, conflicts: conflicts,
    checkLesson: checkLesson, addLesson: addLesson, removeLesson: removeLesson,
    book: book, cancelBooking: cancelBooking, occupancy: occupancy, attendance: attendance,
    peopleAt: peopleAt, dayCurve: dayCurve, importJson: importJson, resetImport: resetImport, info: info
  };
})();
