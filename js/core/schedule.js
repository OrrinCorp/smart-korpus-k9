/* Модуль «Розклад та використання аудиторій» (ТЗ п. 3.2).
 * - генерує детермінований демо-розклад (однаковий в усіх вкладках);
 * - визначає статус аудиторії: вільна / зайнята / заброньована;
 * - перевіряє конфлікти (два заняття в одній аудиторії одночасно);
 * - керує бронюваннями.
 * Для підключення офіційного розкладу достатньо замінити baseLessons() на
 * завантаження даних з API (формат об'єкта заняття див. нижче). */
SK.schedule = (function () {
  var U = SK.util, D = SK.scheduleData, B = SK.building;

  var PAIRS = D.pairs.map(function (p) {
    return { n: p.n, start: p.start, end: p.end, s: toMin(p.start), e: toMin(p.end) };
  });
  function toMin(hm) { var a = hm.split(':'); return +a[0] * 60 + +a[1]; }

  /* Групи: код спеціальності + курс + номер, напр. «КН-21» */
  var groups = [];
  D.specialties.forEach(function (sp) {
    D.courses.forEach(function (c) {
      var count = (sp.code === 'КН' || sp.code === 'ІПЗ') && c <= 2 ? 2 : 1;
      for (var i = 1; i <= count; i++) {
        var id = sp.code + '-' + c + i;
        groups.push({ id: id, specialty: sp.code, specialtyName: sp.name, course: c,
          size: 16 + Math.floor(U.hash01(id) * 14), roomTypes: sp.rooms });
      }
    });
  });

  /* ---- Генерація базового розкладу ----
     Об'єкт заняття: {id, room, day(1..5), pair(1..6), group, teacher, subject, kind} */
  var base = null;
  function baseLessons() {
    if (base) return base;
    base = [];
    var busy = {};   // room|day|pair
    var teacherBusy = {};
    var rand = U.rng('k9-schedule-v1');
    var byType = {};
    B.bookableRooms().forEach(function (r) {
      if (r.type === 'cowork') return;
      (byType[r.type] = byType[r.type] || []).push(r);
    });
    groups.forEach(function (g) {
      for (var day = 1; day <= 5; day++) {
        var count = 2 + Math.floor(rand() * 3);              // 2..4 пари
        var first = 1 + Math.floor(rand() * (g.course >= 3 ? 3 : 2));
        for (var p = first; p < first + count && p <= 6; p++) {
          var kind = g.roomTypes[Math.floor(rand() * g.roomTypes.length)];
          var cands = (byType[kind] || []).filter(function (r) {
            return !busy[r.id + '|' + day + '|' + p] && r.capacity >= g.size * 0.8;
          });
          if (!cands.length) continue;
          var room = cands[Math.floor(rand() * cands.length)];
          var subj = D.subjects[kind][Math.floor(rand() * D.subjects[kind].length)];
          var t, tries = 0;
          do { t = D.teachers[Math.floor(rand() * D.teachers.length)]; tries++; }
          while (teacherBusy[t + '|' + day + '|' + p] && tries < 20);
          busy[room.id + '|' + day + '|' + p] = 1;
          teacherBusy[t + '|' + day + '|' + p] = 1;
          base.push({ id: 'L' + base.length, room: room.id, day: day, pair: p, group: g.id,
            teacher: t, subject: subj, kind: kind === 'lecture' ? 'Лекція' : kind === 'lab' ? 'Лабораторна' : 'Практична' });
        }
      }
    });
    /* Навмисний конфлікт для демонстрації перевірки (імітація помилки імпорту) */
    var victim = base.filter(function (l) { return l.day === 1 && l.pair === 2; })[0];
    if (victim) base.push({ id: 'L-conflict', room: victim.room, day: 1, pair: 2, group: 'ПФ-41',
      teacher: 'доц. Кравець Р.', subject: 'Методологія досліджень', kind: 'Практична', imported: true });
    return base;
  }

  function lessons() {
    var st = SK.store.state;
    var removed = {};
    st.removedLessons.forEach(function (id) { removed[id] = 1; });
    return baseLessons().filter(function (l) { return !removed[l.id]; }).concat(st.customLessons);
  }

  /* Індекс за ключем room|day|pair — перебудовується, коли змінюється стан */
  var idx = null, idxVer = -1, ver = 0;
  SK.store.on('change', function () { ver++; });
  function index() {
    if (idx && idxVer === ver) return idx;
    idx = {};
    lessons().forEach(function (l) { (idx[l.room + '|' + l.day + '|' + l.pair] = idx[l.room + '|' + l.day + '|' + l.pair] || []).push(l); });
    idxVer = ver;
    return idx;
  }

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

  function lessonsAt(roomId, day, pair) { return index()[roomId + '|' + day + '|' + pair] || []; }

  function bookingAt(roomId, date, pair) {
    var k = U.dateKey(date);
    var b = SK.store.state.bookings.filter(function (b) { return b.room === roomId && b.date === k && b.pair === pair; })[0];
    if (b) return b;
    /* Подія з розкладу подій теж бронює аудиторію */
    if (SK.uniEvents) {
      var p = PAIRS[pair - 1], ev = SK.uniEvents.inRoom(roomId, date, p.s, p.e)[0];
      if (ev) return { id: ev.id, room: roomId, date: k, pair: pair, who: 'Розклад подій', purpose: ev.title, event: true };
    }
    return null;
  }

  /* Статус аудиторії для конкретної пари (або поточної пари, якщо pairN не задано). */
  function status(roomId, date, pairN) {
    var r = B.room(roomId);
    if (!r || !r.bookable) return { status: 'na' };
    var day = U.dow(date);
    var p = pairN ? PAIRS[pairN - 1] : pairAt(date);
    var res = { status: 'free', pair: p, lesson: null, booking: null, next: null };
    if (p && day <= 5) {
      var ls = lessonsAt(roomId, day, p.n);
      if (ls.length) { res.status = 'busy'; res.lesson = ls[0]; res.conflict = ls.length > 1; }
    }
    if (p && res.status === 'free') {
      var b = bookingAt(roomId, date, p.n);
      if (b) { res.status = 'booked'; res.booking = b; }
    }
    if (!pairN) {
      var from = p ? p.n + 1 : (nextPair(date) || { n: 7 }).n;
      for (var n = from; n <= 6; n++) {
        var l2 = day <= 5 ? lessonsAt(roomId, day, n)[0] : null;
        var b2 = bookingAt(roomId, date, n);
        if (l2 || b2) { res.next = { pair: PAIRS[n - 1], lesson: l2, booking: b2 }; break; }
      }
    }
    return res;
  }

  function roomDay(roomId, date) {
    var day = U.dow(date);
    return PAIRS.map(function (p) {
      return { pair: p, lessons: day <= 5 ? lessonsAt(roomId, day, p.n) : [], booking: bookingAt(roomId, date, p.n) };
    });
  }

  function groupWeek(groupId) {
    return lessons().filter(function (l) { return l.group === groupId; })
      .sort(function (a, b) { return a.day - b.day || a.pair - b.pair; });
  }

  function freeRooms(date, pairN, filter) {
    return B.bookableRooms().filter(function (r) {
      if (filter && filter.block && r.block !== filter.block) return false;
      if (filter && filter.floor && r.floor !== +filter.floor) return false;
      if (filter && filter.type && r.type !== filter.type) return false;
      return status(r.id, date, pairN).status === 'free';
    });
  }

  /* Конфлікти: одна аудиторія — кілька занять в одну пару; одна група — дві аудиторії. */
  function conflicts() {
    var out = [], byRoom = {}, byGroup = {};
    lessons().forEach(function (l) {
      var k = l.room + '|' + l.day + '|' + l.pair;
      (byRoom[k] = byRoom[k] || []).push(l);
      var g = l.group + '|' + l.day + '|' + l.pair;
      (byGroup[g] = byGroup[g] || []).push(l);
    });
    Object.keys(byRoom).forEach(function (k) { if (byRoom[k].length > 1) out.push({ kind: 'room', lessons: byRoom[k] }); });
    Object.keys(byGroup).forEach(function (k) { if (byGroup[k].length > 1) out.push({ kind: 'group', lessons: byGroup[k] }); });
    return out;
  }

  /* Перевірка перед додаванням заняття. Повертає текст помилки або null. */
  function checkLesson(l) {
    if (lessonsAt(l.room, l.day, l.pair).length) return 'Аудиторія ' + l.room + ' уже зайнята в цей час.';
    var clash = lessons().filter(function (x) { return x.group === l.group && x.day === l.day && x.pair === l.pair; })[0];
    if (clash) return 'Група ' + l.group + ' уже має заняття в ' + clash.room + ' у цей час.';
    return null;
  }

  function addLesson(l) {
    var err = checkLesson(l);
    if (err) return err;
    l.id = U.uid('LC');
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

  /* Сегменти присутності за день: [{s,e,people,kind}] — використовує симулятор датчиків. */
  var segCache = {};
  function occupancy(roomId, date) {
    var key = roomId + '|' + U.dateKey(date) + '|' + ver;
    if (segCache[key]) return segCache[key];
    var day = U.dow(date), out = [];
    PAIRS.forEach(function (p) {
      var l = day <= 5 ? lessonsAt(roomId, day, p.n)[0] : null;
      var b = bookingAt(roomId, date, p.n);
      if (l) {
        var g = groups.filter(function (x) { return x.id === l.group; })[0];
        out.push({ s: p.s, e: p.e, people: g ? g.size : 20, kind: 'lesson' });
      } else if (b) {
        out.push({ s: p.s, e: p.e, people: b.event ? 25 + Math.floor(U.hash01(b.id) * 30) : 3 + Math.floor(U.hash01(b.id) * 6), kind: b.event ? 'event' : 'booking' });
      }
    });
    if (Object.keys(segCache).length > 4000) segCache = {};
    segCache[key] = out;
    return out;
  }

  var STATUS = {
    free:   { name: 'Вільна', color: 0x5cb87a, css: 'free' },
    busy:   { name: 'Зайнята', color: 0xe06b6b, css: 'busy' },
    booked: { name: 'Заброньована', color: 0x6295dd, css: 'booked' },
    na:     { name: 'Не бронюється', color: 0xb9c2c8, css: 'na' }
  };

  return {
    PAIRS: PAIRS, groups: groups, STATUS: STATUS, toMin: toMin,
    lessons: lessons, lessonsAt: lessonsAt, pairAt: pairAt, nextPair: nextPair, status: status,
    roomDay: roomDay, groupWeek: groupWeek, freeRooms: freeRooms, conflicts: conflicts,
    checkLesson: checkLesson, addLesson: addLesson, removeLesson: removeLesson,
    book: book, cancelBooking: cancelBooking, occupancy: occupancy
  };
})();
