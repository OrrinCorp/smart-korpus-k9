/* Цифрова модель корпусу № 9 (ННІФТКН ЧНУ).
 *
 * Конфігурація: блоки А і Б по 5 поверхів. Поверх 0 — нульовий (хол,
 * вестибюль, службові та адміністративне приміщення), поверхи 1–4 —
 * аудиторії. Перемичка між блоками — на рівні 1-го поверху.
 *
 * Габарити блоків — за попередньою схемою (korpus_terytoriya_3.svg), висота
 * поверху 3,6 м — оцінка. Поділ на аудиторії — ДЕМОНСТРАЦІЙНИЙ; після
 * отримання офіційних планів замініть масив rooms (формат — docs/architecture.md).
 *
 * Система координат плану: x — на схід, y — на північ, метри.
 * У 3D: x → x, y(план) → -z, висота → y.
 */
SK.building = (function () {
  var FH = 3.6;
  var blocks = [
    { id: 'A', name: 'Блок А', floors: 5, floorH: FH, base: 0, color: 0xc9c2b6,
      footprint: [[-34, -10], [-15, -10], [-15, 64], [-34, 64]] },
    { id: 'B', name: 'Блок Б', floors: 5, floorH: FH, base: 0, color: 0xdccfba, roof: { h: 1.5, color: 0xc4552d },
      footprint: [[2, 0], [34, 0], [34, 21], [36, 21], [36, 34], [14, 34], [14, 36], [0.5, 36], [0.5, 22], [2, 22]] },
    { id: 'C', name: 'Перемичка', floors: 1, floorH: FH, base: FH, levelFloor: 1, color: 0x7fa3bf, pilotis: true,
      footprint: [[-15, 10.5], [2, 10.5], [2, 21.5], [-15, 21.5]] }
  ];
  var MIN_FLOOR = 0, MAX_FLOOR = 4;
  var FLOOR_NAMES = { 0: '0 (хол)', 1: '1', 2: '2', 3: '3', 4: '4' };

  var TYPES = {
    lecture:  { name: 'Лекційна аудиторія', bookable: true },
    computer: { name: "Комп'ютерний клас", bookable: true },
    lab:      { name: 'Лабораторія', bookable: true },
    seminar:  { name: 'Семінарська аудиторія', bookable: true },
    cowork:   { name: 'Коворкінг', bookable: true },
    office:   { name: 'Кафедра / кабінет', bookable: false },
    admin:    { name: 'Адміністративне приміщення (диспетчерська)', bookable: false },
    server:   { name: 'Серверна (закрита зона)', bookable: false },
    electric: { name: 'Електрощитова (АВР, ГРЩ)', bookable: false },
    security: { name: 'Пост охорони', bookable: false },
    service:  { name: 'Гардероб / буфет', bookable: false },
    library:  { name: 'Читальна зала', bookable: false },
    hall:     { name: 'Хол / вестибюль', bookable: false },
    wc:       { name: 'Санвузол', bookable: false },
    smoking:  { name: 'Кімната для куріння', bookable: false },
    stairs:   { name: 'Сходи', bookable: false },
    tech:     { name: 'Технічне приміщення', bookable: false }
  };
  /* Закриті зони: вхід лише за відбитком пальця й правами */
  var CLOSED = { admin: 1, server: 1, electric: 1, tech: 1 };

  var rooms = [], corridors = [];

  function blockById(id) { for (var i = 0; i < blocks.length; i++) if (blocks[i].id === id) return blocks[i]; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function addRoom(block, floor, num, type, x0, x1, y0, y1, name) {
    var b = blockById(block);
    var r = {
      id: (block === 'A' ? 'А' : block === 'B' ? 'Б' : 'П') + '-' + num,
      block: block, floor: floor, type: type, x0: x0, x1: x1, y0: y0, y1: y1,
      area: Math.round((x1 - x0) * (y1 - y0)), bookable: TYPES[type].bookable, closed: !!CLOSED[type]
    };
    r.capacity = r.bookable ? Math.max(12, Math.round(r.area / (type === 'lecture' ? 1.3 : 2.2))) : 0;
    r.z0 = b.base + (block === 'C' ? 0 : floor * b.floorH);
    r.h = b.floorH;
    if (type === 'computer') r.pcs = Math.round(r.capacity * 0.8);
    r.name = name || TYPES[type].name;
    rooms.push(r);
    return r;
  }

  /* ---- Блок А: двобічний коридор уздовж осі y ---- */
  (function () {
    var W = [-34, -26], E = [-23, -15], y0 = -4;
    var west = [9, 6, 6, 6, 6, 6, 6, 9, 8];         // сума 62 м
    var east = [6, 6, 6, 6, 4, 6, 6, 6, 6, 10];      // сума 62 м; позиції 2–3 — хол
    var plan = {
      0: { w: ['admin', 'server', 'electric', 'office', 'office', 'service', 'office', 'library', 'office'],
           wn: ['Адміністративне приміщення — диспетчерська', 'Серверна', 'Електрощитова (ГРЩ, АВР, ДБЖ)', 'Деканат', 'Студентський відділ', 'Буфет', 'Профком', 'Читальна зала', 'Архів'],
           e: ['security', 'service', 'hall', 'hall', 'wc', 'office', 'office', 'office', 'office', 'tech'],
           en: ['Пост охорони', 'Гардероб', 'Вестибюль · вихід до перемички', null, null, 'Медпункт', 'Кабінет директора', 'Приймальня', 'Бухгалтерія', 'Вентиляційна камера'] },
      1: { w: ['lecture', 'lab', 'lab', 'lab', 'lab', 'office', 'lab', 'lecture', 'office'],
           e: ['lab', 'lab', 'hall', 'hall', 'wc', 'lab', 'lab', 'office', 'seminar', 'lecture'], en: [null, null, 'Хол · вихід на перемичку'] },
      2: { w: ['lecture', 'computer', 'computer', 'computer', 'computer', 'office', 'computer', 'lecture', 'office'],
           e: ['computer', 'computer', 'hall', 'hall', 'wc', 'computer', 'computer', 'office', 'seminar', 'lecture'] },
      3: { w: ['lecture', 'computer', 'computer', 'computer', 'seminar', 'office', 'computer', 'lecture', 'office'],
           e: ['computer', 'seminar', 'hall', 'hall', 'wc', 'computer', 'computer', 'office', 'seminar', 'lecture'] },
      4: { w: ['lecture', 'seminar', 'seminar', 'lab', 'lab', 'office', 'seminar', 'lecture', 'office'],
           e: ['seminar', 'seminar', 'hall', 'hall', 'wc', 'lab', 'lab', 'office', 'seminar', 'tech'] }
    };
    for (var f = 0; f <= 4; f++) {
      var n = 1, yy = y0, i, P = plan[f], later = [];
      for (i = 0; i < west.length; i++) {
        var wy1 = yy + west[i];
        /* Остання секція біля сходів 2 ділиться: кабінет + кімната для куріння */
        if (i === west.length - 1) { later.push(['smoking', W[0], W[1], wy1 - 4, wy1, 'Кімната для куріння (біля сходів 2)']); wy1 -= 4; }
        addRoom('A', f, f + pad2(n++), P.w[i], W[0], W[1], yy, wy1, P.wn && P.wn[i]); yy += west[i];
      }
      yy = y0;
      for (i = 0; i < east.length; i++) {
        var t = P.e[i];
        if (t === 'hall' && P.e[i - 1] === 'hall') continue;      // хол займає дві секції
        var w = east[i] + (t === 'hall' ? east[i + 1] : 0);
        if (t === 'wc') {   /* санвузли: жіночий (з боку коридору) + чоловічий */
          addRoom('A', f, f + pad2(n++), 'wc', E[0], -19, yy, yy + w, 'Санвузол жіночий');
          later.push(['wc', -19, E[1], yy, yy + w, 'Санвузол чоловічий']);
        } else addRoom('A', f, f + pad2(n++), t, E[0], E[1], yy, yy + w, (P.en && P.en[i]) || (t === 'hall' ? 'Хол поверху' : null));
        yy += w;
      }
      /* Додаткові приміщення нумеруються в кінці, щоб не зсувати номери аудиторій */
      later.forEach(function (x) { addRoom('A', f, f + pad2(n++), x[0], x[1], x[2], x[3], x[4], x[5]); });
      addRoom('A', f, f + 'С1', 'stairs', -34, -15, -10, -4, 'Сходова клітка 1');
      addRoom('A', f, f + 'С2', 'stairs', -34, -15, 58, 64, 'Сходова клітка 2');
      corridors.push({ block: 'A', floor: f, x0: -26, x1: -23, y0: -4, y1: 58 });
    }
  })();

  /* ---- Блок Б: коридор уздовж осі x ----
     Поверх 0 — потокові аудиторії 1, 2, 3, 7, 8, 9 (реальний розклад), поверх 1 — дрібніший
     поділ, бо там 12 аудиторій розкладу. sw/nw — ширини приміщень південного/північного ряду. */
  (function () {
    var plan = {
      0: { s: ['lecture', 'lecture', 'tech'], sw: [16, 8, 8], sn: [null, null, 'Насосна / ІТП'],
           n: ['lecture', 'lecture', 'service', 'stairs', 'wc'], nn: [null, null, 'Студентське кафе'],
           ext: [['lecture', 'Потокова аудиторія'], ['lecture', 'Потокова аудиторія']] },
      1: { s: ['lecture', 'seminar', 'lab', 'lab', 'seminar', 'lab'], sw: [6, 5, 5, 5, 5, 6],
           n: ['seminar', 'office', 'lab', 'seminar', 'stairs', 'wc'], nw: [6, 6, 6, 6, 4, 4],
           ext: [['lecture', 'Велика лекційна зала', 2, 11], ['lecture', 'Лекційна аудиторія', 11, 20], ['cowork', 'Студентський коворкінг']] },
      2: { s: ['computer', 'computer', 'seminar', 'lab'], n: ['seminar', 'office', 'computer', 'stairs', 'wc'],
           ext: [['lecture', 'Потокова аудиторія'], ['seminar', 'Конференц-зала']] },
      3: { s: ['seminar', 'lab', 'lab', 'computer'], n: ['seminar', 'office', 'lab', 'stairs', 'wc'],
           ext: [['lecture', 'Лекційна аудиторія'], ['computer', "Комп'ютерний клас (великий)"]] },
      4: { s: ['seminar', 'seminar', 'computer', 'office'], n: ['seminar', 'office', 'seminar', 'stairs', 'wc'],
           ext: [['lecture', 'Лекційна аудиторія'], ['lab', 'Науково-дослідна лабораторія']] }
    };
    for (var f = 0; f <= 4; f++) {
      var P = plan[f], n = 1, x = 2, i, sw = P.sw || [8, 8, 8, 8], nw = P.nw || [8, 8, 8, 4, 4];
      for (i = 0; i < sw.length; i++) { addRoom('B', f, f + pad2(n++), P.s[i], x, x + sw[i], 0, 9, P.sn && P.sn[i]); x += sw[i]; }
      x = 2;
      for (i = 0; i < nw.length; i++) {
        if (P.n[i] === 'wc') addRoom('B', f, f + pad2(n++), 'wc', x, x + nw[i], 12, 16.5, 'Санвузол жіночий');
        else addRoom('B', f, f + pad2(n++), P.n[i], x, x + nw[i], 12, 21, P.n[i] === 'stairs' ? 'Сходова клітка' : P.nn && P.nn[i]);
        x += nw[i];
      }
      var ex = 2;
      P.ext.forEach(function (e, k) {
        var a = e[2] != null ? e[2] : ex, b = e[3] != null ? e[3] : (k === P.ext.length - 1 ? 30 : 20);
        addRoom('B', f, f + pad2(n++), e[0], a, b, 21, 34, e[1]); ex = b;
      });
      /* Додатково (нумерація в кінці): чоловічий санвузол, кімната для куріння, венткамера її витяжки */
      addRoom('B', f, f + pad2(n++), 'wc', 30, 34, 16.5, 21, 'Санвузол чоловічий');
      addRoom('B', f, f + pad2(n++), 'smoking', 30, 34, 21, 27, 'Кімната для куріння (біля сходів)');
      addRoom('B', f, f + pad2(n++), 'tech', 30, 34, 27, 34, 'Венткамера витяжки кімнати для куріння');
      corridors.push({ block: 'B', floor: f, x0: 2, x1: 34, y0: 9, y1: 12 });
    }
  })();

  /* ---- Перемичка: галерея на рівні 1-го поверху ---- */
  addRoom('C', 1, '101', 'hall', -15, 2, 10.5, 21.5, 'Перемичка — галерея');

  /* ---- Реальні номери аудиторій (розклад ННІФТКН, js/data/real-schedule.js) ----
     Геометрія приміщень орієнтовна; номери, тип і місткість — за реальним розкладом.
     На кожному поверсі найбільші аудиторії розкладу отримують найбільші приміщення;
     приміщення, яким не вистачило аудиторії з розкладу, стають кафедрами й кабінетами. */
  var REAL = (SK.realSchedule && SK.realSchedule.rooms) || [];
  var realInfo = {};
  REAL.forEach(function (x) { realInfo[x[0]] = { id: x[0], lecture: x[1], practice: x[2], lab: x[3], maxPeople: x[4] }; });
  /* Нульовий поверх: потокові зали та лабораторії без номера поверху — вручну */
  var FLOOR0 = { 'Б-009': '3', 'Б-010': '2', 'Б-001': '1', 'Б-002': '8', 'Б-004': '7', 'Б-005': '9',
    'А-017': 'В4', 'А-016': 'В10', 'А-009': '24П' };
  var OFFICE_NAMES = ['Кафедра', 'Викладацька', 'Лабораторантська', 'Кабінет завідувача кафедри', 'Методичний кабінет', 'Кабінет наукових працівників'];
  var SVC_CODE = { hall: 'Х', smoking: 'К', tech: 'Т' };
  function realType(info, slotType) {
    var lab = info.lab > info.lecture + info.practice, lec = info.lecture > info.practice + info.lab;
    if (slotType === 'computer' && !lec) return 'computer';
    if (lab) return 'lab';
    if (lec || info.maxPeople >= 45) return 'lecture';
    return 'seminar';
  }
  function applyReal(r, id, info) {
    r.id = id; r.real = true;
    r.type = info.forceType || realType(info, r.type);
    r.bookable = true; r.closed = false;
    r.capacity = Math.max(12, Math.round(r.area / (r.type === 'lecture' ? 1.3 : 2.2)));
    if (info.maxPeople > r.capacity) r.capacity = info.maxPeople;   // ярусна зала: місць за розкладом
    r.pcs = r.type === 'computer' ? Math.round(r.capacity * 0.8) : undefined;
    r.name = TYPES[r.type].name;
    r.label = /^\d$/.test(id) ? 'ауд. ' + id : id;
  }
  if (REAL.length) {
    var oldIds = {};
    rooms.forEach(function (r) { oldIds[r.id] = r; });
    Object.keys(FLOOR0).forEach(function (oid) {
      var r = oldIds[oid], info = realInfo[FLOOR0[oid]];
      if (r && info) applyReal(r, FLOOR0[oid], info);
    });
    var TEACH = { lecture: 1, computer: 1, lab: 1, seminar: 1, office: 1 };
    ['A', 'B'].forEach(function (blk) {
      var L = blk === 'A' ? 'А' : 'Б';
      for (var f = 1; f <= 4; f++) {
        var slots = rooms.filter(function (r) { return r.block === blk && r.floor === f && TEACH[r.type]; })
          .sort(function (a, b) { return b.area - a.area || (b.type === 'lecture') - (a.type === 'lecture'); });
        var reals = REAL.filter(function (x) { var m = x[0].match(/^([АБ])-(\d)/); return m && m[1] === L && +m[2] === f; })
          .map(function (x) { return realInfo[x[0]]; })
          .sort(function (a, b) { return b.maxPeople - a.maxPeople; });
        var used = {};
        reals.forEach(function (info, i) { if (slots[i]) { applyReal(slots[i], info.id, info); used[info.id.slice(2)] = 1; } });
        /* Решта — кафедри й кабінети з вільними номерами поверху */
        var num = 1, oi = 0;
        slots.slice(reals.length).sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; }).forEach(function (r) {
          while (used[f + pad2(num)]) num++;
          used[f + pad2(num)] = 1;
          if (r.type !== 'office') { r.type = 'office'; r.bookable = false; r.capacity = 0; r.pcs = undefined;
            r.name = OFFICE_NAMES[oi++ % OFFICE_NAMES.length]; }
          r.id = L + '-' + f + pad2(num);
        });
        /* Службові приміщення поверху — літерні коди, щоб не займати номерів аудиторій */
        var wcN = 0;
        rooms.filter(function (r) { return r.block === blk && r.floor === f && !TEACH[r.type] && !r.real; })
          .forEach(function (r) {
            if (r.type === 'stairs') { if (/-\d{3}$/.test(r.id)) r.id = L + '-' + f + 'С'; }
            else if (r.type === 'wc') r.id = L + '-' + f + (/чолов/.test(r.name) ? 'Ч' : 'Ж');
            else if (r.type === 'cowork') r.id = L + '-' + f + 'КВ';
            else r.id = L + '-' + f + (SVC_CODE[r.type] || 'С') + (r.type === 'tech' && blk === 'B' ? 'В' : '');
          });
      }
    });
  }
  rooms.forEach(function (r) { if (!r.label) r.label = r.id; });
  (function () {
    var seen = {};
    rooms.forEach(function (r) { if (seen[r.id]) throw new Error('Дубль номера приміщення ' + r.id); seen[r.id] = 1; });
  })();

  var byId = {};
  rooms.forEach(function (r) { byId[r.id] = r; });

  /* Точки маршруту (орієнтовно) */
  var nav = {
    entrance: { x: -6.5, y: 16, name: 'Головний вхід (під перемичкою)' },
    A: { door: { x: -15, y: 16 }, corridorX: -24.5, stairs: [{ x: -24.5, y: -7 }, { x: -24.5, y: 61 }] },
    B: { door: { x: 2, y: 10.5 }, corridorY: 10.5, stairs: [{ x: 28, y: 16.5 }] }
  };

  function whereText(r) {
    if (!r) return '';
    var b = blockById(r.block).name;
    var fl = r.floor === 0 ? 'нульовий поверх (хол)' : r.floor + ' поверх';
    var hint = '';
    if (r.block === 'A') hint = (r.y0 + r.y1) / 2 > 27 ? 'північне крило, ближче до сходів 2' : 'південне крило, ближче до сходів 1';
    if (r.block === 'B') hint = r.y0 >= 21 ? 'північна частина блоку' : r.y1 <= 9 ? 'південний бік коридору' : 'північний бік коридору';
    if (r.block === 'C') hint = 'галерея між блоками А і Б';
    return b + ', ' + fl + ' — ' + hint;
  }

  return {
    name: 'Навчальний корпус № 9 ЧНУ (ННІФТКН)',
    note: 'Габарити — за попередньою схемою; номери аудиторій — за реальним розкладом ННІФТКН, розташування приміщень на поверсі — орієнтовне.',
    realInfo: realInfo,
    blocks: blocks, rooms: rooms, corridors: corridors, types: TYPES, nav: nav,
    room: function (id) { return byId[id]; }, blockById: blockById, whereText: whereText,
    minFloor: MIN_FLOOR, maxFloor: MAX_FLOOR, floorNames: FLOOR_NAMES, floorH: FH,
    floorZ: function (block, f) { var b = blockById(block); return b.id === 'C' ? b.base : b.base + f * b.floorH; },
    bookableRooms: function () { return rooms.filter(function (r) { return r.bookable; }); },
    adminRoom: function () { return rooms.filter(function (r) { return r.type === 'admin'; })[0]; }
  };
})();
