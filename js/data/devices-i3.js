/* Реєстр розумних пристроїв корпусу № 9 (КОНЦЕПТ розташування й кількості).
 *
 * Контролери — серія Atom від i3 Engineering (https://i3engineering.com/atom-series).
 * Датчики, біометричні зчитувачі, дошки, камери, ДБЖ — сторонні; вони
 * підключаються до входів Atom (цифрові / 1-Wire / Modbus RS-485) або мережею.
 * Призначення портів — js/core/wiring.js. Моделі, кількість і схему погодити
 * з i3 Engineering та проєктувальником після обстеження об'єкта.
 */
SK.devicesI3 = (function () {
  var B = SK.building, T = SK.territory;

  var CATALOG = {
    'Atom Krypton + R12': { u: '9U DIN', vendor: 'i3', role: 'Освітлення: диммування LED (виходи DIM), входи PIR і вимикачів (DI), шина 1-Wire для термодатчиків' },
    'Atom Carbon + R12':  { u: '9U DIN', vendor: 'i3', role: 'Облік: моніторинг вводів і груп поверху (входи датчиків струму), потужні навантаження' },
    'Atom Ferrum + R12':  { u: '9U DIN', vendor: 'i3', role: 'Потужні та індуктивні навантаження: електроприводи жалюзі (вгору/вниз), керовані розеткові групи ПК і проєкторів' },
    'Atom Helium + R12':  { u: '9U DIN', vendor: 'i3', role: 'Регулювання швидкості AC-вентиляторів: витяжка кімнат для куріння, вентилятори санвузлів' },
    'Atom Hydrogen':      { u: '6U DIN', vendor: 'i3', role: 'Клімат: модулі 10D (0–10 В) для фанкойлів і припливних установок' },
    'Atom Argon':         { u: '6U DIN', vendor: 'i3', role: 'Безпека: релейні виходи електрозамків (DO), геркони, протікання, вейп-детектори (DI)' },
    'Atom Cobalt':        { u: '2U DIN', vendor: 'i3', role: 'Шлюз Modbus RS-485: датчики CO₂/T/RH, ДБЖ, АВР, лічильник, датчики паркування' },
    'Контролер доступу (біометрія)': { u: 'DIN', vendor: 'сторонній', role: 'Підключення біометричних зчитувачів (RS-485/OSDP), зберігання шаблонів відбитків, логіка доступу; команда на замок — через Atom Argon' },
    'PoE-комутатор 24 порти':        { u: '1U / DIN', vendor: 'сторонній', role: 'Живлення й мережа: онлайн-дошки, інфотабло, камери, точки Wi-Fi; аплінк до ядра мережі в адмін. приміщенні' }
  };

  var CATS = {
    sensors:   { name: 'Датчики',              color: 0x0f9d8a, css: '#0f9d8a' },
    control:   { name: 'Світло й клімат',      color: 0x3f7fd0, css: '#3f7fd0' },
    boards:    { name: 'Онлайн-дошки й табло', color: 0x7b4fd0, css: '#7b4fd0' },
    access:    { name: 'Доступ за відбитками', color: 0x8d6e63, css: '#8d6e63' },
    safety:    { name: 'Безпека',              color: 0x546e7a, css: '#546e7a' },
    infra:     { name: 'Мережа, шафи, сервер', color: 0x5c6bc0, css: '#5c6bc0' },
    power:     { name: 'Резервне живлення',    color: 0x6b7a1e, css: '#6b7a1e' },
    territory: { name: 'Територія',            color: 0x2e8b3e, css: '#2e8b3e' }
  };

  var KINDS = {
    pir:       { cat: 'sensors', icon: '👁', name: 'PIR-датчик присутності' },
    temp:      { cat: 'sensors', icon: '🌡', name: 'Термодатчик 1-Wire' },
    co2:       { cat: 'sensors', icon: '💨', name: 'Датчик CO₂/T/RH (NDIR, Modbus)' },
    light:     { cat: 'control', icon: '💡', name: 'Група LED-освітлення (димована)' },
    hvac:      { cat: 'control', icon: '❄', name: 'Фанкойл / приплив (0–10 В)' },
    blinds:    { cat: 'control', icon: '🪟', name: 'Електропривод жалюзі' },
    sockets:   { cat: 'control', icon: '🔌', name: 'Керована розеткова група (ПК, проєктор)' },
    board:     { cat: 'boards',  icon: '🖥', name: 'Інтерактивна панель (онлайн-дошка)' },
    signage:   { cat: 'boards',  icon: '📋', name: 'Інфотабло розкладу' },
    panel:     { cat: 'boards',  icon: '📱', name: 'Настінна панель сценаріїв (i3 Home)' },
    finger:    { cat: 'access',  icon: '☝', name: 'Біометричний зчитувач відбитків + електрозамок' },
    turnstile: { cat: 'access',  icon: '🚧', name: 'Турнікет з біометричним зчитувачем' },
    door:      { cat: 'safety',  icon: '🚪', name: 'Геркон дверей' },
    leak:      { cat: 'safety',  icon: '💧', name: 'Датчик протікання' },
    vape:      { cat: 'safety',  icon: '🚭', name: 'Детектор диму/вейпу' },
    camera:    { cat: 'safety',  icon: '📷', name: 'IP-камера (концепт)' },
    wifi:      { cat: 'infra',   icon: '📶', name: 'Точка доступу Wi-Fi (PoE)' },
    cabinet:   { cat: 'infra',   icon: '⚡', name: 'Шафа автоматики ЩА' },
    server:    { cat: 'infra',   icon: '🗄', name: 'Сервер «Розумного корпусу» + MQTT-брокер' },
    accsrv:    { cat: 'infra',   icon: '🔐', name: 'Сервер доступу (біометрія)' },
    core:      { cat: 'infra',   icon: '🔀', name: 'Ядро мережі (комутатор L3)' },
    console:   { cat: 'infra',   icon: '🖥', name: 'Робоче місце диспетчера (відеостіна)' },
    upsc:      { cat: 'power',   icon: '🔋', name: 'Центральний онлайн-ДБЖ 20 кВА' },
    upscab:    { cat: 'power',   icon: '🔋', name: 'DIN-ДБЖ 24 В шафи ЩА' },
    meter:     { cat: 'power',   icon: '📟', name: 'Облік електроенергії поверху (датчики струму)' },
    ats:       { cat: 'power',   icon: '🔁', name: 'АВР / ГРЩ' },
    gen:       { cat: 'power',   icon: '⛽', name: 'ДГУ 60 кВА' },
    parking:   { cat: 'territory', icon: '🅿', name: 'Шлюз датчиків паркомісць' },
    bench:     { cat: 'territory', icon: '🪑', name: 'Розумна лавка (USB, підсвітка)' },
    exhaust:   { cat: 'control', icon: '🌀', name: 'Витяжний вентилятор кімнати для куріння (0–10 В)' },
    pm:        { cat: 'sensors', icon: '🌫', name: 'Датчик PM2.5 / диму (Modbus)' },
    pole:      { cat: 'territory', icon: '🏮', name: 'Вуличне освітлення за PIR' }
  };

  /* ---------- Шафи автоматики: по одній на поверх блоку ---------- */
  var CAB_POS = { A: { x: -16.5, y: -7 }, B: { x: 29.4, y: 19.5 }, C: { x: 1.2, y: 11.5 }, T: { x: 40, y: 43 } };
  var cabinets = [];
  function L(b) { return b === 'A' ? 'А' : b === 'B' ? 'Б' : b === 'C' ? 'П' : 'Т'; }
  B.blocks.forEach(function (b) {
    var floors = b.id === 'C' ? [1] : range(B.minFloor, B.maxFloor);
    floors.forEach(function (f) {
      cabinets.push({ id: 'ЩА-' + L(b.id) + f, block: b.id, floor: f, x: CAB_POS[b.id].x, y: CAB_POS[b.id].y,
        z: B.floorZ(b.id, f) + 1.6, controllers: [], mqtt: 'chnu/k9/' + b.id + '/' + f + '/#' });
    });
  });
  cabinets.push({ id: 'ЩА-Т', block: 'T', floor: 0, x: CAB_POS.T.x, y: CAB_POS.T.y, z: 1.6, controllers: [], mqtt: 'chnu/k9/T/#', territory: true });
  function cabinetFor(o) {
    var blk = o.block === 'T' ? 'T' : o.block;
    return cabinets.filter(function (c) { return (c.territory ? 'T' : c.block) === blk && (blk === 'T' || c.floor === o.floor); })[0];
  }

  /* ---------- Геометрія ---------- */
  function door(r) {          // двері з боку коридору; nx/ny — напрям у коридор
    if (r.block === 'A') return r.x1 <= -26 ? { x: -26, y: (r.y0 + r.y1) / 2, nx: 1 } : { x: -23, y: (r.y0 + r.y1) / 2, nx: -1 };
    if (r.block === 'B') {
      if (r.y1 <= 9) return { x: (r.x0 + r.x1) / 2, y: 9, ny: 1 };
      if (r.y0 > 12) return { x: (r.x0 + r.x1) / 2, y: r.y0, ny: -1 };   // внутрішні приміщення — двері з південного боку
      return { x: (r.x0 + r.x1) / 2, y: 12, ny: -1 };
    }
    return { x: -15, y: 16, nx: -1 };
  }
  /* Зовнішні стіни приміщення (для вікон і жалюзі): середини сторін, що збігаються з межею блоку */
  function exterior(r) {
    var b = B.blockById(r.block), xs = b.footprint.map(function (p) { return p[0]; }), ys = b.footprint.map(function (p) { return p[1]; });
    var X0 = Math.min.apply(null, xs), X1 = Math.max.apply(null, xs), Y0 = Math.min.apply(null, ys), Y1 = Math.max.apply(null, ys), o = [];
    var cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    if (Math.abs(r.x0 - X0) < 0.6) o.push({ x: r.x0 + 0.2, y: cy, side: 'W' });
    if (Math.abs(r.x1 - X1) < 0.6 && !(r.block === 'A' && r.y0 < 21.5 && r.y1 > 10.5 && r.floor === 1)) o.push({ x: r.x1 - 0.2, y: cy, side: 'E' });
    if (Math.abs(r.y0 - Y0) < 0.6) o.push({ x: cx, y: r.y0 + 0.2, side: 'S' });
    if (Math.abs(r.y1 - Y1) < 2.1 && r.y1 >= Y1 - 2) o.push({ x: cx, y: r.y1 - 0.2, side: 'N' });
    if (r.block === 'B' && r.y0 >= 21 && r.x0 <= 2.1) o.push({ x: r.x0 + 0.2, y: cy, side: 'W' });
    return o;
  }
  function at(r, u, v) { return { x: r.x0 + (r.x1 - r.x0) * u, y: r.y0 + (r.y1 - r.y0) * v }; }
  function inward(r, p, d) { var dd = door(r); return dd.nx ? { x: p.x - dd.nx * d, y: p.y } : { x: p.x, y: p.y - (dd.ny || 0) * d }; }
  function far(r) {
    var dd = door(r), cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    if (dd.nx === 1) return { x: r.x0 + 0.6, y: cy };
    if (dd.nx === -1) return { x: r.x1 - 0.6, y: cy };
    if (dd.ny === 1) return { x: cx, y: r.y0 + 0.6 };
    return { x: cx, y: r.y1 - 0.6 };
  }

  var devices = [], byId = {}, byRoom = {}, cnt = {};
  /* Приміщення з біометричним зчитувачем на дверях (див. SK.security, зони доступу) */
  var FINGER_TYPES = { admin: 1, server: 1, electric: 1, tech: 1, office: 1, security: 1, computer: 1, lab: 1, cowork: 1 };
  function add(kind, o) {
    var k = KINDS[kind];
    var d = { id: o.id, kind: kind, cat: k.cat, name: k.name, room: o.room || null, block: o.block, floor: o.floor,
      x: o.x, y: o.y, z: o.z, zone: o.zone || null, label: o.label || null };
    d.topic = 'chnu/k9/' + d.block + '/' + d.floor + '/' + (d.room || d.zone || 'common') + '/' + kind + '/' + d.id.split('-').pop();
    var cab = cabinetFor(d); d.cabinet = cab ? cab.id : null;
    devices.push(d); byId[d.id] = d;
    if (d.room) (byRoom[d.room] = byRoom[d.room] || []).push(d);
    return d;
  }
  function nid(kind, place) { var k = kind + '|' + place; cnt[k] = (cnt[k] || 0) + 1; return kind.toUpperCase() + '-' + place + '-' + cnt[k]; }

  /* ---------- Пристрої в приміщеннях ---------- */
  B.rooms.forEach(function (r) {
    var top = r.z0 + r.h - 0.15, wall = r.z0 + 1.4, big = r.area > 80;
    function put(kind, p, z, extra) {
      var o = { id: nid(kind, r.id), x: p.x, y: p.y, z: z, room: r.id, block: r.block, floor: r.floor };
      if (extra) for (var e in extra) o[e] = extra[e];
      return add(kind, o);
    }
    if (r.type === 'stairs') { put('light', at(r, 0.5, 0.5), top); put('vape', at(r, 0.3, 0.5), top); return; }
    put('light', at(r, 0.5, 0.7), top);
    if (big) put('light', at(r, 0.5, 0.3), top);
    if (r.type !== 'wc') put('temp', at(r, 0.2, 0.2), wall);
    if (r.bookable || r.type === 'wc' || r.type === 'office' || r.type === 'library' || r.type === 'admin' || r.type === 'smoking') {
      put('pir', at(r, 0.5, 0.5), top);
      if (big) put('pir', at(r, 0.25, 0.5), top);
    }
    if (r.bookable || r.type === 'library' || r.type === 'admin') put('co2', at(r, 0.8, 0.2), wall);
    if (r.type === 'lecture' || r.type === 'computer') put('hvac', at(r, 0.5, 0.88), top);
    var ext = exterior(r);
    if (r.bookable && ext.length) put('blinds', ext[0], r.z0 + r.h - 0.4);
    if (r.type === 'computer' || r.type === 'lecture' || r.type === 'lab') put('sockets', at(r, 0.15, 0.6), r.z0 + 0.4);
    if (r.type === 'computer') put('sockets', at(r, 0.85, 0.6), r.z0 + 0.4);
    if (r.bookable) put('board', far(r), wall);
    if (r.type === 'lecture' || r.type === 'computer') put('panel', inward(r, door(r), 0.6), wall);
    if (FINGER_TYPES[r.type]) {
      var dp = door(r);
      put('finger', dp, wall);
      put('door', inward(r, dp, 0.5), r.z0 + 2.2);
    }
    if (r.type === 'wc' || r.type === 'server' || r.type === 'tech' || r.type === 'electric') put('leak', at(r, 0.7, 0.7), r.z0 + 0.3);
    if (r.type === 'wc') put('vape', at(r, 0.3, 0.6), top);
    if (r.type === 'smoking') {     /* кімната для куріння: витяжка, якість повітря, двері з доводчиком */
      put('exhaust', at(r, 0.8, 0.8), top);
      put('pm', at(r, 0.2, 0.8), wall);
      put('door', inward(r, door(r), 0.5), r.z0 + 2.2, { label: 'Двері з доводчиком' });
    }
    if (r.type === 'server' || r.type === 'admin' || r.type === 'electric') put('camera', at(r, 0.9, 0.9), top);
    if (r.type === 'hall') put('signage', at(r, 0.5, 0.5), wall, { label: r.floor === 0 ? 'Табло: розклад, події, оголошення' : 'Розклад поверху' });
    /* Адміністративне приміщення та серверна */
    if (r.type === 'admin') { put('console', at(r, 0.5, 0.6), wall, { label: 'Диспетчерська: моніторинг корпусу' }); }
    if (r.type === 'server') {
      put('server', at(r, 0.3, 0.3), wall, { label: 'Сервер «Розумного корпусу», MQTT' });
      put('accsrv', at(r, 0.3, 0.7), wall, { label: 'Сервер доступу (шаблони відбитків зашифровано)' });
      put('core', at(r, 0.7, 0.3), wall, { label: 'Ядро мережі' });
      put('upsc', at(r, 0.7, 0.7), r.z0 + 0.8, { label: 'Онлайн-ДБЖ 20 кВА' });
    }
    if (r.type === 'electric') put('ats', at(r, 0.5, 0.5), wall, { label: 'АВР + ГРЩ' });
  });

  /* ---------- Коридори ---------- */
  function common(kind, block, floor, x, y, z, extra) {
    var o = { id: nid(kind, L(block) + floor), block: block, floor: floor, x: x, y: y, z: z };
    if (extra) for (var k in extra) o[k] = extra[k];
    return add(kind, o);
  }
  B.blocks.forEach(function (b) {
    var floors = b.id === 'C' ? [1] : range(B.minFloor, B.maxFloor);
    floors.forEach(function (f) {
      var z0 = B.floorZ(b.id, f), top = z0 + b.floorH - 0.2, wall = z0 + 1.6;
      var cab = cabinets.filter(function (c) { return c.block === b.id && c.floor === f; })[0];
      common('cabinet', b.id, f, cab.x, cab.y, wall, { label: cab.id });
      common('upscab', b.id, f, cab.x + 0.8, cab.y, z0 + 0.6, { label: 'ДБЖ ' + cab.id });
      common('meter', b.id, f, cab.x - 0.8, cab.y, wall, { label: 'Облік ' + cab.id });
      if (b.id === 'A') {
        common('camera', 'A', f, -24.5, -3.5, top); common('camera', 'A', f, -24.5, 57.5, top);
        [8, 27, 46].forEach(function (y) { common('wifi', 'A', f, -24.5, y, top); });
        if (f > 0) common('signage', 'A', f, -23.3, -2.5, wall, { label: 'Розклад і навігація' });
      } else if (b.id === 'B') {
        common('camera', 'B', f, 3, 10.5, top); common('camera', 'B', f, 33, 10.5, top);
        [10, 24].forEach(function (x) { common('wifi', 'B', f, x, 10.5, top); });
        common('signage', 'B', f, 4.5, 11.7, wall, { label: 'Розклад і навігація' });
      } else {
        common('wifi', 'C', 1, -6.5, 16, top); common('camera', 'C', 1, -13.5, 16, top);
      }
    });
  });
  /* Вхідна група (поверх 0) */
  common('turnstile', 'A', 0, -15.8, 16, 0.9, { label: 'Турнікети: вхід у блок А' });
  common('turnstile', 'B', 0, 2.8, 10.5, 0.9, { label: 'Турнікети: вхід у блок Б' });
  common('camera', 'A', 0, -14, 19.5, 2.8, { label: 'Камера вхідної групи' });

  /* ---------- Територія ---------- */
  T.zones.forEach(function (z) {
    var cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
    if (z.kind === 'parking') {
      common('parking', 'T', 0, cx, cy, 2.5, { zone: z.id, label: z.name });
      common('camera', 'T', 0, z.x0, z.y1, 4, { zone: z.id });
      common('pole', 'T', 0, z.x1, z.y0, 4, { zone: z.id });
    } else if (z.kind === 'rest') {
      T.benches.forEach(function (b) { common('bench', 'T', 0, b.x, b.y, 1, { zone: z.id }); });
      common('wifi', 'T', 0, cx, cy + 6, 3, { zone: z.id, label: 'Вулична точка Wi-Fi' });
      common('pole', 'T', 0, z.x0 + 1, z.y0 + 1, 4, { zone: z.id });
    } else if (z.kind === 'gen') {
      common('gen', 'T', 0, cx, cy, 2.2, { zone: z.id, label: 'ДГУ 60 кВА' });
    }
  });
  common('cabinet', 'T', 0, CAB_POS.T.x, CAB_POS.T.y - 1.5, 1.6, { label: 'ЩА-Т', zone: 'GEN' });
  common('upscab', 'T', 0, CAB_POS.T.x + 0.8, CAB_POS.T.y - 1.5, 0.6, { label: 'ДБЖ ЩА-Т', zone: 'GEN' });

  function roomDevices(room) { return byRoom[room.id || room] || []; }
  function totals() {
    var t = { controllers: {}, kinds: {}, cats: {} };
    cabinets.forEach(function (c) { c.controllers.forEach(function (m) { t.controllers[m] = (t.controllers[m] || 0) + 1; }); });
    devices.forEach(function (d) { t.kinds[d.kind] = (t.kinds[d.kind] || 0) + 1; t.cats[d.cat] = (t.cats[d.cat] || 0) + 1; });
    return t;
  }
  function range(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }

  return { CATALOG: CATALOG, CATS: CATS, KINDS: KINDS, cabinets: cabinets, devices: devices,
    cabinet: function (id) { return cabinets.filter(function (c) { return c.id === id; })[0]; },
    device: function (id) { return byId[id]; }, doorOf: door, exterior: exterior, roomDevices: roomDevices, cabinetFor: cabinetFor, totals: totals,
    vendorUrl: 'https://i3engineering.com/atom-series' };
})();
