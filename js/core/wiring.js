/* Карта комутації: пристрій → розподільча коробка приміщення → шафа ЩА поверху →
 * контролер → порт. Плюс живлення шаф від ГРЩ і мережевий аплінк до серверної.
 *
 * ПІДБІР КОНТРОЛЕРІВ (серія Atom, i3 Engineering) — за функцією:
 *   Atom Krypton + R12  — освітлення (диммування LED), входи PIR, шина 1-Wire термодатчиків;
 *   Atom Ferrum + R12   — потужні/індуктивні навантаження: приводи жалюзі, розеткові групи ПК і проєкторів;
 *   Atom Helium + R12   — регулювання швидкості AC-вентиляторів (витяжка кімнат для куріння);
 *   Atom Hydrogen + 10D — аналогові виходи 0–10 В для фанкойлів і припливних установок;
 *   Atom Argon          — замки (релейні виходи) і сухі контакти: геркони, протікання, вейп-детектори;
 *   Atom Cobalt         — шлюз Modbus RS-485: CO₂, PM2.5, ДБЖ, АВР, ДГУ, паркування;
 *   Atom Carbon + R12   — облік вводів поверху (датчики струму).
 * Сторонні: біометричний контролер доступу (OSDP), PoE-комутатор.
 * Кількість портів — УМОВНА (звірити з документацією i3 Engineering). Коли порти
 * закінчуються, у шафу додається наступний екземпляр моделі.
 */
