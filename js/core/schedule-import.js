/* Імпорт реального розкладу ННІФТКН ЧНУ (корпус № 9).
 *
 * Джерело — відкритий розклад інституту: https://ptcsi.chnu.edu.ua/ →
 * «Розклад занять» → https://shpatar26121974.github.io/nniftcn_schedule/
 * (дані: src/data/schedule.json у репозиторії shpatar26121974/nniftcn_schedule).
 * Формат запису джерела:
 *   {day:'Понеділок', period:1..7, week:1|2, group:'121 група', subject, teacher,
 *    room:'к.9, а.310' | '9-110Б' | 'Корпус 9, ауд. 303А' | '8-326' | 'онлайн', type:'lecture'|'practice'|'lab'}
 *
 * Модуль не залежить від DOM: його використовують і браузер (знімок
 * js/data/real-schedule.js, імпорт власного JSON у вкладці «Розклад»),
 * і скрипт tools/build-real-schedule.js.
 *
 * Правила (погоджено):
 *  - беруться лише аудиторії корпусу 9; інші корпуси й «онлайн» пропускаються;
 *  - літера А/Б (суфікс 205А чи префікс А109) — блок; 303А і А303 — одна кімната;
 *  - номери без літери (310, 402) — блок Б (так узгоджуються обидва файли джерела);
 *  - номери 1–9 без поверху, В4, В10, 24П — нульовий поверх («1*» = «1»);
 *  - перша цифра тризначного номера — поверх;
 *  - кілька груп у тій самій аудиторії, парі й з тією самою дисципліною — потік (одне заняття);
 *  - однакове заняття в 1-му і 2-му тижні — щотижневе (week 0).
 */
