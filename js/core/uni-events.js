/* Розклад подій інституту: конференції, хакатони, консультації, відкриті
 * лекції, збори, захисти. Адміністратор веде їх у панелі (вкладка «Події»),
 * студенти бачать у додатку. Подія в аудиторії автоматично робить її
 * «заброньованою» на відповідний час. Демо-події — вигадані.
 *
 * Подія: {id, title, type, date 'YYYY-MM-DD', start 'HH:MM', end 'HH:MM',
 *         room|null, place, audience ('all' | код спеціальності | група | 'course:N'), desc}
 */
SK.uniEvents = (function () {
  var U = SK.util;

  var TYPES = {
    conf:    'Конференція',
    hack:    'Хакатон',
    consult: 'Консультація',
    lecture: 'Відкрита лекція',
    meeting: 'Збори',
    defense: 'Захист робіт',
    career:  "Кар'єра",
    culture: 'Студентське життя',
    exam:    'Іспит / залік'
  };

  function weekMonday(d) { var x = new Date(d); x.setDate(x.getDate() - (U.dow(x) - 1)); x.setHours(0, 0, 0, 0); return x; }
  function dayKey(mon, add) { var x = new Date(mon); x.setDate(x.getDate() + add); return U.dateKey(x); }

  function demo() {
    var mon = weekMonday(SK.store.clock.now());
    var E = [
      [1, '14:40', '16:00', 'Б-110', 'Всім', 'Відкрита лекція: «Штучний інтелект у науці»', 'lecture', 'all', 'Запрошений лектор (демо). Вхід вільний.'],
      [2, '13:00', '14:20', 'А-305', 'КН', 'Консультація з курсових робіт', 'consult', 'КН', 'Принесіть чернетки розділу 1.'],
      [3, '16:10', '19:00', 'Б-211', 'Всім', 'Хакатон «Розумний корпус»: старт', 'hack', 'all', 'Команди до 4 осіб. Реєстрація — у старости.'],
      [4, '11:30', '12:50', 'Б-210', 'Перший курс', 'Збори першокурсників', 'meeting', 'course:1', 'Інформація про сесію та стипендії.'],
      [5, '13:00', '15:30', 'Б-210', 'Всім', "День кар'єри ІТ: зустріч з роботодавцями", 'career', 'all', 'Презентації компаній, стажування.'],
      [8, '09:50', '12:50', 'А-401', 'КІ-41', 'Попередній захист дипломних робіт', 'defense', 'КІ-41', ''],
      [9, '14:40', '16:00', null, 'Всім', 'Студентська рада: відкрите засідання', 'culture', 'all', 'Місце: коворкінг Б-111.'],
      [10, '08:20', '09:40', 'А-208', 'ІПЗ-21', 'Залік: Бази даних', 'exam', 'ІПЗ-21', 'Мати студентський квиток.'],
      [11, '11:30', '16:00', 'Б-310', 'Всім', 'Наукова конференція молодих учених', 'conf', 'all', 'Секції: фізика, КН, кібербезпека.']
    ];
    return E.map(function (e, i) {
      return { id: 'UE-' + (i + 1), date: dayKey(mon, e[0] - 1), start: e[1], end: e[2], room: e[3], aud: e[4], title: e[5],
        type: e[6], audience: e[7], desc: e[8], place: e[3] || 'Коворкінг Б-111' };
    });
  }

  function list() {
    var st = SK.store.state;
    if (!st.uniEvents) return demo();
    return st.uniEvents;
  }
  function editable() { var st = SK.store.state; if (!st.uniEvents) st.uniEvents = demo(); return st.uniEvents; }

  function toMin(hm) { var a = hm.split(':'); return +a[0] * 60 + +a[1]; }

  /* Події в аудиторії, що перетинаються з інтервалом [s,e) хв у день date */
  function inRoom(roomId, date, s, e) {
    var k = U.dateKey(date);
    return list().filter(function (ev) { return ev.room === roomId && ev.date === k && toMin(ev.start) < e && toMin(ev.end) > s; });
  }

  function forAudience(groupId) {
    var g = SK.schedule ? SK.schedule.groups.filter(function (x) { return x.id === groupId; })[0] : null;
    return function (ev) {
      if (ev.audience === 'all') return true;
      if (!g) return false;
      if (ev.audience === g.id || ev.audience === g.specialty) return true;
      if (ev.audience === 'course:' + g.course) return true;
      return false;
    };
  }

  function upcoming(fromDate, days) {
    var a = U.dateKey(fromDate), to = new Date(fromDate); to.setDate(to.getDate() + (days || 14));
    var b = U.dateKey(to);
    return list().filter(function (e) { return e.date >= a && e.date <= b; })
      .sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : toMin(x.start) - toMin(y.start); });
  }

  function save(ev) {
    var l = editable();
    if (ev.room && SK.building.room(ev.room) && !SK.building.room(ev.room).bookable) return 'Ця аудиторія не призначена для подій.';
    if (toMin(ev.end) <= toMin(ev.start)) return 'Час завершення має бути пізніше за початок.';
    if (ev.room) {
      var clash = l.filter(function (x) { return x.id !== ev.id && x.room === ev.room && x.date === ev.date && toMin(x.start) < toMin(ev.end) && toMin(x.end) > toMin(ev.start); })[0];
      if (clash) return 'У ' + ev.room + ' на цей час уже є подія «' + clash.title + '».';
      var d = new Date(ev.date + 'T12:00:00'), day = U.dow(d), lesson = null;
      if (SK.schedule && day <= 5) SK.schedule.PAIRS.forEach(function (p) {
        if (p.s < toMin(ev.end) && p.e > toMin(ev.start) && SK.schedule.lessonsAt(ev.room, day, p.n).length) lesson = p;
      });
      if (lesson) return 'У ' + ev.room + ' о ' + lesson.start + ' заняття за розкладом. Оберіть інший час або аудиторію.';
    }
    ev.place = ev.room || ev.place || 'уточнюється';
    var i = -1; l.forEach(function (x, k) { if (x.id === ev.id) i = k; });
    if (i >= 0) l[i] = ev; else { ev.id = U.uid('UE'); l.push(ev); }
    SK.store.save();
    return null;
  }
  function remove(id) { SK.store.state.uniEvents = editable().filter(function (e) { return e.id !== id; }); SK.store.save(); }

  return { TYPES: TYPES, list: list, inRoom: inRoom, forAudience: forAudience, upcoming: upcoming, save: save, remove: remove, toMin: toMin };
})();