SK.wiring = (function () {
  var REG = SK.devicesI3, B = SK.building;

  var POOLS = {
    'Atom Krypton + R12': { short: 'KR', u: 9, ports: { DIM: 12, DI: 16, OW: 24 } },
    'Atom Ferrum + R12':  { short: 'FE', u: 9, ports: { RL: 12 } },
    'Atom Helium + R12':  { short: 'HE', u: 9, ports: { FAN: 8 } },
    'Atom Hydrogen':      { short: 'HY', u: 6, ports: { AO: 8 } },
    'Atom Argon':         { short: 'AR', u: 6, ports: { DI: 24, DO: 12 } },
    'Atom Cobalt':        { short: 'CO', u: 2, ports: { RS485: 32 } },
    'Atom Carbon + R12':  { short: 'CA', u: 9, ports: { CT: 12 } },
    'Контролер доступу (біометрія)': { short: 'AC', u: 4, ports: { RDR: 8 } },
    'PoE-комутатор 24 порти':        { short: 'SW', u: 4, ports: { POE: 24 } }
  };

  var BUS = {
    DIM:   { name: 'Вихід DIM (освітлення)', color: 0x5b8def, css: '#5b8def', cable: 'NYM 3×1,5' },
    RL:    { name: 'Силове реле (жалюзі, розетки)', color: 0x8d6e63, css: '#8d6e63', cable: 'NYM 3×2,5' },
    FAN:   { name: 'Регулятор швидкості вентилятора', color: 0x4f9a94, css: '#4f9a94', cable: 'NYM 3×1,5' },
    DI:    { name: 'Цифровий вхід', color: 0x2e9e5b, css: '#2e9e5b', cable: 'КСПВ 4×0,5' },
    OW:    { name: 'Шина 1-Wire', color: 0x0f9d8a, css: '#0f9d8a', cable: 'UTP cat.5e (1-Wire)' },
    RS485: { name: 'Шина Modbus RS-485', color: 0x2f6fd0, css: '#2f6fd0', cable: 'КИПЭВ 2×2×0,6 (RS-485 + 24 В)' },
    AO:    { name: 'Аналоговий вихід 0–10 В', color: 0x8a4fd0, css: '#8a4fd0', cable: 'КВВГЭ 4×0,75' },
    DO:    { name: 'Релейний вихід (замок)', color: 0xb05fa8, css: '#b05fa8', cable: 'ШВВП 2×0,75' },
    CT:    { name: 'Датчик струму (облік)', color: 0x6b7a1e, css: '#6b7a1e', cable: 'КСПВ 2×0,5 (ТС)' },
    RDR:   { name: 'Зчитувач (RS-485 / OSDP)', color: 0x5c6bc0, css: '#5c6bc0', cable: 'UTP cat.6 (OSDP)' },
    POE:   { name: 'Ethernet + PoE', color: 0x5b6b78, css: '#5b6b78', cable: 'UTP cat.6' },
    UP:    { name: 'Аплінк до ядра мережі', color: 0x1b2830, css: '#1b2830', cable: 'Оптика OM3 / UTP cat.6' },
    FEED:  { name: 'Живлення шафи від ГРЩ (категорія I)', color: 0x7a8a6a, css: '#7a8a6a', cable: 'ВВГнг-LS 3×4' },
    WIFI:  { name: 'Wi-Fi (без кабелю)', color: 0x9aa5ad, css: '#9aa5ad', cable: '—' }
  };

  var MAP = {
    light: [['Atom Krypton + R12', 'DIM']], pir: [['Atom Krypton + R12', 'DI']], temp: [['Atom Krypton + R12', 'OW']],
    blinds: [['Atom Ferrum + R12', 'RL'], ['Atom Ferrum + R12', 'RL']],          // два реле: вгору / вниз
    sockets: [['Atom Ferrum + R12', 'RL']],
    exhaust: [['Atom Helium + R12', 'FAN']], hvac: [['Atom Hydrogen', 'AO']],
    co2: [['Atom Cobalt', 'RS485']], pm: [['Atom Cobalt', 'RS485']],
    door: [['Atom Argon', 'DI']], leak: [['Atom Argon', 'DI']], vape: [['Atom Argon', 'DI']],
    finger: [['Контролер доступу (біометрія)', 'RDR'], ['Atom Argon', 'DO']],
    turnstile: [['Контролер доступу (біометрія)', 'RDR'], ['Atom Argon', 'DO']],
    board: [['PoE-комутатор 24 порти', 'POE']], signage: [['PoE-комутатор 24 порти', 'POE']],
    camera: [['PoE-комутатор 24 порти', 'POE']], wifi: [['PoE-комутатор 24 порти', 'POE']],
    server: [['PoE-комутатор 24 порти', 'POE']], accsrv: [['PoE-комутатор 24 порти', 'POE']], console: [['PoE-комутатор 24 порти', 'POE']],
    upscab: [['Atom Cobalt', 'RS485']], upsc: [['Atom Cobalt', 'RS485']],
    ats: [['Atom Cobalt', 'RS485'], ['Atom Argon', 'DI']], gen: [['Atom Cobalt', 'RS485'], ['Atom Argon', 'DI']],
    meter: [['Atom Carbon + R12', 'CT'], ['Atom Carbon + R12', 'CT'], ['Atom Carbon + R12', 'CT']],   // 3 фази
    parking: [['Atom Cobalt', 'RS485']],
    bench: [['Atom Krypton + R12', 'DIM']], pole: [['Atom Krypton + R12', 'DIM']],
    panel: 'WIFI', cabinet: 'UP', core: 'UP'
  };

  /* ---------- Розподільча коробка приміщення (біля дверей, під стелею) ---------- */
  var jboxes = {};
  B.rooms.forEach(function (r) {
    var d = REG.doorOf(r);
    var x = d.nx ? d.x - d.nx * 0.4 : d.x + 0.8, y = d.ny ? d.y - d.ny * 0.4 : d.y + 0.8;
    jboxes[r.id] = { id: 'РК-' + r.id, room: r.id, x: x, y: y, z: r.z0 + r.h - 0.35, door: d };
  });

  function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z); }

  var inst = {};
  function instFor(cab, model, type) {
    var list = inst[cab] = inst[cab] || [];
    var c = list.filter(function (i) { return i.model === model && (i.used[type] || 0) < POOLS[model].ports[type]; })[0];
    if (c) return c;
    var n = list.filter(function (i) { return i.model === model; }).length + 1;
    var i = { id: cab + '/' + POOLS[model].short + n, cabinet: cab, model: model, short: POOLS[model].short + n, used: {}, ports: [] };
    list.push(i);
    return i;
  }

  var core = REG.devices.filter(function (x) { return x.kind === 'core'; })[0];
  var grsh = REG.devices.filter(function (x) { return x.kind === 'ats'; })[0];
  var links = [];
  REG.devices.forEach(function (d) {
    var cab = REG.cabinet(d.cabinet), m = MAP[d.kind];
    d.conn = [];
    if (!m) return;
    if (m === 'WIFI' || m === 'UP') {
      var l0 = { device: d, inst: null, type: m, port: m === 'WIFI' ? 'Wi-Fi' : d.kind === 'core' ? 'ядро' : 'аплінк',
        cable: BUS[m].cable, len: m === 'UP' && cab && core ? Math.round(manhattan(cab, core) + 10) : 0 };
      links.push(l0); d.conn.push(l0); return;
    }
    var jb = d.room ? jboxes[d.room] : null;
    var len = cab ? Math.round(jb ? manhattan(d, jb) + manhattan(jb, cab) + 3 : manhattan(d, cab) + 3) : 0;
    m.forEach(function (pair) {
      var i = instFor(d.cabinet, pair[0], pair[1]);
      i.used[pair[1]] = (i.used[pair[1]] || 0) + 1;
      var k = i.used[pair[1]];
      var port = pair[1] === 'OW' ? '1-Wire L1 · №' + k : pair[1] === 'RS485' ? 'RS-485 · адр. ' + (k + 1) : pair[1] + ' ' + k;
      var l = { device: d, inst: i, type: pair[1], port: port, cable: BUS[pair[1]].cable, len: len, jbox: jb ? jb.id : null };
      i.ports.push(l); links.push(l); d.conn.push(l);
    });
  });

  /* Живлення шаф від ГРЩ (через центральний ДБЖ — категорія I) */
  var feeds = REG.cabinets.map(function (c) {
    return { cabinet: c.id, from: 'ГРЩ А-003 → ДБЖ шафи', cable: BUS.FEED.cable, len: grsh ? Math.round(manhattan(c, grsh) + 8) : 0 };
  });

  REG.cabinets.forEach(function (c) {
    c.instances = inst[c.id] || [];
    c.controllers = c.instances.map(function (i) { return i.model; });
    c.units = c.instances.reduce(function (a, i) { return a + POOLS[i.model].u; }, 0) + 6;   // + ДБЖ, БЖ 24 В, автомати
  });

  function cables() {
    var out = {};
    links.forEach(function (l) { if (l.cable !== '—') out[l.cable] = (out[l.cable] || 0) + l.len; });
    feeds.forEach(function (f) { out[f.cable] = (out[f.cable] || 0) + f.len; });
    return out;
  }
  function forCabinet(id) { return links.filter(function (l) { return l.device.cabinet === id; }); }
  function forRoom(id) { return links.filter(function (l) { return l.device.room === id; }); }

  return { POOLS: POOLS, BUS: BUS, links: links, feeds: feeds, cables: cables, forCabinet: forCabinet, forRoom: forRoom,
    jbox: function (roomId) { return jboxes[roomId]; }, instances: function (cab) { return inst[cab] || []; } };
})();
