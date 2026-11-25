/* Енергоспоживання КОЖНОГО пристрою (ТЗ п. 3.5).
 *
 * Потужність пристрою в момент часу = паспортне значення (робочий / черговий режим)
 * × стан, який задають сценарій, розклад, присутність людей і ручні команди диспетчера.
 * Навантаження приміщень (світло, ПК, проєктор, клімат) рахує sensors.js і ділить між
 * пристроями приміщення; те, що не належить системі (серверна університету, обладнання
 * кабінетів, коридори, насоси), іде шаром «Інше навантаження корпусу».
 *
 * Джерела паспортних даних — у PASSPORT (поле src). Значення з позначкою ref:true —
 * довідкові типові для класу пристрою: звірити з паспортом обладнання, яке встановлять.
 * Сума за всіма пристроями = SK.energy.power() — показники в усіх розділах узгоджені.
 */
SK.devpower = (function () {
  var B = SK.building, U = SK.util, SEN = SK.sensors, REG = SK.devicesI3;

  /* Шари графіка (знизу вгору) */
  var LAYERS = [
    { id: 'other',   name: 'Інше навантаження корпусу', short: 'Інше', css: '#6c7f8f', note: 'коридори, насоси, вентиляція, серверна університету, обладнання кабінетів' },
    { id: 'system',  name: 'Система: датчики, автоматика, мережа, доступ', short: 'Система', css: '#3ecf8e' },
    { id: 'climate', name: 'Клімат, витяжка, жалюзі', short: 'Клімат', css: '#4fa3e0' },
    { id: 'sockets', name: 'ПК і проєктори (керовані розетки)', short: 'ПК і проєктори', css: '#9b8cff' },
    { id: 'boards',  name: 'Онлайн-дошки, табло, панелі', short: 'Дошки й табло', css: '#f472b6' },
    { id: 'light',   name: 'Освітлення', short: 'Світло', css: '#f2c94c' }
  ];
  var LAYER_OF = {
    light: 'light', pole: 'light', bench: 'light',
    hvac: 'climate', exhaust: 'climate', blinds: 'climate',
    sockets: 'sockets', board: 'boards', signage: 'boards', panel: 'boards'
  };
  function layerOf(kind) { return LAYER_OF[kind] || 'system'; }

  /* Паспортні дані, Вт. avg — середня в роботі; max — максимум за паспортом; stby — черговий режим. */
  var S = {
    dahuaPir: { t: 'Dahua ARD1112C (стельовий PIR): ≤ 30 мА @ 12 В, макс. 0,54 Вт', url: 'https://www.dahuasecurity.com/it/products/All-Products/Alarms/Wired-Alarm/Detectors/ARD1112C' },
    belimo:   { t: 'Belimo P-22RT (кімнатний датчик CO₂/T/RH, Modbus): 0,5 Вт DC', url: 'https://belimo.com/mam/general-documents/datasheets/en-gb/belimo_P-22RT..-1U00A-2_datasheet_en-gb.pdf' },
    aci:      { t: 'ACI TSENSE CO₂: макс. 2 Вт, середня < 0,35 Вт (без дисплея)', url: 'https://manualmachine.com/aciautomationcomponents/tsenseco2/16824331-data-sheet' },
    somfy:    { t: 'Somfy Sonesse 40 RS485: 120 Вт у роботі, 0,4 Вт у черговому', url: 'https://www.somfy.co.uk/products/1240557/sonesse-40-rs-485-6-20' },
    hikIfp:   { t: 'Hikvision DS-D5B75RB (75″ інтерактивна панель): середня 210 Вт, макс. 510 Вт, черговий 0,5 Вт', url: 'https://www.hikvision.com/content/dam/hikvision/en/support/regional-materials/moldova/Datasheet_DS-D5B75RB_ES_20240506.pdf' },
    zkFr:     { t: 'ZKTeco FR1500S (біометричний зчитувач): черговий 0,72 Вт, пік сканування 140 мА @ 12 В', url: 'https://www.zkteco.com/en/BiometricReader/FR1500S' },
    zkAtlas:  { t: 'ZKTeco Atlas Bio (контролер доступу): 9 Вт', url: 'https://www.zkteco.com/en/Atlas_Series/Atlas-Bio-Series' },
    halo:     { t: 'HALO Smart Sensor 3C (вейп-детектор): PoE 802.3af, 11 Вт', url: 'https://www.pelco.com/fs/documents/pelco-halo-smart-sensor-3c-3pc-specsheet-en-100626.pdf' },
    hikCam:   { t: 'Hikvision DS-2CD2143G2-IU (4 Мп купольна): PoE макс. 6,5 Вт', url: 'https://www.hikvision.com/ro/products/IP-Products/Network-Cameras/acusense-series/ds-2cd2143g2-iu' },
    vs121:    { t: 'Milesight VS121-P (лічильник людей у зоні): 4,5 Вт від PoE 802.3af', url: 'https://www.milesight.com/iot/product/lorawan-sensor/vs121' },
    vs133:    { t: 'Milesight VS133-P (ToF-лічильник проходів): типово 9,4 Вт, макс. 23,8 Вт (PoE 802.3at)', url: 'https://resource.milesight.com/milesight/iot/document/vs133-p-datasheet-en.pdf' },
    u6:       { t: 'Ubiquiti U6 Lite (Wi-Fi 6): макс. 12 Вт', url: 'https://techspecs.ui.com/unifi/wifi/u6-lite' },
    usw:      { t: 'UniFi Enterprise 24 PoE (ядро L3): макс. 60 Вт без PoE-навантаження', url: 'https://techspecs.ui.com/unifi/switching/usw-enterprise-24-poe' },
    dahuaSw:  { t: 'Dahua PFS4226-24ET-240 (PoE-комутатор): 10 Вт без навантаження', url: 'https://www.dahuasecurity.com/uk/products/All-Products/Transmission/PoE-Switches/Desktop-PoE-Switch/PFS4226-24ET-240' },
    atom:     { t: 'i3 Engineering Atom (Argon / Ferrum / Carbon / Helium / Neon + R12): живлення 9–48 В DC, споживана потужність макс. 15 Вт', url: 'https://4d.in.ua/9-atom-argon.html' },
    i3em:     { t: 'i3 Engineering Energy Meter i3-EM-1: < 2 Вт', url: 'https://i3engineering.com/accessories-ua/energy-meter-i3-em-1' },
    ref:      { t: 'Довідкове значення для класу пристрою — звірити з паспортом обладнання, яке встановлять', url: '' }
  };
  var PASSPORT = {
    pir:       { avg: 0.36, max: 0.54, stby: 0.36, src: 'dahuaPir', how: 'постійно' },
    counter:   { avg: 4.5, max: 4.5, stby: 4.5, src: 'vs121', how: 'постійно (PoE)' },
    counterDoor: { avg: 9.4, max: 23.8, stby: 9.4, src: 'vs133', how: 'постійно, типово 9,4 Вт (PoE)' },
    temp:      { avg: 0.005, max: 0.0075, stby: 0.005, src: 'ref', ref: true, how: 'постійно (1-Wire DS18B20, ≈ 1 мА @ 5 В під час вимірювання)' },
    co2:       { avg: 0.5, max: 2, stby: 0.5, src: 'belimo', how: 'постійно' },
    pm:        { avg: 0.6, max: 1.5, stby: 0.6, src: 'ref', ref: true, how: 'постійно' },
    light:     { avg: null, max: null, stby: 0, src: 'ref', ref: true, how: '9 Вт/м² LED × рівень диммування за сценарієм' },
    hvac:      { avg: null, max: null, stby: 1, src: 'ref', ref: true, how: 'за режимом вентиляції і кількістю людей; черговий 1 Вт' },
    blinds:    { avg: 0.4, max: 120, stby: 0.4, src: 'somfy', how: '120 Вт ≈ 45 с на кожне переміщення (зміна сценарію / початок і кінець пари)' },
    sockets:   { avg: null, max: null, stby: 0, src: 'ref', ref: true, how: 'ПК 110 Вт у роботі / 35 Вт простій / 4 Вт сон; проєктор 280 Вт' },
    board:     { avg: 210, max: 510, stby: 0.5, src: 'hikIfp', how: 'увімкнена під час пари / презентації' },
    signage:   { avg: 95, max: 120, stby: 0.5, src: 'ref', ref: true, how: '07:00–21:00 (55″ табло)' },
    panel:     { avg: 3, max: 5, stby: 3, src: 'ref', ref: true, how: 'постійно (настінна панель)' },
    finger:    { avg: 0.72, max: 1.7, stby: 0.72, src: 'zkFr', how: 'постійно; замок fail-secure у спокої не споживає' },
    turnstile: { avg: 30, max: 60, stby: 30, src: 'ref', ref: true, how: 'постійно' },
    door:      { avg: 0, max: 0, stby: 0, src: 'ref', ref: true, how: 'пасивний геркон: струм входу контролера < 0,01 Вт' },
    leak:      { avg: 0.05, max: 0.1, stby: 0.05, src: 'ref', ref: true, how: 'постійно' },
    vape:      { avg: 11, max: 11, stby: 11, src: 'halo', how: 'постійно (PoE)' },
    camera:    { avg: 4.5, max: 6.5, stby: 4.5, src: 'hikCam', how: 'вдень ≈ 4,5 Вт, уночі з ІЧ-підсвіткою 6,5 Вт' },
    wifi:      { avg: 7, max: 12, stby: 5, src: 'u6', how: '5 Вт + до 7 Вт за навантаженням (люди в корпусі)' },
    cabinet:   { avg: null, max: null, stby: null, src: 'atom', how: 'контролери Atom (типово 6 Вт, макс. 15 Вт) + PoE-комутатор 10 Вт + втрати БЖ 10 %' },
    server:    { avg: 250, max: 400, stby: 250, src: 'ref', ref: true, how: 'цілодобово' },
    accsrv:    { avg: 9, max: 9, stby: 9, src: 'zkAtlas', how: 'цілодобово' },
    core:      { avg: 40, max: 60, stby: 40, src: 'usw', how: 'цілодобово' },
    console:   { avg: 450, max: 600, stby: 450, src: 'ref', ref: true, how: 'диспетчерська працює цілодобово' },
    upsc:      { avg: null, max: null, stby: 150, src: 'ref', ref: true, how: 'втрати онлайн-ДБЖ: 150 Вт + 4 % навантаження категорії I' },
    upscab:    { avg: 3, max: 8, stby: 3, src: 'ref', ref: true, how: 'підзаряд АКБ / втрати' },
    meter:     { avg: 2, max: 2, stby: 2, src: 'i3em', how: 'постійно' },
    ats:       { avg: 6, max: 10, stby: 6, src: 'ref', ref: true, how: 'постійно' },
    gen:       { avg: 10, max: 610, stby: 10, src: 'ref', ref: true, how: 'контролер ДГУ 10 Вт + підігрів двигуна 600 Вт з листопада по березень' },
    parking:   { avg: 5, max: 8, stby: 5, src: 'ref', ref: true, how: 'шлюз; датчики паркомісць — на батареях' },
    bench:     { avg: 15, max: 30, stby: 2, src: 'ref', ref: true, how: 'підсвітка й USB з заходу сонця до 23:00, інакше 2 Вт' },
    exhaust:   { avg: 450, max: 450, stby: 40, src: 'ref', ref: true, how: '450 Вт під час роботи, 40 Вт мінімальний режим' },
    pole:      { avg: 40, max: 40, stby: 0, src: 'ref', ref: true, how: '40 Вт LED уночі; без руху поруч — 30 %' }
  };
  var CTRL_TYP = 6, CTRL_MAX = 15, POE_SW = 10;
  /* Пристрої, потужність яких рахується від навантаження приміщення (sensors.js) */
  var ROOM_KINDS = { light: 1, sockets: 1, hvac: 1, board: 1, exhaust: 1, blinds: 1 };

  /* Схід / захід сонця для Чернівців (≈ 48,3° пн. ш.), хв від півночі за місцевим часом — наближено */
  function sunTimes(date) {
    var start = new Date(date.getFullYear(), 0, 0), doy = Math.floor((date - start) / 86400000);
    var dl = 12 + 3.9 * Math.sin(2 * Math.PI * (doy - 80) / 365);          // тривалість дня, год
    var dst = date.getTimezoneOffset() < new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    var noon = 11.9 * 60 + (dst ? 60 : 0);
    return { rise: noon - dl * 30, set: noon + dl * 30 };
  }

  /* ---------- Реєстр «споживачів»: пристрої + приміщення/блоки без пристроїв ---------- */
  var entries = [], byRoom = {}, devIndex = {};
  function addEntry(o) { o.i = entries.length; entries.push(o); return o; }
  REG.devices.forEach(function (d) {
    var e = addEntry({ id: d.id, dev: d, kind: d.kind, name: d.label || REG.KINDS[d.kind].name + (d.room ? ' · ' + d.room : ''), layer: layerOf(d.kind), room: d.room, block: d.block, floor: d.floor });
    devIndex[d.id] = e.i;
    if (d.room) { var br = byRoom[d.room] = byRoom[d.room] || {}; (br[d.kind] = br[d.kind] || []).push(e); }
  });
  /* Навантаження приміщень, для яких немає окремого пристрою в реєстрі */
  var roomExtra = {};
  B.rooms.forEach(function (r) {
    var br = byRoom[r.id] || {};
    roomExtra[r.id] = {
      light: br.light ? null : addEntry({ id: 'R:' + r.id + ':light', name: 'Освітлення ' + r.id, layer: 'light', room: r.id, block: r.block, floor: r.floor, pseudo: true }),
      sockets: br.sockets ? null : addEntry({ id: 'R:' + r.id + ':sockets', name: 'Розетки ' + r.id, layer: 'sockets', room: r.id, block: r.block, floor: r.floor, pseudo: true }),
      hvac: br.hvac ? null : addEntry({ id: 'R:' + r.id + ':hvac', name: 'Клімат ' + r.id, layer: 'climate', room: r.id, block: r.block, floor: r.floor, pseudo: true }),
      fixed: addEntry({ id: 'R:' + r.id + ':fixed', name: 'Обладнання приміщення ' + r.id + ' (поза системою)', layer: 'other', room: r.id, block: r.block, floor: r.floor, pseudo: true })
    };
  });
  var baseEntries = {};
  ['A', 'B', 'C'].forEach(function (b) {
    baseEntries[b] = addEntry({ id: 'BASE:' + b, name: 'Коридори, вентиляція, насоси — ' + B.blockById(b).name, layer: 'other', block: b, floor: null, pseudo: true });
  });

  /* ---------- Потужність усіх споживачів у момент date ---------- */
  function snapshot(date, opts) {
    opts = opts || {};
    var out = new Float64Array(entries.length);
    var m = date.getHours() * 60 + date.getMinutes(), day = U.dow(date), outage = SK.power ? SK.power.isOutage(date) : false;
    var sun = sunTimes(date), dark = m < sun.rise || m > sun.set;
    var people = 0, rs = {};

    B.rooms.forEach(function (r) {
      var v = SEN.read(r.id, date, opts), br = byRoom[r.id] || {}, ex = roomExtra[r.id], p = v.parts;
      rs[r.id] = v; people += v.people;
      function split(list, total, pseudo) {
        if (list && list.length) list.forEach(function (e) { out[e.i] += total / list.length; });
        else if (pseudo) out[pseudo.i] += total;
      }
      split(br.light, p.light, ex.light);
      split(br.sockets, p.pc + p.projector, ex.sockets);
      if (br.hvac) br.hvac.forEach(function (e) { out[e.i] += p.hvac / br.hvac.length + 1; }); else out[ex.hvac.i] += p.hvac;
      /* Інтерактивна панель — за паспортом: увімкнена, якщо сценарій вмикає дошку */
      if (br.board) br.board.forEach(function (e) { out[e.i] += p.board > 0 ? PASSPORT.board.avg : PASSPORT.board.stby; });
      else if (p.board > 0) out[ex.fixed.i] += p.board;
      /* Витяжка кімнати для куріння — частина «fixed» у sensors.js */
      if (r.type === 'smoking' && br.exhaust) { split(br.exhaust, p.fixed, null); }
      else out[ex.fixed.i] += p.fixed;
      /* Жалюзі: рух на початку і в кінці пари або при зміні режиму */
      if (br.blinds) {
        var moving = 0, segs = SK.schedule.occupancy(r.id, date);
        segs.forEach(function (s) { if ((m >= s.s - 1 && m < s.s + 1) || (m >= s.e && m < s.e + 2)) moving = 1; });
        br.blinds.forEach(function (e) { out[e.i] += moving ? PASSPORT.blinds.max * 45 / 120 : PASSPORT.blinds.stby; });
      }
    });

    var load = Math.min(1, people / 900);
    entries.forEach(function (e) {
      var d = e.dev; if (!d || ROOM_KINDS[d.kind] && d.room) return;
      var P = PASSPORT[d.kind], w = 0;
      if (!P) return;
      switch (d.kind) {
        case 'camera': w = dark ? P.max : P.avg; break;
        case 'wifi': w = P.stby + 7 * load; break;
        case 'signage': w = m >= 7 * 60 && m < 21 * 60 && !outage ? P.avg : P.stby; break;
        case 'bench': w = dark && m < 23 * 60 && m > 12 * 60 ? P.avg : P.stby; break;
        case 'pole': w = dark ? (U.hash01(d.id + Math.floor(m / 10)) > 0.75 ? P.avg : P.avg * 0.3) : 0; break;
        case 'gen': w = P.avg + ([10, 11, 0, 1, 2].indexOf(date.getMonth()) >= 0 ? 600 : 0); break;
        case 'cabinet':
          var cab = REG.cabinet(d.label) || REG.cabinet(d.cabinet), insts = SK.wiring ? SK.wiring.instances(cab ? cab.id : d.cabinet) : [];
          var nCtl = insts.filter(function (i) { return i.model.indexOf('Atom') === 0; }).length, poe = insts.some(function (i) { return i.model.indexOf('PoE') >= 0; });
          w = (nCtl * CTRL_TYP + (poe ? POE_SW : 0) + insts.filter(function (i) { return i.model.indexOf('доступу') >= 0; }).length * 9) * 1.1;
          break;
        case 'upsc': w = null; break;          // рахується наприкінці від навантаження категорії I
        default: w = P.avg;
      }
      if (w == null) return;
      if (SK.control && SK.control.isOff && SK.control.isOff(d)) w = P.stby || 0;
      if (outage && (d.kind === 'signage' || d.kind === 'bench')) w = 0;
      out[e.i] = w;
    });
    /* Втрати центрального ДБЖ: 150 Вт + 4 % від категорії I (сервер, ядро, диспетчерська, шафи) */
    var cat1 = 0;
    entries.forEach(function (e) { if (e.dev && /^(server|core|accsrv|console|cabinet)$/.test(e.kind)) cat1 += out[e.i]; });
    entries.forEach(function (e) { if (e.kind === 'upsc') out[e.i] = 150 + cat1 * 0.04; });
    /* Базове навантаження блоків */
    var bl = SK.energy && SK.energy.baseLoad ? SK.energy.baseLoad(date) : { A: 0, B: 0, C: 0 };
    out[baseEntries.A.i] += bl.A; out[baseEntries.B.i] += bl.B; out[baseEntries.C.i] += bl.C;
    return out;
  }

  /* Підсумок знімка за блоками (для SK.energy.power) */
  function byBlock(date, opts) {
    var v = snapshot(date, opts), res = { A: 0, B: 0, C: 0, T: 0, total: 0 };
    entries.forEach(function (e) { var b = e.block === 'T' ? 'T' : e.block; res[b] = (res[b] || 0) + v[e.i]; res.total += v[e.i]; });
    res.C += res.T;          // територія живиться від блоку Б/П — показуємо разом з перемичкою
    return res;
  }

  /* ---------- Добовий профіль з кроком STEP хв (кешується) ---------- */
  var STEP = 5, dayCache = {};
  function stateKey(date) {
    var st = SK.store.state;
    return U.dateKey(date) + '|' + JSON.stringify(st.settings.automation) + '|' + st.bookings.length + '|' + st.customLessons.length + '|' + st.removedLessons.length +
      '|' + JSON.stringify(st.power.outages) + '|' + JSON.stringify(st.scenarioCfg || 0).length + '|' + JSON.stringify(st.manualOff || st.control || 0).length;
  }
  function day(date) {
    var key = stateKey(date);
    if (dayCache[key]) return dayCache[key];
    var d0 = new Date(date); d0.setHours(0, 0, 0, 0);
    var n = 24 * 60 / STEP, vals = new Array(n);
    for (var k = 0; k < n; k++) vals[k] = snapshot(new Date(d0.getTime() + (k * STEP + STEP / 2) * 60000), { ignoreManual: true });
    if (Object.keys(dayCache).length > 8) dayCache = {};
    return (dayCache[key] = { date: d0, step: STEP, vals: vals });
  }

  /* Фільтр споживачів: {scope:'all'|'block'|'floor'|'room'|'device', block, floor, room, device} */
  function match(e, f) {
    if (!f || !f.scope || f.scope === 'all') return true;
    if (f.scope === 'block') return e.block === f.block;
    if (f.scope === 'floor') return e.block === f.block && e.floor === +f.floor;
    if (f.scope === 'room') return e.room === f.room;
    if (f.scope === 'device') return e.id === f.device;
    if (f.scope === 'system') return e.layer === 'system';
    return true;
  }
  /* Ряд для графіка: [{t (хв), total, layers:{id:Вт}}] до upTo (хв) */
  function series(date, f, upTo) {
    var D = day(date), sel = entries.filter(function (e) { return match(e, f); });
    var out = [];
    D.vals.forEach(function (v, k) {
      var t = k * D.step; if (upTo != null && t > upTo) return;
      var ly = {}, tot = 0;
      LAYERS.forEach(function (L) { ly[L.id] = 0; });
      sel.forEach(function (e) { var w = v[e.i]; if (w) { ly[e.layer] += w; tot += w; } });
      out.push({ t: t, total: tot, layers: ly });
    });
    return out;
  }
  function peak(ser) {
    var p = null; ser.forEach(function (x) { if (!p || x.total > p.total) p = x; }); return p;
  }
  function kwh(ser, step) { return ser.reduce(function (a, x) { return a + x.total * (step || STEP) / 60 / 1000; }, 0); }
  /* Рейтинг споживачів за добу (кВт·год) */
  function ranking(date, f, upTo, n) {
    var D = day(date), sel = entries.filter(function (e) { return match(e, f); });
    var k1 = upTo == null ? D.vals.length : Math.min(D.vals.length, Math.floor(upTo / D.step) + 1);
    return sel.map(function (e) {
      var s = 0, mx = 0; for (var k = 0; k < k1; k++) { var w = D.vals[k][e.i]; s += w; if (w > mx) mx = w; }
      return { e: e, kwh: s * D.step / 60 / 1000, max: mx };
    }).filter(function (x) { return x.kwh > 0; }).sort(function (a, b) { return b.kwh - a.kwh; }).slice(0, n || 10);
  }
  /* Хто створює пік: найбільші споживачі на кроці t (хв) */
  function at(date, f, t, n) {
    var D = day(date), k = Math.min(D.vals.length - 1, Math.max(0, Math.floor(t / D.step))), v = D.vals[k];
    return entries.filter(function (e) { return match(e, f) && v[e.i] > 0; }).map(function (e) { return { e: e, w: v[e.i] }; })
      .sort(function (a, b) { return b.w - a.w; }).slice(0, n || 8);
  }
  /* Скільки пристроїв кожного типу в фільтрі */
  function kindsIn(f) {
    var o = {}; entries.forEach(function (e) { if (e.dev && match(e, f)) o[e.kind] = (o[e.kind] || 0) + 1; }); return o;
  }
  /* Потужність одного пристрою зараз (Вт) і профіль за добу */
  function deviceNow(d, date) { var i = devIndex[d.id]; return i == null ? 0 : snapshot(date)[i]; }
  function passportOf(kind) { var P = PASSPORT[kind]; return P ? { p: P, src: S[P.src] } : null; }

  return { LAYERS: LAYERS, PASSPORT: PASSPORT, SOURCES: S, STEP: STEP, entries: entries, snapshot: snapshot, byBlock: byBlock,
    day: day, series: series, peak: peak, at: at, kindsIn: kindsIn, match: match, kwh: kwh, ranking: ranking, deviceNow: deviceNow, passportOf: passportOf, layerOf: layerOf, sunTimes: sunTimes };
})();
