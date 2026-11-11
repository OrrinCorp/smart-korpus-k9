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

  /* ---- Блок Б: коридор уздовж осі x ---- */
  (function () {
    var plan = {
      0: { s: ['service', 'office', 'office', 'tech'], sn: ['Гардероб блоку Б', 'Методичний кабінет', 'Кабінет інженера', 'Насосна / ІТП'],
           n: ['office', 'office', 'service', 'stairs', 'wc'], nn: ['Кафедра (довідка)', 'Кабінет завгоспа', 'Студентське кафе'],
           ext: [['hall', 'Вестибюль блоку Б'], ['tech', 'Склад обладнання']] },
      1: { s: ['lecture', 'seminar', 'lab', 'lab'], n: ['seminar', 'office', 'lab', 'stairs', 'wc'],
           ext: [['lecture', 'Велика лекційна зала'], ['cowork', 'Студентський коворкінг']] },
      2: { s: ['computer', 'computer', 'seminar', 'lab'], n: ['seminar', 'office', 'computer', 'stairs', 'wc'],
           ext: [['lecture', 'Потокова аудиторія'], ['seminar', 'Конференц-зала']] },
      3: { s: ['seminar', 'lab', 'lab', 'computer'], n: ['seminar', 'office', 'lab', 'stairs', 'wc'],
           ext: [['lecture', 'Лекційна аудиторія'], ['computer', "Комп'ютерний клас (великий)"]] },
      4: { s: ['seminar', 'seminar', 'computer', 'office'], n: ['seminar', 'office', 'seminar', 'stairs', 'wc'],
           ext: [['lecture', 'Лекційна аудиторія'], ['lab', 'Науково-дослідна лабораторія']] }
    };
    for (var f = 0; f <= 4; f++) {
      var P = plan[f], n = 1, x = 2, i;
      for (i = 0; i < 4; i++) { addRoom('B', f, f + pad2(n++), P.s[i], x, x + 8, 0, 9, P.sn && P.sn[i]); x += 8; }
      var nw = [8, 8, 8, 4, 4]; x = 2;
      for (i = 0; i < nw.length; i++) {
        if (P.n[i] === 'wc') addRoom('B', f, f + pad2(n++), 'wc', x, x + nw[i], 12, 16.5, 'Санвузол жіночий');
        else addRoom('B', f, f + pad2(n++), P.n[i], x, x + nw[i], 12, 21, P.n[i] === 'stairs' ? 'Сходова клітка' : P.nn && P.nn[i]);
        x += nw[i];
      }
      addRoom('B', f, f + pad2(n++), P.ext[0][0], 2, 20, 21, 34, P.ext[0][1]);
      addRoom('B', f, f + pad2(n++), P.ext[1][0], 20, 30, 21, 34, P.ext[1][1]);
      /* Додатково (нумерація в кінці): чоловічий санвузол, кімната для куріння, венткамера її витяжки */
      addRoom('B', f, f + pad2(n++), 'wc', 30, 34, 16.5, 21, 'Санвузол чоловічий');
      addRoom('B', f, f + pad2(n++), 'smoking', 30, 34, 21, 27, 'Кімната для куріння (біля сходів)');
      addRoom('B', f, f + pad2(n++), 'tech', 30, 34, 27, 34, 'Венткамера витяжки кімнати для куріння');
      corridors.push({ block: 'B', floor: f, x0: 2, x1: 34, y0: 9, y1: 12 });
    }
  })();

  /* ---- Перемичка: галерея на рівні 1-го поверху ---- */
  addRoom('C', 1, '101', 'hall', -15, 2, 10.5, 21.5, 'Перемичка — галерея');

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
    note: 'Габарити — за попередньою схемою; поділ на аудиторії — демонстраційний.',
    blocks: blocks, rooms: rooms, corridors: corridors, types: TYPES, nav: nav,
    room: function (id) { return byId[id]; }, blockById: blockById, whereText: whereText,
    minFloor: MIN_FLOOR, maxFloor: MAX_FLOOR, floorNames: FLOOR_NAMES, floorH: FH,
    floorZ: function (block, f) { var b = blockById(block); return b.id === 'C' ? b.base : b.base + f * b.floorH; },
    bookableRooms: function () { return rooms.filter(function (r) { return r.bookable; }); },
    adminRoom: function () { return rooms.filter(function (r) { return r.type === 'admin'; })[0]; }
  };
})();