SK.scheduleImport = (function () {
  var DAYS = { 'понеділок': 1, 'вівторок': 2, 'середа': 3, 'четвер': 4, "п'ятниця": 5, 'пʼятниця': 5, 'п’ятниця': 5, 'субота': 6 };
  var KIND = { lecture: 'Лекція', practice: 'Практична', lab: 'Лабораторна' };
  var LAT = { A: 'А', B: 'В', a: 'А', b: 'В' };

  function cyr(s) { return String(s).replace(/[ABab]/g, function (c) { return LAT[c]; }); }

  /* Нормалізований номер у корпусі 9 або null (інший корпус / онлайн / порожньо). */
  function roomKey(raw) {
    var r = String(raw || '').trim();
    if (!r) return null;
    var n = null, m;
    if ((m = r.match(/^9-\s*(\S+)$/))) n = m[1];
    else if ((m = r.match(/^Корпус\s*9\s*,\s*ауд\.\s*(\S+)/i))) n = m[1];
    else if (/к\.?\s*9/.test(r) && !/к\.?\s*[2-8]\b/.test(r)) {
      m = r.match(/к\.?\s*9[.,]?\s*(?:а\.?)?\s*([АВABБ]?\s?\d+[А-ЯA-Z]?\*?)/);
      if (m) n = m[1].replace(/\s/g, '');
    }
    if (!n) return null;
    n = cyr(n).replace(/[.,;]+$/, '').replace(/\*$/, '');
    if ((m = n.match(/^(\d{3})([АБ])$/))) return (m[2] === 'А' ? 'А-' : 'Б-') + m[1];
    if ((m = n.match(/^А(\d{3})$/))) return 'А-' + m[1];
    if (/^\d{3}$/.test(n)) return 'Б-' + n;
    if (/^\d$/.test(n)) return n;                 // потокові зали 1–9 (поверх 0)
    if ((m = n.match(/^В(\d{1,2})$/))) return 'В' + m[1];
    if (/^\d{1,2}П$/.test(n)) return n;           // 24П
    return null;
  }
  function roomPlace(key) {
    var m = key.match(/^([АБ])-(\d)\d\d$/);
    if (m) return { block: m[1] === 'А' ? 'A' : 'B', floor: +m[2] };
    return { block: null, floor: 0 };
  }

  /* ---- Групи: курс і орієнтовна чисельність (погоджено: за курсом, ±20 %) ---- */
  var COURSE_SIZE = { 1: 25, 2: 22, 3: 18, 4: 15 };
  /* Спеціальність — 2-га і 3-тя цифри номера групи (як на сайті розкладу інституту) */
  var SPEC = {
    '11': 'E5 — Фізика та астрономія', '13': 'E6/G7 — Прикладна фізика / Автоматизація',
    '15': 'A4 — Середня освіта (Технології)', '16': 'A5 — Професійна освіта (Машинобудування)',
    '17': 'F6 — Інформаційні системи і технології', '31': 'G3 — Електрична інженерія',
    '21': '121 — Електронні комунікації (інженерія)', '22': '122 — Інформаційно-вимірювальні технології',
    '24': '124 — Електронні комунікації (телеком)', '25': '125 — Кібербезпека та захист інформації',
    '26': '126 — Видавнича та поліграфічна справа',
    '41': "Інженерія програмного забезпечення", '42': "Комп'ютерні науки", '43': "Інженерія програмного забезпечення",
    '44': "Комп'ютерна інженерія"
  };
  function h01(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
  function cleanGroup(g) { return String(g || '').replace(/\s*група\s*$/i, '').replace(/\s+/g, ' ').trim(); }
  /* «221,221ск» і «213+213ск» — дві групи (звичайна + скорочений термін) в одному рядку */
  function splitGroup(g) { return cleanGroup(g).split(/\s*[,+]\s*/).filter(Boolean); }
  function groupInfo(name) {
    var m = name.match(/^(\d)/), course = m ? +m[1] : 0;
    var master = /м/.test(name), short = /ск/.test(name), sub = /\(\d+-\d+\)/.test(name);
    var base = master ? 10 : short ? 12 : COURSE_SIZE[course] || 18;
    var sp = (name.match(/^\d(\d\d)/) || [])[1] || '';
    var size = Math.max(5, Math.round(base * (0.8 + 0.4 * h01('grp|' + name))));
    if (sub) size = Math.max(4, Math.round(size / 2));
    return { id: name, course: course, master: master, short: short, sub: sub, size: size,
      specialty: sp, specialtyName: SPEC[sp] || ('Спеціальність ' + sp),
      level: master ? 'магістратура' : 'бакалаврат' + (short ? ' (скорочений термін)' : '') };
  }

  /* Ключ викладача — прізвище без посади й ініціалів («доц.Горбулик В.І.» = «доц. Горбулик») */
  function teacherKey(t) {
    var w = String(t || '').replace(/(ст\.\s*викл|викл|доц|проф|ас|асист|зав\.\s*каф)\.?/gi, ' ')
      .split(/[\s.,]+/).filter(function (x) { return x.length > 2; });
    return w.length ? w[0].toLowerCase() : '';
  }
  function subjKey(s) { return s.toLowerCase().replace(/[^a-zа-яєіїґ]/g, ''); }
  function normSubject(s) {
    s = String(s || '').trim().replace(/\s+/g, ' ');
    if (/^[А-ЯЄІЇҐA-Z'() ]{6,}$/.test(s)) s = s.charAt(0) + s.slice(1).toLowerCase();
    return s;
  }

  /* Приймає масив записів у форматі джерела (об'єкти) або компактний знімок
     (масиви [day, period, week, group, subject, teacher, room, type]).
     opts.rooms — {id: true} кімнати моделі; заняття в невідомих кімнатах звітуються. */
  function build(input, opts) {
    opts = opts || {};
    var rows = Array.isArray(input) ? input : (input && (input.lessons || input.data || input.rows)) || [];
    var rep = { total: rows.length, k9: 0, otherBuilding: 0, online: 0, noRoom: 0, badRow: 0, unknownRoom: {}, weekend: 0 };
    var slots = {}, order = [];
    rows.forEach(function (x) {
      var o = Array.isArray(x) ? { day: x[0], period: x[1], week: x[2], group: x[3], subject: x[4], teacher: x[5], room: x[6], type: x[7] } : x;
      var day = typeof o.day === 'number' ? o.day : DAYS[String(o.day || '').trim().toLowerCase()];
      var pair = +o.period || +o.pair;
      if (!day || !pair || pair < 1 || pair > 7 || !o.group) { rep.badRow++; return; }
      if (day > 5) { rep.weekend++; return; }
      var raw = String(o.room || '').trim();
      var key = roomKey(raw);
      if (!key) {
        if (!raw) rep.noRoom++; else if (/онлайн|online/i.test(raw)) rep.online++; else rep.otherBuilding++;
        return;
      }
      if (opts.rooms && !opts.rooms[key]) { rep.unknownRoom[key] = (rep.unknownRoom[key] || 0) + 1; return; }
      rep.k9++;
      var week = +o.week === 2 ? 2 : 1, type = KIND[o.type] ? o.type : 'practice';
      var subject = normSubject(o.subject), t = String(o.teacher || '').trim();
      var bk = key + '|' + day + '|' + pair + '|' + week, sk = subjKey(subject), tk = teacherKey(t);
      var bucket = slots[bk] || (slots[bk] = []), s = null;
      /* Потік: та сама дисципліна (без огляду на пробіли/розділові знаки) або той самий викладач */
      for (var i = 0; i < bucket.length; i++) {
        if (bucket[i].sk === sk || (tk && bucket[i].tks.indexOf(tk) >= 0)) { s = bucket[i]; break; }
      }
      if (!s) {
        s = { room: key, label: raw, day: day, pair: pair, week: week, subject: subject, sk: sk, tks: [], teachers: [], groups: [], type: type };
        bucket.push(s); order.push(s);
      } else if (s.sk !== sk && s.alt === undefined) s.alt = subject;
      splitGroup(o.group).forEach(function (g) { if (s.groups.indexOf(g) < 0) s.groups.push(g); });
      if (tk && s.tks.indexOf(tk) < 0) { s.tks.push(tk); s.teachers.push(t); }
      if (type === 'lecture') s.type = 'lecture';
    });

    /* Злиття тижнів: те саме заняття в обох тижнях → щотижня */
    var byWeekless = {}, lessons = [];
    order.forEach(function (s) {
      s.groups.sort(function (a, b) { return a.localeCompare(b, 'uk', { numeric: true }); });
      var wk = [s.room, s.day, s.pair, s.sk, s.groups.join(','), s.tks.join(',')].join('|');
      var twin = byWeekless[wk];
      if (twin && twin.week !== s.week && twin.week !== 0) { twin.week = 0; return; }
      byWeekless[wk] = s;
      lessons.push(s);
    });

    var groups = {};
    lessons.forEach(function (s, i) {
      s.id = 'R' + i;
      s.kind = KIND[s.type];
      s.teacher = s.teachers.join('; ');
      s.group = s.groups.join(', ');
      s.people = 0;
      s.groups.forEach(function (g) { var gi = groups[g] || (groups[g] = groupInfo(g)); s.people += gi.size; });
      s.stream = s.groups.length > 1;
      delete s.teachers; delete s.sk; delete s.tks;
    });
    var gl = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'uk', { numeric: true }); }).map(function (g) { return groups[g]; });
    rep.lessons = lessons.length;
    rep.streams = lessons.filter(function (l) { return l.stream; }).length;
    rep.groups = gl.length;
    rep.rooms = Object.keys(lessons.reduce(function (a, l) { a[l.room] = 1; return a; }, {})).length;
    return { lessons: lessons, groups: gl, report: rep };
  }

  /* Каталог реальних аудиторій зі статистикою використання — для нумерації моделі */
  function catalog(lessons) {
    var by = {};
    lessons.forEach(function (l) {
      var c = by[l.room] || (by[l.room] = { id: l.room, labels: [], lecture: 0, practice: 0, lab: 0, maxPeople: 0, lessons: 0 });
      c[l.type]++; c.lessons++;
      if (c.labels.indexOf(l.label) < 0 && c.labels.length < 4) c.labels.push(l.label);
      c.maxPeople = Math.max(c.maxPeople, l.people);
    });
    return Object.keys(by).map(function (k) { var c = by[k], p = roomPlace(k); c.block = p.block; c.floor = p.floor; return c; });
  }

  /* Парність тижня: 1-й тиждень — тиждень, що містить 1 вересня поточного навчального року */
  function weekOf(date) {
    var y = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
    var s = new Date(y, 8, 1); s.setDate(s.getDate() - ((s.getDay() + 6) % 7));    // понеділок того тижня
    var d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var n = Math.floor(Math.round((d0 - s) / 86400000) / 7);
    return n % 2 === 0 ? 1 : 2;
  }

  return { build: build, catalog: catalog, roomKey: roomKey, roomPlace: roomPlace, groupInfo: groupInfo,
    splitGroup: splitGroup, weekOf: weekOf, KIND: KIND, SPEC: SPEC };
})();
