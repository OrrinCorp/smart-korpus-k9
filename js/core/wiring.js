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
    jboxes[r.id] = { id: 'РК-' + r.id, room: r.id, block: r.block, floor: r.floor, x: x, y: y, z: r.z0 + r.h - 0.35, door: d };
  });

  /* =====================================================================
     КАБЕЛЬНІ ТРАСИ: лотки в коридорах (під стелею), стояки у сходових клітках
     поруч зі шафами ЩА, галерея перемички, підземна траншея до території.
     Пристрій → (опуск до стелі) → РК приміщення → вихід за двері → лоток →
     лоток / стояк → шафа ЩА поверху. Мережа — граф; шлях — найкоротший (Дейкстра).
     ===================================================================== */
  var TRAY_DROP = 0.35;                       // лоток на 35 см нижче стелі
  function trayZ(block, f) { return B.floorZ(block, f) + B.floorH - TRAY_DROP; }
  var RISER = { A: { x: -16.5, y: -7 }, B: { x: 29.4, y: 19.5 } };
  var TRENCH_Z = -0.6;

  var nodes = [], nodeKey = {}, segs = [], adj = [];
  function node(x, y, z) {
    var k = x.toFixed(2) + ',' + y.toFixed(2) + ',' + z.toFixed(2);
    if (nodeKey[k] != null) return nodeKey[k];
    nodes.push({ x: x, y: y, z: z }); adj.push([]);
    return (nodeKey[k] = nodes.length - 1);
  }
  function dist3(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z); }   // траси ортогональні
  /* Відрізок мережі; kind: tray | riser | link | trench; цілі лотки ріжуться у вузлах */
  function seg(p, q, kind, meta) {
    var a = node(p[0], p[1], p[2]), b = node(q[0], q[1], q[2]);
    var s = { id: segs.length, a: a, b: b, kind: kind, block: meta.block, floor: meta.floor, name: meta.name || '', len: dist3(nodes[a], nodes[b]) };
    segs.push(s); adj[a].push(s); adj[b].push(s);
    return s;
  }
  function polyline(pts, kind, meta) { for (var i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], kind, meta); }

  for (var f = B.minFloor; f <= B.maxFloor; f++) {
    var zA = trayZ('A', f), zB = trayZ('B', f);
    /* Блок А: лоток уздовж коридору (вісь x = −24,5), відгалуження до стояка в сходовій клітці 1 */
    polyline([[-24.5, 58, zA], [-24.5, 16, zA], [-24.5, -4, zA]], 'tray', { block: 'A', floor: f, name: 'Лоток коридору А-' + f });
    polyline([[-24.5, -4, zA], [-24.5, -7, zA], [RISER.A.x, RISER.A.y, zA]], 'link', { block: 'A', floor: f, name: 'Відгалуження до стояка А' });
    /* Блок Б: лоток уздовж коридору (вісь y = 10,5), відгалуження до стояка Б */
    polyline([[2, 10.5, zB], [RISER.B.x, 10.5, zB], [34, 10.5, zB]], 'tray', { block: 'B', floor: f, name: 'Лоток коридору Б-' + f });
    polyline([[RISER.B.x, 10.5, zB], [RISER.B.x, RISER.B.y, zB]], 'link', { block: 'B', floor: f, name: 'Відгалуження до стояка Б' });
    if (f < B.maxFloor) {
      seg([RISER.A.x, RISER.A.y, zA], [RISER.A.x, RISER.A.y, trayZ('A', f + 1)], 'riser', { block: 'A', floor: f, name: 'Стояк А' });
      seg([RISER.B.x, RISER.B.y, zB], [RISER.B.x, RISER.B.y, trayZ('B', f + 1)], 'riser', { block: 'B', floor: f, name: 'Стояк Б' });
    }
  }
  /* Перемичка (рівень 1-го поверху): галерея з’єднує лотки блоків А і Б */
  var zC = trayZ('C', 1);
  polyline([[-24.5, 16, trayZ('A', 1)], [-15, 16, zC], [1.2, 16, zC], [2, 16, zC], [2, 10.5, trayZ('B', 1)]], 'tray', { block: 'C', floor: 1, name: 'Лоток галереї перемички' });
  seg([1.2, 16, zC], [1.2, 11.5, zC], 'link', { block: 'C', floor: 1, name: 'Відгалуження до ЩА-П1' });
  /* Територія: з основи стояка Б — під землю, траншея до шафи ЩА-Т */
  var cabT = REG.cabinets.filter(function (c) { return c.territory; })[0];
  polyline([[RISER.B.x, RISER.B.y, trayZ('B', 0)], [RISER.B.x, RISER.B.y, TRENCH_Z], [37, RISER.B.y, TRENCH_Z], [37, cabT.y, TRENCH_Z], [cabT.x, cabT.y, TRENCH_Z]],
    'trench', { block: 'T', floor: 0, name: 'Кабельна траншея до території' });

  /* Точка підключення шафи до мережі трас */
  function cabNode(c) {
    if (c.territory) return node(c.x, c.y, TRENCH_Z);
    if (c.block === 'C') return node(1.2, 11.5, zC);
    return node(RISER[c.block].x, RISER[c.block].y, trayZ(c.block, c.floor));
  }

  /* Дейкстра від вузла (кешується для кожної шафи / джерела) */
  var spCache = {};
  function sp(from) {
    if (spCache[from]) return spCache[from];
    var dist = nodes.map(function () { return Infinity; }), prev = nodes.map(function () { return null; }), done = {};
    dist[from] = 0;
    for (;;) {
      var u = -1, best = Infinity;
      for (var i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      adj[u].forEach(function (s) { var v = s.a === u ? s.b : s.a; if (dist[u] + s.len < dist[v]) { dist[v] = dist[u] + s.len; prev[v] = s; } });
    }
    return (spCache[from] = { dist: dist, prev: prev, from: from });
  }
  function pathNodes(tree, to) {             // від шафи до вузла: [id...], сегменти
    var ids = [to], ss = [], v = to;
    while (tree.prev[v]) { var s = tree.prev[v]; ss.push(s); v = s.a === v ? s.b : s.a; ids.push(v); }
    return { ids: ids.reverse(), segs: ss.reverse() };
  }

  /* Приєднання довільної точки до найближчого лотка свого блоку й поверху */
  function attach(pt, block, floor) {
    var best = null;
    segs.forEach(function (s) {
      if (s.kind !== 'tray' && s.kind !== 'trench') return;
      if (block === 'T' ? s.kind !== 'trench' : (s.block !== block || s.floor !== floor)) return;
      var A = nodes[s.a], Bn = nodes[s.b], t;
      var dx = Bn.x - A.x, dy = Bn.y - A.y, L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) return;
      t = Math.max(0, Math.min(1, ((pt.x - A.x) * dx + (pt.y - A.y) * dy) / L2));
      var q = { x: A.x + dx * t, y: A.y + dy * t, z: A.z + (Bn.z - A.z) * t };
      var d = Math.abs(q.x - pt.x) + Math.abs(q.y - pt.y);
      if (!best || d < best.d) best = { seg: s, q: q, d: d, t: t };
    });
    return best;
  }
  /* Найкоротший шлях від шафи до точки Q на відрізку */
  function toCab(cab, at) {
    var tree = sp(cabNode(cab)), s = at.seg;
    var da = tree.dist[s.a] + dist3(nodes[s.a], at.q), db = tree.dist[s.b] + dist3(nodes[s.b], at.q);
    var end = da <= db ? s.a : s.b, p = pathNodes(tree, end);
    return { len: Math.min(da, db), ids: p.ids, segs: p.segs, end: end, part: { seg: s, from: end, q: at.q } };
  }
  function P(n) { return { x: nodes[n].x, y: nodes[n].y, z: nodes[n].z }; }
  /* Траси лише по осях: якщо до точки q треба змістися і по x, і по y — додаємо кут */
  function corner(pts, q) {
    var l = pts[pts.length - 1];
    if (Math.abs(l.x - q.x) > 0.01 && Math.abs(l.y - q.y) > 0.01) pts.push({ x: q.x, y: l.y, z: l.z });
  }

  /* Маршрут пристрою до його шафи: масив точок {x,y,z} від пристрою до шафи + довжина й опис */
  var routeCache = {};
  function deviceRoute(d) {
    if (routeCache[d.id]) return routeCache[d.id];
    var cab = REG.cabinet(d.cabinet); if (!cab) return null;
    var pts = [{ x: d.x, y: d.y, z: d.z }], parts = [], jb = d.room ? jboxes[d.room] : null, at, start;
    var blk = cab.territory ? 'T' : d.block === 'C' || (d.room && B.room(d.room).block === 'C') ? 'C' : d.block;
    var flr = blk === 'C' ? 1 : d.floor;
    if (blk === 'T') {
      pts.push({ x: d.x, y: d.y, z: TRENCH_Z });
      start = { x: d.x, y: d.y, z: TRENCH_Z };
      parts.push({ name: 'Опуск у траншею', len: Math.abs(d.z - TRENCH_Z) });
    } else if (jb) {
      var dr = jb.door, ex = dr.nx ? { x: dr.x + dr.nx * 0.8, y: jb.y } : { x: jb.x, y: dr.y + dr.ny * 0.8 };
      pts.push({ x: d.x, y: d.y, z: jb.z }, { x: jb.x, y: d.y, z: jb.z }, { x: jb.x, y: jb.y, z: jb.z });
      parts.push({ name: 'Пристрій → ' + jb.id, len: Math.abs(jb.z - d.z) + Math.abs(jb.x - d.x) + Math.abs(jb.y - d.y) });
      pts.push({ x: ex.x, y: ex.y, z: jb.z });
      start = { x: ex.x, y: ex.y, z: trayZ(blk, flr) };
      parts.push({ name: jb.id + ' → вихід у коридор', len: Math.abs(ex.x - jb.x) + Math.abs(ex.y - jb.y) });
    } else {
      start = { x: d.x, y: d.y, z: trayZ(blk, flr) };
      parts.push({ name: 'Пристрій → лоток', len: Math.abs(start.z - d.z) });
    }
    at = attach(start, blk, flr);
    if (!at) { routeCache[d.id] = { pts: pts.concat([{ x: cab.x, y: cab.y, z: cab.z }]), len: Math.round(dist3(d, cab) + 3), parts: parts, jb: jb }; return routeCache[d.id]; }
    if (blk !== 'T') pts.push({ x: start.x, y: start.y, z: at.q.z });
    corner(pts, at.q);                                   // якщо лоток закінчується раніше — підхід «буквою Г»
    pts.push({ x: at.q.x, y: at.q.y, z: at.q.z });
    parts.push({ name: 'Підхід до лотка', len: at.d + (blk !== 'T' ? Math.abs(pts[pts.length - 2].z - (jb ? jb.z : d.z)) * 0 : 0) });
    var tc = toCab(cab, at);
    tc.ids.slice().reverse().forEach(function (n) { pts.push(P(n)); });
    parts.push({ name: blk === 'T' ? 'Траншея' : 'Лоток / стояк → ' + cab.id, len: tc.len });
    pts.push({ x: cab.x, y: cab.y, z: cab.z });
    parts.push({ name: 'Опуск у шафу', len: Math.abs(pts[pts.length - 2].z - cab.z) });
    var geo = 0; for (var i = 1; i < pts.length; i++) geo += dist3(pts[i - 1], pts[i]);
    var r = { pts: pts, geo: geo, len: Math.round(geo * 1.1 + 2), parts: parts, jb: jb, trayEnter: at, tc: tc };
    return (routeCache[d.id] = r);
  }

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

  /* Шинні лінії (RS-485 Modbus, 1-Wire) не йдуть «зіркою»: один кабель шлейфом обходить
     РК приміщень уздовж лотка. Решта (DIM, реле, DI/DO, 0–10 В, OSDP, PoE) — окремий кабель від порту. */
  var BUSES = { RS485: 1, OW: 1 };

  var core = REG.devices.filter(function (x) { return x.kind === 'core'; })[0];
  var links = [];
  REG.devices.forEach(function (d) {
    var cab = REG.cabinet(d.cabinet), m = MAP[d.kind];
    d.conn = [];
    if (!m) return;
    if (m === 'WIFI' || m === 'UP') {
      var l0 = { device: d, inst: null, type: m, port: m === 'WIFI' ? 'Wi-Fi' : d.kind === 'core' ? 'ядро' : 'аплінк', cable: BUS[m].cable, len: 0 };
      links.push(l0); d.conn.push(l0); return;
    }
    var jb = d.room ? jboxes[d.room] : null, rt = cab ? deviceRoute(d) : null;
    m.forEach(function (pair) {
      var i = instFor(d.cabinet, pair[0], pair[1]);
      i.used[pair[1]] = (i.used[pair[1]] || 0) + 1;
      var k = i.used[pair[1]];
      var port = pair[1] === 'OW' ? '1-Wire ' + i.short + ' · №' + k : pair[1] === 'RS485' ? 'RS-485 ' + i.short + ' · адр. ' + (k + 1) : pair[1] + ' ' + k;
      var l = { device: d, inst: i, type: pair[1], port: port, cable: BUS[pair[1]].cable, len: rt ? rt.len : 0, jbox: jb ? jb.id : null, route: rt, bus: !!BUSES[pair[1]] };
      i.ports.push(l); links.push(l); d.conn.push(l);
    });
  });

  /* Шини: для кожного екземпляра контролера з RS-485 / 1-Wire — один шлейф.
     Довжина = об’єднання ділянок лотка від шафи до найдальшої РК + відгалуження «туди-назад» до кожного пристрою. */
  var buses = [];
  Object.keys(inst).forEach(function (cabId) {
    var cab = REG.cabinet(cabId);
    inst[cabId].forEach(function (i) {
      Object.keys(BUSES).forEach(function (t) {
        var ls = i.ports.filter(function (l) { return l.type === t && l.route; });
        if (!ls.length) return;
        var used = {}, trunk = 0, stops = {};
        ls.forEach(function (l) {
          var tc = l.route.tc; if (!tc) return;
          tc.segs.forEach(function (s) { if (!used['s' + s.id]) { used['s' + s.id] = 1; trunk += s.len; } });
          var pk = 'p' + tc.part.seg.id + ':' + tc.part.from, pl = dist3(nodes[tc.part.from], tc.part.q);
          used[pk] = Math.max(used[pk] || 0, pl);
          var key = l.jbox || l.device.id;
          (stops[key] = stops[key] || { jb: l.jbox, room: l.device.room, devices: [], at: tc.len }).devices.push(l);
        });
        Object.keys(used).forEach(function (k) { if (k[0] === 'p') trunk += used[k]; });
        var drops = 0;
        ls.forEach(function (l) {
          var r = l.route, d = 0;
          r.parts.forEach(function (p) { if (!/Лоток|Траншея|Опуск у шафу/.test(p.name)) d += p.len; });
          l.drop = Math.round(d * 2 * 1.1 + 1);           // шлейф заходить у пристрій і повертається
          l.len = l.drop; drops += l.drop;
        });
        var trunkLen = Math.round(trunk * 1.1 + Math.abs(cab.z - nodes[cabNode(cab)].z) + 2);
        var st = Object.keys(stops).map(function (k) { return stops[k]; }).sort(function (a, b) { return a.at - b.at; });
        var bus = { id: i.id + '/' + t, inst: i, type: t, cabinet: cabId, trunk: trunkLen, drops: drops, len: trunkLen + drops, stops: st, links: ls };
        ls.forEach(function (l) { l.busRef = bus; });
        buses.push(bus);
      });
    });
  });

  /* Живлення шаф від ГРЩ і аплінки до серверної — теж по трасах */
  function roomRoute(roomId, cab) {
    var r = B.room(roomId), jb = jboxes[roomId];
    var blk = cab.territory ? 'T' : cab.block;
    var dr = jb.door, ex = dr.nx ? { x: dr.x + dr.nx * 0.8, y: jb.y } : { x: jb.x, y: dr.y + dr.ny * 0.8 };
    var at = attach({ x: ex.x, y: ex.y }, r.block, r.floor);
    var tc = toCab(cab, at);
    var pts = [{ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, z: r.z0 + 1.6 }, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, z: jb.z }];
    corner(pts, jb); pts.push({ x: jb.x, y: jb.y, z: jb.z });
    corner(pts, ex); pts.push({ x: ex.x, y: ex.y, z: jb.z });
    if (Math.abs(jb.z - at.q.z) > 0.01) pts.push({ x: ex.x, y: ex.y, z: at.q.z });
    corner(pts, at.q); pts.push({ x: at.q.x, y: at.q.y, z: at.q.z });
    tc.ids.slice().reverse().forEach(function (n) { pts.push(P(n)); });
    pts.push({ x: cab.x, y: cab.y, z: cab.z });
    var geo = 0; for (var i = 1; i < pts.length; i++) geo += dist3(pts[i - 1], pts[i]);
    return { pts: pts, len: Math.round(geo * 1.1 + 4) };
  }
  var GRSH = 'А-003', SRV = 'А-002';
  var feeds = REG.cabinets.map(function (c) {
    var rr = roomRoute(GRSH, c);
    return { cabinet: c.id, from: 'ГРЩ ' + GRSH + ' → ДБЖ шафи', cable: BUS.FEED.cable, len: rr.len, pts: rr.pts };
  });
  var uplinks = {};
  REG.cabinets.forEach(function (c) { var rr = roomRoute(SRV, c); uplinks[c.id] = { cabinet: c.id, from: 'Серверна ' + SRV, cable: BUS.UP.cable, len: rr.len, pts: rr.pts }; });
  links.forEach(function (l) { if (l.type === 'UP' && l.device.kind === 'cabinet') { var u = uplinks[l.device.cabinet]; if (u) { l.len = u.len; l.route = { pts: u.pts.slice().reverse(), len: u.len }; } } });

  REG.cabinets.forEach(function (c) {
    c.instances = inst[c.id] || [];
    c.controllers = c.instances.map(function (i) { return i.model; });
    c.units = c.instances.reduce(function (a, i) { return a + POOLS[i.model].u; }, 0) + 6;   // + ДБЖ, БЖ 24 В, автомати
  });

  /* Кабельний журнал: зіркові лінії — сума довжин; шини — магістраль + відгалуження один раз */
  function cables(cabId) {
    var out = {};
    function add(k, v) { if (k !== '—' && v) out[k] = (out[k] || 0) + v; }
    links.forEach(function (l) { if ((!cabId || l.device.cabinet === cabId) && !l.bus) add(l.cable, l.len); });
    buses.forEach(function (b) { if (!cabId || b.cabinet === cabId) add(BUS[b.type].cable, b.len); });
    feeds.forEach(function (f) { if (!cabId || f.cabinet === cabId) add(f.cable, f.len); });
    return out;
  }
  function forCabinet(id) { return links.filter(function (l) { return l.device.cabinet === id; }); }
  function forRoom(id) { return links.filter(function (l) { return l.device.room === id; }); }
  /* РК шафи: приміщення з лініями, відсортовані за відстанню по трасі */
  function jboxesFor(cabId) {
    var m = {};
    forCabinet(cabId).forEach(function (l) {
      if (!l.jbox || !l.route) return;
      var j = m[l.jbox] = m[l.jbox] || { jb: jboxes[l.device.room], room: l.device.room, links: [], at: l.route.tc ? l.route.tc.len : 0, len: 0 };
      j.links.push(l); if (!l.bus) j.len += l.len;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.at - b.at; });
  }
  /* Сегменти трас для показу на карті */
  function network(floor) {
    return segs.filter(function (s) { return floor == null || s.floor === floor || s.kind === 'riser' || (s.kind === 'trench' && floor === 0); })
      .map(function (s) { return { a: P(s.a), b: P(s.b), kind: s.kind, name: s.name, block: s.block, floor: s.floor }; });
  }

  return { POOLS: POOLS, BUS: BUS, BUSES: BUSES, links: links, feeds: feeds, uplinks: uplinks, buses: buses, cables: cables, forCabinet: forCabinet, forRoom: forRoom,
    jbox: function (roomId) { return jboxes[roomId]; }, jboxesFor: jboxesFor, instances: function (cab) { return inst[cab] || []; },
    route: deviceRoute, network: network, busesFor: function (cab) { return buses.filter(function (b) { return b.cabinet === cab; }); },
    feed: function (cab) { return feeds.filter(function (f) { return f.cabinet === cab; })[0]; }, uplink: function (cab) { return uplinks[cab]; } };
})();
